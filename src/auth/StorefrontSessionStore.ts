// Owner: @BE | Scope: Shopify storefront — persistent profile that carries
// password-gate cookies (per-store). Mirrors the Shopify Partner / Meta /
// Gokwik pattern.
//
// Each Shopify dev store has its own preview password. Once you enter it
// manually via `npm run storefront:login -- <handle>`, Shopify sets a cookie
// scoped to that store's `<handle>.myshopify.com` domain. The cookie persists
// in `storefront-profile/` for days/weeks. A single profile holds cookies
// for all bootstrapped stores at once (different stores = different domains
// → no conflict).

import fs   from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const PROFILE_DIR = path.resolve(__dirname, '../../storefront-profile');

export class StorefrontSessionStore {
  static getProfileDir(): string { return PROFILE_DIR; }
  static hasProfile(): boolean { return fs.existsSync(PROFILE_DIR); }

  static clear(): void {
    if (fs.existsSync(PROFILE_DIR)) {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      logger.info('[StorefrontSessionStore] Profile cleared — next storefront:login will require manual password entry');
    }
  }
}
