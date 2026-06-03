/**
 * shopify-observe.ts — Open one store's Shopify admin and watch what happens.
 *
 * Usage:
 *   npm run shopify:observe                    # interactive prompt for store
 *   npm run shopify:observe -- prnab-test      # specific store by handle/name
 *
 * What it does:
 *   - Reuses the persistent Shopify Partner profile (no re-login).
 *   - Navigates to the store admin (NOT to /apps directly — we want to see
 *     where you click first).
 *   - Subscribes to: page navigations, popups, and "interesting" network
 *     requests (anything mentioning search, kwikpass, gokwik, app installation,
 *     or graphql operations whose body hints at the search/install flow).
 *   - Lets you click around manually until you press Enter in this terminal.
 *   - On exit, writes everything captured to:
 *       reports/shopify-observe-<store>-<timestamp>.log
 *     and prints a short summary inline.
 *
 * Use this to confirm Kwikpass is actually installed and to capture the exact
 * URLs / endpoints the manual flow walks through, so the automation script
 * can replicate them precisely.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import type { Page, Request, Frame } from '@playwright/test';

import { ShopifyPartnerAuthManager } from '../core/shopify-partner-auth/ShopifyPartnerAuthManager';
import * as Stores from '../testdata/shopifyStoreslist';
import type { ShopifyStore } from '../testdata/shopifyStoreslist';
import { logger } from '../core/utils/logger';

const SHOPIFY_STORES: ShopifyStore[] = Stores.SHOPIFY_STORES ?? Stores.loadShopifyStores?.() ?? [];

const REPORTS_DIR = path.resolve(__dirname, '../../reports');

// Match URLs/request paths that are useful when reverse-engineering the flow.
//
// Covers: Shopify search/install plumbing, gokwik admin/api hosts, and the
// usual suspects for storefront tracking pixels/events (pixel, beacon, track,
// collect, events). Broad on purpose — we'd rather over-capture during
// discovery than miss a critical endpoint.
const INTERESTING_PATTERN =
  /search|kwikpass|gokwik|app_installations|app_installation|app[_-]?launch|graphql|sidekick|kwikads|\bka\b|\bkp\b|track|pixel|beacon|analytics|\/events?\b|collect|monorail/i;

interface CapturedNav {
  ts: string;
  pageId: number;
  url: string;
  source: 'main' | 'popup' | 'frame';
}

interface CapturedRequest {
  ts: string;
  pageId: number;
  method: string;
  url: string;
  resourceType: string;
  postData?: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

function describe(store: ShopifyStore): string {
  if (store.name && !/^log in$/i.test(store.name)) {
    return `${store.name}  (${store.handle})`;
  }
  return store.handle;
}

function pickStore(arg: string | undefined): ShopifyStore | null {
  if (SHOPIFY_STORES.length === 0) {
    throw new Error(
      'shopifyStores.json is empty. Run `npm run shopify:scrape-stores` first.',
    );
  }
  if (!arg) return null;
  const needle = arg.trim().toLowerCase();
  const numeric = parseInt(needle, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= SHOPIFY_STORES.length) {
    return SHOPIFY_STORES[numeric - 1] ?? null;
  }
  return SHOPIFY_STORES.find(
    (s) => s.name.toLowerCase() === needle || s.handle.toLowerCase() === needle,
  ) ?? null;
}

async function promptForStore(): Promise<ShopifyStore> {
  console.log('\nAvailable stores:');
  SHOPIFY_STORES.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${describe(s)}`);
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('\nWhich store? > ')).trim();
    const picked = pickStore(answer);
    if (!picked) throw new Error(`No store matched "${answer}"`);
    return picked;
  } finally {
    rl.close();
  }
}

function attachWatchers(
  page: Page,
  source: CapturedNav['source'],
  navs: CapturedNav[],
  reqs: CapturedRequest[],
  pageIdRef: { id: number },
): void {
  const pageId = pageIdRef.id++;

  page.on('framenavigated', (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    navs.push({ ts: timestamp(), pageId, url: frame.url(), source });
    console.log(`[${source}#${pageId}] → ${frame.url()}`);
  });

  page.on('request', (req: Request) => {
    const url = req.url();
    if (!INTERESTING_PATTERN.test(url)) return;
    const entry: CapturedRequest = {
      ts: timestamp(),
      pageId,
      method: req.method(),
      url,
      resourceType: req.resourceType(),
    };
    const post = req.postData();
    if (post) {
      // Truncate huge bodies for the live log; full body still goes to file.
      entry.postData = post.length > 500 ? `${post.slice(0, 500)}…` : post;
    }
    reqs.push(entry);
    console.log(`[${source}#${pageId}] ${entry.method} ${entry.resourceType}  ${url}`);
  });
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  KwikAds — Shopify Observation Tool    ');
  console.log('========================================\n');

  const cliArg = process.argv[2];
  const store = (cliArg && pickStore(cliArg)) || (await promptForStore());

  console.log(`\nObserving store: ${describe(store)}`);
  console.log(`Admin URL:       ${store.adminUrl}\n`);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const auth = new ShopifyPartnerAuthManager();
  const navs: CapturedNav[] = [];
  const reqs: CapturedRequest[] = [];
  const pageIdRef = { id: 0 };

  try {
    const ctx = await auth.getAuthenticatedContext();

    // Watch every existing page + any future ones (popups/new tabs).
    ctx.on('page', (newPage) => {
      attachWatchers(newPage, 'popup', navs, reqs, pageIdRef);
    });

    const page = await ctx.newPage();
    attachWatchers(page, 'main', navs, reqs, pageIdRef);

    await page.goto(store.adminUrl, { waitUntil: 'load', timeout: 60_000 });

    console.log('────────────────────────────────────────');
    console.log(' Browser is now open. Drive the FULL flow:');
    console.log('   1. Search "kwikpass" → click app');
    console.log('   2. In GK admin: navigate to Kwikads → Platform');
    console.log('   3. Note the event-tracking toggle name + state');
    console.log('   4. Back in Shopify admin: click "View store" /');
    console.log('      "Online store" → opens storefront');
    console.log('   5. On storefront: visit homepage, add to cart,');
    console.log('      open a product — anything that should fire events');
    console.log('');
    console.log(' Every navigation + tracking-shaped network request');
    console.log(' will print here AND get saved to the JSON log.');
    console.log('────────────────────────────────────────');
    console.log(' >>> Press Enter when done, then close <<<');
    console.log('────────────────────────────────────────\n');

    const rl = readline.createInterface({ input: stdin, output: stdout });
    await rl.question('');
    rl.close();
  } catch (err) {
    logger.error(`Observe failed: ${(err as Error).message}`);
    console.error(`\n✗ Observe failed: ${(err as Error).message}\n`);
  } finally {
    await auth.close();

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(REPORTS_DIR, `shopify-observe-${store.handle}-${ts}.log`);
    const summary = {
      store,
      capturedAt: new Date().toISOString(),
      navigationCount: navs.length,
      requestCount: reqs.length,
      navigations: navs,
      requests: reqs,
    };
    fs.writeFileSync(logPath, JSON.stringify(summary, null, 2) + '\n');
    console.log(`\nCaptured ${navs.length} navigation(s) and ${reqs.length} interesting request(s).`);
    console.log(`Saved → ${logPath}\n`);
  }
}

main();
