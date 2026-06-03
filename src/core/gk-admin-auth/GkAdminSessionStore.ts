// Owner: @FE
// Scope: GK Admin auth — shared persistent profile with Shopify Partner
//
// GK Admin runs in the same persistent Chromium profile as Shopify Partner.
// After the manual SSO that fires on the first per-merchant Kwikpass nav,
// GK admin cookies live alongside Shopify cookies in shopify-partner-profile/.
// A separate storage-state snapshot (gk-admin.state.json) captures the combined
// session so other tests/scripts can attach via browser.newContext({ storageState })
// without launching the persistent profile.

import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const STATE_PATH = path.resolve(__dirname, '../../../gk-admin.state.json');

export class GkAdminStateFile {
  static getStatePath(): string {
    return STATE_PATH;
  }

  static hasState(): boolean {
    return fs.existsSync(STATE_PATH);
  }

  static clear(): void {
    if (fs.existsSync(STATE_PATH)) {
      fs.unlinkSync(STATE_PATH);
      logger.info('GK admin state file cleared');
    }
  }
}
