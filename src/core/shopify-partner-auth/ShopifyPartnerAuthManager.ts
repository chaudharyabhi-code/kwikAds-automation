// Owner: @FE
// Scope: Shopify Partner dev dashboard auth

import { chromium, BrowserContext, Page } from '@playwright/test';
import { envConfig } from '../../config/env.config';
import { ShopifyPartnerSessionStore } from './ShopifyPartnerSessionStore';
import { logger } from '../utils/logger';

// Canonical entry point for the Shopify "dev dashboard" — every test store
// for this partner account is listed here. Pre-auth, Shopify redirects this
// URL to accounts.shopify.com / Google SSO; post-auth, it lands back on
// dev.shopify.com/dashboard/<org-id>/stores.
const PARTNER_URL = 'https://dev.shopify.com/dashboard/129006046/stores';
// Manual login budget: covers email, password, optional 2FA, and any extra
// security challenges Shopify may show. Mirrors gokwik-login.ts.
const MANUAL_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class ShopifyPartnerAuthManager {
  private context: BrowserContext | null = null;

  async getAuthenticatedContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const isCI = envConfig.isCI;
    this.context = await chromium.launchPersistentContext(
      ShopifyPartnerSessionStore.getProfileDir(),
      {
        headless: false,
        args: [
          '--start-maximized',
          ...(isCI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        ],
        viewport: { width: 1920, height: 1080 },
      },
    );

    const page = await this.context.newPage();
    await page.goto(PARTNER_URL, { waitUntil: 'load', timeout: 30_000 });

    if (this.isAuthenticated(page.url())) {
      logger.info('Shopify Partner session valid — no login required');
      await this.saveStorageState();
      await page.close();
      return this.context;
    }

    logger.warn('Shopify Partner session expired or new profile — manual login required');
    await this.runManualLogin(page);
    await this.saveStorageState();
    return this.context;
  }

  private async saveStorageState(): Promise<void> {
    if (!this.context) return;
    const statePath = ShopifyPartnerSessionStore.getStatePath();
    await this.context.storageState({ path: statePath });
    logger.info(`Shopify Partner storage state saved → ${statePath}`);
  }

  private isAuthenticated(url: string): boolean {
    // Unauthenticated sessions land on accounts.shopify.com/* or any /login,
    // /signin, or accounts.google.com (Google SSO step) page. Authenticated
    // sessions resolve to dev.shopify.com / partners.shopify.com / admin.shopify.com.
    return !/\/login|\/signin|accounts\.shopify\.com|accounts\.google\.com/.test(url);
  }

  private async runManualLogin(page: Page): Promise<void> {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  ACTION REQUIRED                                        │');
    console.log('│                                                         │');
    console.log('│  Sign in to Shopify Partners in the browser window.     │');
    console.log('│  Type your email + password (and 2FA if prompted).      │');
    console.log('│                                                         │');
    console.log('│  As soon as you land on the partners dashboard,         │');
    console.log('│  this script saves the session and exits.               │');
    console.log('│                                                         │');
    console.log('│  Waiting up to 5 minutes...                             │');
    console.log('└─────────────────────────────────────────────────────────┘\n');
    logger.info('Waiting for manual Shopify Partner login...');

    // After SSO, Shopify can land on any of these authenticated hosts:
    //   - dev.shopify.com        (new dev dashboard — canonical for this account)
    //   - partners.shopify.com   (legacy partners dashboard)
    //   - admin.shopify.com      (when SSO routes straight into a store)
    //   - <handle>.myshopify.com (legacy store admin)
    await page.waitForURL(
      (u) => {
        const onLoginPath = /\/login|\/signin/.test(u.pathname);
        const onAuthedHost =
          /(?:^|\.)dev\.shopify\.com$/.test(u.hostname) ||
          /(?:^|\.)partners\.shopify\.com$/.test(u.hostname) ||
          /(?:^|\.)admin\.shopify\.com$/.test(u.hostname) ||
          /\.myshopify\.com$/.test(u.hostname);
        return onAuthedHost && !onLoginPath;
      },
      { timeout: MANUAL_LOGIN_TIMEOUT_MS },
    );

    logger.info('Shopify Partner login complete — session persisted');
    await page.close();
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      // context may already be closed
    }
    this.context = null;
    logger.info('Browser closed');
  }
}
