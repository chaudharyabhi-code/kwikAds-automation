/**
 * storefront-login.ts — Bootstrap the password-gate cookie for a Shopify
 * dev-store storefront so the storefront spec can sail past the /password
 * page on subsequent runs.
 *
 * Usage:
 *   npm run storefront:login -- <handle>      # bootstrap one store by handle
 *   npm run storefront:login                  # interactive picker
 *
 * What it does:
 *   - Launches the persistent profile at `storefront-profile/`.
 *   - Navigates to https://<handle>.myshopify.com/.
 *   - If the storefront lands on /password, prints an action-required block
 *     and waits up to 5 minutes for YOU to enter the password manually.
 *   - As soon as the URL leaves /password (Shopify accepted the password and
 *     set the gate-bypass cookie), the script saves and exits.
 *   - Subsequent runs against this store reuse the cookie automatically.
 *
 * Each store has its own preview password — bootstrap each store once.
 * Cookies for different stores coexist in the same profile.
 *
 * To force a clean re-bootstrap for one store:
 *   delete the cookies for `<handle>.myshopify.com` (or wipe the whole profile)
 *   then re-run this script.
 */

import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { chromium } from '@playwright/test';
import { StorefrontSessionStore } from '../auth/StorefrontSessionStore';
import * as Stores from '../testdata/shopifyStoreslist';
import type { ShopifyStore } from '../testdata/shopifyStoreslist';
import { envConfig } from '../config/env.config';
import { logger } from '../utils/logger';
import { tryClickGoogleAccount } from '../auth/GoogleSSOHelper';
import { StorefrontPage, type StorefrontEvent } from '../pages/StorefrontPage';

const SHOPIFY_STORES: ShopifyStore[] = Stores.SHOPIFY_STORES ?? Stores.loadShopifyStores?.() ?? [];
const PASSWORD_GATE_PATTERN = /\/password(\?|$)/;
const LOGIN_TIMEOUT = 5 * 60 * 1000;

function describe(s: ShopifyStore): string {
  return s.name && !/^log in$/i.test(s.name) ? `${s.name}  (${s.handle})` : s.handle;
}

function pickByArg(arg: string): ShopifyStore | null {
  const needle = arg.trim().toLowerCase();
  return SHOPIFY_STORES.find(
    (s) => s.handle.toLowerCase() === needle || s.name.toLowerCase() === needle,
  ) ?? null;
}

async function promptForStore(): Promise<ShopifyStore> {
  console.log('\nAvailable stores:');
  SHOPIFY_STORES.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describe(s)}`));

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('\nWhich store? > ')).trim();
    const idx = parseInt(answer, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= SHOPIFY_STORES.length) {
      return SHOPIFY_STORES[idx - 1]!;
    }
    const match = pickByArg(answer);
    if (!match) throw new Error(`No store matched "${answer}"`);
    return match;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const TABLE_W = 78;
  const eq = '═'.repeat(TABLE_W);

  console.log(`\n╔${eq}╗`);
  console.log(`║  KwikAds — Storefront Password Bootstrap`.padEnd(TABLE_W + 1) + '║');
  console.log(`╚${eq}╝\n`);

  // ── Session status ────────────────────────────────────────────────────────
  const hasProfile = StorefrontSessionStore.hasProfile();
  console.log('  Session status:');
  if (hasProfile) {
    console.log(`  ✓ storefront-profile/ found at ${StorefrontSessionStore.getProfileDir()}`);
    console.log('    Existing cookies will be reused — only missing ones are bootstrapped.');
  } else {
    console.log(`  ⚠ storefront-profile/ not found — a fresh profile will be created.`);
  }
  console.log('');

  if (SHOPIFY_STORES.length === 0) {
    console.error('✗ shopifyStores.json is empty. Run: npm run shopify:scrape-stores\n');
    process.exit(1);
  }

  const arg = process.argv[2];
  const store = arg ? pickByArg(arg) : await promptForStore();
  if (!store) {
    console.error(`✗ Unknown store "${arg}". Run without an argument for an interactive picker.\n`);
    process.exit(1);
  }

  console.log(`Bootstrapping: ${describe(store)}\n`);

  const isCI = envConfig.isCI;
  const context = await chromium.launchPersistentContext(
    StorefrontSessionStore.getProfileDir(),
    {
      headless: false,
      args: [
        '--start-maximized',
        ...(isCI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      ],
      viewport: { width: 1920, height: 1080 },
    },
  );
  const page = await context.newPage();

  try {
    const storefrontHost = `${store.handle}.myshopify.com`;
    const storefrontUrl  = `https://${storefrontHost}/`;
    console.log(`Opening: ${storefrontUrl}\n`);
    await page.goto(storefrontUrl, { waitUntil: 'load', timeout: 30_000 });

    // "Bootstrap is done" requires BOTH:
    //   1. URL host is the storefront's own host (NOT accounts.shopify.com,
    //      NOT a Shopify SSO redirect, NOT shop.app, etc.)
    //   2. Pathname is not /password (gate dismissed)
    const isOnStorefront = (url: URL): boolean =>
      url.host === storefrontHost && !PASSWORD_GATE_PATTERN.test(url.pathname);

    const initialUrl = new URL(page.url());
    console.log(`  URL:               ${page.url()}`);
    console.log(`  on storefront:     ${isOnStorefront(initialUrl)}\n`);

    if (isOnStorefront(initialUrl)) {
      console.log('✓ No password gate — cookie already cached or store is public. Saving profile state.');
    } else {
      console.log('┌─────────────────────────────────────────────────────────────┐');
      console.log('│  ACTION REQUIRED                                            │');
      console.log('│                                                             │');
      console.log('│  1. Complete Google SSO if prompted.                        │');
      console.log('│  2. The script will auto-navigate back to the storefront    │');
      console.log('│     when it detects you settled on admin.shopify.com /      │');
      console.log('│     dev.shopify.com (Shopify Partner default landing).      │');
      console.log('│  3. Enter the dev-store password on the storefront page.    │');
      console.log('│  4. Script saves & exits the moment URL leaves /password    │');
      console.log(`│     and is on ${storefrontHost.padEnd(34)}│`);
      console.log('│                                                             │');
      console.log('│  Every redirect is logged below.                            │');
      console.log('│                                                             │');
      console.log('│  Waiting up to 5 minutes...                                 │');
      console.log('└─────────────────────────────────────────────────────────────┘\n');

      // Live URL logging
      const onNav = (frame: import('@playwright/test').Frame): void => {
        if (frame !== page.mainFrame()) return;
        const u = frame.url();
        try {
          const parsed = new URL(u);
          const matchMarker = isOnStorefront(parsed) ? '✓' : '·';
          console.log(`  [${matchMarker}] ${u}`);
        } catch { /* ignore */ }
      };
      page.on('framenavigated', onNav);

      // Hosts that mean "you finished SSO but Shopify dropped you on the
      // wrong page" — script auto-navigates back to the storefront.
      const STUCK_HOST = /^(admin|dev|partners)\.shopify\.com$/i;
      const POLL_INTERVAL_MS  = 2_000;
      const STUCK_DWELL_MS    = 5_000;  // wait this long on a stuck host before redirecting (let SSO settle)

      const startTime = Date.now();
      let stuckSinceMs: number | null = null;
      let settled = false;
      let lastLoggedState = '';

      try {
        while (Date.now() - startTime < LOGIN_TIMEOUT) {
          // Auto-click Google account tile if SSO chooser is showing.
          const clicked = await tryClickGoogleAccount(page, envConfig.gokwikSsoEmail);
          if (clicked) {
            console.log(`  → Google account auto-clicked (${envConfig.gokwikSsoEmail}) — waiting for redirect...`);
          }

          await page.waitForTimeout(POLL_INTERVAL_MS);

          let parsed: URL;
          try {
            parsed = new URL(page.url());
          } catch {
            continue;
          }

          // Log state changes (not every poll — only when hostname or path changes)
          const stateKey = `${parsed.hostname}${parsed.pathname.split('/')[1] ?? ''}`;
          if (stateKey !== lastLoggedState) {
            lastLoggedState = stateKey;
            if (/accounts\.google\.com/.test(parsed.hostname)) {
              console.log(`  ● Google SSO detected — auto-click will fire on next poll`);
            } else if (/accounts\.shopify\.com/.test(parsed.hostname)) {
              console.log(`  ● Shopify account chooser — waiting for redirect...`);
            } else if (STUCK_HOST.test(parsed.hostname)) {
              console.log(`  ● On ${parsed.hostname} (Shopify partner/admin) — will redirect back to storefront`);
            } else if (/\/password/.test(parsed.pathname)) {
              console.log(`  ● Password gate active — enter the dev-store password in the browser window`);
            }
          }

          if (isOnStorefront(parsed)) {
            settled = true;
            break;
          }

          if (STUCK_HOST.test(parsed.hostname)) {
            if (stuckSinceMs === null) {
              stuckSinceMs = Date.now();
            } else if (Date.now() - stuckSinceMs >= STUCK_DWELL_MS) {
              console.log(`  ⤴ Stuck on ${parsed.hostname} — auto-navigating back to ${storefrontHost}...`);
              await page.goto(storefrontUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
              stuckSinceMs = null;  // reset, may bounce a few times
            }
          } else {
            stuckSinceMs = null;  // moved off stuck host
          }
        }
      } finally {
        page.off('framenavigated', onNav);
      }

      if (!settled) {
        throw new Error(
          `Did not settle on ${storefrontHost} within 5 min. Last URL: ${page.url()}`,
        );
      }
      console.log(`\n✓ Settled on storefront: ${page.url()}`);
    }

    // Persistent context auto-persists on close — no explicit save call needed.
    logger.info(`[storefront-login] Profile dir → ${StorefrontSessionStore.getProfileDir()}`);
    console.log(`\n✓ Profile saved at ${StorefrontSessionStore.getProfileDir()}`);
    console.log(`  Storefront spec will now sail past the gate for ${store.handle}.`);

    // ── Quick pixel verification — capture events from homepage + first product ──
    console.log('\n  Verifying pixel events on storefront...\n');
    const verifyPage = await context.newPage();
    try {
      const sf = new StorefrontPage(verifyPage);
      const homeResult = await sf.gotoHome(store.handle).catch(() => ({ events: [], finalUrl: page.url() }));
      const pdpResult  = await sf.viewFirstProduct().catch(() => ({ events: [], finalUrl: verifyPage.url() }));
      const allEvents: StorefrontEvent[] = [...homeResult.events, ...pdpResult.events];
      printEventTable(store.handle, allEvents, pdpResult.finalUrl || homeResult.finalUrl);
    } catch {
      console.log('  (Pixel verification skipped — page could not load)\n');
    } finally {
      await verifyPage.close().catch(() => {});
    }
  } catch (err) {
    logger.error(`[storefront-login] Failed: ${(err as Error).message}`);
    console.error('\n✗ Bootstrap failed. See above for details.');
    console.error('  Common causes:');
    console.error('  - Password was not entered within 5 minutes');
    console.error('  - Wrong password (Shopify keeps redirecting back to /password)');
    console.error('  - Network issue reaching the storefront');
    process.exit(1);
  } finally {
    await context.close();
  }
}

main();

function printEventTable(handle: string, events: StorefrontEvent[], finalUrl: string): void {
  const W = 96;
  const eq   = '═'.repeat(W);
  const dash = '─'.repeat(W - 2);
  const verdict = events.length > 0 ? '✓ PIXEL FIRING' : '✗ NO EVENTS';

  console.log(`\n${eq}`);
  console.log(`  PIXEL VERIFICATION  |  Store: ${handle}  |  ${verdict}`);
  console.log(eq);

  if (events.length > 0) {
    console.log(
      `  ${'Action'.padEnd(16)}${'Endpoint'.padEnd(11)}${'Event Name'.padEnd(22)}${'Merchant ID'.padEnd(22)}Status`,
    );
    console.log(`  ${dash}`);
    for (const e of events) {
      console.log(
        `  ${e.action.padEnd(16)}${e.endpoint.padEnd(11)}${e.eventName.padEnd(22)}${(e.merchantId ?? '—').padEnd(22)}${e.eventName === '?' ? '✗' : '✓'}`,
      );
    }
    console.log(`  ${dash}`);
  } else {
    console.log(`  No events captured — Kwikpass pixel may not be installed on this theme.`);
    console.log(`  ${dash}`);
  }

  console.log(`  Total: ${events.length} event(s)  |  Final URL: ${finalUrl}`);
  if (events.length === 0) {
    console.log(`  Tip: If Kwikpass is not on this store the cookie is still saved correctly.`);
    console.log(`       The storefront spec will SKIP this store (no events = pixel not installed).`);
  }
  console.log(`${eq}\n`);
}
