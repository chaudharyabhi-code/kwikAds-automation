/**
 * gokwik-login.ts — Run this script ONCE to log into the GoKwik dashboard.
 *
 * Usage:
 *   npm run gokwik:login
 *
 * What it does:
 *   - Launches a persistent Chromium profile at `gokwik-profile/` (same
 *     pattern as `shopify-partner-profile/` and `meta-profile/`).
 *   - Navigates to the GoKwik dashboard.
 *   - If already logged in (profile retains cookies + sessionStorage from a
 *     prior run) → saves state.json and exits silently.
 *   - If redirected to login / Google SSO → waits up to 5 minutes for YOU
 *     to complete sign-in, then saves both the persistent profile AND
 *     `gokwik.state.json` automatically.
 *
 * Two persistence layers are written:
 *   1. `gokwik-profile/` — full browser state (cookies + localStorage +
 *      sessionStorage + IndexedDB). Used by SPA-driving specs (e.g.
 *      `kwikads-toggle.spec.ts`).
 *   2. `gokwik.state.json` — cookie + localStorage snapshot. Used by
 *      API-level consumers (`kwik-ai-live.spec.ts`).
 *
 * After running this once, tests reuse the saved session automatically.
 * Re-run only when the session expires (typically every few days).
 * To force a clean re-login: `GokwikSessionStore.clear()` or delete both
 * `gokwik.state.json` and `gokwik-profile/`, then re-run this script.
 */

import { chromium, Page }            from '@playwright/test';
import { GokwikSessionStore }        from '../auth/GokwikSessionStore';
import { envConfig }                 from '../config/env.config';
import { logger }                    from '../utils/logger';
import { tryClickGoogleAccount }     from '../auth/GoogleSSOHelper';

const DASHBOARD_URL  = envConfig.kwikAiDashboardUrl;
const API_BASE_URL   = envConfig.kwikAiBaseUrl;
const LOGIN_TIMEOUT  = 5 * 60 * 1000; // 5 minutes for the user to complete SSO

/**
 * Definitive auth signal: an authenticated API call that returns user data.
 * Returns true only when /user/details responds 200 with a user object that
 * contains identity fields (email or id). Stale cookies that pass URL /
 * localStorage heuristics still get correctly rejected here because the
 * gateway validates the session server-side.
 */
async function checkAuthViaUserDetails(page: Page): Promise<boolean> {
  const url = `${API_BASE_URL}/qa/v3/api/dashboard/user/details`;
  return await page.evaluate(async (apiUrl: string): Promise<boolean> => {
    try {
      const r = await fetch(apiUrl, { method: 'GET', credentials: 'include' });
      if (!r.ok) return false;
      const body = await r.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return false;
      // Authenticated response carries the user object somewhere — accept any
      // shape that mentions email or a numeric/string id at top level OR under
      // a nested "data"/"user" key.
      const flat = JSON.stringify(body);
      return /"email"|"user_id"|"userId"|"id"\s*:/i.test(flat) && flat.length > 50;
    } catch {
      return false;
    }
  }, url);
}

async function main(): Promise<void> {
  const W = 72;
  console.log(`\n╔${'═'.repeat(W)}╗`);
  console.log(`║  KwikAds — GoKwik Dashboard Login`.padEnd(W + 1) + '║');
  console.log(`╠${'═'.repeat(W)}╣`);

  // Session status check (disk only — no browser yet)
  const hasProfile = GokwikSessionStore.hasProfile();
  const isExpired  = hasProfile ? GokwikSessionStore.isExpired() : true;
  const sessionLine = !hasProfile
    ? '✗ MISSING   gokwik-profile/ not found — fresh login required'
    : isExpired
      ? '⚠ EXPIRED   session cookie timestamps past or state file > 7 days old'
      : '✓ PRESENT   profile found, attempting to verify via /user/details API';

  console.log(`║  Session: ${sessionLine}`.padEnd(W + 1) + '║');
  console.log(`╚${'═'.repeat(W)}╝\n`);

  if (!DASHBOARD_URL) {
    console.error('✗ KWIK_AI_DASHBOARD_URL is not set in .env');
    console.error('  Add this line to your .env file:');
    console.error('  KWIK_AI_DASHBOARD_URL=https://qa-mdashboard.dev.gokwik.in\n');
    process.exit(1);
  }

  const isCI = envConfig.isCI;
  const context = await chromium.launchPersistentContext(
    GokwikSessionStore.getProfileDir(),
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
    console.log(`Opening: ${DASHBOARD_URL}\n`);
    await page.goto(DASHBOARD_URL, { waitUntil: 'load', timeout: 30_000 });

    // The only definitive auth signal is an authenticated API call.
    // /v3/api/dashboard/user/details returns 200 + a user object when the
    // session is real, 401/403 (or no user fields) when stale cookies are
    // fooling URL/localStorage checks but the actual session is dead.
    const userDetailsAuthed = await checkAuthViaUserDetails(page);
    console.log(`  URL:                       ${page.url()}`);
    console.log(`  /user/details authed:      ${userDetailsAuthed}`);

    if (userDetailsAuthed) {
      console.log(`\n✓ Already logged in (verified via /user/details API) — refreshing state...`);
    } else {
      console.log('\nNot authenticated — server rejected the saved session.');
      console.log('┌─────────────────────────────────────────────────────┐');
      console.log('│  ACTION REQUIRED                                    │');
      console.log('│                                                     │');
      console.log('│  → Complete Google Sign-In in the browser window.   │');
      console.log('│                                                     │');
      console.log('│  Once /v3/api/dashboard/user/details returns 200,   │');
      console.log('│  the script saves the session and exits.            │');
      console.log('│                                                     │');
      console.log('│  Waiting up to 5 minutes...                         │');
      console.log('└─────────────────────────────────────────────────────┘\n');

      // Poll the API every 5s until it returns authenticated, OR timeout.
      // Wrap each evaluate in a catch: Google SSO triggers several navigations
      // and the execution context is temporarily destroyed mid-redirect.
      // The context-destroyed error is transient — we simply continue polling.
      const start = Date.now();
      let authed = false;
      while (Date.now() - start < LOGIN_TIMEOUT) {
        await tryClickGoogleAccount(page, envConfig.gokwikSsoEmail);
        await page.waitForTimeout(5_000);
        try {
          authed = await checkAuthViaUserDetails(page);
        } catch (evalErr) {
          const msg = (evalErr as Error).message ?? '';
          if (/context was destroyed|Execution context|navigation/i.test(msg)) {
            // Page is mid-navigation (e.g. oauth-redirect → dashboard) — keep polling.
            continue;
          }
          throw evalErr;
        }
        if (authed) break;
      }
      if (!authed) {
        throw new Error('Manual SSO did not complete — /user/details still returns unauthenticated after 5 min');
      }

      console.log('\n✓ /user/details now returns authenticated — saving session...');
    }

    // Wait for the page to fully settle before issuing page.evaluate calls.
    // SSO leaves the page in the middle of a redirect chain; without this wait
    // any evaluate fires into a destroyed context (failure seen 2026-05-06).
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Trigger a warmup API request from within the page so the gateway issues
    // the qa_token cookie for api-gw-v4.dev.gokwik.in — without this the cookie
    // is never set and all subsequent API calls are unauthenticated.
    const apiUrl = `${envConfig.kwikAiBaseUrl}/qa/ka/api/mam/op4`;
    console.log('  Warming up API gateway to obtain qa_token cookie...');
    await page.evaluate(async (url: string) => {
      await fetch(url, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ message: 'ping', accountId: '' }),
      }).catch(() => {});
    }, apiUrl).catch(() => {
      // Warmup is best-effort — if the context is briefly gone, qa_token may
      // still be set by the dashboard's own init requests.
    });
    await page.waitForTimeout(2_000);

    const cookies    = await context.cookies();
    const hasQaToken = cookies.some(c => c.name === 'qa_token' && c.value.length > 0);
    console.log(hasQaToken ? '  ✓ qa_token acquired' : '  ⚠ qa_token not set — API calls may fail; try re-running this script');

    const finalLsKeys = await page.evaluate((): string[] => Object.keys(localStorage)).catch(() => [] as string[]);
    logger.info(`[gokwik-login] localStorage keys: [${finalLsKeys.join(', ')}]`);

    // Dual persistence: profile dir (already on disk via launchPersistentContext)
    // + state.json snapshot for API-level consumers.
    await context.storageState({ path: GokwikSessionStore.getStatePath() });
    logger.info(`[gokwik-login] State snapshot saved → ${GokwikSessionStore.getStatePath()}`);
    logger.info(`[gokwik-login] Persistent profile → ${GokwikSessionStore.getProfileDir()}`);

    console.log('✓ Session saved:');
    console.log(`  • profile dir: ${GokwikSessionStore.getProfileDir()}`);
    console.log(`  • state file:  ${GokwikSessionStore.getStatePath()}`);
    console.log('  Future test runs will reuse the persistent profile automatically.\n');
  } catch (err) {
    logger.error(`[gokwik-login] Failed: ${(err as Error).message}`);
    console.error('\n✗ Login failed. See above for details.');
    console.error('  Common causes:');
    console.error('  - Sign-in was not completed within 5 minutes');
    console.error('  - KWIK_AI_DASHBOARD_URL is wrong in .env');
    console.error('  - Network issue reaching the dashboard');
    console.error('  To retry: just re-run this script — the persistent profile is preserved.');
    console.error('  Only delete gokwik-profile/ if you want a completely fresh login.\n');
    process.exit(1);
  } finally {
    await context.close();
  }
}

main();
