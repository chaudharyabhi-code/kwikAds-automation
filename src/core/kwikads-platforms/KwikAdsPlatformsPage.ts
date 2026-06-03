// Owner: @FE | Scope: KwikAds /kwikads/platforms — toggle state read + write
//
// readPlatformState(adAccountId) — intercepts m/op2, returns toggle state + apiBase.
// togglePlatform(id, isActive, apiBase) — PATCH m/op6/<id> via page.evaluate fetch
//   (session cookies already in context — no token plumbing needed).
// - URL guards: BLOCKED if /onboarding/(kp|ka)/, throws if /login (stale auth).
// - apiBase derived from live m/op2 URL — works for QA and prod without config change.
//
// Set KWIKADS_DEBUG=1 to log the captured response body when no row matches.

import { Page, Response } from '@playwright/test';
import { logger } from '../utils/logger';

export type PlatformState = 'BLOCKED' | 'META_NOT_ONBOARDED' | 'TOGGLE_ON' | 'TOGGLE_OFF';

export interface PlatformRow {
  id: string;                          // m/op2 returns id as a string ("59"); same id used by PATCH m/op6/<id>
  adAccountId: string;
  isEventTrackingEnabled: boolean;
  raw: Record<string, unknown>;
}

export interface PlatformReadResult {
  state: PlatformState;
  platform: PlatformRow | null;
  finalUrl: string;
  // API base derived from the live m/op2 URL (e.g. ".../qa/ka/api/v1").
  // Pass straight into togglePlatform() — no env var needed.
  apiBase: string;
}

const PLATFORMS_URL = 'https://qa-mdashboard.dev.gokwik.in/kwikads/platforms';
// m/op2 returns the per-merchant Meta platform toggle row (calibrated 2026-04-30):
//   { data: { id: "59", adAccountId: "act_...", isActive: true, ... } }
// PATCH endpoint for the toggle is m/op6/<id> (Phase 4 — parked).
const PLATFORMS_PATTERN = /\/ka\/api\/v1\/m\/op2(?:\b|\?|\/)/;
const BLOCKED_URL_PATTERN = /\/onboarding\/(kp|ka)\//;
const LOGIN_URL_PATTERN = /\/login(\?|$)|\/oauth-redirect/;
const PLATFORMS_TIMEOUT_MS = 15_000;
const NAV_TIMEOUT_MS = 30_000;

export class KwikAdsPlatformsPage {
  constructor(private readonly page: Page) {}

  async readPlatformState(adAccountId: string): Promise<PlatformReadResult> {
    // Closure-mutated lets confuse TS narrowing across `await`s; collect into
    // arrays and read the first element after the listener detaches instead.
    const matches: PlatformRow[] = [];
    const firstBodies: unknown[] = [];
    const responseUrls: string[] = [];
    let m_op2Fired = false;

    const onResponse = async (r: Response): Promise<void> => {
      if (!PLATFORMS_PATTERN.test(r.url())) return;
      m_op2Fired = true;
      if (responseUrls.length === 0) responseUrls.push(r.url());
      if (matches.length > 0) return;
      const body = await r.json().catch(() => null) as unknown;
      if (body !== null && firstBodies.length === 0) firstBodies.push(body);
      const match = extractToggleRow(body, adAccountId);
      if (match) matches.push(match);
    };
    this.page.on('response', onResponse);

    const firstHit = this.page
      .waitForResponse((r) => PLATFORMS_PATTERN.test(r.url()), { timeout: PLATFORMS_TIMEOUT_MS })
      .catch(() => null);

    try {
      await this.page.goto(PLATFORMS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await firstHit;
      // Brief grace window — m/op2 fires twice in practice; first body is enough but the second arrives within 500ms.
      await this.page.waitForTimeout(1_000);
    } finally {
      this.page.off('response', onResponse);
    }

    const finalUrl = this.page.url();

    // Derive apiBase from the first captured m/op2 URL — strips from /m/op2 onward
    // so the same prefix can be used for /m/op6/<id>. Falls back to empty string
    // if no response was captured (BLOCKED / early return paths).
    const apiBase = responseUrls[0]?.replace(/\/m\/op2.*$/, '') ?? '';

    // Both /onboarding/(kp|ka)/ AND /login redirects mean the user can't
    // reach the platforms toggle for this merchant → Kwikads not integrated.
    // Caller (spec) collapses this to a single "Integrate KwikAds" skip.
    if (BLOCKED_URL_PATTERN.test(finalUrl) || LOGIN_URL_PATTERN.test(finalUrl)) {
      return { state: 'BLOCKED', platform: null, finalUrl, apiBase };
    }

    if (!m_op2Fired) {
      throw new Error(
        `m/op2 not observed within ${PLATFORMS_TIMEOUT_MS}ms at ${finalUrl}. ` +
        'Page may still be loading or the dashboard route changed.',
      );
    }

    const platform = matches[0];
    if (!platform) {
      // Distinguish "Meta platform not onboarded" (m/op2 body has data.url for OAuth)
      // from "session scoped to a different merchant" (body has different adAccountId).
      if (firstBodies[0] !== undefined && isMetaNotOnboardedBody(firstBodies[0])) {
        return { state: 'META_NOT_ONBOARDED', platform: null, finalUrl, apiBase };
      }
      if (process.env['KWIKADS_DEBUG'] === '1' && firstBodies[0] !== undefined) {
        logger.error(
          `[kwikads-platforms] No row matched adAccountId=${adAccountId}. ` +
          `Body: ${JSON.stringify(firstBodies[0]).slice(0, 1500)}`,
        );
      }
      throw new Error(
        `m/op2 returned no row matching adAccountId=${adAccountId}. ` +
        'The dashboard session may be scoped to a different merchant. ' +
        'Set KWIKADS_DEBUG=1 to log the captured body.',
      );
    }

    logger.info(
      `[kwikads-platforms] adAccountId=${adAccountId} ` +
      `id=${platform.id} isActive=${platform.isEventTrackingEnabled} apiBase=${apiBase}`,
    );

    return {
      state: platform.isEventTrackingEnabled ? 'TOGGLE_ON' : 'TOGGLE_OFF',
      platform,
      finalUrl,
      apiBase,
    };
  }

  /**
   * Flips the event-tracking toggle for one platform row via PATCH m/op6/<id>.
   *
   * Requires `merchantId` (gokwik internal ID, e.g. "4bzi40ahksbqurl7") — sent
   * as the `gk-merchant-id` header that the API mandates (confirmed 2026-05-07
   * from 400 error: "gk-merchant-id must be a string, should not be empty").
   *
   * Uses page.evaluate fetch so the browser's own session cookies are sent —
   * no extra auth plumbing. Page must be on the dashboard domain.
   *
   * Returns the observed isActive from the response body, or the requested
   * value as an optimistic fallback if the response body shape differs.
   */
  async togglePlatform(
    id:         string,
    isActive:   boolean,
    apiBase:    string,
    merchantId: string,
  ): Promise<boolean> {
    const url = `${apiBase}/m/op6/${id}`;
    logger.info(`[kwikads-platforms] PATCH ${url} merchantId=${merchantId} → isActive=${isActive}`);

    const result = await this.page.evaluate(
      async (args: { patchUrl: string; active: boolean; mid: string }) => {
        const r = await fetch(args.patchUrl, {
          method:      'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type':  'application/json',
            'gk-merchant-id': args.mid,
          },
          body: JSON.stringify({ isActive: args.active }),
        });
        const text = await r.text().catch(() => '');
        if (!r.ok) throw new Error(`PATCH ${args.patchUrl} → HTTP ${r.status}: ${text.slice(0, 500)}`);
        try { return JSON.parse(text) as unknown; } catch { return null; }
      },
      { patchUrl: url, active: isActive, mid: merchantId },
    );

    // Extract observed isActive from response (same shape as m/op2).
    const data = (result as Record<string, unknown> | null)?.['data'];
    if (data != null && typeof data === 'object') {
      const observed = (data as Record<string, unknown>)['isActive'];
      if (typeof observed === 'boolean') {
        logger.info(`[kwikads-platforms] PATCH confirmed — isActive now ${observed}`);
        return observed;
      }
    }
    return isActive; // optimistic fallback
  }
}

// "Meta not onboarded" body shape: { data: { url: <Meta OAuth URL>, ... } } —
// no id, no adAccountId, no isActive. The dashboard returns this when the
// merchant has Kwikads installed but hasn't completed Meta platform OAuth.
function isMetaNotOnboardedBody(body: unknown): boolean {
  if (body == null || typeof body !== 'object') return false;
  const data = (body as Record<string, unknown>)['data'];
  if (data == null || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  const url = obj['url'];
  return typeof url === 'string' && /facebook\.com\/.*\/oauth/i.test(url) && obj['adAccountId'] === undefined;
}

// Direct extraction — calibrated body shape is { data: { id, adAccountId, isActive } }.
// Returns null if the body doesn't match this shape OR adAccountId differs.
function extractToggleRow(body: unknown, adAccountId: string): PlatformRow | null {
  if (body == null || typeof body !== 'object') return null;
  const data = (body as Record<string, unknown>)['data'];
  if (data == null || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;
  const adAcc = obj['adAccountId'];
  const idRaw = obj['id'];
  const isActive = obj['isActive'];

  if (typeof adAcc !== 'string' || adAcc !== adAccountId) return null;
  if (typeof isActive !== 'boolean') return null;
  const id = typeof idRaw === 'string' ? idRaw : typeof idRaw === 'number' ? String(idRaw) : null;
  if (id === null) return null;

  return {
    id,
    adAccountId: adAcc,
    isEventTrackingEnabled: isActive,
    raw: obj,
  };
}
