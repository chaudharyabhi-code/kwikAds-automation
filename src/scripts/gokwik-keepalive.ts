/**
 * gokwik-keepalive.ts — Lightweight session refresh for GoKwik dashboard.
 *
 * Usage:
 *   npm run gokwik:keepalive          # run once manually
 *
 * Two paths:
 *   1. Session still valid  → API check passes → exits in <5 seconds, no browser.
 *   2. Session expired      → launches gokwik-profile/, Google SSO auto-clicks,
 *                             new qa_token saved → exits in <30 seconds.
 *
 * Cron (run every 5.5 hours — keeps server JWT alive before the 6h TTL hits):
 *   crontab -e
 *   0 0,6,12,18 * * * cd /home/driftking/Desktop/KwikAds_Automation && npm run gokwik:keepalive >> /tmp/gokwik-keepalive.log 2>&1
 *
 * Why this exists:
 *   The GK dashboard issues JWTs with a ~6h server-side TTL. The cookie container
 *   lives longer (24h) but the JWT inside goes stale. This script checks the JWT
 *   validity with a single API call (no browser needed) and only opens Chrome
 *   when a re-login is actually required.
 */

import https  from 'https';
import { chromium, Page } from '@playwright/test';
import { GokwikSessionStore }    from '../core/gokwik-auth/GokwikSessionStore';
import { envConfig }             from '../config/env.config';
import { tryClickGoogleAccount } from '../core/auth/GoogleSSOHelper';
import { logger }                from '../core/utils/logger';

const DASHBOARD_URL  = envConfig.kwikAiDashboardUrl || 'https://qa-mdashboard.dev.gokwik.in';
const API_BASE       = envConfig.kwikAiBaseUrl       || 'https://api-gw-v4.dev.gokwik.in';
const USER_DETAILS   = `${API_BASE}/qa/v3/api/dashboard/user/details`;
const LOGIN_TIMEOUT  = 5 * 60 * 1000;
const W = 68;

// ── Step 1: Check session via raw HTTPS request (no browser) ─────────────────

function checkSessionViaHttp(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!GokwikSessionStore.hasState()) { resolve(false); return; }

    let cookieHdr: string;
    try {
      cookieHdr = GokwikSessionStore.getCookieHeaderFor(new URL(API_BASE).hostname);
    } catch { resolve(false); return; }

    if (!cookieHdr) { resolve(false); return; }

    const url = new URL(USER_DETAILS);
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'GET',
        headers: {
          Cookie:  cookieHdr,
          Origin:  DASHBOARD_URL,
          Referer: `${DASHBOARD_URL}/`,
        },
        timeout: 8_000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) { resolve(false); return; }
          try {
            const flat = JSON.stringify(JSON.parse(body));
            resolve(/"email"|"user_id"|"userId"|"id"\s*:/i.test(flat) && flat.length > 50);
          } catch { resolve(false); }
        });
      },
    );
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// ── Step 2: Re-login via browser if session is expired ───────────────────────

async function checkAuthViaPage(page: Page): Promise<boolean> {
  return await page.evaluate(async (url: string): Promise<boolean> => {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!r.ok) return false;
      const flat = JSON.stringify(await r.json().catch(() => null));
      return /"email"|"user_id"|"userId"|"id"\s*:/i.test(flat) && flat.length > 50;
    } catch { return false; }
  }, USER_DETAILS);
}

async function relogin(): Promise<void> {
  console.log('  Launching browser for re-login...');

  try {
    const { unlinkSync } = await import('fs');
    const { join } = await import('path');
    unlinkSync(join(GokwikSessionStore.getProfileDir(), 'SingletonLock'));
  } catch { /* not present */ }

  const context = await chromium.launchPersistentContext(
    GokwikSessionStore.getProfileDir(),
    {
      headless: false,
      args: ['--start-maximized', ...(envConfig.isCI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
      viewport: { width: 1920, height: 1080 },
    },
  );
  const page = await context.newPage();

  try {
    await page.goto(DASHBOARD_URL, { waitUntil: 'load', timeout: 30_000 });

    const alreadyAuthed = await checkAuthViaPage(page).catch(() => false);
    if (alreadyAuthed) {
      console.log('  ✓ Session recovered without SSO (Google auto-approved)');
    } else {
      console.log('  Google SSO in progress — auto-clicking account tile...');
      const start = Date.now();
      let authed = false;
      while (Date.now() - start < LOGIN_TIMEOUT) {
        await tryClickGoogleAccount(page, envConfig.gokwikSsoEmail);
        await page.waitForTimeout(3_000);
        try {
          authed = await checkAuthViaPage(page);
        } catch { continue; }
        if (authed) break;
      }
      if (!authed) throw new Error('Re-login did not complete within 5 minutes');
    }

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Warm up the API gateway to renew qa_token
    const apiUrl = `${API_BASE}/qa/ka/api/mam/op4`;
    await page.evaluate(async (url: string) => {
      await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ping', accountId: '' }),
      }).catch(() => {});
    }, apiUrl).catch(() => {});
    await page.waitForTimeout(1_500);

    await context.storageState({ path: GokwikSessionStore.getStatePath() });
    logger.info(`[gokwik-keepalive] Session renewed → ${GokwikSessionStore.getStatePath()}`);
    console.log('  ✓ New session saved');
  } finally {
    await context.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n╔${'═'.repeat(W)}╗`);
  console.log(`║  GoKwik Keepalive  ${ts}`.padEnd(W + 1) + '║');
  console.log(`╚${'═'.repeat(W)}╝`);

  // Fast path: no browser needed
  process.stdout.write('  Checking session via API... ');
  const valid = await checkSessionViaHttp();
  console.log(valid ? '✓ VALID' : '✗ EXPIRED');

  if (valid) {
    console.log('  Session is alive — nothing to do.\n');
    return;
  }

  if (!GokwikSessionStore.hasProfile()) {
    console.error(`  ✗ gokwik-profile/ not found. Run: npm run gokwik:login\n`);
    process.exit(1);
  }

  try {
    await relogin();
    console.log(`  ✓ Keepalive complete — session renewed at ${ts}\n`);
  } catch (err) {
    console.error(`  ✗ Re-login failed: ${(err as Error).message}`);
    console.error('  → Run manually: npm run gokwik:login\n');
    process.exit(1);
  }
}

main();
