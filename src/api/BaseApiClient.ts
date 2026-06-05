import axios, { AxiosInstance, AxiosError } from 'axios';
import { envConfig } from '../config/env.config';
import { logger } from '../utils/logger';

// ─── Request / Response types ────────────────────────────────────────────────

export type Metric =
  | 'cpm' | 'ctr' | 'roas' | 'spend'             // original 4 — Benchmark API metrics
  | 'impressions' | 'clicks' | 'cpc'               // existing Meta metrics now API-typed
  | 'revenue' | 'results' | 'reach' | 'frequency'; // new extended metrics

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface BenchmarkRequest {
  periodOne: DateRange;
  periodTwo: DateRange;
  merchantIds: string[];
  metrics: Metric[];
  categories: string[];
  tags: string[];
}

export interface MetricValues {
  before: number | null;
  after: number | null;
  percentChange: number | null;
}

export interface AdAccountMetrics {
  adAccountId: string;
  adAccountName: string;
  metrics: Partial<Record<Metric, MetricValues>>;  // Partial — API may not return all metric types
}

export interface MerchantBenchmark {
  merchantId: string;
  totals: Partial<Record<Metric, MetricValues>>;
  adAccounts: AdAccountMetrics[];
}

export interface BenchmarkResponse {
  data: {
    data: MerchantBenchmark[];
  };
  success: boolean;
  status_code: number;
  timestamp: number;
  isSuccess: boolean;
  error: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class BaseApiClient {
  private readonly http: AxiosInstance;
  private authToken: string | null = null;
  
  constructor() {
    this.http = axios.create({
      baseURL: envConfig.apiBaseUrl,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.http.interceptors.request.use((config) => {
      if (this.authToken) {
        config.headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      return config;
    });
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;

      // Retry only on 5xx or network errors (no response)
      const isRetryable = !status || status >= 500;

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.warn(
          `Request failed (status=${status ?? 'network'}), retrying in ${delay}ms [${attempt}/${MAX_RETRIES - 1}]`,
        );
        await new Promise((res) => setTimeout(res, delay));
        return this.withRetry(fn, attempt + 1);
      }

      throw err;
    }
  }

  async fetchBenchmarkData(payload: BenchmarkRequest): Promise<BenchmarkResponse> {
    logger.info(
      `Fetching benchmark data — merchants: [${payload.merchantIds.join(', ')}], ` +
        `metrics: [${payload.metrics.join(', ')}]`,
    );

    const response = await this.withRetry(() =>
      this.http.post<BenchmarkResponse>('/ka/api/v1/bm/op1', payload),
    );

    if (!response.data.isSuccess) {
      throw new Error(`API error: ${response.data.error}`);
    }

    logger.info(`Benchmark data fetched — ${response.data.data.data.length} merchant(s) returned`);
    return response.data;
  }
}
