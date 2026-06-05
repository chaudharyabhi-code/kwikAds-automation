// Owner: @BE | Scope: GoKwik Dashboard Auth
//
// Two persistence layers, each with its own consumer:
//   - Persistent Chromium profile at `gokwik-profile/` — used by SPA-driving
//     specs (e.g. kwikads-toggle.spec.ts) via launchPersistentContext.
//     Captures sessionStorage / IndexedDB / device cookies that storageState
//     does not.
//   - Storage-state JSON at `gokwik.state.json` — used by API-level consumers
//     (kwik-ai-live.spec.ts) that only need cookies for header injection.
//
// Both are written by `npm run gokwik:login`. Mirrors the Shopify Partner /
// Meta auth pattern (persistent profile + state-file dual persistence).

import fs   from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const STATE_PATH       = path.resolve(__dirname, '../../gokwik.state.json');
const PROFILE_DIR      = path.resolve(__dirname, '../../gokwik-profile');
const MAX_STATE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — fallback expiry

interface StoredCookie {
  name:    string;
  value:   string;
  domain:  string;
  expires: number; // unix timestamp seconds; -1 = session cookie
}

interface LocalStorageEntry {
  name:  string;
  value: string;
}

interface StorageOrigin {
  origin:       string;
  localStorage: LocalStorageEntry[];
}

interface StorageState {
  cookies: StoredCookie[];
  origins: StorageOrigin[];
}

export class GokwikSessionStore {
  static getStatePath(): string { return STATE_PATH; }
  static getProfileDir(): string { return PROFILE_DIR; }

  static hasState(): boolean { return fs.existsSync(STATE_PATH); }
  static hasProfile(): boolean { return fs.existsSync(PROFILE_DIR); }

  static loadState(): StorageState {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as Partial<StorageState>;
    return {
      cookies: raw.cookies ?? [],
      origins: raw.origins ?? [],
    };
  }

  /**
   * Returns true if the session should be considered expired.
   * Checks cookie expiry timestamps, then falls back to file age.
   */
  static isExpired(): boolean {
    if (!this.hasState()) return true;
    const { cookies } = this.loadState();
    const nowSec      = Date.now() / 1000;

    const datedGokwikCookies = cookies.filter(
      c => c.domain.includes('gokwik') && c.expires !== -1,
    );
    if (datedGokwikCookies.length > 0 && datedGokwikCookies.some(c => c.expires < nowSec)) {
      return true;
    }

    // File-age fallback — covers all-session-cookie case
    const fileAgeMs = Date.now() - fs.statSync(STATE_PATH).mtimeMs;
    if (fileAgeMs > MAX_STATE_AGE_MS) {
      logger.warn('[GokwikSessionStore] State file older than 7 days — treating as expired');
      return true;
    }

    return false;
  }

  /**
   * Builds a Cookie header string containing only cookies that belong to the
   * given hostname, using proper domain-matching rules (same as a browser would).
   *
   * This prevents leaking cookies from `api-gw-v4.dev.gokwik.in` into requests
   * destined for `qa-mdashboard.dev.gokwik.in`, which would confuse the server.
   */
  static getCookieHeaderFor(hostname: string): string {
    const { cookies } = this.loadState();

    const relevant = cookies.filter(c => {
      const d = c.domain;
      if (d.startsWith('.')) {
        // Wildcard domain — matches hostname and all subdomains
        return hostname.endsWith(d.slice(1));   // e.g. ".gokwik.in" matches any *.gokwik.in
      }
      return hostname === d;                     // Exact match only
    });

    logger.info(
      `[GokwikSessionStore] Cookie header for ${hostname}: ` +
      `${relevant.length} cookie(s) — [${relevant.map(c => c.name).join(', ')}]`,
    );
    return relevant.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Looks for the GoKwik API token in cookies (set on api-gw-v4.dev.gokwik.in).
   * This token may be required as an Authorization Bearer for some endpoints.
   */
  static getApiToken(): string | null {
    const { cookies } = this.loadState();
    const tokenCookie = cookies.find(c => c.name === 'qa_token');
    if (tokenCookie !== undefined && tokenCookie.value.length > 10) {
      logger.info('[GokwikSessionStore] qa_token cookie found');
      return tokenCookie.value;
    }
    return null;
  }

  /**
   * Logs all localStorage keys — useful for identifying auth token key names.
   */
  static debugLocalStorage(): void {
    const state  = this.loadState();
    const origin = state.origins.find(o => o.origin.includes('gokwik'));
    if (!origin) { logger.info('[GokwikSessionStore] No GoKwik localStorage origin found'); return; }
    logger.info(`[GokwikSessionStore] localStorage keys: [${origin.localStorage.map(e => e.name).join(', ')}]`);
  }

  static clear(): void {
    if (fs.existsSync(STATE_PATH)) {
      fs.unlinkSync(STATE_PATH);
      logger.info('[GokwikSessionStore] State file cleared');
    }
    if (fs.existsSync(PROFILE_DIR)) {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      logger.info('[GokwikSessionStore] Profile directory cleared');
    }
    logger.info('[GokwikSessionStore] Session cleared — next run requires gokwik:login');
  }
}
