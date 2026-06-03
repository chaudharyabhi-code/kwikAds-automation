import { Page } from '@playwright/test';
import { logger } from '../utils/logger';

export interface MetaMetrics {
  // ── Compared against KwikAds API ──────────────────────────────────────────
  spend: number;
  cpm:   number;
  ctr:   number;
  roas:  number;
  impressions: number;
  clicks:      number;   // Link clicks
  cpc:         number;   // Cost per link click (all)
}

// ─── Extended metrics (superset of MetaMetrics) ───────────────────────────────

/** Superset of MetaMetrics — includes 4 additional scraped columns.
 *  `scrapeTotalsRow()` still returns the base MetaMetrics (7 fields).
 *  New scraping methods (`scrapeCampaignRows`, `scrapeAdRows`) return this type.
 */
export interface ExtendedMetaMetrics extends MetaMetrics {
  revenue:   number;   // Purchase conversion value (₹) — "Website purchase ROAS value"
  results:   number;   // Count of purchase conversions — "Results"
  reach:     number;   // Unique users reached — "Reach"
  frequency: number;   // Avg impressions per unique user — "Frequency"
}

/** Patterns for all 11 metrics — used by readRowMetrics() for campaign/ad rows.
 *  Serialised as plain strings so they survive page.evaluate() serialisation.
 */
export const EXTENDED_METRIC_PATTERNS: Record<keyof ExtendedMetaMetrics, string> = {
  // existing 7 — verbatim from METRIC_PATTERNS below
  spend:       'amount spent|total spend',
  cpm:         'cpm|cost per 1,000',
  ctr:         'ctr \\(all\\)',
  roas:        '^purchase roas',
  impressions: '^impressions$',
  clicks:      '^link clicks$',
  cpc:         '^cpc',
  // new 4
  revenue:     'purchase conversion value|purchase value|website purchase roas value',
  results:     '^results$',
  reach:       '^reach$',
  frequency:   '^frequency$',
};

// Maps our metric keys to patterns that match Meta's column header text.
// Serialised as plain strings so they survive page.evaluate() serialisation.
const METRIC_PATTERNS: Record<string, string> = {
  spend:       'amount spent|total spend',
  cpm:         'cpm|cost per 1,000',
  ctr:         'ctr \\(all\\)',
  roas:        '^purchase roas',
  impressions: '^impressions$',
  clicks:      '^link clicks$',
  cpc:         '^cpc',
};

export class MetaDataScraper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Waits for the campaigns totals row, resets the table scroll to X=0 via
   * Playwright wheel events, then reads all metric columns with a multi-pass
   * scan that scrolls right in steps — keeping both scroll containers in sync.
   *
   * ── Root-cause of the previous bugs ──────────────────────────────────────
   * Meta's table has TWO separate scroll containers:
   *   • Header container  — the sticky column-header row
   *   • Data container    — the scrollable rows / totals row
   *
   * React keeps them in sync ONLY via its own wheel-event handlers.
   * Calling `element.scrollIntoView()` or setting `scrollLeft` from inside
   * page.evaluate() moves the HEADER container alone — the data container
   * stays where it is.  After that, elementsFromPoint(headerX, totalsY) hits
   * the WRONG data column, causing all metrics to return the same value
   * (the value that happens to sit under the data container's current offset).
   *
   * ── Fix ───────────────────────────────────────────────────────────────────
   * 1. resetTableScroll(): wheel-left 12 × 700 px → both containers land at
   *    scrollLeft = 0 (can't go past the left edge).
   * 2. readMetrics(): loop — read every header that is currently inside the
   *    viewport, then wheel-right 600 px, repeat up to 15 times.
   *    Because we only ever move via Playwright wheel events (never from
   *    page.evaluate), the two containers are always in lock-step and
   *    elementsFromPoint(headerX, totalsY) always hits the correct cell.
   */
  async scrapeTotalsRow(): Promise<MetaMetrics> {
    logger.info('Waiting for table data to load...');
    await this.page.getByText(/Results from \d+/i).first().waitFor({ timeout: 30_000 });

    // Allow React to fully settle after a date-range change.
    // `Results from N` resolves against stale data that is still on screen
    // while the new period's data is loading.  Without this pause,
    // resetTableScroll() fires during the React re-render — the re-render then
    // restores the previous horizontal scroll offset and overwrites our reset
    // (confirmed from Period 2 diags: spend at x=-2021 = exactly Period 1 end-state).
    await this.page.waitForTimeout(2_500);

    await this.resetTableScroll();

    const metrics = await this.readMetrics();

    logger.info(
      `Scraped totals — Spend: ${metrics.spend}, CPM: ${metrics.cpm}, ` +
      `CTR: ${metrics.ctr}, ROAS: ${metrics.roas}`,
    );
    return metrics;
  }

  // ─── Reset horizontal scroll to leftmost position ──────────────────────────
  //
  // Scroll right briefly (forces React to begin rendering off-screen columns),
  // then scroll all the way left so readMetrics starts from a known X = 0 state.
  // Using Playwright wheel events keeps both scroll containers in sync.

  private async resetTableScroll(): Promise<void> {
    const grid    = this.page.locator('[role="grid"], [role="table"]').first();
    const gridBox = await grid.boundingBox();
    const hoverX  = gridBox ? gridBox.x + gridBox.width  / 2 : 960;
    const hoverY  = gridBox ? gridBox.y + gridBox.height * 0.6 : 540;

    // Retry loop — a React re-render triggered by date-range data loading can
    // restore the previous scroll position right after our reset completes.
    // A second pass (after a short settle) is enough to recover.
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.page.mouse.move(hoverX, hoverY);

      // Brief right-scroll to trigger React column virtualisation
      for (let i = 0; i < 6; i++) {
        await this.page.mouse.wheel(700, 0);
        await this.page.waitForTimeout(120);
      }
      await this.page.waitForTimeout(400);

      // Scroll fully left — 12 × 700 px overshoots any table width, guaranteeing
      // both containers land at scrollLeft = 0 simultaneously.
      for (let i = 0; i < 12; i++) {
        await this.page.mouse.wheel(-700, 0);
        await this.page.waitForTimeout(120);
      }
      await this.page.waitForTimeout(800);

      // Verify the reset actually took effect by checking that the "Amount spent"
      // column header is visible (positive x in viewport).  If it's still
      // off-screen to the left (negative x), the React re-render fired during the
      // reset and restored the old position — retry.
      const spendX = await this.page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('[role="columnheader"]'));
        const h = headers.find(el => /amount spent|total spend/i.test(el.textContent ?? ''));
        return h ? Math.round(h.getBoundingClientRect().left) : null;
      });

      if (spendX !== null && spendX >= 20) break;   // reset confirmed — spend is visible
      if (attempt === 0) {
        logger.warn(`  Scroll reset attempt 1 failed (spend at x=${spendX}) — React re-render likely restored old position — retrying`);
        await this.page.waitForTimeout(1_000);       // brief pause before retry
      }
    }

    logger.info('  Table scroll reset to leftmost position');
  }

  // ─── Multi-pass metric read ────────────────────────────────────────────────
  //
  // Each pass calls page.evaluate ONCE to read every column header that is
  // currently inside the viewport.  Columns outside the viewport are skipped
  // (NOT scrolled via scrollIntoView — that would desync the containers).
  // After each pass Playwright scrolls right 600 px (synced wheel event) so
  // the next batch of columns comes into view.

  private async readMetrics(): Promise<MetaMetrics> {
    const out: Record<string, number> = {
      spend: 0, cpm: 0, ctr: 0, roas: 0, impressions: 0, clicks: 0, cpc: 0,
    };
    // `resolved` tracks every key that has been definitively answered —
    // either with a real numeric value OR with a confirmed dash (= 0).
    // Keys not in `resolved` are still pending and will be retried next step.
    // This prevents a dash cell from being retried 15 times and eventually
    // being overwritten with a value from an adjacent column.
    const resolved = new Set<string>();
    const allDiags: string[] = [];

    // Keep the mouse over the data area throughout so wheel events hit the
    // correct scroll target.
    const grid    = this.page.locator('[role="grid"], [role="table"]').first();
    const gridBox = await grid.boundingBox();
    const hoverX  = gridBox ? gridBox.x + gridBox.width  / 2 : 960;
    const hoverY  = gridBox ? gridBox.y + gridBox.height * 0.6 : 540;
    await this.page.mouse.move(hoverX, hoverY);

    const allKeys = Object.keys(METRIC_PATTERNS);

    for (let step = 0; step < 15; step++) {
      if (resolved.size === allKeys.length) break; // all metrics resolved

      // Keys already resolved (value or dash) are skipped inside page.evaluate.
      const skip = Array.from(resolved);

      const result = await this.page.evaluate(
        ({ patterns, skip: skipKeys }: { patterns: Record<string, string>; skip: string[] }) => {
          const stepMetrics: Record<string, number> = {};
          // Keys whose totals-row cell explicitly shows a dash — resolved as 0,
          // never retried.  Dash means Meta has no aggregate for this metric.
          const dashKeys: string[] = [];
          const diags: string[] = [];

          // ── Helper: strip to first clean number ────────────────────────
          function stripToNumber(text: string): number {
            const digits   = (text || '').replace(/[^0-9.]/g, '');
            const firstDot = digits.indexOf('.');
            const clean    = firstDot === -1
              ? digits
              : digits.slice(0, firstDot + 1) + digits.slice(firstDot + 1).replace(/\./g, '');
            const val = parseFloat(clean);
            return isNaN(val) ? 0 : val;
          }

          // ── Helper: is a text string an explicit dash character? ────────
          // Empty string is NOT treated as dash — it might mean the cell hasn't
          // rendered yet (React virtualisation delay) or uses a CSS pseudo-element.
          // Only explicit dash glyphs are treated as "Meta shows no aggregate".
          function isDashText(t: string): boolean {
            return t === '—' || t === '–' || t === '--' || t === '-';
          }

          // ── Helper: walk leaf nodes, reject leaves outside header bounds ──
          // hLeft / hRight are the column header's CURRENT viewport X bounds.
          // tolerancePx: how far outside the bounds a leaf center may sit.
          // Element 0 (the direct data cell) gets 2× tolerance so right-aligned
          // values just past the header edge are not rejected.
          function extractValueFromElement(
            el: Element,
            hLeft: number,
            hRight: number,
            tolerancePx: number,
          ): number {
            const leaves = Array.from(el.querySelectorAll('*')).filter(
              e => e.querySelectorAll('*').length === 0,
            );
            const nodesToCheck = leaves.length > 0 ? leaves : [el];

            for (const node of nodesToCheck) {
              const text = (node.textContent || '').trim();
              if (!text || isDashText(text)) continue;
              if (!/\d/.test(text)) continue;
              if (/Results from|campaigns?/i.test(text)) continue;

              // For zero-dim leaves (React mid-render), use parent bounds to determine
              // the column. This rejects the "50" leaf from "Results from N campaigns"
              // (its parent is the leftmost cell → cx fails the column-bounds check)
              // while allowing valid metric leaves that are momentarily zero-dim
              // (their parent IS the correct metric cell → cx passes) — failure_knowledge #15/#17.
              const nb = node.getBoundingClientRect();
              let checkBounds = nb;
              if (nb.width === 0 || nb.height === 0) {
                const parent = (node as HTMLElement).parentElement;
                if (!parent) continue;
                const pb = parent.getBoundingClientRect();
                if (pb.width === 0 || pb.height === 0) continue;
                checkBounds = pb;
              }
              const cx = checkBounds.left + checkBounds.width / 2;
              if (cx < hLeft - tolerancePx || cx > hRight + tolerancePx) continue;

              const val = stripToNumber(text);
              if (val !== 0) return val;
            }
            return 0;
          }

          // ── Helper: get the primary visible text of element 0 at a point ──
          // Used to detect dash cells before giving up on a metric.
          // Falls back to element.innerText when textContent is empty — Meta
          // renders the "—" glyph via CSS ::before / ::after pseudo-elements in
          // some totals-row cells, and innerText (unlike textContent) captures
          // pseudo-element content in Chromium.
          function primaryTextAtPoint(x: number, y: number): string {
            const els = document.elementsFromPoint(x, y);
            const el0 = els.find(e => e !== document.body && e !== document.documentElement);
            if (!el0) return '';
            const leaves = Array.from(el0.querySelectorAll('*')).filter(
              e => e.querySelectorAll('*').length === 0,
            );
            for (const n of leaves) {
              const t = (n.textContent || '').trim();
              if (t) return t;
            }
            const tc = (el0.textContent || '').trim();
            if (tc) return tc;
            // Pseudo-element fallback — innerText includes ::before / ::after
            return ((el0 as HTMLElement).innerText || '').trim();
          }

          // ── Helper: collect raw leaf texts at a viewport point (diagnostics) ──
          function rawTextsAtPoint(x: number, y: number): string[] {
            const texts: string[] = [];
            for (const el of document.elementsFromPoint(x, y).slice(0, 6)) {
              if (el === document.body || el === document.documentElement) continue;
              const leaves = Array.from(el.querySelectorAll('*')).filter(
                e => e.querySelectorAll('*').length === 0,
              );
              for (const n of (leaves.length > 0 ? leaves.slice(0, 4) : [el])) {
                const t = (n.textContent || '').trim().slice(0, 30);
                if (t) texts.push(t);
              }
              if (texts.length >= 6) break;
            }
            return [...new Set(texts)];
          }

          // ── Step 1: locate totals row Y ────────────────────────────────
          const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let textNode: Node | null;
          let totalsY = -1;

          while ((textNode = textWalker.nextNode())) {
            if (/Results from \d+/i.test(textNode.textContent || '')) {
              const p    = textNode.parentElement as HTMLElement | null;
              const rect = p?.getBoundingClientRect();
              if (rect && rect.height > 0) {
                totalsY = Math.round(rect.top + rect.height / 2);
                diags.push(`totalsY=${totalsY}`);
              }
              break;
            }
          }

          if (totalsY < 0) {
            diags.push('ERROR:totals-row-not-found');
            return { stepMetrics, dashKeys, diags };
          }

          const vw         = window.innerWidth;
          const allHeaders = Array.from(document.querySelectorAll('[role="columnheader"]'));

          // ── Step 2: attempt to read each unresolved metric ─────────────
          for (const [key, pat] of Object.entries(patterns)) {
            if (skipKeys.includes(key)) continue;

            const header = allHeaders.find(
              h => new RegExp(pat, 'i').test((h.textContent || '').trim()),
            );
            if (!header) { diags.push(`${key}:no-header`); continue; }

            const hRect = header.getBoundingClientRect();
            if (hRect.width === 0 || hRect.height === 0) {
              diags.push(`${key}:zero-size`); continue;
            }

            // Skip headers not yet in the viewport — read them after the
            // next wheel-right.  Never call scrollIntoView here; it only moves
            // the header container and desyncs it from the data container.
            if (hRect.right <= 20 || hRect.left >= vw - 20) {
              diags.push(`${key}:off-screen(x=${Math.round(hRect.left)})`);
              continue;
            }

            const xCandidates = [
              Math.round(hRect.right - 5),
              Math.round(hRect.left + hRect.width * 0.6),
              Math.round(hRect.left + hRect.width / 2),
            ].filter(x => x > 20 && x < vw - 10);

            // Column header's left edge is inside the viewport but all candidate
            // sample points fall past the right edge (vw-10). The column body is
            // still mostly off-screen — React hasn't rendered the data cell yet.
            // Skip this step so the next scroll brings it fully into view.
            // Prevents the misleading "miss @x= raw=[]" log entry.
            if (xCandidates.length === 0) {
              diags.push(`${key}:partial-offscreen(left=${Math.round(hRect.left)})`);
              continue;
            }

            // Narrow columns (< 80 px) get a wider base tolerance; element-0
            // then gets 2× of this so right-aligned leaf values just past the
            // header edge are still captured.
            const colTolerance = hRect.width < 80 ? 60 : 30;

            let found = false;

            for (const hitX of xCandidates) {
              if (found) break;

              const hitElements = document.elementsFromPoint(hitX, totalsY);

              for (let eIdx = 0; eIdx < hitElements.length; eIdx++) {
                const el = hitElements[eIdx]!;
                if (el === document.body || el === document.documentElement) continue;

                const elText = (el.textContent || '').trim();
                if (/Results from \d+/i.test(elText) && /campaigns?/i.test(elText)) continue;

                // Element 0 (most specific) gets 2× tolerance — covers
                // right-aligned leaf nodes positioned just past the header edge.
                // Parent containers (eIdx ≥ 1) keep normal tolerance to prevent
                // leaves from adjacent columns bleeding in.
                const elTolerance = eIdx === 0 ? colTolerance * 2 : colTolerance;

                const val = extractValueFromElement(el, hRect.left, hRect.right, elTolerance);
                if (val !== 0) {
                  stepMetrics[key] = val;
                  diags.push(`${key}:found→${val} @x=${hitX}`);
                  found = true;
                  break;
                }

                // Skip very large containers (whole-table wrappers) — expensive
                // and won't produce a better result.  Continue rather than break
                // so we can still try smaller elements further down the stack.
                if (el.querySelectorAll('*').length > 40) continue;
              }
            }

            if (!found) {
              // Check whether the cell explicitly shows a dash.
              // If yes: Meta has no aggregate for this metric → resolve as 0
              // immediately so we never retry (and never risk picking up an
              // adjacent column's value on a later scroll step).
              const firstHitX = xCandidates[0];
              const primary   = firstHitX !== undefined ? primaryTextAtPoint(firstHitX, totalsY) : '';
              const raw       = firstHitX !== undefined ? rawTextsAtPoint(firstHitX, totalsY) : [];

              if (isDashText(primary)) {
                diags.push(`${key}:dash→0 raw=[${raw.join('|')}]`);
                dashKeys.push(key);
              } else {
                diags.push(`${key}:miss @x=${xCandidates.join(',')} raw=[${raw.join('|')}]`);
              }
            }
          }

          return { stepMetrics, dashKeys, diags };
        },
        { patterns: METRIC_PATTERNS, skip },
      );

      // Merge numeric values found this step
      for (const [k, v] of Object.entries(result.stepMetrics)) {
        if (v !== 0) {
          out[k] = v;
          resolved.add(k);
        }
      }

      // Mark dash cells as resolved (value stays 0 — Meta shows no aggregate)
      for (const k of result.dashKeys) {
        resolved.add(k); // out[k] stays 0
      }

      allDiags.push(`[step${step}] ` + result.diags.join(' | '));

      if (resolved.size === allKeys.length) break;

      // Scroll right via Playwright wheel — keeps both scroll containers in sync.
      // 500 ms gives React enough time to virtualise and render newly visible cells.
      await this.page.mouse.wheel(600, 0);
      await this.page.waitForTimeout(500);
    }

    // Any key still not in resolved after all steps stays 0.
    // Log a warning so it's visible in the report.
    for (const k of allKeys) {
      if (!resolved.has(k)) {
        logger.warn(`  ${k}: could not be read from Meta totals row after all scroll steps — defaulting to 0`);
      }
    }

    logger.info('  Scrape diags:\n    ' + allDiags.join('\n    '));
    logger.info(
      `  spend=${out['spend']}, cpm=${out['cpm']}, ctr=${out['ctr']}, roas=${out['roas']}, ` +
      `impressions=${out['impressions']}, clicks=${out['clicks']}, cpc=${out['cpc']}`,
    );

    const raw: MetaMetrics = {
      spend:       out['spend']       ?? 0,
      cpm:         out['cpm']         ?? 0,
      ctr:         out['ctr']         ?? 0,
      roas:        out['roas']        ?? 0,
      impressions: out['impressions'] ?? 0,
      clicks:      out['clicks']      ?? 0,
      cpc:         out['cpc']         ?? 0,
    };

    // Safety: take absolute value for any metric that came back negative.
    for (const key of Object.keys(raw) as Array<keyof MetaMetrics>) {
      if (raw[key] < 0) {
        logger.warn(`  Negative value for ${key} (${raw[key]}) — using absolute`);
        raw[key] = Math.abs(raw[key]);
      }
    }

    return raw;
  }

  // ─── readRowMetrics — mirrors readMetrics() with an external rowY ────────────
  //
  // The ONLY difference from readMetrics() is that instead of walking the DOM
  // to locate the totals-row Y coordinate inside page.evaluate(), we receive
  // `rowY` from the Playwright side (via .boundingBox()) and pass it in as a
  // serialised argument.  This is the critical discipline: row Y coordinates
  // are always computed in Playwright, never inside evaluate().

  private async readRowMetrics(rowY: number, patterns: Record<string, string>): Promise<ExtendedMetaMetrics> {
    const keys = Object.keys(patterns);
    const out: Record<string, number> = {};
    for (const k of keys) out[k] = 0;

    const resolved = new Set<string>();
    const allDiags: string[] = [];

    const grid    = this.page.locator('[role="grid"], [role="table"]').first();
    const gridBox = await grid.boundingBox();
    const hoverX  = gridBox ? gridBox.x + gridBox.width  / 2 : 960;
    const hoverY  = gridBox ? gridBox.y + gridBox.height * 0.6 : 540;
    await this.page.mouse.move(hoverX, hoverY);

    for (let step = 0; step < 15; step++) {
      if (resolved.size === keys.length) break;

      const skip = Array.from(resolved);

      const result = await this.page.evaluate(
        ({ patterns: pats, skip: skipKeys, rowY: targetY }: {
          patterns: Record<string, string>;
          skip: string[];
          rowY: number;
        }) => {
          const stepMetrics: Record<string, number> = {};
          const dashKeys: string[] = [];
          const diags: string[] = [];

          function stripToNumber(text: string): number {
            const digits   = (text || '').replace(/[^0-9.]/g, '');
            const firstDot = digits.indexOf('.');
            const clean    = firstDot === -1
              ? digits
              : digits.slice(0, firstDot + 1) + digits.slice(firstDot + 1).replace(/\./g, '');
            const val = parseFloat(clean);
            return isNaN(val) ? 0 : val;
          }

          function isDashText(t: string): boolean {
            return t === '—' || t === '–' || t === '--' || t === '-';
          }

          function extractValueFromElement(
            el: Element,
            hLeft: number,
            hRight: number,
            tolerancePx: number,
          ): number {
            const leaves = Array.from(el.querySelectorAll('*')).filter(
              e => e.querySelectorAll('*').length === 0,
            );
            const nodesToCheck = leaves.length > 0 ? leaves : [el];

            for (const node of nodesToCheck) {
              const text = (node.textContent || '').trim();
              if (!text || isDashText(text)) continue;
              if (!/\d/.test(text)) continue;
              if (/Results from|campaigns?/i.test(text)) continue;

              // For zero-dim leaves (React mid-render), use parent bounds to determine
              // the column. This rejects the "50" leaf from "Results from N campaigns"
              // (its parent is the leftmost cell → cx fails the column-bounds check)
              // while allowing valid metric leaves that are momentarily zero-dim
              // (their parent IS the correct metric cell → cx passes) — failure_knowledge #15/#17.
              const nb = node.getBoundingClientRect();
              let checkBounds = nb;
              if (nb.width === 0 || nb.height === 0) {
                const parent = (node as HTMLElement).parentElement;
                if (!parent) continue;
                const pb = parent.getBoundingClientRect();
                if (pb.width === 0 || pb.height === 0) continue;
                checkBounds = pb;
              }
              const cx = checkBounds.left + checkBounds.width / 2;
              if (cx < hLeft - tolerancePx || cx > hRight + tolerancePx) continue;

              const val = stripToNumber(text);
              if (val !== 0) return val;
            }
            return 0;
          }

          function primaryTextAtPoint(x: number, y: number): string {
            const els = document.elementsFromPoint(x, y);
            const el0 = els.find(e => e !== document.body && e !== document.documentElement);
            if (!el0) return '';
            const leaves = Array.from(el0.querySelectorAll('*')).filter(
              e => e.querySelectorAll('*').length === 0,
            );
            for (const n of leaves) {
              const t = (n.textContent || '').trim();
              if (t) return t;
            }
            const tc = (el0.textContent || '').trim();
            if (tc) return tc;
            return ((el0 as HTMLElement).innerText || '').trim();
          }

          function rawTextsAtPoint(x: number, y: number): string[] {
            const texts: string[] = [];
            for (const el of document.elementsFromPoint(x, y).slice(0, 6)) {
              if (el === document.body || el === document.documentElement) continue;
              const leaves = Array.from(el.querySelectorAll('*')).filter(
                e => e.querySelectorAll('*').length === 0,
              );
              for (const n of (leaves.length > 0 ? leaves.slice(0, 4) : [el])) {
                const t = (n.textContent || '').trim().slice(0, 30);
                if (t) texts.push(t);
              }
              if (texts.length >= 6) break;
            }
            return [...new Set(texts)];
          }

          // Use the externally-provided row Y (computed in Playwright via .boundingBox())
          const totalsY = targetY;
          diags.push(`rowY=${totalsY}`);

          const vw         = window.innerWidth;
          const allHeaders = Array.from(document.querySelectorAll('[role="columnheader"]'));

          for (const [key, pat] of Object.entries(pats)) {
            if (skipKeys.includes(key)) continue;

            const header = allHeaders.find(
              h => new RegExp(pat, 'i').test((h.textContent || '').trim()),
            );
            if (!header) { diags.push(`${key}:no-header`); continue; }

            const hRect = header.getBoundingClientRect();
            if (hRect.width === 0 || hRect.height === 0) {
              diags.push(`${key}:zero-size`); continue;
            }
            if (hRect.right <= 20 || hRect.left >= vw - 20) {
              diags.push(`${key}:off-screen(x=${Math.round(hRect.left)})`);
              continue;
            }

            const xCandidates = [
              Math.round(hRect.right - 5),
              Math.round(hRect.left + hRect.width * 0.6),
              Math.round(hRect.left + hRect.width / 2),
            ].filter(x => x > 20 && x < vw - 10);

            if (xCandidates.length === 0) {
              diags.push(`${key}:partial-offscreen(left=${Math.round(hRect.left)})`);
              continue;
            }

            const colTolerance = hRect.width < 80 ? 60 : 30;
            let found = false;

            for (const hitX of xCandidates) {
              if (found) break;
              const hitElements = document.elementsFromPoint(hitX, totalsY);

              for (let eIdx = 0; eIdx < hitElements.length; eIdx++) {
                const el = hitElements[eIdx]!;
                if (el === document.body || el === document.documentElement) continue;

                const elText = (el.textContent || '').trim();
                if (/Results from \d+/i.test(elText) && /campaigns?/i.test(elText)) continue;

                const elTolerance = eIdx === 0 ? colTolerance * 2 : colTolerance;
                const val = extractValueFromElement(el, hRect.left, hRect.right, elTolerance);
                if (val !== 0) {
                  stepMetrics[key] = val;
                  diags.push(`${key}:found→${val} @x=${hitX}`);
                  found = true;
                  break;
                }
                if (el.querySelectorAll('*').length > 40) continue;
              }
            }

            if (!found) {
              const firstHitX = xCandidates[0];
              const primary   = firstHitX !== undefined ? primaryTextAtPoint(firstHitX, totalsY) : '';
              const raw       = firstHitX !== undefined ? rawTextsAtPoint(firstHitX, totalsY) : [];

              if (isDashText(primary)) {
                diags.push(`${key}:dash→0 raw=[${raw.join('|')}]`);
                dashKeys.push(key);
              } else {
                diags.push(`${key}:miss @x=${xCandidates.join(',')} raw=[${raw.join('|')}]`);
              }
            }
          }

          return { stepMetrics, dashKeys, diags };
        },
        { patterns, skip, rowY },
      );

      for (const [k, v] of Object.entries(result.stepMetrics)) {
        if (v !== 0) { out[k] = v; resolved.add(k); }
      }
      for (const k of result.dashKeys) resolved.add(k);
      allDiags.push(`[step${step}] ` + result.diags.join(' | '));

      if (resolved.size === keys.length) break;
      await this.page.mouse.wheel(600, 0);
      await this.page.waitForTimeout(500);
    }

    for (const k of keys) {
      if (!resolved.has(k)) {
        logger.warn(`  ${k}: could not be read from row Y=${rowY} after all scroll steps — defaulting to 0`);
      }
    }

    logger.info('  Row diags:\n    ' + allDiags.join('\n    '));

    const raw: ExtendedMetaMetrics = {
      spend:       out['spend']       ?? 0,
      cpm:         out['cpm']         ?? 0,
      ctr:         out['ctr']         ?? 0,
      roas:        out['roas']        ?? 0,
      impressions: out['impressions'] ?? 0,
      clicks:      out['clicks']      ?? 0,
      cpc:         out['cpc']         ?? 0,
      revenue:     out['revenue']     ?? 0,
      results:     out['results']     ?? 0,
      reach:       out['reach']       ?? 0,
      frequency:   out['frequency']   ?? 0,
    };

    for (const key of Object.keys(raw) as Array<keyof ExtendedMetaMetrics>) {
      if (raw[key] < 0) {
        logger.warn(`  Negative value for ${key} (${raw[key]}) — using absolute`);
        raw[key] = Math.abs(raw[key]);
      }
    }

    return raw;
  }

  // ─── Helper: zero-filled ExtendedMetaMetrics ─────────────────────────────────

  private zeroExtendedMetrics(): ExtendedMetaMetrics {
    return {
      spend: 0, cpm: 0, ctr: 0, roas: 0, impressions: 0, clicks: 0, cpc: 0,
      revenue: 0, results: 0, reach: 0, frequency: 0,
    };
  }

}
