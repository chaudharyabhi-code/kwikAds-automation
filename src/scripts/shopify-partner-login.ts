/**
 * shopify-partner-login.ts — Run ONCE to log into the Shopify Partner dev
 * dashboard manually and persist the session for future runs.
 *
 * Usage:
 *   npm run shopify:login
 *
 * What it does:
 *   - Opens a Chrome window with the persistent profile (shopify-partner-profile/).
 *   - If Shopify still recognises the session → saves a fresh storage-state
 *     snapshot and exits.
 *   - If session is expired / profile is new → waits up to 5 minutes for you
 *     to log in manually (email, password, 2FA if prompted), then saves both
 *     the persistent profile AND a storage-state snapshot to
 *     shopify-partner.state.json.
 *
 * After a successful run, no further logins are required until Shopify expires
 * the session or the profile directory is deleted.
 */

import { ShopifyPartnerAuthManager } from '../auth/ShopifyPartnerAuthManager';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  KwikAds — Shopify Partner Login Script');
  console.log('========================================\n');
  console.log('Launching browser with persistent profile...\n');

  const auth = new ShopifyPartnerAuthManager();

  try {
    await auth.getAuthenticatedContext();
    console.log('\n✓ Session is valid — you are logged in to Shopify Partners.');
    console.log('  Persistent profile:  shopify-partner-profile/');
    console.log('  Storage state file:  shopify-partner.state.json');
    console.log('  Future test runs will reuse this session automatically.\n');
  } catch (err) {
    logger.error(`Login failed: ${(err as Error).message}`);
    console.error('\n✗ Login failed. See above for details.');
    console.error('  Common causes:');
    console.error('  - Login not completed within 5 minutes');
    console.error('  - Shopify blocked the login (try again in a few minutes)');
    console.error('  - To force a clean re-login: delete shopify-partner-profile/');
    console.error('    and shopify-partner.state.json\n');
    process.exit(1);
  } finally {
    await auth.close();
  }
}

main();
