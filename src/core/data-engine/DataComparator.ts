import { AdAccountMetrics, Metric } from '../api-client/BaseApiClient';
import { MetaMetrics, ExtendedMetaMetrics } from '../meta-scraper/MetaDataScraper';
import { logger } from '../utils/logger';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface PeriodComparison {
  metaValue: number;
  kwikadsValue: number | null; // null = API returned no data for this period
  diffPercent: number | null;  // null = cannot calculate (kwikadsValue is null)
  isMismatch: boolean;
}

export interface MetricComparison {
  metric: Metric;
  before: PeriodComparison;   // Period 1 — "before" range
  after: PeriodComparison;    // Period 2 — "after" range
  isMismatch: boolean;        // true if EITHER period has a mismatch
}

export interface ComparisonReport {
  adAccountId: string;
  adAccountName: string;
  threshold: number;            // the % tolerance used
  comparisons: MetricComparison[];
  hasMismatch: boolean;         // true if ANY metric/period is beyond the threshold
  summary: string;              // human-readable one-liner
  metaPeriodOne: MetaMetrics;   // raw scraped Meta values — period 1 (before)
  metaPeriodTwo: MetaMetrics;   // raw scraped Meta values — period 2 (after)
}

// ─── Comparator ───────────────────────────────────────────────────────────────

// Default tolerance: flag if values differ by more than 5%
const DEFAULT_THRESHOLD_PERCENT = 5;

// Maps API metric keys → ExtendedMetaMetrics object keys.
// The original 4 are always compared; the 7 new keys are only used when the
// API response includes them (guarded by `apiAccount.metrics[apiKey]` check).
const METRIC_MAP: Record<Metric, keyof ExtendedMetaMetrics> = {
  spend:       'spend',
  cpm:         'cpm',
  ctr:         'ctr',
  roas:        'roas',
  impressions: 'impressions',
  clicks:      'clicks',
  cpc:         'cpc',
  revenue:     'revenue',
  results:     'results',
  reach:       'reach',
  frequency:   'frequency',
};

export class DataComparator {
  private threshold: number;

  constructor(thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT) {
    this.threshold = thresholdPercent;
  }

  /**
   * Compares Meta scraped metrics for BOTH periods against the KwikAds API data.
   *
   * @param metaPeriodOne  - Values scraped from Meta for the "before" date range
   * @param metaPeriodTwo  - Values scraped from Meta for the "after" date range
   * @param apiAccount     - Single ad account entry from the KwikAds API response
   */
  compare(
    metaPeriodOne: MetaMetrics | ExtendedMetaMetrics,
    metaPeriodTwo: MetaMetrics | ExtendedMetaMetrics,
    apiAccount: AdAccountMetrics,
  ): ComparisonReport {
    const comparisons: MetricComparison[] = [];

    for (const [apiKey, metaKey] of Object.entries(METRIC_MAP) as [Metric, keyof ExtendedMetaMetrics][]) {
      // Skip metrics not present in either source — no comparison possible
      if (!(metaKey in metaPeriodOne)) continue;   // not in Meta (base MetaMetrics)
      if (!apiAccount.metrics[apiKey]) continue;   // not in API response for this account
      const p1 = metaPeriodOne as ExtendedMetaMetrics;
      const p2 = metaPeriodTwo as ExtendedMetaMetrics;

      const before = this.buildPeriodComparison(
        p1[metaKey] ?? 0,
        apiAccount.metrics[apiKey]?.before ?? null,
        apiKey,
        apiAccount.adAccountId,
        'BEFORE',
      );

      const after = this.buildPeriodComparison(
        p2[metaKey] ?? 0,
        apiAccount.metrics[apiKey]?.after ?? null,
        apiKey,
        apiAccount.adAccountId,
        'AFTER',
      );

      comparisons.push({ metric: apiKey, before, after, isMismatch: before.isMismatch || after.isMismatch });
    }

    const hasMismatch = comparisons.some((c) => c.isMismatch);
    const mismatchedMetrics = comparisons
      .filter((c) => c.isMismatch)
      .map((c) => {
        const periods = [
          c.before.isMismatch ? 'before' : '',
          c.after.isMismatch  ? 'after'  : '',
        ].filter(Boolean).join('/');
        return `${c.metric.toUpperCase()}(${periods})`;
      });

    const summary = hasMismatch
      ? `FAIL — ${apiAccount.adAccountName}: mismatch in [${mismatchedMetrics.join(', ')}] (threshold: ${this.threshold}%)`
      : `PASS — ${apiAccount.adAccountName}: all metrics within ${this.threshold}% tolerance`;

    logger.info(summary);

    return {
      adAccountId:   apiAccount.adAccountId,
      adAccountName: apiAccount.adAccountName,
      threshold:     this.threshold,
      comparisons,
      hasMismatch,
      summary,
      metaPeriodOne,
      metaPeriodTwo,
    };
  }

  private buildPeriodComparison(
    metaValue: number,
    kwikadsValue: number | null,
    metric: Metric,
    accountId: string,
    label: string,
  ): PeriodComparison {
    const diffPercent = this.calcDiffPercent(metaValue, kwikadsValue);
    const isMismatch  = diffPercent !== null && Math.abs(diffPercent) > this.threshold;

    if (isMismatch) {
      logger.warn(
        `MISMATCH [${accountId}] ${metric.toUpperCase()} ${label}: ` +
        `Meta=${metaValue}, KwikAds=${kwikadsValue}, diff=${diffPercent!.toFixed(2)}%`,
      );
    } else {
      logger.info(
        `OK [${accountId}] ${metric.toUpperCase()} ${label}: ` +
        `Meta=${metaValue}, KwikAds=${kwikadsValue ?? 'N/A'}, diff=${diffPercent?.toFixed(2) ?? 'N/A'}%`,
      );
    }

    return { metaValue, kwikadsValue, diffPercent, isMismatch };
  }

  /**
   * Calculates the percentage difference between two values.
   * Formula: ((meta - kwikads) / kwikads) * 100
   * Returns null if kwikadsValue is null or zero (division not possible).
   */
  private calcDiffPercent(metaValue: number, kwikadsValue: number | null): number | null {
    if (kwikadsValue === null || kwikadsValue === 0) return null;
    return ((metaValue - kwikadsValue) / kwikadsValue) * 100;
  }
}
