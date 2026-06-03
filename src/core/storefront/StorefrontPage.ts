// Owner: @FE | Scope: Shopify storefront — Kwikpass tracking-event capture
//
// Public surface:
//   gotoHome(handle)        → navigate <handle>.myshopify.com, auto-fill password
//                             gate from KWIKADS_STOREFRONT_PASSWORD if needed,
//                             capture sp/op1 + e/op5 fired in the settle window.
//                             Events tagged action='Homepage view'.
//   viewFirstProduct()      → click the first product link on the current page
//                             (PDP nav), capture events tagged 'PDP view'.
//
// Endpoint shape calibrated 2026-04-30 against som-qa-store:
//   POST gokwik.io/qa/ka/api/v1/sp/op1   body: { merchant_id, label, ... }
//   POST gokwik.io/qa/ka/api/v1/e/op5    body: { events: [{ event_name, ... }] }
// See: src/discovery/storefront-events-trace.md

import { Page, Request } from '@playwright/test';
import { StorefrontProtectedError } from './errors';

export type StorefrontEndpoint = 'sp/op1' | 'e/op5';

export interface StorefrontEvent {
  action:     string;          // 'Homepage view' | 'PDP view' | …
  endpoint:   StorefrontEndpoint;
  url:        string;
  eventName:  string;
  merchantId: string | null;
}

export interface StorefrontResult {
  events:   StorefrontEvent[];
  finalUrl: string;
}

const SP_OP1                = /https:\/\/api-gw-v4\.dev\.gokwik\.io\/qa\/ka\/api\/v1\/sp\/op1/;
const E_OP5                 = /https:\/\/api-gw-v4\.dev\.gokwik\.io\/qa\/ka\/api\/v1\/e\/op5/;
const PASSWORD_GATE_PATTERN = /\/password(\?|$)/;
const PRODUCT_LINK          = 'a[href*="/products/"]';
const NAV_TIMEOUT_MS        = 30_000;
const SETTLE_GRACE_MS       = 2_000;

export class StorefrontPage {
  constructor(private readonly page: Page) {}

  async gotoHome(handle: string): Promise<StorefrontResult> {
    return this.captureAction('Homepage view', async () => {
      const url = `https://${handle}.myshopify.com/`;
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

      // Password gate is handled by the persistent storefront-profile/ context
      // (cookie cached after a one-time `npm run storefront:login -- <handle>`).
      // If we still land on /password here, the profile hasn't been bootstrapped
      // for this store — caller should skip cleanly.
      if (PASSWORD_GATE_PATTERN.test(this.page.url())) {
        throw new StorefrontProtectedError(handle);
      }

      await this.page.waitForTimeout(SETTLE_GRACE_MS);
    });
  }

  async viewFirstProduct(): Promise<StorefrontResult> {
    return this.captureAction('PDP view', async () => {
      const link = this.page.locator(PRODUCT_LINK).first();
      // Shopify Dawn uses `full-unstyled-link` — position:absolute inside
      // overflow:hidden parent. Playwright can't click it even with force:true.
      // Extract the href and navigate directly — functionally identical.
      await link.waitFor({ state: 'attached', timeout: NAV_TIMEOUT_MS });
      const href = await link.getAttribute('href');
      if (!href) throw new Error('No product link found on storefront page');
      const productUrl = href.startsWith('http') ? href : `https://${this.page.url().split('/')[2]}${href}`;
      await this.page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await this.page.waitForTimeout(SETTLE_GRACE_MS);
    });
  }

  /**
   * Wraps an async action with a request-listener that captures every sp/op1 + e/op5
   * fired during the action. Tags each captured event with the action label.
   */
  private async captureAction(
    actionLabel: string,
    run: () => Promise<void>,
  ): Promise<StorefrontResult> {
    const events: StorefrontEvent[] = [];
    const onRequest = (req: Request): void => {
      const endpoint: StorefrontEndpoint | null =
        SP_OP1.test(req.url()) ? 'sp/op1' :
        E_OP5.test(req.url()) ? 'e/op5'  : null;
      if (!endpoint) return;
      const post = req.postData() ?? '';
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(post) as Record<string, unknown>; } catch { /* ignore — record with eventName='?' */ }
      events.push({
        action:     actionLabel,
        endpoint,
        url:        req.url(),
        eventName:  extractEventName(endpoint, parsed),
        merchantId: extractMerchantId(parsed),
      });
    };
    this.page.on('request', onRequest);

    try {
      await run();
    } finally {
      this.page.off('request', onRequest);
    }

    return { events, finalUrl: this.page.url() };
  }

}

function extractEventName(endpoint: StorefrontEndpoint, body: Record<string, unknown> | null): string {
  if (!body) return '?';
  if (endpoint === 'sp/op1') {
    const label = body['label'];
    return typeof label === 'string' ? label : '?';
  }
  // e/op5
  const eventsArr = body['events'];
  if (!Array.isArray(eventsArr) || eventsArr.length === 0) return '?';
  const first = eventsArr[0] as Record<string, unknown>;
  const name = first['event_name'];
  return typeof name === 'string' ? name : '?';
}

function extractMerchantId(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const top = body['merchant_id'];
  if (typeof top === 'string') return top;
  // e/op5 nests it as events[0].custom_data.prd_ltv_data.m_id
  const eventsArr = body['events'];
  if (!Array.isArray(eventsArr) || eventsArr.length === 0) return null;
  const first = eventsArr[0] as Record<string, unknown>;
  const cd = first['custom_data'];
  if (cd == null || typeof cd !== 'object') return null;
  const ltv = (cd as Record<string, unknown>)['prd_ltv_data'];
  if (ltv == null || typeof ltv !== 'object') return null;
  const m = (ltv as Record<string, unknown>)['m_id'];
  return typeof m === 'string' ? m : null;
}
