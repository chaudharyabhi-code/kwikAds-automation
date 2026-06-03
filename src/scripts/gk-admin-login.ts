/**
 * gk-admin-login.ts — Bootstrap GK admin auth for one or more Shopify stores
 * by navigating Shopify dev admin → Apps → click Kwikpass → GK admin.
 *
 * Usage:
 *   npm run gkadmin:login                 # interactive — prompts which store
 *   npm run gkadmin:login -- all          # all stores from shopifyStores.json
 *   npm run gkadmin:login -- "Store Name" # one store by display name
 *   npm run gkadmin:login -- store-handle # one store by handle (slug)
 *
 * Prerequisites:
 *   1. `npm run shopify:login`            — Shopify Partner session
 *   2. `npm run shopify:scrape-stores`    — populates shopifyStores.json
 *
 * Per-store work runs in parallel tabs (concurrency cap 3) after the first
 * store completes serially to absorb any cold-start manual Google SSO.
 * Failures are scoped per-store; the batch is reported via a final summary
 * and exits 0 as long as at least one store succeeded.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';

import {
  GkAdminAuthManager,
  type StoreResult,
} from '../core/gk-admin-auth/GkAdminAuthManager';
import * as Stores from '../testdata/shopifyStoreslist';
import type { ShopifyStore } from '../testdata/shopifyStoreslist';

// Defensive: if for any reason the named export resolves to undefined
// (stale cache, transpile quirk), fall back to an empty list rather than
// crashing on `.length`.
const SHOPIFY_STORES: ShopifyStore[] = Stores.SHOPIFY_STORES ?? Stores.loadShopifyStores?.() ?? [];
import { logger } from '../core/utils/logger';

const REPORTS_DIR = path.resolve(__dirname, '../../reports');
const BOOTSTRAP_REPORT_PATH = path.join(REPORTS_DIR, 'gkadmin-bootstrap.json');

function describe(store: ShopifyStore): string {
  if (store.name && !/^log in$/i.test(store.name)) {
    return `${store.name}  (${store.handle})`;
  }
  return store.handle;
}

function resolveByArg(arg: string): ShopifyStore[] {
  const needle = arg.trim().toLowerCase();
  if (needle === 'all') return SHOPIFY_STORES;

  const match = SHOPIFY_STORES.find(
    (s) => s.name.toLowerCase() === needle || s.handle.toLowerCase() === needle,
  );
  if (!match) {
    const known = SHOPIFY_STORES.map(describe).join(', ');
    throw new Error(`Unknown store "${arg}". Known: ${known}`);
  }
  return [match];
}

function resolveByIndices(input: string): ShopifyStore[] {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  const picked: ShopifyStore[] = [];
  for (const part of parts) {
    const idx = parseInt(part, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > SHOPIFY_STORES.length) {
      throw new Error(`Invalid index "${part}" — must be 1..${SHOPIFY_STORES.length}`);
    }
    const store = SHOPIFY_STORES[idx - 1];
    if (store && !picked.includes(store)) picked.push(store);
  }
  return picked;
}

async function promptForStores(): Promise<ShopifyStore[]> {
  console.log('\nAvailable stores:');
  SHOPIFY_STORES.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${describe(s)}`);
  });
  console.log('\n  Enter a number, comma-separated numbers (e.g. 1,3,5),');
  console.log('  a store name/handle, or "all" to bootstrap every store.');
  console.log('  Press Ctrl+C to cancel.\n');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question('Select store > ')).trim();
    if (!answer) throw new Error('No selection provided');
    if (/^[\s,\d]+$/.test(answer)) return resolveByIndices(answer);
    return resolveByArg(answer);
  } finally {
    rl.close();
  }
}

async function pickStores(arg: string | undefined): Promise<ShopifyStore[]> {
  if (SHOPIFY_STORES.length === 0) {
    throw new Error(
      'shopifyStores.json is empty. Run `npm run shopify:scrape-stores` first.',
    );
  }
  if (arg) return resolveByArg(arg);
  return await promptForStores();
}

/**
 * Persists the bootstrap results keyed by store handle so that specs can read
 * kwikpass-install state without re-running the full auth flow.
 *
 * Schema per entry:
 *   { kwikpass: 'installed' | 'not-installed', gkAdminUrl?, durationMs, capturedAt }
 */
function writeBootstrapReport(results: StoreResult[]): void {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // Merge with any existing report so incremental runs (single store) don't
  // wipe out previously bootstrapped stores.
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(BOOTSTRAP_REPORT_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    // File doesn't exist yet — start fresh.
  }

  for (const r of results) {
    existing[r.store.handle] = {
      kwikpass: r.status === 'kwikpass-missing' ? 'not-installed' : 'installed',
      ...(r.gkAdminUrl ? { gkAdminUrl: r.gkAdminUrl } : {}),
      durationMs:  r.durationMs,
      capturedAt:  new Date().toISOString(),
    };
  }

  fs.writeFileSync(BOOTSTRAP_REPORT_PATH, JSON.stringify(existing, null, 2) + '\n');
  logger.info(`Bootstrap report written → ${BOOTSTRAP_REPORT_PATH}`);
}

function renderSummary(results: StoreResult[]): void {
  const success = results.filter((r) => r.status === 'success');
  const missing = results.filter((r) => r.status === 'kwikpass-missing');
  const errored = results.filter((r) => r.status === 'error');

  console.log('\n────────────────────────────────────────────────────');
  console.log(` Summary: ${success.length}/${results.length} stores authenticated`);
  console.log('────────────────────────────────────────────────────');

  for (const r of success) {
    console.log(`  ✓ ${r.store.handle.padEnd(50)} ${r.durationMs}ms`);
  }
  if (missing.length > 0) {
    console.log(`\n⚠  Kwikpass not installed (${missing.length}):`);
    for (const r of missing) console.log(`   - ${r.store.handle}`);
  }
  if (errored.length > 0) {
    console.log(`\n✗ Errors (${errored.length}):`);
    for (const r of errored) console.log(`   - ${r.store.handle}: ${r.error}`);
  }
  if (success.length > 0) {
    console.log('\n  Persistent profile:  shopify-partner-profile/');
    console.log('  Storage state file:  gk-admin.state.json\n');
  }
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  KwikAds — GK Admin Bootstrap Script   ');
  console.log('========================================\n');

  const stores = await pickStores(process.argv[2]);
  console.log(
    `\nBootstrapping ${stores.length} store(s): ${stores.map((s) => s.handle).join(', ')}`,
  );

  const auth = new GkAdminAuthManager();
  try {
    const results = await auth.bootstrapStores(stores);
    writeBootstrapReport(results);
    renderSummary(results);
    if (!results.some((r) => r.status === 'success')) process.exit(1);
  } catch (err) {
    logger.error(`Bootstrap aborted: ${(err as Error).message}`);
    console.error('\n✗ Bootstrap aborted. See above for details.');
    console.error('  Common causes:');
    console.error('  - Shopify Partner not logged in — run: npm run shopify:login');
    console.error('  - Stores list empty — run: npm run shopify:scrape-stores');
    console.error('  - Selector mismatch on Apps panel — refine GkAdminAuthManager');
    console.error('  - Manual SSO not completed within 5 minutes\n');
    process.exit(1);
  } finally {
    await auth.close();
  }
}

main();
