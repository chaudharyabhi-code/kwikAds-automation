// Owner: @BE | Scope: Global login — session validity checker (no browser, no network)
//
// Pure disk-read: checks all 5 session types and returns a SessionStatus[].
// Called by login-all.ts before deciding which logins to run.

import fs   from 'fs';
import path from 'path';

import { MetaSessionStore }           from './MetaSessionStore';
import { GokwikSessionStore }         from './GokwikSessionStore';
import { ShopifyPartnerSessionStore } from './ShopifyPartnerSessionStore';
import { GkAdminStateFile }           from './GkAdminSessionStore';
import { StorefrontSessionStore }     from './StorefrontSessionStore';
import { loadShopifyStores }          from '../testdata/shopifyStoreslist';

export type SessionKind =
  | 'gokwik'
  | 'shopify-partner'
  | 'gkadmin-bootstrap'
  | 'storefront'
  | 'meta';

export type SessionHealth = 'valid' | 'expired' | 'missing';

export interface SessionStatus {
  kind:          SessionKind;
  label:         string;
  health:        SessionHealth;
  detail:        string;
  storeCount?:   number;   // storefront only — total stores in shopifyStores.json
}

const BOOTSTRAP_REPORT  = path.resolve(__dirname, '../../../reports/gkadmin-bootstrap.json');
const BOOTSTRAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function checkAllSessions(): SessionStatus[] {
  const statuses: SessionStatus[] = [];

  // ── GoKwik Dashboard ─────────────────────────────────────────────────────────
  {
    const hasProfile = GokwikSessionStore.hasProfile();
    const expired    = hasProfile && GokwikSessionStore.isExpired();
    statuses.push({
      kind:   'gokwik',
      label:  'GoKwik Dashboard',
      health: !hasProfile ? 'missing' : expired ? 'expired' : 'valid',
      detail: !hasProfile
        ? 'gokwik-profile/ not found'
        : expired
          ? 'session expired (cookie timestamps past or file > 7 days old)'
          : 'profile exists, state file fresh',
    });
  }

  // ── Shopify Partner ───────────────────────────────────────────────────────────
  {
    const hasProfile = ShopifyPartnerSessionStore.hasProfile();
    statuses.push({
      kind:   'shopify-partner',
      label:  'Shopify Partner',
      health: hasProfile ? 'valid' : 'missing',
      detail: hasProfile
        ? 'shopify-partner-profile/ exists'
        : 'shopify-partner-profile/ not found',
    });
  }

  // ── GK Admin bootstrap ────────────────────────────────────────────────────────
  {
    const hasState       = GkAdminStateFile.hasState();
    const bootstrapExist = fs.existsSync(BOOTSTRAP_REPORT);
    let health: SessionHealth = 'missing';
    let detail = '';

    if (bootstrapExist) {
      const ageMs  = Date.now() - fs.statSync(BOOTSTRAP_REPORT).mtimeMs;
      const ageDays = Math.round(ageMs / 86_400_000);
      const ageHrs  = Math.round(ageMs / 3_600_000);

      if (ageMs > BOOTSTRAP_MAX_AGE_MS) {
        health = 'expired';
        detail = `gkadmin-bootstrap.json is ${ageDays}d old (> 7d threshold)`;
      } else if (!hasState) {
        health = 'expired';
        detail = `bootstrap report is ${ageHrs}h old but gk-admin.state.json is missing`;
      } else {
        health = 'valid';
        detail = `bootstrap report is ${ageHrs}h old, state file present`;
      }
    } else {
      detail = 'reports/gkadmin-bootstrap.json not found — run gkadmin:login';
    }

    statuses.push({
      kind:   'gkadmin-bootstrap',
      label:  'GK Admin (bootstrap)',
      health,
      detail,
    });
  }

  // ── Storefront (per-store cookies in shared profile) ─────────────────────────
  {
    const hasProfile = StorefrontSessionStore.hasProfile();
    const stores     = loadShopifyStores();
    statuses.push({
      kind:       'storefront',
      label:      `Storefront (${stores.length} store${stores.length !== 1 ? 's' : ''})`,
      health:     hasProfile ? 'valid' : 'missing',
      detail:     hasProfile
        ? `storefront-profile/ exists — ${stores.length} store(s) will be verified on run`
        : `storefront-profile/ missing — all ${stores.length} store(s) need login`,
      storeCount: stores.length,
    });
  }

  // ── Meta Ads Manager ──────────────────────────────────────────────────────────
  {
    const hasProfile = MetaSessionStore.hasProfile();
    statuses.push({
      kind:   'meta',
      label:  'Meta Ads Manager',
      health: hasProfile ? 'valid' : 'missing',
      detail: hasProfile ? 'meta-profile/ exists' : 'meta-profile/ not found',
    });
  }

  return statuses;
}
