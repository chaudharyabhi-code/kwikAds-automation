// Owner: @BE | Scope: Generic response-capture utility — no KwikAds-specific logic

import type { Page, Response } from '@playwright/test';
import type { Captured, ResponseLog } from './network-types';

/**
 * Pattern registry: map from a bucket name to one or more URL regexes.
 * A response is routed to a bucket if its URL matches ANY of the bucket's patterns.
 *
 * @example
 *   { search_graphql: [/\/api\/operations\/[^/]+\/Search\//] }
 */
export type PatternRegistry<K extends string> = Record<K, RegExp[]>;

/**
 * Attaches a response listener to `page` that captures responses whose URLs
 * match the supplied pattern registry.
 *
 * Returns:
 *   - `buckets` — live reference; entries appear as responses fire (poll-safe)
 *   - `stop()`  — detaches the listener and resolves the final buckets
 *
 * Typical usage (fire-and-poll):
 * ```ts
 * const { buckets, stop } = observeNetwork(page, { search_graphql: [/\/Search\//] });
 * await page.keyboard.press('Control+k');
 * await page.keyboard.type('kwikpass');
 * // poll until a match lands
 * const deadline = Date.now() + 15_000;
 * while (buckets.search_graphql.length === 0 && Date.now() < deadline) {
 *   await page.waitForTimeout(300);
 * }
 * const captured = await stop();
 * ```
 *
 * The listener is non-blocking — it never delays the page.
 * Body parsing is best-effort: non-JSON responses get `body: null`.
 */
export function observeNetwork<K extends string>(
  page: Page,
  patterns: PatternRegistry<K>,
): { buckets: Captured<K>; stop: () => Promise<Captured<K>> } {
  const buckets = Object.fromEntries(
    (Object.keys(patterns) as K[]).map((k) => [k, [] as ResponseLog[]]),
  ) as Captured<K>;

  const keys = Object.keys(patterns) as K[];

  const onResponse = async (response: Response): Promise<void> => {
    const url = response.url();
    for (const key of keys) {
      const regexes = patterns[key]!;
      if (regexes.some((re) => re.test(url))) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // Non-JSON or already-consumed body — leave as null
        }
        buckets[key].push({ url, status: response.status(), body, raw: response, capturedAt: Date.now() });
      }
    }
  };

  page.on('response', onResponse);

  return {
    buckets,
    stop: async (): Promise<Captured<K>> => {
      page.off('response', onResponse);
      return buckets;
    },
  };
}
