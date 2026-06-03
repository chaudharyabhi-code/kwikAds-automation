import { chromium, BrowserContext, Page } from '@playwright/test';
import { envConfig } from '../../config/env.config';
import { MetaSessionStore } from './MetaSessionStore';
import { logger } from '../utils/logger';

const META_LOGIN_URL = 'https://www.facebook.com/login';
const ADS_MANAGER_URL = 'https://adsmanager.facebook.com';

// How long to wait for the human to complete 2FA (5 minutes)
const TWO_FA_TIMEOUT_MS = 5 * 60 * 1000;

export class MetaAuthManager {
  private context: BrowserContext | null = null;

  /**
   * Returns a ready-to-use BrowserContext logged into Meta.
   *
   * Uses a persistent Chromium profile (meta-profile/) so Meta always sees the
   * same "device". After the first login + 2FA, subsequent runs reuse the stored
   * session automatically — no repeated 2FA prompts.
   *
   * Only falls back to interactive login when Meta has actually expired / revoked
   * the session (detected by checking where the browser lands after navigation).
   */
  async getAuthenticatedContext(): Promise<BrowserContext> {
    // On local machines: headful (false) — Meta blocks pure headless Chromium.
    // On CI (Xvfb virtual display): headless=false still works because Xvfb
    // provides a real X11 display.  headless=true is NOT used for Meta scraping.
    const isCI = envConfig.isCI;
    this.context = await chromium.launchPersistentContext(
      MetaSessionStore.getProfileDir(),
      {
        headless: false,
        args: [
          '--start-maximized',
          ...(isCI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        ],
        viewport: { width: 1920, height: 1080 }, // Full HD — ensures all table columns visible
      },
    );

    // Probe whether the stored session is still valid
    const page = await this.context.newPage();
    await page.goto(ADS_MANAGER_URL, { waitUntil: 'load', timeout: 30_000 });

    const url = page.url();
    const sessionExpired =
      url.includes('/login') ||
      url.includes('/checkpoint') ||
      url.includes('login.php') ||
      url.includes('/two_step_verification');

    if (!sessionExpired) {
      logger.info('Persistent session still valid — no login required');
      await page.close();
      return this.context;
    }

    // Session is dead — do interactive login, then Meta will persist the new
    // session tokens into the profile directory automatically
    logger.warn('Meta session expired or profile is new — starting interactive login (2FA required once)');
    await this.runInteractiveLogin(page);
    return this.context;
  }

  /**
   * Fills credentials and waits for the human to complete 2FA.
   * Called only when the persistent session has actually expired.
   * After this succeeds, the profile on disk is updated automatically
   * and future runs will skip this entirely.
   *
   * Two paths:
   *   A) Fresh profile / new account → Meta shows email + password form first.
   *   B) Known device, expired token → Meta skips email/pass and lands directly
   *      on the 2FA / authenticator-code page. In this case we skip filling
   *      credentials and go straight to the waitForURL step.
   */
  private async runInteractiveLogin(page: Page): Promise<void> {
    await page.goto(META_LOGIN_URL, { waitUntil: 'load' });

    // Dismiss cookie consent banner if present
    const cookieBtn = page.locator(
      '[data-cookiebanner="accept_button"], button:has-text("Allow all cookies"), button:has-text("Accept all")',
    );
    if (await cookieBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cookieBtn.first().click();
      logger.info('Cookie consent dismissed');
    }

    // Meta may redirect straight to 2FA when the device (persistent profile) is
    // already recognised — the email/pass form is skipped entirely.
    const landedOn2FA =
      page.url().includes('/two_step_verification') ||
      page.url().includes('/checkpoint') ||
      page.url().includes('/login/two_factor');

    if (landedOn2FA) {
      // Path B — device known, just need the authenticator code
      logger.info('Meta recognised the device — skipped to 2FA/checkpoint directly');
    } else {
      // Path A — fill credentials first
      const emailInput = page.locator('input[name="email"], #email').first();
      const passInput  = page.locator('input[name="pass"], #pass').first();

      // Short-circuit: if the email input never appears (e.g. another redirect),
      // skip filling and fall through to the waitForURL below so the human can
      // complete whatever challenge Meta presents.
      const emailVisible = await emailInput.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
      if (emailVisible) {
        await emailInput.fill(envConfig.metaEmail);
        await passInput.fill(envConfig.metaPassword);
        await passInput.press('Enter');
        logger.info('Credentials submitted — waiting for 2FA...');
      } else {
        logger.warn('Email input not found after goto /login — Meta may have presented a different challenge. Waiting for human to resolve...');
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  ACTION REQUIRED: Complete 2FA in the browser window    ║');
    console.log('║  Enter your authenticator code / approve the request.   ║');
    console.log('║  This is a ONE-TIME step — future runs skip this.       ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    await page.waitForURL(
      (u) =>
        u.hostname.includes('facebook.com') &&
        !u.pathname.includes('/login') &&
        !u.pathname.includes('/checkpoint') &&
        !u.pathname.includes('/two_step_verification') &&
        !u.pathname.includes('/secure/login') &&
        !u.pathname.includes('login.php') &&
        !u.pathname.includes('/login/two_factor'),
      { timeout: TWO_FA_TIMEOUT_MS },
    );

    logger.info('2FA complete — session saved to persistent profile (no 2FA needed on next run)');
    await page.close();
  }

  /** Closes the browser context. Call this at the end of every test/script. */
  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      // context may already be closed if the page crashed or navigated away
    }
    this.context = null;
    logger.info('Browser closed');
  }
}
