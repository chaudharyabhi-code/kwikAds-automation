// Owner: @SDET | Scope: KwikAds — 3-step end-to-end validator (combined verdict)
//
// Per store from shopifyStores.json:
//   Step 1: Read kwikpass install state from reports/gkadmin-bootstrap.json
//   Step 2: Drive storefront (storefront-profile/) — check if sp/op1 + e/op5 fire
//   Step 3: If silent + kwikpass installed — check platform onboarding (gokwik-profile/)
//   Verdict: assemble 6-state result, attach verdict.json to the HTML report
//
// Prerequisites (run once):
//   npm run shopify:login
//   npm run shopify:scrape-stores
//   npm run gkadmin:login -- <handle>    ← writes reports/gkadmin-bootstrap.json
//   npm run storefront:login -- <handle> ← writes storefront-profile/ cookie
//   npm run gokwik:login                 ← writes gokwik-profile/  (platform check)
//
// Run:
//   npx playwright test --project=kwikads-validator

import fs from 'fs';
import path from 'path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';

import { loadShopifyStores } from '../testdata/shopifyStoreslist';
import { ALL_MERCHANTS }      from '../testdata/merchants';
import { StorefrontPage }     from '../pages/StorefrontPage';
import { StorefrontProtectedError } from '../pages/errors';
import { StorefrontSessionStore }   from '../auth/StorefrontSessionStore';
import { KwikAdsPlatformsPage }     from '../pages/KwikAdsPlatformsPage';
import { GokwikSessionStore }       from '../auth/GokwikSessionStore';
import {
  assembleVerdict,
  type VerdictInput,
  type KwikpassState,
  type OnboardingState,
} from '../validators/verdict-assembler';
import type { PlatformState } from '../pages/KwikAdsPlatformsPage';

const BOOTSTRAP_REPORT = path.resolve(__dirname, '../../../reports/gkadmin-bootstrap.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BootstrapEntry {
  kwikpass:    'installed' | 'not-installed';
  gkAdminUrl?: string;
  durationMs:  number;
  capturedAt:  string;
}

function readBootstrapReport(): Record<string, BootstrapEntry> {
  if (!fs.existsSync(BOOTSTRAP_REPORT)) return {};
  try {
    return JSON.parse(fs.readFileSync(BOOTSTRAP_REPORT, 'utf-8')) as Record<string, BootstrapEntry>;
  } catch {
    return {};
  }
}

function kwikpassState(handle: string, report: Record<string, BootstrapEntry>): KwikpassState {
  const entry = report[handle];
  if (!entry) return 'unknown';
  return entry.kwikpass === 'installed' ? 'installed' : 'not-installed';
}

function findAdAccountId(handle: string): string | null {
  const merchant = ALL_MERCHANTS.find((m) => m.shopifyHandle === handle);
  return merchant?.adAccountId && merchant.adAccountId.length > 0
    ? merchant.adAccountId
    : null;
}

// Maps KwikAdsPlatformsPage.PlatformState to the verdict-assembler's OnboardingState.
//   BLOCKED / META_NOT_ONBOARDED → platform setup incomplete → not-onboarded
//   TOGGLE_ON / TOGGLE_OFF       → platform OAuth done         → onboarded
function toOnboardingState(state: PlatformState): OnboardingState {
  if (state === 'TOGGLE_ON' || state === 'TOGGLE_OFF') return 'onboarded';
  if (state === 'BLOCKED' || state === 'META_NOT_ONBOARDED') return 'not-onboarded';
  return 'unknown';
}

function printVerdict(handle: string, input: VerdictInput, verdict: string, note?: string): void {
  const w = 90;
  const eq = '═'.repeat(w);
  const dash = '─'.repeat(w - 2);
  console.log(`\n${eq}`);
  console.log(`  KWIKADS VALIDATOR  |  Store: ${handle}  |  Verdict: ${verdict}`);
  console.log(eq);
  const rows: Array<[string, string]> = [
    ['kwikpass',   input.kwikpass],
    ['storefront', input.storefront],
    ['onboarding', input.onboarding],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(14)}${v}`);
  if (note) { console.log(`  ${dash}`); console.log(`  Note: ${note}`); }
  console.log(`${eq}\n`);
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

const STORES = loadShopifyStores();
const BOOTSTRAP = readBootstrapReport();

test.describe('KwikAds — End-to-End Validator', () => {
  // Both storefront-profile and gokwik-profile are single-process contexts.
  test.describe.configure({ mode: 'serial' });

  // Contexts are opened once for the whole describe block and reused across
  // all per-store tests. Each test opens a new page (tab) and closes it when
  // done — the context (and the browser process) stays alive. This reduces
  // browser launches from 2×N (storefront + optional gokwik, once per store)
  // to 2 total, making the spec visibly faster and less noisy.
  let sfCtx: BrowserContext;
  let gkCtx: BrowserContext | null = null;

  test.beforeAll(async () => {
    if (STORES.length === 0) {
      throw new Error(
        'shopifyStores.json is empty — run: npm run shopify:scrape-stores',
      );
    }
    if (!StorefrontSessionStore.hasProfile()) {
      throw new Error(
        `storefront-profile/ not found at ${StorefrontSessionStore.getProfileDir()}. ` +
        'Run: npm run storefront:login -- <handle>',
      );
    }
    // Clear stale SingletonLocks from abnormal previous exits.
    try { fs.unlinkSync(path.join(StorefrontSessionStore.getProfileDir(), 'SingletonLock')); } catch { /* not present */ }
    sfCtx = await chromium.launchPersistentContext(
      StorefrontSessionStore.getProfileDir(),
      { headless: false },
    );
    // Open the gokwik context once if the profile exists — it will be used
    // only for stores that need the platform check (kwikpass installed + silent).
    if (GokwikSessionStore.hasProfile()) {
      try { fs.unlinkSync(path.join(GokwikSessionStore.getProfileDir(), 'SingletonLock')); } catch { /* not present */ }
      gkCtx = await chromium.launchPersistentContext(
        GokwikSessionStore.getProfileDir(),
        { headless: false },
      );
    }
  });

  test.afterAll(async () => {
    await sfCtx?.close().catch(() => { /* ignore */ });
    await gkCtx?.close().catch(() => { /* ignore */ });
  });

  for (const store of STORES) {
    test(
      `@smoke @kwikads-validator @ci [${store.handle}] 3-step validation`,
      async () => {
        test.setTimeout(120_000);

        const kwikpass   = kwikpassState(store.handle, BOOTSTRAP);
        const adAccountId = findAdAccountId(store.handle);

        // ── Step 2: Storefront ──────────────────────────────────────────────
        let storefrontFired = false;

        const sfPage = await sfCtx.newPage();
        try {
          const result = await new StorefrontPage(sfPage).gotoHome(store.handle);
          storefrontFired = result.events.length > 0;
        } catch (err) {
          if (err instanceof StorefrontProtectedError) {
            // Can't bypass password gate — verdict is INCONCLUSIVE.
            const input: VerdictInput = { kwikpass: 'unknown', storefront: 'silent', onboarding: 'unknown' };
            const r = assembleVerdict(input);
            printVerdict(store.handle, input, r.verdict, `Password gate — run: npm run storefront:login -- ${store.handle}`);
            await test.info().attach('verdict.json', {
              body: JSON.stringify(r, null, 2),
              contentType: 'application/json',
            });
            test.skip(true, err.message);
            return;
          }
          throw err;
        } finally {
          await sfPage.close().catch(() => { /* ignore */ });
        }

        // ── Step 3: Platform check (only if silent + installed + adAccountId) ─
        let onboarding: OnboardingState = 'unknown';

        if (kwikpass === 'installed' && !storefrontFired && adAccountId) {
          if (!gkCtx) {
            // Can't check — record unknown; verdict will be ANOMALY.
            console.warn(
              `[kwikads-validator] gokwik-profile/ missing — skipping platform check for ${store.handle}. ` +
              'Run: npm run gokwik:login',
            );
          } else {
            const gkPage = await gkCtx.newPage();
            try {
              const platformResult = await new KwikAdsPlatformsPage(gkPage).readPlatformState(adAccountId);
              onboarding = toOnboardingState(platformResult.state);
            } catch (err) {
              console.warn(
                `[kwikads-validator] Platform check failed for ${store.handle}: ${(err as Error).message}`,
              );
            } finally {
              await gkPage.close().catch(() => { /* ignore */ });
            }
          }
        }

        // ── Step 4: Assemble & report ────────────────────────────────────────
        const input: VerdictInput = {
          kwikpass,
          storefront: storefrontFired ? 'events-fired' : 'silent',
          onboarding,
        };
        const r = assembleVerdict(input);

        printVerdict(store.handle, input, r.verdict, r.rationale);
        await test.info().attach('verdict.json', {
          body: JSON.stringify(r, null, 2),
          contentType: 'application/json',
        });

        if (r.verdict !== 'PASS') {
          // Non-PASS verdicts fail the test with a meaningful message.
          expect(r.verdict, r.rationale).toBe('PASS');
        }
      },
    );
  }
});
