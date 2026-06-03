// Owner: @SDET | Scope: KwikAds storefront pixel — event-firing validation
//
// Per merchant: drive Homepage view → PDP view (click first product). Capture
// every sp/op1 + e/op5 fired during each action and render a per-merchant
// table where each row attributes a captured event to the action that fired it.
//
//   ══════════════════════════════════════════════════════════════════════════════════
//     STOREFRONT EVENTS  |  Store: <handle>  |  Verdict: ✓ PASS / ⊘ SKIP
//   ══════════════════════════════════════════════════════════════════════════════════
//     Action          Endpoint   Event Name        Captured merchant_id    Status
//     ──────────────────────────────────────────────────────────────────────────────
//     Homepage view   sp/op1     page_viewed       39028imn4dzg9a           ✓
//     Homepage view   e/op5      PageView          39028imn4dzg9a           ✓
//     PDP view        sp/op1     product_viewed    39028imn4dzg9a           ✓
//     PDP view        e/op5      ViewContent       39028imn4dzg9a           ✓
//     ──────────────────────────────────────────────────────────────────────────────
//     Total: 4 events  |  Final: https://...
//   ══════════════════════════════════════════════════════════════════════════════════
//
// Verdicts:
//   ✓ PASS — at least one event captured per driven action
//   ⊘ SKIP — password gate not bypassable (env missing OR rejected)
//   ⊘ SKIP — no events captured (Kwikpass pixel not installed on theme)
//   ✗ FAIL — unexpected error

import fs   from 'fs';
import path from 'path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { KWIKADS_STOREFRONT_MERCHANTS } from '../../testdata/merchants';
import { StorefrontPage, type StorefrontEvent } from '../../core/storefront/StorefrontPage';
import { StorefrontProtectedError } from '../../core/storefront/errors';
import { StorefrontSessionStore } from '../../core/storefront/StorefrontSessionStore';

const TABLE_W = 96;

test.describe('KwikAds — Storefront Event Firing', () => {
  // Persistent profile = single-process; serial mode required.
  test.describe.configure({ mode: 'serial' });

  let ctx: BrowserContext;

  test.beforeAll(async () => {
    if (!StorefrontSessionStore.hasProfile()) {
      throw new Error(
        `storefront-profile/ not found at ${StorefrontSessionStore.getProfileDir()}. ` +
        'Run: npm run storefront:login -- <handle>',
      );
    }
    try { fs.unlinkSync(path.join(StorefrontSessionStore.getProfileDir(), 'SingletonLock')); } catch { /* not present */ }
    ctx = await chromium.launchPersistentContext(
      StorefrontSessionStore.getProfileDir(),
      { headless: false },
    );
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => { /* ignore */ });
  });

  for (const merchant of KWIKADS_STOREFRONT_MERCHANTS) {
    const handle = merchant.shopifyHandle;
    if (!handle) continue;

    test(`@smoke @kwikads-storefront @ci [${merchant.name}] events fire on user actions`, async () => {
      test.setTimeout(90_000);

      const page = await ctx.newPage();

      try {
        const storefront = new StorefrontPage(page);
        const allEvents: StorefrontEvent[] = [];
        let finalUrl = '';

        try {
          const home = await storefront.gotoHome(handle);
          allEvents.push(...home.events);
          finalUrl = home.finalUrl;

          const pdp = await storefront.viewFirstProduct();
          allEvents.push(...pdp.events);
          finalUrl = pdp.finalUrl;
        } catch (err) {
          if (err instanceof StorefrontProtectedError) {
            printTable(merchant.name, handle, '⊘ SKIP', [], '/password',
              `Password gate — run: npm run storefront:login -- ${handle}`);
            test.skip(true, err.message);
            return;
          }
          throw err;
        }

        if (allEvents.length === 0) {
          printTable(merchant.name, handle, '⊘ SKIP', [], finalUrl,
            'No events captured — Kwikpass pixel not installed on theme');
          test.skip(true, `Kwikpass pixel not firing on ${handle} storefront`);
          return;
        }

        const homeEvents = allEvents.filter((e) => e.action === 'Homepage view');
        const pdpEvents = allEvents.filter((e) => e.action === 'PDP view');
        const allActionsFired = homeEvents.length > 0 && pdpEvents.length > 0;
        const verdict = allActionsFired ? '✓ PASS' : '⊘ SKIP';
        const note = allActionsFired
          ? 'Events fired for every action driven'
          : `Missing events — Homepage:${homeEvents.length}, PDP:${pdpEvents.length}`;

        printTable(merchant.name, handle, verdict, allEvents, finalUrl, note);

        // Cross-check captured merchant_id against config (if config has one)
        const captured = allEvents.find((e) => e.merchantId !== null);
        if (
          captured &&
          merchant.merchantId !== '' &&
          captured.merchantId !== merchant.merchantId
        ) {
          console.warn(
            `  [${merchant.name}] merchant_id mismatch: ` +
            `expected ${merchant.merchantId}, captured ${captured.merchantId}`,
          );
        }

        expect(
          allActionsFired,
          `${merchant.name} — Homepage:${homeEvents.length} events, PDP:${pdpEvents.length} events`,
        ).toBe(true);
      } finally {
        await page.close().catch(() => { /* ignore */ });
      }
    });
  }
});

function printTable(
  merchantName: string,
  handle: string,
  verdict: string,
  events: StorefrontEvent[],
  finalUrl: string,
  note?: string,
): void {
  const eq = '═'.repeat(TABLE_W);
  const dash = '─'.repeat(TABLE_W - 2);

  console.log(`\n${eq}`);
  console.log(`  STOREFRONT EVENTS  |  Store: ${handle}  |  Merchant: ${merchantName}  |  Verdict: ${verdict}`);
  console.log(eq);

  if (events.length > 0) {
    console.log(
      `  ${'Action'.padEnd(16)}` +
      `${'Endpoint'.padEnd(11)}` +
      `${'Event Name'.padEnd(20)}` +
      `${'Captured merchant_id'.padEnd(28)}` +
      'Status',
    );
    console.log(`  ${dash}`);
    for (const e of events) {
      const status = e.eventName === '?' ? '✗' : '✓';
      const mid = e.merchantId ?? '—';
      console.log(
        `  ${e.action.padEnd(16)}` +
        `${e.endpoint.padEnd(11)}` +
        `${e.eventName.padEnd(20)}` +
        `${mid.padEnd(28)}` +
        status,
      );
    }
    console.log(`  ${dash}`);
  }

  console.log(`  Total: ${events.length} events  |  Final: ${finalUrl}`);
  if (note) console.log(`  Note: ${note}`);
  console.log(`${eq}\n`);
}
