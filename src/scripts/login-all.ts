/**
 * login-all.ts — Global login orchestrator.
 *
 * Checks every session type in the framework, prints a status table,
 * then runs only the expired/missing ones — in dependency order,
 * one browser window at a time.
 *
 * Usage:
 *   npm run login:all           # smart — skips sessions that are still valid
 *   npm run login:force         # brute — refreshes every session unconditionally
 *
 * Execution order (enforced):
 *   1. GoKwik Dashboard         (independent)
 *   2. Shopify Partner          (independent; required before step 3)
 *   3. GK Admin bootstrap       (depends on Shopify Partner being valid)
 *   4. Storefront per-store     (independent; sequential — shared profile)
 *   5. Meta Ads Manager         (independent; last — may trigger 2FA)
 *
 * Each step calls the existing ts-node login script with stdio: 'inherit'
 * so the browser window and human prompts pipe through unchanged.
 * No new auth logic lives here — this is pure orchestration.
 */

import { spawnSync }  from 'child_process';
import path           from 'path';
import { checkAllSessions, type SessionStatus, type SessionKind } from '../core/auth/SessionChecker';
import { loadShopifyStores } from '../testdata/shopifyStoreslist';

const FORCE   = process.argv.includes('--force');
const COL_W   = 86;
const SCRIPTS = path.resolve(__dirname, '.');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(scriptFile: string, args: string[] = []): boolean {
  const result = spawnSync(
    'npx',
    ['ts-node', path.join(SCRIPTS, scriptFile), ...args],
    { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') },
  );
  return (result.status ?? 1) === 0;
}

function needsRefresh(s: SessionStatus): boolean {
  return FORCE || s.health !== 'valid';
}

function byKind(statuses: SessionStatus[], kind: SessionKind): SessionStatus {
  return statuses.find(s => s.kind === kind)!;
}

function healthIcon(h: SessionStatus['health']): string {
  if (h === 'valid')   return '✓';
  if (h === 'expired') return '⚠';
  return '✗';
}

function healthLabel(h: SessionStatus['health']): string {
  if (h === 'valid')   return 'VALID  ';
  if (h === 'expired') return 'EXPIRED';
  return 'MISSING';
}

// ─── Print helpers ─────────────────────────────────────────────────────────────

function printBanner(): void {
  const eq = '═'.repeat(COL_W);
  console.log(`\n${eq}`);
  console.log(`  KwikAds — Global Login${FORCE ? '  [--force: refreshing all]' : ''}`);
  console.log(`${eq}\n`);
}

function printStatusTable(statuses: SessionStatus[]): void {
  const dash = '─'.repeat(COL_W - 2);
  console.log(`  ${'Session'.padEnd(28)}${'Health'.padEnd(10)}Detail`);
  console.log(`  ${dash}`);
  for (const s of statuses) {
    const icon  = healthIcon(s.health);
    const label = healthLabel(s.health);
    const tag   = FORCE ? ' → will refresh' : s.health !== 'valid' ? ' → will refresh' : '';
    console.log(`  ${icon} ${s.label.padEnd(26)} ${label}  ${s.detail}${tag}`);
  }
  console.log(`  ${dash}\n`);
}

function printStep(n: number, total: number, label: string): void {
  const eq = '─'.repeat(COL_W);
  console.log(`\n${eq}`);
  console.log(`  [${n}/${total}]  ${label}`);
  console.log(`${eq}\n`);
}

function printDone(refreshed: string[], skipped: string[]): void {
  const eq = '═'.repeat(COL_W);
  console.log(`\n${eq}`);
  console.log('  Login summary');
  console.log(eq);
  if (refreshed.length > 0) {
    console.log(`  Refreshed (${refreshed.length}):`);
    for (const s of refreshed) console.log(`    ✓  ${s}`);
  }
  if (skipped.length > 0) {
    console.log(`  Skipped — already valid (${skipped.length}):`);
    for (const s of skipped) console.log(`    ·  ${s}`);
  }
  console.log(`\n  All sessions ready. Run your tests:\n`);
  console.log(`    npx playwright test --project=kwikads-validator`);
  console.log(`    npm test\n`);
  console.log(`${eq}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  printBanner();

  const statuses  = checkAllSessions();
  printStatusTable(statuses);

  const toRun   = statuses.filter(needsRefresh);
  const toSkip  = statuses.filter(s => !needsRefresh(s));

  if (toRun.length === 0) {
    console.log('  ✓ All sessions are valid — nothing to refresh.');
    console.log('  Run with --force (npm run login:force) to refresh everything.\n');
    return;
  }

  // Count total steps (storefront counts as 1 step regardless of store count)
  const totalSteps = toRun.length;
  let step = 1;
  const refreshed: string[] = [];
  const skipped:   string[] = toSkip.map(s => s.label);

  // ── 1. GoKwik ──────────────────────────────────────────────────────────────
  const gk = byKind(statuses, 'gokwik');
  if (needsRefresh(gk)) {
    printStep(step++, totalSteps, 'GoKwik Dashboard login');
    const ok = run('gokwik-login.ts');
    refreshed.push(`GoKwik Dashboard ${ok ? '✓' : '✗ (failed — re-run manually)'}`);
  }

  // ── 2. Shopify Partner ────────────────────────────────────────────────────
  const sp = byKind(statuses, 'shopify-partner');
  if (needsRefresh(sp)) {
    printStep(step++, totalSteps, 'Shopify Partner login');
    const ok = run('shopify-partner-login.ts');
    refreshed.push(`Shopify Partner ${ok ? '✓' : '✗ (failed — re-run manually)'}`);
  }

  // ── 3. GK Admin bootstrap (needs Shopify Partner) ─────────────────────────
  const gka = byKind(statuses, 'gkadmin-bootstrap');
  if (needsRefresh(gka)) {
    // Guard: Shopify Partner must be present (either was valid or we just ran it)
    const spValid = byKind(statuses, 'shopify-partner');
    if (!needsRefresh(spValid) || refreshed.some(r => r.startsWith('Shopify Partner ✓'))) {
      printStep(step++, totalSteps, 'GK Admin bootstrap — all stores');
      const ok = run('gk-admin-login.ts', ['all']);
      refreshed.push(`GK Admin bootstrap ${ok ? '✓' : '✗ (failed — re-run manually)'}`);
    } else {
      console.warn(
        '\n  ⚠  Skipping GK Admin bootstrap — Shopify Partner login failed or was not run.\n' +
        '      Fix Shopify Partner first, then re-run.\n',
      );
      refreshed.push('GK Admin bootstrap — SKIPPED (Shopify Partner unavailable)');
    }
  }

  // ── 4. Storefront — every store in shopifyStores.json ────────────────────
  const sf = byKind(statuses, 'storefront');
  if (needsRefresh(sf)) {
    const stores = loadShopifyStores();
    if (stores.length === 0) {
      console.warn(
        '\n  ⚠  shopifyStores.json is empty — skipping storefront logins.\n' +
        '      Run: npm run shopify:scrape-stores\n',
      );
      refreshed.push('Storefront — SKIPPED (shopifyStores.json empty)');
    } else {
      printStep(step++, totalSteps, `Storefront login — ${stores.length} store(s)`);
      let sfFailed = 0;
      for (let i = 0; i < stores.length; i++) {
        const store = stores[i]!;
        console.log(`  Store ${i + 1}/${stores.length}: ${store.handle}`);
        const ok = run('storefront-login.ts', [store.handle]);
        if (!ok) {
          console.warn(`  ✗  storefront-login failed for ${store.handle} — continuing`);
          sfFailed++;
        }
      }
      refreshed.push(
        `Storefront ${stores.length} store(s) ` +
        (sfFailed > 0 ? `✗ (${sfFailed} failed)` : '✓'),
      );
    }
  }

  // ── 5. Meta Ads Manager (last — may trigger 2FA) ──────────────────────────
  const meta = byKind(statuses, 'meta');
  if (needsRefresh(meta)) {
    printStep(step++, totalSteps, 'Meta Ads Manager login');
    const ok = run('meta-login.ts');
    refreshed.push(`Meta Ads Manager ${ok ? '✓' : '✗ (failed — re-run manually)'}`);
  }

  printDone(refreshed, skipped);
}

main();
