// Owner: @FE
// Scope: Per-store GK admin bootstrap via Shopify topbar search (Ctrl+K) →
//        click Kwikpass APP_INSTALLATION → popup deep-links to gokwik.* → land
//        on GK admin (manual Google SSO once).
//
// Public surface is `bootstrapStores(stores[])`. The first store runs serially
// to absorb the cold-start manual Google SSO; remaining stores run in parallel
// tabs (concurrency-bounded). Per-store failures are scoped — they never abort
// the batch. State is saved once at end; cookies have accumulated in the
// shared persistent context across all tabs.
//
// Flow verified against captured network trace 2026-04-29:
//   GET admin.shopify.com/api/operations/<hash>/Search/shopify/<handle>
//       ?operationName=Search
//       &variables={query:"kwikpass",types:["APP","APP_INSTALLATION"],...}
//   Click APP_INSTALLATION result → popup opens
//       qa-mdashboard.dev.gokwik.in/login?...&app=kwik_pass&redirect_to=...
//   Popup eventually settles on gokwik.* path that isn't /login or /signin.

import { BrowserContext, Page } from '@playwright/test';
import { ShopifyPartnerAuthManager } from './ShopifyPartnerAuthManager';
import { GkAdminStateFile } from './GkAdminSessionStore';
import { runWithConcurrency } from '../utils/concurrency';
import { logger } from '../utils/logger';
import { tryClickGoogleAccount } from './GoogleSSOHelper';
import { envConfig } from '../config/env.config';
import type { ShopifyStore } from '../testdata/shopifyStoreslist';
import { observeNetwork } from '../utils/network-observer';

// Match the dashboard host explicitly. The OAuth callback chain bounces
// through qa-merchant-api.dev.gokwik.io/api/gk-shp/kwik_pass/callback before
// landing on the dashboard — without specifying the host we'd return the
// in-flight callback page, which has no auth state established yet.
const GK_ADMIN_HOST_PATTERN = /^(qa-mdashboard\.dev|dashboard)\.gokwik\.(in|co)$/i;
const NAV_TIMEOUT_MS = 60_000;
const MANUAL_SSO_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const POPUP_WAIT_MS = 10_000;
const DEFAULT_CONCURRENCY = 3;

export type StoreStatus = 'success' | 'kwikpass-missing' | 'error';

export interface StoreResult {
  store: ShopifyStore;
  status: StoreStatus;
  durationMs: number;
  error?: string;
  gkAdminUrl?: string;
}

export class KwikpassNotInstalledError extends Error {
  constructor(public readonly storeName: string) {
    super(`Kwikpass app not found on store "${storeName}"`);
    this.name = 'KwikpassNotInstalledError';
  }
}

export class GkAdminAuthManager {
  private shopifyAuth = new ShopifyPartnerAuthManager();
  private context: BrowserContext | null = null;

  /**
   * Bootstrap GK admin auth for every supplied store.
   *
   * - First store runs serially (handles any cold-start manual Google SSO).
   * - Remaining stores run in parallel tabs, bounded by `opts.concurrency`.
   * - Per-store failures don't abort the batch; results carry their own status.
   * - Storage state is saved once at end (shopify-partner-profile cookies hold
   *   both Shopify and GK admin sessions after the SSO has completed).
   */
  async bootstrapStores(
    stores: readonly ShopifyStore[],
    opts: { concurrency?: number } = {},
  ): Promise<StoreResult[]> {
    if (stores.length === 0) return [];

    this.context = await this.shopifyAuth.getAuthenticatedContext();
    const limit = opts.concurrency ?? DEFAULT_CONCURRENCY;
    const results: StoreResult[] = new Array(stores.length);

    this.printSsoBanner();

    // First store: serial — absorbs the cold-start SSO if needed.
    logger.info(`[gk-admin] Bootstrapping store 1/${stores.length} serially: ${stores[0]!.handle}`);
    results[0] = await this.runStore(stores[0]!);

    // Remaining stores: parallel tabs, bounded.
    if (stores.length > 1) {
      const remaining = stores.slice(1);
      logger.info(
        `[gk-admin] Bootstrapping ${remaining.length} remaining store(s) ` +
        `with concurrency=${limit}`,
      );
      const settled = await runWithConcurrency(
        remaining,
        (store) => this.runStore(store),
        limit,
      );
      // runStore never throws (catches internally), so settled[i] is always
      // 'fulfilled'. The 'rejected' branch is a defensive safety net.
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]!;
        if (s.status === 'fulfilled') {
          results[i + 1] = s.value;
        } else {
          results[i + 1] = {
            store: remaining[i]!,
            status: 'error',
            durationMs: 0,
            error: String((s as PromiseRejectedResult).reason),
          };
        }
      }
    }

    await this.saveStorageState();
    return results;
  }

  /**
   * Opens a new tab, runs the per-store flow, captures result, closes the tab.
   * Never throws — returns a typed StoreResult.
   */
  private async runStore(store: ShopifyStore): Promise<StoreResult> {
    if (!this.context) throw new Error('runStore called before context init');
    const start = Date.now();
    const page = await this.context.newPage();
    try {
      const { gkAdminUrl } = await this.bootstrapStoreInPage(page, store);
      const durationMs = Date.now() - start;
      logger.info(`[gk-admin] ✓ ${store.handle} bootstrapped in ${durationMs}ms`);
      return { store, status: 'success', durationMs, gkAdminUrl };
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err instanceof KwikpassNotInstalledError) {
        return {
          store,
          status: 'kwikpass-missing',
          durationMs,
          error: 'Kwikpass not installed',
        };
      }
      const message = (err as Error).message ?? String(err);
      logger.warn(`[gk-admin] ✗ ${store.handle} failed: ${message}`);
      return { store, status: 'error', durationMs, error: message };
    } finally {
      await page.close().catch(() => { /* ignore */ });
    }
  }

  /**
   * Spec-friendly variant of `bootstrapStoreInPage`: runs the full popup-login
   * flow and returns the LIVE, authenticated GK admin Page (not just the URL).
   *
   * Why this exists: the dashboard SPA's auth state isn't fully captured by
   * `storageState({ path })` — it depends on session-scoped state established
   * during the popup login flow. Specs that try `browser.newContext({ storageState })`
   * + direct nav to `/kwikads/platforms` get redirected to `/login`. To run a
   * spec that reads dashboard state, you need this live Page.
   *
   * Caller is responsible for `auth.close()` (which closes the underlying
   * persistent context). Throws `KwikpassNotInstalledError` if the store
   * doesn't have Kwikpass — caller should `instanceof` and skip.
   */
  async bootstrapAndOpenDashboard(store: ShopifyStore): Promise<Page> {
    if (!this.context) {
      this.context = await this.shopifyAuth.getAuthenticatedContext();
    }
    const adminPage = await this.context.newPage();
    try {
      logger.info(`[gk-admin] Opening store admin (spec mode): ${store.adminUrl}`);
      await adminPage.goto(store.adminUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await adminPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { /* ignore */ });
      await adminPage.keyboard.press('Escape').catch(() => { /* dismiss Sidekick / Restore Pages */ });

      const installed = await this.searchAndVerifyInstalled(adminPage, store);
      if (!installed) {
        throw new KwikpassNotInstalledError(store.name);
      }

      logger.info(`[gk-admin] Kwikpass installed on ${store.handle} — opening (spec mode)`);
      const dashboardPage = await this.openKwikpassFromSearch(adminPage);
      // Leave adminPage open — the popup is its child; closing the parent
      // could orphan the popup. The caller's `auth.close()` cleans both up.
      return dashboardPage;
    } catch (err) {
      await adminPage.close().catch(() => { /* ignore */ });
      throw err;
    }
  }

  /**
   * Per-store flow (verified against captured network trace 2026-04-29):
   *
   *   1. goto store admin home
   *   2. Press Ctrl+K → topbar search dialog opens
   *   3. Type "kwikpass" — triggers Shopify Search GraphQL with
   *      types=["APP","APP_INSTALLATION"]
   *   4. Wait for the search response. If response has no APP_INSTALLATION
   *      result for kwikpass, the app isn't installed on this store.
   *   5. Click the first kwikpass option → opens a popup that deep-links
   *      to qa-mdashboard.dev.gokwik.in with app=kwik_pass.
   *   6. Wait for the popup to land on a gokwik.* host.
   */
  private async bootstrapStoreInPage(
    page: Page,
    store: ShopifyStore,
  ): Promise<{ gkAdminUrl: string }> {
    logger.info(`[gk-admin] Opening store admin: ${store.adminUrl}`);
    await page.goto(store.adminUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { /* ignore */ });
    await page.keyboard.press('Escape').catch(() => { /* dismiss Sidekick / Restore Pages */ });

    const installed = await this.searchAndVerifyInstalled(page, store);
    if (!installed) {
      console.error(
        `\n✗ Kwikpass app NOT installed on store "${store.name}" (${store.handle}).\n`,
      );
      throw new KwikpassNotInstalledError(store.name);
    }

    logger.info(`[gk-admin] Kwikpass installed on ${store.handle} — opening`);
    const gkPage = await this.openKwikpassFromSearch(page);
    return { gkAdminUrl: gkPage.url() };
  }

  /**
   * Opens Shopify topbar search (Ctrl+K), types kwikpass, uses observeNetwork
   * to capture the Search GraphQL response, and inspects whether at least one
   * result is an APP_INSTALLATION (installed on this store) vs only APP.
   *
   * Returns true if installed; false otherwise.
   */
  private async searchAndVerifyInstalled(page: Page, store: ShopifyStore): Promise<boolean> {
    // Arm the observer BEFORE opening the search dialog so we don't race.
    const { buckets, stop } = observeNetwork(page, {
      search_graphql: [/\/api\/operations\/[^/]+\/Search\/shopify\//],
    });

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    await page.keyboard.type('kwikpass', { delay: 60 });

    // Poll the live buckets until a Search response lands (up to 15s).
    const deadline = Date.now() + 15_000;
    while (buckets.search_graphql.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(300);
    }

    const captured = await stop();

    if (captured.search_graphql.length === 0) {
      logger.warn(
        `[gk-admin] No Search response captured for ${store.handle} — falling back to DOM presence check`,
      );
      const opt = page.getByRole('option', { name: /kwikpass/i }).first();
      return await opt.isVisible({ timeout: 5_000 }).catch(() => false);
    }

    // Prefer the response whose URL carries the kwikpass query variable.
    const match =
      captured.search_graphql.find((log) => /kwikpass/i.test(log.url)) ??
      captured.search_graphql[0]!;

    const installed = hasAppInstallation(match.body);
    logger.info(
      `[gk-admin] Search response for ${store.handle}: ` +
      `${installed ? 'APP_INSTALLATION present (installed)' : 'no APP_INSTALLATION (not installed)'}`,
    );
    return installed;
  }

  /**
   * Clicks the first kwikpass result in the open search listbox and awaits
   * the popup that deep-links to gokwik.*.
   */
  private async openKwikpassFromSearch(page: Page): Promise<Page> {
    const popupPromise = page.waitForEvent('popup', { timeout: POPUP_WAIT_MS }).catch(() => null);

    const option = page.getByRole('option', { name: /kwikpass/i }).first();
    await option.waitFor({ timeout: 10_000 });
    await option.click({ force: true, timeout: 10_000 });

    const popup = await popupPromise;
    if (!popup) {
      // No popup — Shopify may have routed the main tab to apps.shopify.com
      // (App Store) which means the click resolved as APP not APP_INSTALLATION.
      const url = page.url();
      if (/apps\.shopify\.com/.test(url)) {
        throw new KwikpassNotInstalledError('current store');
      }
      throw new Error(`Clicking Kwikpass result did not open a popup (still on ${url})`);
    }
    logger.info('[gk-admin] Popup opened — waiting for gokwik landing');
    return await this.awaitGkAdminLanding(popup);
  }

  /**
   * Polls the target page (page-scoped, parallel-safe) until URL settles on
   * a gokwik.* host that isn't login/signin. Tolerates manual Google SSO
   * (5 min budget) on the first store; subsequent stores resolve instantly
   * because cookies are already cached in the persistent profile.
   */
  private async awaitGkAdminLanding(target: Page): Promise<Page> {
    const start = Date.now();
    while (Date.now() - start < MANUAL_SSO_TIMEOUT_MS) {
      await tryClickGoogleAccount(target, envConfig.gokwikSsoEmail);
      try {
        const url = new URL(target.url());
        if (
          GK_ADMIN_HOST_PATTERN.test(url.hostname) &&
          !/\/login|\/signin/.test(url.pathname) &&
          !/accounts\.google\.com/.test(url.hostname)
        ) {
          return target;
        }
      } catch {
        // about:blank or invalid URL — keep polling
      }
      await target.waitForTimeout(POLL_INTERVAL_MS);
    }
    throw new Error('GK admin did not load within 5 minutes');
  }

  private printSsoBanner(): void {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  HEADS UP                                               │');
    console.log('│                                                         │');
    console.log('│  GK admin may ask you to sign in with Google on the     │');
    console.log('│  first store. Complete the SSO manually if prompted —   │');
    console.log('│  later stores will reuse the cached session.            │');
    console.log('└─────────────────────────────────────────────────────────┘\n');
  }

  private async saveStorageState(): Promise<void> {
    if (!this.context) return;
    const statePath = GkAdminStateFile.getStatePath();
    await this.context.storageState({ path: statePath });
    logger.info(`GK admin storage state saved → ${statePath}`);
  }

  async close(): Promise<void> {
    await this.shopifyAuth.close();
    this.context = null;
  }
}

/**
 * Walks an unknown JSON tree (Shopify's Search GraphQL response) and returns
 * true if any node is an APP_INSTALLATION result mentioning kwikpass.
 *
 * The response shape can vary between Shopify deployments. We look for either:
 *   - `__typename === 'AppInstallation'`
 *   - any nested object whose stringified form contains "AppInstallation"
 *     alongside "kwikpass" (case-insensitive)
 *
 * This is intentionally lenient — false positives are filtered out at click
 * time when `openKwikpassFromSearch` checks whether a popup actually opens.
 */
function hasAppInstallation(body: unknown): boolean {
  if (body == null) return false;

  let foundInstallation = false;
  let foundKwikpass = false;

  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) continue;

    if (typeof node === 'string') {
      if (/AppInstallation/i.test(node)) foundInstallation = true;
      if (/kwikpass/i.test(node)) foundKwikpass = true;
      continue;
    }

    if (typeof node !== 'object') continue;

    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    const obj = node as Record<string, unknown>;
    const typename = obj['__typename'];
    if (typeof typename === 'string' && /AppInstallation/i.test(typename)) {
      foundInstallation = true;
    }
    for (const v of Object.values(obj)) stack.push(v);
  }

  return foundInstallation && foundKwikpass;
}
