// Owner: @SDET | Scope: KwikAds /kwikads/platforms — toggle-state validation
//
// One test per merchant. Per-merchant outcome printed as a table.
// Four outcomes:
//   - BLOCKED              → "Integrate KwikAds to continue"; SKIPPED
//   - META_NOT_ONBOARDED   → "Meta platform not connected"; SKIPPED
//   - TOGGLE_ON            → "Event tracking is ON"; PASSES
//   - TOGGLE_OFF           → "Event tracking is OFF"; FAILS
//
// Auth: launches `gokwik-profile/` (persistent Chromium profile produced by
// `npm run gokwik:login`). The dashboard SPA needs sessionStorage / IndexedDB
// that storageState alone can't capture — so we use the persistent profile,
// same pattern as Shopify Partner / Meta.
//
// Trade-off: serial mode (one persistent profile = single process). Acceptable
// while the toggle-merchant set is small.

import fs   from 'fs';
import path from 'path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { KWIKADS_TOGGLE_MERCHANTS } from '../../testdata/merchants';
import { KwikAdsPlatformsPage, type PlatformReadResult } from '../../core/kwikads-platforms/KwikAdsPlatformsPage';
import { GokwikSessionStore } from '../../core/gokwik-auth/GokwikSessionStore';

const TABLE_W = 92;

test.describe('KwikAds — Event-Tracking Toggle State', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: BrowserContext;

  test.beforeAll(async () => {
    if (!GokwikSessionStore.hasProfile()) {
      throw new Error(
        `gokwik-profile/ not found at ${GokwikSessionStore.getProfileDir()}. ` +
        'Run: npm run gokwik:login',
      );
    }
    try { fs.unlinkSync(path.join(GokwikSessionStore.getProfileDir(), 'SingletonLock')); } catch { /* not present */ }
    ctx = await chromium.launchPersistentContext(
      GokwikSessionStore.getProfileDir(),
      { headless: false },
    );
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => { /* ignore */ });
  });

  for (const merchant of KWIKADS_TOGGLE_MERCHANTS) {
    test(`@smoke @kwikads @ci [${merchant.name}] toggle state is ON`, async () => {
      test.setTimeout(60_000);

      const page = ctx.pages()[0] ?? await ctx.newPage();

      try {
        const platforms = new KwikAdsPlatformsPage(page);
        const result = await platforms.readPlatformState(merchant.adAccountId);

        switch (result.state) {
          case 'BLOCKED':
            printTable(merchant.name, merchant.adAccountId, '⊘ SKIP', result, 'Integrate KwikAds to continue');
            test.skip(true, `KwikAds not integrated for ${merchant.name}`);
            break;

          case 'META_NOT_ONBOARDED':
            printTable(merchant.name, merchant.adAccountId, '⊘ SKIP', result,
              'Meta platform not connected — complete Meta OAuth in dashboard');
            test.skip(true, `Meta platform not onboarded for ${merchant.name}`);
            break;

          case 'TOGGLE_ON':
            printTable(merchant.name, merchant.adAccountId, '✓ PASS', result,
              'Event tracking is ON for this merchant');
            expect(result.platform?.isEventTrackingEnabled).toBe(true);
            break;

          case 'TOGGLE_OFF':
            printTable(merchant.name, merchant.adAccountId, '✗ FAIL', result,
              'Event tracking is OFF — Phase 4 will auto-enable');
            expect(
              result.platform?.isEventTrackingEnabled,
              `Toggle is OFF for ${merchant.name}; auto-enable lands in Phase 4`,
            ).toBe(true);
            break;
        }
      } finally {
        await page.close().catch(() => { /* ignore */ });
      }
    });
  }
});

function printTable(
  merchantName: string,
  adAccountId: string,
  verdict: string,
  result: PlatformReadResult,
  note: string,
): void {
  const eq = '═'.repeat(TABLE_W);
  const dash = '─'.repeat(TABLE_W - 2);

  const rows: Array<[string, string]> = [
    ['State', result.state],
    ['AdAccount ID', adAccountId],
  ];
  if (result.platform) {
    rows.push(['Row ID', result.platform.id]);
    rows.push(['isActive', String(result.platform.isEventTrackingEnabled)]);
  }
  rows.push(['Final URL', result.finalUrl]);

  console.log(`\n${eq}`);
  console.log(`  TOGGLE STATE  |  Merchant: ${merchantName}  |  Verdict: ${verdict}`);
  console.log(eq);
  console.log(`  ${'Field'.padEnd(18)}Value`);
  console.log(`  ${dash}`);
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(18)}${v}`);
  }
  console.log(`  ${dash}`);
  console.log(`  Note: ${note}`);
  console.log(`${eq}\n`);
}
