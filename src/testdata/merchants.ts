// Owner: @SDET | Scope: Shared test data — merchant registry
//
// Tag conventions:
//   @meta-benchmark      → eligible for meta-vs-dashboard.spec.ts (data parity check)
//   @kwikads-toggle      → eligible for kwikads-toggle.spec.ts (event-tracking state on dashboard)
//   @kwikads-storefront  → eligible for kwikads-storefront-events.spec.ts (storefront pixel firing)
//   @smoke               → daily-pass verified merchants (subset of either spec)
//   @regression          → known-failing or rare-run merchants (run on demand)
//   @critical            → must always pass — release-blocking
//
// Each spec imports ONLY its own subset. A merchant may carry multiple tags
// if it's relevant to multiple flows.
//
// Field semantics:
//   merchantId    — gokwik internal merchant id (string, not MID format)
//   adAccountId   — Meta/FB ad account id (`act_...`); only required for
//                   @meta-benchmark and @kwikads-toggle. Empty string for
//                   storefront-only merchants.
//   shopifyHandle — Shopify store slug (e.g. "som-qa-store"). Required for
//                   @kwikads-storefront; optional otherwise.

export interface MerchantConfig {
  name:           string;
  merchantId:     string;
  adAccountId:    string;
  shopifyHandle?: string;
  tags:           string[];
}

/**
 * Full merchant registry.
 *
 * Known data-pipeline bugs (not scraping bugs — do not fix by changing thresholds):
 *   - Macrame Cords Pari:  Spend ~7–14% off; CPM ~6–12% off; ROAS Meta shows "—"
 *   - Raho Saada:          CTR ~19–20% off (all-clicks vs link-clicks formula diff); ROAS Meta shows "—"
 */
export const ALL_MERCHANTS: MerchantConfig[] = [
  {
    name:          'qa.gokwik (prnab-test)',
    merchantId:    '4bzi40ahksbqurl7',
    adAccountId:   'act_1035682277234487',
    shopifyHandle: 'prnab-test',
    tags:          ['@kwikads-toggle', '@smoke'],
  },
  {
    name:          'astro-store-9980',
    merchantId:    '',           // gokwik mid TBD — will be captured live from sp/op1 body
    adAccountId:   '',
    shopifyHandle: 'astro-store-9980',
    tags:          ['@kwikads-storefront', '@smoke'],
  },
  {
    name:          'som-qa-store',
    merchantId:    '39028imn4dzg9a',
    adAccountId:   '',
    shopifyHandle: 'som-qa-store',
    tags:          ['@kwikads-storefront', '@smoke'],
  },
  {
    name:        'Creare X Unrush',
    merchantId:  '19g6hlyr50n6j',
    adAccountId: 'act_1543438996237925',
    tags:        ['@meta-benchmark', '@smoke', '@critical'],
  },
  {
    name:        'Macrame Cords Pari',
    merchantId:  '19g6im7uxama1',
    adAccountId: 'act_1247455895764678',
    tags:        ['@meta-benchmark', '@regression'],
  },
  {
    name:        'Raho Saada',
    merchantId:  '19g6ila23ecj7',
    adAccountId: 'act_1136644150469466',
    tags:        ['@meta-benchmark', '@regression'],
  },
  {
    name:        'New Ads Test',
    merchantId:  '19fan7mwgshu',
    adAccountId: 'act_3781545225208934',
    tags:        ['@meta-benchmark', '@regression'],
  },
];

/** Default merchants for meta-vs-dashboard.spec.ts (verified-passing daily smoke). */
export const META_BENCHMARK_MERCHANTS = ALL_MERCHANTS.filter(
  (m) => m.tags.includes('@meta-benchmark') && m.tags.includes('@smoke'),
);

/** Default merchants for kwikads-toggle.spec.ts. */
export const KWIKADS_TOGGLE_MERCHANTS = ALL_MERCHANTS.filter(
  (m) => m.tags.includes('@kwikads-toggle'),
);

/** Default merchants for kwikads-storefront-events.spec.ts. */
export const KWIKADS_STOREFRONT_MERCHANTS = ALL_MERCHANTS.filter(
  (m) => m.tags.includes('@kwikads-storefront'),
);
