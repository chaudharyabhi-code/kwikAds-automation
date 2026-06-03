/**
 * scrape-shopify-stores.ts — One-time discovery: scrape the list of dev stores
 * from the Shopify dev dashboard and persist them to src/testdata/shopifyStores.json.
 *
 * Usage:
 *   npm run shopify:scrape-stores
 *
 * Prerequisites:
 *   - Shopify Partner session active (run `npm run shopify:login` first).
 *
 * What it does:
 *   - Reuses the persistent Shopify Partner profile (no re-login).
 *   - Opens https://dev.shopify.com/dashboard/<org-id>/stores
 *   - Collects every anchor pointing to admin.shopify.com/store/<handle>.
 *   - Dedupes by handle, sorts alphabetically, writes JSON to disk.
 *
 * Re-run only when you add/remove stores from the partner account.
 */

import fs from 'fs';
import path from 'path';
import { ShopifyPartnerAuthManager } from '../core/shopify-partner-auth/ShopifyPartnerAuthManager';
import { logger } from '../core/utils/logger';

const STORES_DASHBOARD_URL = 'https://dev.shopify.com/dashboard/129006046/stores';
const OUTPUT_PATH = path.resolve(__dirname, '../testdata/shopifyStores.json');

interface ScrapedStore {
  name: string;
  handle: string;
  adminUrl: string;
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  KwikAds — Shopify Store Discovery     ');
  console.log('========================================\n');

  const auth = new ShopifyPartnerAuthManager();
  try {
    const context = await auth.getAuthenticatedContext();
    const page = await context.newPage();

    console.log(`Opening: ${STORES_DASHBOARD_URL}\n`);
    await page.goto(STORES_DASHBOARD_URL, { waitUntil: 'load', timeout: 60_000 });

    // Give virtualised lists a moment to render
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* ignore */ });
    await page.waitForTimeout(2_000);

    // Anchor links pointing into a store admin are the canonical signal.
    const links = page.locator('a[href*="admin.shopify.com/store/"]');
    const count = await links.count();
    if (count === 0) {
      throw new Error(
        'No store links found on the dev dashboard. Selector may need updating, ' +
        'or the partner account has zero stores.',
      );
    }

    const raw = await links.evaluateAll((els) =>
      els.map((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href;
        const slug = href.split('/store/')[1]?.split(/[?#/]/)[0] ?? '';

        // Shopify dev dashboard doesn't use headings for store names.
        // Collect every leaf text node in the card, filter noise, pick first hit.
        const NOISE = /^(log in|open admin|visit store|manage|settings|stores?)$/i;
        let name = '';
        let cur: Element | null = a.parentElement;
        for (let i = 0; i < 10 && cur && !name; i++) {
          const leafTexts = Array.from(cur.querySelectorAll('*'))
            .filter((e) => e.children.length === 0)
            .map((e) => e.textContent?.trim() ?? '')
            .filter((t) => t.length > 0 && !NOISE.test(t));
          if (leafTexts.length > 0) name = leafTexts[0]!;
          cur = cur.parentElement;
        }
        // Guaranteed fallback: handle is always correct even if DOM walk fails.
        if (!name || NOISE.test(name)) name = slug;

        return { name, handle: slug, adminUrl: href };
      }),
    );

    // Dedupe by handle — the dashboard often renders multiple links per card.
    const byHandle = new Map<string, ScrapedStore>();
    for (const s of raw) {
      if (!s.handle) continue;
      const existing = byHandle.get(s.handle);
      // Prefer the entry with a non-empty, longer human-readable name
      if (!existing || (s.name.length > existing.name.length)) {
        byHandle.set(s.handle, {
          name: s.name || s.handle,
          handle: s.handle,
          adminUrl: `https://admin.shopify.com/store/${s.handle}`,
        });
      }
    }

    const stores = Array.from(byHandle.values()).sort((a, b) => a.name.localeCompare(b.name));

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stores, null, 2) + '\n');
    logger.info(`Discovered ${stores.length} store(s) → ${OUTPUT_PATH}`);

    console.log(`\n✓ Discovered ${stores.length} store(s):`);
    for (const s of stores) console.log(`   - ${s.name}  (${s.handle})`);
    console.log(`\nWritten to: ${OUTPUT_PATH}\n`);

    await page.close();
  } catch (err) {
    logger.error(`Scrape failed: ${(err as Error).message}`);
    console.error(`\n✗ Scrape failed: ${(err as Error).message}`);
    console.error('  Common causes:');
    console.error('  - Shopify Partner session not active — run: npm run shopify:login');
    console.error('  - Dev dashboard structure changed — refine the link selector\n');
    process.exit(1);
  } finally {
    await auth.close();
  }
}

main();
