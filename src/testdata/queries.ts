// Owner: @SDET | Scope: Shared test data — KwikAI query fixtures

export interface QueryFixture {
  /** Short identifier used as test label */
  label:   string;
  /** Natural-language prompt sent to the KwikAI assistant */
  message: string;
}

/**
 * KwikAI assistant query fixtures.
 * Used by kwik-ai-live.spec.ts for live SSE API tests.
 *
 * Out-of-context queries (not Meta Ads questions) will trigger KAAI's canned
 * self-identification response — use the OUT_OF_CONTEXT_QUERY for negative tests.
 */
export const KWIKAI_QUERIES: readonly QueryFixture[] = [
  {
    label:   'top-ads-yesterday',
    message: 'Show top 10 ads by ROAS for the last 7 days',
  },
  {
    label:   'fetch-performance-analytics',
    message: 'Show campaign performance analytics for the last 7 days',
  },
  {
    label:   'top-performing-demographics',
    message: 'Fetch the regional demographic data for the last 7 days and identify the top-performing region based on ROAS.',
  },
] as const;

/**
 * Out-of-context query — triggers KAAI's self-identification response.
 * Reply will contain "KAAI" or "specifically designed"; AiResponseParser returns ads: [].
 */
export const OUT_OF_CONTEXT_QUERY: QueryFixture = {
  label:   'out-of-context-redirect',
  message: 'What is the weather today?',
};
