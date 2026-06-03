// Owner: @BE | Scope: Google SSO — auto-click known account tile if already persisted in Chrome
//
// Drop-in helper for any polling loop that may stall on accounts.google.com.
// Returns true if a click was fired, false in every other case (no-op).
// Never throws.

import type { Page } from '@playwright/test';
import { logger } from '../utils/logger';

/**
 * If the current page is a Google account chooser AND the target email is
 * visible as a tile, clicks it and returns true.
 *
 * Returns false immediately when:
 *   - email is empty / undefined  → auto-click disabled
 *   - not on accounts.google.com  → fast no-op
 *   - tile not found              → manual SSO required, caller keeps waiting
 *
 * Tries 4 selector strategies in order so a Google UI refresh doesn't
 * silently break the feature.
 */
export async function tryClickGoogleAccount(
  page: Page,
  email: string | undefined,
): Promise<boolean> {
  if (!email) return false;

  try {
    if (!page.url().includes('accounts.google.com')) return false;

    // Strategy 1 — data-email  (classic account chooser)
    // Strategy 2 — data-identifier  (newer chooser variant)
    // Strategy 3 — aria-label containing the email
    const attrSelectors = [
      `[data-email="${email}"]`,
      `[data-identifier="${email}"]`,
      `[aria-label*="${email}"]`,
    ];

    for (const sel of attrSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await el.click();
        logger.info(`[google-sso] Auto-clicked account tile (${sel}): ${email}`);
        return true;
      }
    }

    // Strategy 4 — exact text match (always works if email is rendered as plain text)
    const textEl = page.getByText(email, { exact: true }).first();
    if (await textEl.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await textEl.click();
      logger.info(`[google-sso] Auto-clicked account tile (text match): ${email}`);
      return true;
    }

    return false;
  } catch {
    // Page closed, context destroyed mid-check — safe to ignore
    return false;
  }
}
