// import { test, expect } from '@playwright/test';
// import { BenchmarkService } from '../../core/services/BenchmarkService';
// import { ComparisonReport, PeriodComparison } from '../../core/data-engine/DataComparator';
// import { MetaMetrics } from '../../core/meta-scraper/MetaDataScraper';
// import { META_BENCHMARK_MERCHANTS } from '../../testdata/merchants';
// import { fmtRange, fmtValue } from '../../core/utils/formatting';

// // Metrics scraped from Meta but not returned by the KwikAds API
// const META_ONLY_METRICS: Array<keyof MetaMetrics> = ['impressions', 'clicks', 'cpc'];

// // ─── Test merchants (imported from src/testdata/merchants.ts) ─────────────────
// const MERCHANTS = META_BENCHMARK_MERCHANTS;

// // ─── Date ranges ─────────────────────────────────────────────────────────────
// // Period 2 (After)  = 7 days ending 2 days ago
// // Period 1 (Before) = the 7 days immediately before Period 2

// function buildPeriods() {
//   const fmt   = (d: Date): string => d.toISOString().split('T')[0] as string;
//   const shift = (d: Date, days: number): Date => {
//     const r = new Date(d);
//     r.setDate(d.getDate() + days);
//     return r;
//   };

//   const today   = new Date();
//   const p2End   = shift(today, -2);
//   const p2Start = shift(p2End, -6);
//   const p1End   = shift(p2Start, -1);
//   const p1Start = shift(p1End, -6);

//   return {
//     periodOne: { startDate: fmt(p1Start), endDate: fmt(p1End) },
//     periodTwo: { startDate: fmt(p2Start), endDate: fmt(p2End) },
//   };
// }

// const { periodOne: PERIOD_ONE, periodTwo: PERIOD_TWO } = buildPeriods();

// // ─── Threshold ────────────────────────────────────────────────────────────────
// const MISMATCH_THRESHOLD = 5;

// // ─── Tests ────────────────────────────────────────────────────────────────────

// test.describe('KwikAds vs Meta — Benchmark Data Validation', () => {
//   // Serial: tests share a single persistent Chromium profile — concurrent access would corrupt the session.
//   test.describe.configure({ mode: 'serial' });

//   for (const merchant of MERCHANTS) {
//     test(`@smoke @critical @local-only [${merchant.name}] metrics match Meta Ads Manager`, async () => {
//       // Full run: API fetch + browser launch + column config + 2× date-range scrape.
//       // 90s global is too tight — allow up to 3 minutes.
//       test.setTimeout(180_000);

//       const service = new BenchmarkService(MISMATCH_THRESHOLD);

//       const report: ComparisonReport = await service.run({
//         merchantId:        merchant.merchantId,
//         adAccountId:       merchant.adAccountId,
//         periodOne:         PERIOD_ONE,
//         periodTwo:         PERIOD_TWO,
//         mismatchThreshold: MISMATCH_THRESHOLD,
//       });

//       const W      = 92;
//       const p1Lbl  = fmtRange(PERIOD_ONE);   // e.g. "01 Mar – 07 Mar 2026"
//       const p2Lbl  = fmtRange(PERIOD_TWO);   // e.g. "08 Mar – 14 Mar 2026"
//       const COL    = 24;                      // width for each date-range value column

//       // ══════════════════════════════════════════════════════════════════════
//       // TABLE 1 — META ADS MANAGER (scraped live from the browser)
//       // ══════════════════════════════════════════════════════════════════════
//       console.log(`\n${'═'.repeat(W)}`);
//       console.log(`  TABLE 1 — META ADS MANAGER  |  Merchant: ${merchant.name}  |  Scraped: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
//       console.log(`${'═'.repeat(W)}`);
//       console.log(
//         `  ${'Metric'.padEnd(13)}` +
//         `${p1Lbl.padEnd(COL)}` +
//         `${p2Lbl}`,
//       );
//       console.log(`  ${'─'.repeat(W - 2)}`);

//       for (const c of report.comparisons) {
//         console.log(
//           `  ${c.metric.toUpperCase().padEnd(13)}` +
//           `${fmtValue(c.before.metaValue).padEnd(COL)}` +
//           `${fmtValue(c.after.metaValue)}`,
//         );
//       }
//       console.log(`  ${'─'.repeat(W - 2)}`);
//       for (const key of META_ONLY_METRICS) {
//         console.log(
//           `  ${key.toUpperCase().padEnd(13)}` +
//           `${fmtValue(report.metaPeriodOne[key]).padEnd(COL)}` +
//           `${fmtValue(report.metaPeriodTwo[key])}`,
//         );
//       }
//       console.log(`${'═'.repeat(W)}`);

//       // ══════════════════════════════════════════════════════════════════════
//       // TABLE 2 — KWIKADS DASHBOARD (fetched from API)
//       // ══════════════════════════════════════════════════════════════════════
//       console.log(`\n${'═'.repeat(W)}`);
//       console.log(`  TABLE 2 — KWIKADS DASHBOARD  |  Merchant: ${merchant.name}  |  Source: API /ka/api/v1/bm/op1`);
//       console.log(`${'═'.repeat(W)}`);
//       console.log(
//         `  ${'Metric'.padEnd(13)}` +
//         `${p1Lbl.padEnd(COL)}` +
//         `${p2Lbl}`,
//       );
//       console.log(`  ${'─'.repeat(W - 2)}`);

//       for (const c of report.comparisons) {
//         console.log(
//           `  ${c.metric.toUpperCase().padEnd(13)}` +
//           `${fmtValue(c.before.kwikadsValue).padEnd(COL)}` +
//           `${fmtValue(c.after.kwikadsValue)}`,
//         );
//       }
//       console.log(`${'═'.repeat(W)}`);

//       // ══════════════════════════════════════════════════════════════════════
//       // TABLE 3 — PIVOT COMPARISON  (Meta vs KwikAds, pass/fail per cell)
//       // ══════════════════════════════════════════════════════════════════════
//       console.log(`\n${'═'.repeat(W)}`);
//       console.log(`  TABLE 3 — COMPARISON PIVOT  |  Merchant: ${merchant.name}  |  Threshold: ${MISMATCH_THRESHOLD}%  |  ${report.summary}`);
//       console.log(`${'═'.repeat(W)}`);
//       console.log(
//         `  ${'Metric'.padEnd(13)}` +
//         `${'Date Range'.padEnd(26)}` +
//         `${'Meta'.padEnd(12)}` +
//         `${'KwikAds'.padEnd(12)}` +
//         `${'Diff %'.padEnd(13)}` +
//         `Status`,
//       );
//       console.log(`  ${'─'.repeat(W - 2)}`);

//       for (const c of report.comparisons) {
//         const rows: Array<{ label: string; p: PeriodComparison }> = [
//           { label: p1Lbl, p: c.before },
//           { label: p2Lbl, p: c.after  },
//         ];
//         for (const { label, p } of rows) {
//           const diff   = p.diffPercent !== null ? `${p.diffPercent.toFixed(2)}%` : 'N/A';
//           const status = p.isMismatch ? '✗ FAIL' : '✓ PASS';
//           console.log(
//             `  ${c.metric.toUpperCase().padEnd(13)}` +
//             `${label.padEnd(26)}` +
//             `${fmtValue(p.metaValue).padEnd(12)}` +
//             `${fmtValue(p.kwikadsValue).padEnd(12)}` +
//             `${diff.padEnd(13)}` +
//             `${status}`,
//           );
//         }
//       }
//       console.log(`${'═'.repeat(W)}\n`);

//       // ─── Assert ───────────────────────────────────────────────────────────
//       expect(
//         report.hasMismatch,
//         `Data mismatch for ${merchant.name}:\n` +
//         report.comparisons
//           .filter((c) => c.isMismatch)
//           .flatMap((c) => {
//             const lines: string[] = [];
//             if (c.before.isMismatch)
//               lines.push(`  ${c.metric.toUpperCase()} ${p1Lbl}: Meta=${c.before.metaValue}, KwikAds=${c.before.kwikadsValue}, diff=${c.before.diffPercent?.toFixed(2)}%`);
//             if (c.after.isMismatch)
//               lines.push(`  ${c.metric.toUpperCase()} ${p2Lbl}: Meta=${c.after.metaValue}, KwikAds=${c.after.kwikadsValue}, diff=${c.after.diffPercent?.toFixed(2)}%`);
//             return lines;
//           })
//           .join('\n'),
//       ).toBe(false);
//     });
//   }
// });
