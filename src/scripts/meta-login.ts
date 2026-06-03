/**
 * meta-login.ts — Run this script ONCE to log into Meta and save the session.
 *
 * Usage:
 *   npm run meta:login
 *
 * What it does:
 *   - Opens a Chrome window with the persistent browser profile (meta-profile/).
 *   - If Meta still recognises the session → prints a success message and exits.
 *   - If session is expired / profile is new → fills your email + password,
 *     then waits for YOU to complete 2FA.
 *     Once you land on Ads Manager, the session is stored in the profile
 *     and this script exits.
 *
 * After running this once successfully, you do NOT need to run it again unless
 * Meta explicitly logs you out or you manually delete the meta-profile/ directory.
 */

import { MetaAuthManager } from '../core/meta-scraper/MetaAuthManager';
import { logger } from '../core/utils/logger';

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  KwikAds — Meta Session Login Script   ');
  console.log('========================================\n');
  console.log('Launching browser with persistent profile...\n');

  const auth = new MetaAuthManager();

  try {
    await auth.getAuthenticatedContext();
    console.log('\n✓ Session is valid — you are logged in to Meta.');
    console.log('  Future test runs will reuse this session automatically.\n');
    console.log('  Run tests with:  npx playwright test\n');
  } catch (err) {
    logger.error(`Login failed: ${(err as Error).message}`);
    console.error('\n✗ Login failed. See above for details.');
    console.error('  Common causes:');
    console.error('  - 2FA not completed within 5 minutes');
    console.error('  - Wrong META_EMAIL or META_PASSWORD in .env');
    console.error('  - Meta blocked the login (try again in a few minutes)');
    console.error('  - To force a clean re-login: delete the meta-profile/ folder\n');
    process.exit(1);
  } finally {
    await auth.close();
  }
}

main();
