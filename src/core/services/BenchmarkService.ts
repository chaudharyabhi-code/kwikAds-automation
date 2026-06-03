import { BaseApiClient, BenchmarkRequest, DateRange, Metric } from '../api-client/BaseApiClient';
import { MetaAuthManager } from '../meta-scraper/MetaAuthManager';
import { MetaAdsNavigator } from '../meta-scraper/MetaAdsNavigator';
import { MetaDataScraper } from '../meta-scraper/MetaDataScraper';
import { DataComparator, ComparisonReport } from '../data-engine/DataComparator';
import { logger } from '../utils/logger';

// ─── Config passed in per test run ───────────────────────────────────────────

export interface BenchmarkRunConfig {
  merchantId: string;
  adAccountId: string;      // format: "act_XXXX"
  periodOne: DateRange;     // "before" period  (YYYY-MM-DD)
  periodTwo: DateRange;     // "after"  period  (YYYY-MM-DD)
  metrics?: Metric[];       // defaults to all 4
  mismatchThreshold?: number; // % tolerance, defaults to 5
}

// ─── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_METRICS: Metric[] = ['spend', 'cpm', 'ctr', 'roas'];

export class BenchmarkService {
  private apiClient: BaseApiClient;
  private comparator: DataComparator;

  constructor(mismatchThreshold?: number) {
    this.apiClient  = new BaseApiClient();
    this.comparator = new DataComparator(mismatchThreshold);
  }

  /**
   * Full benchmark run for one ad account:
   * 1. Fetch KwikAds API data
   * 2. Scrape Meta Ads Manager (reuses saved session if valid)
   * 3. Compare and return the report
   *
   * The browser is always closed in the finally block — even if a step fails.
   */
  async run(config: BenchmarkRunConfig): Promise<ComparisonReport> {
    const metrics = config.metrics ?? DEFAULT_METRICS;

    logger.info(
      `Starting benchmark run — merchant: ${config.merchantId}, account: ${config.adAccountId}`,
    );

    // ── Step 1: Fetch KwikAds API data ───────────────────────────────────────
    const apiPayload: BenchmarkRequest = {
      periodOne:   config.periodOne,
      periodTwo:   config.periodTwo,
      merchantIds: [config.merchantId],
      metrics,
      categories:  [],
      tags:        [],
    };

    const apiResponse = await this.apiClient.fetchBenchmarkData(apiPayload);

    // Find this merchant's data in the response
    const merchantData = apiResponse.data.data.find(
      (m) => m.merchantId === config.merchantId,
    );
    if (!merchantData) {
      throw new Error(`Merchant ${config.merchantId} not found in API response`);
    }

    // Find the specific ad account inside the merchant's data
    const apiAccount = merchantData.adAccounts.find(
      (a) => a.adAccountId === config.adAccountId,
    );
    if (!apiAccount) {
      throw new Error(`Ad account ${config.adAccountId} not found in API response`);
    }

    logger.info(`API data fetched for ${apiAccount.adAccountName}`);

    // ── Step 2: Scrape Meta Ads Manager ──────────────────────────────────────
    const auth = new MetaAuthManager();

    try {
      const context = await auth.getAuthenticatedContext();
      const nav     = await MetaAdsNavigator.create(context);
      const scraper = new MetaDataScraper(nav.getPage());

      await nav.goToAdAccount(config.adAccountId);

      // Configure columns once — they persist across date range changes
      await nav.configureColumns();

      // Scrape Period 1 ("before")
      logger.info(`Scraping Meta for Period 1 (before): ${config.periodOne.startDate} → ${config.periodOne.endDate}`);
      await nav.setDateRange(config.periodOne.startDate, config.periodOne.endDate);
      const metaPeriodOne = await scraper.scrapeTotalsRow();

      // Scrape Period 2 ("after")
      logger.info(`Scraping Meta for Period 2 (after): ${config.periodTwo.startDate} → ${config.periodTwo.endDate}`);
      await nav.setDateRange(config.periodTwo.startDate, config.periodTwo.endDate);
      const metaPeriodTwo = await scraper.scrapeTotalsRow();

      // ── Step 3: Compare both periods ──────────────────────────────────────
      const report = this.comparator.compare(metaPeriodOne, metaPeriodTwo, apiAccount);

      return report;

    } finally {
      // Always close the browser — success or failure
      await auth.close();
    }
  }
}
