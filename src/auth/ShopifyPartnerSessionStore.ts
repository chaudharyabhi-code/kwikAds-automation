// Owner: @FE
// Scope: Shopify Partner dev dashboard auth

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Persistent Chromium profile for the Shopify Partner dev dashboard.
// One partner account owns every test store, so a single profile covers
// all per-merchant Shopify Admin navigation done from the partner dash.
const PROFILE_DIR = path.resolve(__dirname, '../../shopify-partner-profile');

// Snapshot of cookies + localStorage exported alongside the persistent profile,
// so other scripts/tests can attach the same auth via `browser.newContext({ storageState })`
// without having to launch the full persistent profile.
const STATE_PATH = path.resolve(__dirname, '../../shopify-partner.state.json');

export class ShopifyPartnerSessionStore {
  static getProfileDir(): string {
    return PROFILE_DIR;
  }

  static getStatePath(): string {
    return STATE_PATH;
  }

  static hasProfile(): boolean {
    return fs.existsSync(PROFILE_DIR);
  }

  static hasState(): boolean {
    return fs.existsSync(STATE_PATH);
  }

  static clear(): void {
    if (fs.existsSync(PROFILE_DIR)) {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      logger.info('Shopify Partner profile cleared — next run will require login');
    }
    if (fs.existsSync(STATE_PATH)) {
      fs.unlinkSync(STATE_PATH);
      logger.info('Shopify Partner state file cleared');
    }
  }
}
