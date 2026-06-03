// src/core/meta-scraper/MetaAdsNavigator.ts

import { BrowserContext, Page } from '@playwright/test';
import { logger } from '../utils/logger';

// ─── Constants ───────────────────────────────────────────────────────────────

const ADS_MANAGER_BASE      = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
const ADS_MANAGER_ADS_BASE  = 'https://adsmanager.facebook.com/adsmanager/manage/ads';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Each entry: `search` is typed into the modal's search box,
// `match` checks the first line of text in the result row.
// `subOption` (optional): if the result row has sub-option toggles (e.g. Total/Value/Cost),
//   this is the exact label of the one to select.  The main row click is skipped and only
//   the named sub-option element is clicked.
// To add a new metric: add one entry here AND add a matching pattern in
// MetaDataScraper METRIC_PATTERNS. That's all — everything else is automatic.
const REQUIRED_COLUMNS: Array<{ search: string; match: RegExp; subOption?: string }> = [
  // Original 7 columns
  { search: 'Amount spent',              match: /^amount spent$/i },
  { search: 'CTR (all)',                 match: /^ctr \(all\)$/i },
  { search: 'Purchase ROAS',            match: /^purchase roas/i, subOption: 'Total' },
  { search: 'CPM',                       match: /^cpm/i },
  { search: 'Impressions',              match: /^impressions$/i },
  { search: 'Link clicks',              match: /^link clicks$/i },
  { search: 'CPC (all)',                match: /^cpc/i },
  // Extended 4 columns (for ExtendedMetaMetrics)
  { search: 'Website purchase',          match: /^website purchase roas/i, subOption: 'Value' },
  { search: 'Results',                   match: /^results$/i },
  { search: 'Reach',                     match: /^reach$/i },
  { search: 'Frequency',                 match: /^frequency$/i },
];

// ─── Class ───────────────────────────────────────────────────────────────────

export class MetaAdsNavigator {
  private page: Page;

  private constructor(private readonly context: BrowserContext) {
    this.page = null as unknown as Page;
  }

  static async create(context: BrowserContext): Promise<MetaAdsNavigator> {
    const nav = new MetaAdsNavigator(context);
    nav.page = await context.newPage();
    return nav;
  }

  getPage(): Page {
    return this.page;
  }


  // ═══════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════

  /**
   * Navigate to a specific ad account's campaigns page and wait for the table.
   */
  async goToAdAccount(adAccountId: string): Promise<void> {
    const numericId = adAccountId.replace('act_', '');
    const url = `${ADS_MANAGER_BASE}?act=${numericId}`;

    logger.info(`Navigating to ad account: ${adAccountId}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await this.page.waitForSelector('[role="grid"], [role="table"]', { timeout: 30_000 });

    // Wait for any loading overlay to clear before we interact
    await this.page
      .locator('text="Loading..."')
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => {});

    logger.info(`✅ Loaded ad account: ${adAccountId}`);
  }

  /**
   * Navigate to the Ads view for a specific ad account.
   * Meta tracks column presets per view level — call configureColumns() after this.
   *
   * @param adAccountId - format "act_XXXX"
   */
  async goToAdsView(adAccountId: string): Promise<void> {
    const numericId = adAccountId.replace('act_', '');
    const url = `${ADS_MANAGER_ADS_BASE}?act=${numericId}`;

    logger.info(`Navigating to Ads view: ${adAccountId}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await this.page.waitForSelector('[role="grid"], [role="table"]', { timeout: 30_000 });

    await this.page
      .locator('text="Loading..."')
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => {});

    logger.info(`✅ Loaded Ads view: ${adAccountId}`);
  }

  /**
   * Navigate back to the campaigns view.
   * Convenience alias for goToAdAccount() — used after goToAdsView() to return.
   */
  async goToCampaignsView(adAccountId: string): Promise<void> {
    return this.goToAdAccount(adAccountId);
  }


  // ═══════════════════════════════════════════
  // DATE RANGE
  // ═══════════════════════════════════════════

  /**
   * Set the date range in Meta Ads Manager.
   * Opens the date picker, navigates to the right months, clicks both days, then Updates.
   *
   * @param startDate - "YYYY-MM-DD"
   * @param endDate   - "YYYY-MM-DD"
   */
  async setDateRange(startDate: string, endDate: string): Promise<void> {
    logger.info(`Setting date range: ${startDate} → ${endDate}`);

    await this.openDatePicker();

    const start = this.parseDate(startDate);
    const end   = this.parseDate(endDate);

    await this.ensureMonthVisible(start.month, start.year);
    await this.clickDay(start.day, start.month, start.year);
    await this.page.waitForTimeout(500);

    if (end.month !== start.month || end.year !== start.year) {
      await this.ensureMonthVisible(end.month, end.year);
    }

    await this.clickDay(end.day, end.month, end.year);
    await this.page.waitForTimeout(500);
    await this.clickUpdateButton();
    await this.page.waitForTimeout(1_200);

    logger.info(`✅ Date range set: ${startDate} → ${endDate}`);
  }

  private async openDatePicker(): Promise<void> {
    const dateButton = this.page.locator('div[role="button"]')
      .filter({ hasText: /\b20\d{2}\b/ })
      .first();

    await dateButton.waitFor({ state: 'visible', timeout: 10_000 });
    await dateButton.click();
    await this.page.waitForTimeout(700);

    // Click "Custom" preset to enter calendar-selection mode.
    // Without this, clicking day cells on a non-custom preset (e.g. "Last 30 days")
    // only highlights them visually — it does NOT commit a new date range.
    // If Custom is already active (second setDateRange call), the option is not
    // visible as a separate item so isVisible returns false and this is skipped.
    const customOption = this.page.getByText('Custom', { exact: true }).first();
    if (await customOption.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await customOption.click();
      await this.page.waitForTimeout(300);
      logger.info('  Custom preset selected');
    }

    logger.info('  Date picker opened');
  }

  private async clickDay(day: number, month: number, year: number): Promise<void> {
    const label = this.buildAriaLabel(day, month, year);
    logger.info(`  Clicking: "${label}"`);

    const dayBtn = this.page.locator(`div[role="button"][aria-label="${label}"]`);
    await dayBtn.waitFor({ state: 'visible', timeout: 5_000 });

    const isDisabled = await dayBtn.getAttribute('aria-disabled');
    if (isDisabled === 'true') {
      throw new Error(`Day "${label}" is disabled and cannot be clicked`);
    }

    await dayBtn.click();
    logger.info(`  ✓ Clicked: "${label}"`);
  }

  private buildAriaLabel(day: number, month: number, year: number): string {
    const dateObj  = new Date(year, month - 1, day);
    const weekday  = WEEKDAYS[dateObj.getDay()];
    const monthName = MONTHS[month - 1];
    return `${weekday}, ${day} ${monthName} ${year}`;
  }

  private async ensureMonthVisible(targetMonth: number, targetYear: number): Promise<void> {
    const monthShort = MONTHS_SHORT[targetMonth - 1];

    const isVisible = await this.page
      .locator(`text="${monthShort}"`)
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (isVisible) {
      logger.info(`  Month ${monthShort} ${targetYear} already visible`);
      return;
    }

    // Try forward first (up to 12 months), then backward (up to 24 months)
    for (const [dir, max] of [['next', 12], ['previous', 24]] as const) {
      for (let i = 0; i < max; i++) {
        await this.page
          .locator(`[aria-label*="${dir}" i]`)
          .first()
          .click({ timeout: 5_000 });
        await this.page.waitForTimeout(250);

        const found = await this.page
          .locator(`text="${monthShort}"`)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (found) {
          logger.info(`  Navigated ${dir} to ${monthShort} ${targetYear}`);
          return;
        }
      }
    }

    throw new Error(`Could not navigate calendar to ${monthShort} ${targetYear}`);
  }

  private async clickUpdateButton(): Promise<void> {
    // Prefer the Update button scoped inside the date picker popover (dialog/tooltip).
    // Falls back to a page-wide exact match if the popover has no recognised role.
    // Anchored regex /^Update$/i ensures "Account Updates" can never match.
    const withinPopover = this.page
      .locator('[role="dialog"], [role="tooltip"]')
      .locator('[role="button"]')
      .filter({ hasText: /^Update$/i })
      .first();

    const pageWide = this.page
      .locator('[role="button"]')
      .filter({ hasText: /^Update$/i })
      .first();

    const updateBtn = (await withinPopover.isVisible({ timeout: 1_000 }).catch(() => false))
      ? withinPopover
      : pageWide;

    await updateBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await updateBtn.click();
    logger.info('  ✓ Clicked Update');
    await this.page.waitForTimeout(600);
  }

  /**
   * Dismiss the "Account Updates" notification bar that Meta sometimes renders.
   * Uses text-based detection — survives Meta deploy changes to DOM attributes.
   * Safe to call when the dialog is absent — returns silently.
   */
  private async dismissAccountUpdatesDialog(): Promise<void> {
    try {
      const dialog = this.page.getByText('Account Updates').first();
      const visible = await dialog.isVisible({ timeout: 1_500 }).catch(() => false);
      if (!visible) {
        logger.info('  No "Account Updates" dialog — continuing');
        return;
      }
      logger.info('  "Account Updates" dialog — dismissing');
      await dialog.click({ timeout: 2_000 }).catch(() => {});
      await this.page.waitForTimeout(300);
      logger.info('  ✓ Dismissed');
    } catch {
      logger.warn('  Could not dismiss "Account Updates" dialog — proceeding');
    }
  }

  private parseDate(dateStr: string): { year: number; month: number; day: number } {
    const [y, m, d] = dateStr.split('-').map(Number);
    return { year: y!, month: m!, day: d! };
  }


  // ═══════════════════════════════════════════
  // COLUMN CONFIGURATION
  // ═══════════════════════════════════════════

  /**
   * Guard: throw if Meta redirected us to a login / 2FA / block page.
   */
  private async assertNotRedirectedToAuth(): Promise<void> {
    const url     = this.page.url();
    const is2FA   = await this.page.locator('text="Confirm that it\'s you"').isVisible({ timeout: 500 }).catch(() => false);
    const isLogin = url.includes('login') || url.includes('checkpoint') || url.includes('security/block');
    if (is2FA || isLogin) {
      throw new Error(
        `Meta blocked or redirected to auth page (url: ${url}). ` +
        `Run: npm run meta:login`,
      );
    }
  }

  /**
   * Returns true if every required column header is already visible in the table.
   * The persistent Chrome profile preserves column config across runs — if all
   * headers are present we skip the entire configure flow.
   */
  private async allColumnsAlreadyConfigured(): Promise<boolean> {
    try {
      const headers = await this.page.locator('[role="columnheader"]').allTextContents();
      // Test each regex against individual header strings (not a joined blob) so
      // anchored patterns like /^results roas$/i work correctly.
      const allFound = REQUIRED_COLUMNS.every(col =>
        headers.some(h => col.match.test(h.trim())),
      );
      if (allFound) logger.info('  All required column headers already present in table');
      return allFound;
    } catch {
      return false;
    }
  }

  /**
   * Opens the "Customise columns" search modal via a reliable 3-click path:
   *
   *   1. Click the CORRECT Columns toolbar button (nearest left of Breakdown).
   *   2. Click the NEW "Customise columns…" dropdown item that appears.
   *      DOM-diff approach: snapshot all "customise" text positions BEFORE the
   *      click, then find the element that is NEW after — immune to stale panel
   *      links from prior sessions.
   *   3. If the dropdown opened a sidebar instead of the modal directly, click
   *      the [role="button"] "Customise columns" inside the sidebar.
   *
   * isModalOpen() uses [data-surface*="customize_columns_modal"] with state
   * "attached" — this attribute is set by Meta only on the real search modal,
   * not on the sidebar panel.
   */
  private async openCustomiseColumnsModal(): Promise<void> {
    await this.dismissAccountUpdatesDialog();
    // ── Find the correct Columns toolbar button (nearest left of Breakdown) ─
    const allColumnsBtns = this.page.locator('[role="button"]').filter({ hasText: /^Columns/i });
    await allColumnsBtns.first().waitFor({ state: 'visible', timeout: 15_000 });

    const columnsBtn = await (async () => {
      const breakdown = this.page.locator('[role="button"]').filter({ hasText: /^Breakdown/i }).first();
      const bdBox = await breakdown.boundingBox().catch(() => null);
      if (!bdBox) {
        logger.info('  Breakdown not found — using first Columns button');
        return allColumnsBtns.first();
      }
      const cnt = await allColumnsBtns.count();
      let bestIdx = 0, bestDist = Infinity;
      for (let i = 0; i < cnt; i++) {
        const box = await allColumnsBtns.nth(i).boundingBox().catch(() => null);
        if (!box) continue;
        const dist = bdBox.x - box.x;
        if (dist > 0 && dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      logger.info(`  Columns toolbar button[${bestIdx}] — ${bestDist.toFixed(0)}px left of Breakdown`);
      return allColumnsBtns.nth(bestIdx);
    })();

    // ── isModalOpen: [data-surface*="customize_columns_modal"] attached ──────
    // This data-surface attribute is present ONLY on the real search modal, not
    // on the sidebar. Using state:"attached" (not "visible") so it fires as soon
    // as React mounts the component — before it becomes fully visible.
    // 8 s timeout: the modal can render slowly on heavy-ad-account pages — a 4 s
    // timeout caused false negatives that led to the Escape-then-intercept loop
    // (failure_knowledge Entry #17).
    const isModalOpen = async (): Promise<boolean> =>
      this.page
        .locator('[data-surface*="customize_columns_modal"]')
        .first()
        .waitFor({ state: 'attached', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

    // Wait for the modal to fully unmount before the next attempt's columnsBtn click.
    // If the modal is open (or still detaching) when we click the Columns button,
    // the modal panel intercepts the pointer event and Playwright throws
    // "Target page, context or browser has been closed" (failure_knowledge Entry #17).
    const waitForModalDetached = async (): Promise<void> => {
      await this.page
        .locator('[data-surface*="customize_columns_modal"]')
        .first()
        .waitFor({ state: 'detached', timeout: 6_000 })
        .catch(() => {});  // best-effort — if it times out we still proceed
    };

    /** Collect {x,y} of every visible "customise" text node right now. */
    const snapshotCustomisePositions = (): Promise<Array<{ x: number; y: number }>> =>
      this.page.evaluate((): Array<{ x: number; y: number }> => {
        const result: Array<{ x: number; y: number }> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!/customis|customiz/i.test(node.textContent || '')) continue;
          const p = (node as Text).parentElement as HTMLElement | null;
          if (!p) continue;
          const r = p.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) result.push({ x: Math.round(r.x), y: Math.round(r.y) });
        }
        return result;
      });

    for (let attempt = 1; attempt <= 3; attempt++) {
      logger.info(`  openModal attempt ${attempt}/3`);

      // Guard: the modal may already be open from a previous attempt that had a
      // false-negative isModalOpen() result (timed out before React finished mounting).
      // If so, return immediately — clicking columnsBtn again would CLOSE the modal
      // (failure_knowledge Entry #17).
      if (attempt > 1 && await isModalOpen()) {
        logger.info('  Modal already open at attempt start — returning early');
        return;
      }

      await columnsBtn.waitFor({ state: 'visible', timeout: 10_000 });
      const before = await snapshotCustomisePositions();
      await columnsBtn.click();
      await this.page.waitForTimeout(400);

      // ── Step 2: click the NEW "Customise columns" dropdown item ─────────────
      // DOM-diff: snapshot positions BEFORE click, then find NEW elements AFTER.
      // RULES (failure-knowledge Entries #2, #3, #7):
      //   - Use elementHandle.click() — coordinate-based clicks (.last(), mouse.click)
      //     land on nav links underneath and navigate/close the page.
      //   - Return the first ancestor with role="link"/"menuitem"/A — this is the
      //     fresh dropdown item (new in DOM after click), not the stale sidebar heading.
      //   - Attempt 1 typically clicks the sidebar-opening link ("Customise columns...")
      //     Escape resets state so attempt 2 finds the modal-opener div ("Customise columns").
      const newElemHandle = await this.page.waitForFunction(
        (existing: Array<{ x: number; y: number }>) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!/customis|customiz/i.test(node.textContent || '')) continue;
            const p = (node as Text).parentElement as HTMLElement | null;
            if (!p) continue;
            const r = p.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const nx = Math.round(r.x), ny = Math.round(r.y);
              if (!existing.some((e) => e.x === nx && e.y === ny)) {
                let el: Element | null = p;
                for (let i = 0; i < 6 && el; i++) {
                  const role = (el as HTMLElement).getAttribute('role');
                  if (role === 'link' || role === 'menuitem' || el.tagName === 'A') return el;
                  el = el.parentElement;
                }
                return p;
              }
            }
          }
          return null;
        },
        before,
        { timeout: 5_000 },
      ).catch(() => null);

      const elemHandle = newElemHandle ? newElemHandle.asElement() : null;

      if (!elemHandle) {
        logger.info('  No new dropdown item appeared — retrying');
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
        continue;
      }

      const itemText = await elemHandle
        .evaluate((el: Element) => (el.textContent || '').trim().slice(0, 40))
        .catch(() => '?');
      logger.info(`  Clicking dropdown item: "${itemText}"`);

      const urlBeforeClick = this.page.url();
      await elemHandle.click({ timeout: 5_000 }).catch(() => {});
      await this.page.waitForTimeout(600);

      // Guard: if click navigated away, go back and retry
      if (!this.page.url().includes('adsmanager.facebook.com')) {
        logger.warn(`  Click navigated away (→ ${this.page.url().slice(0, 80)}) — going back`);
        await this.page.goto(urlBeforeClick, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
        await this.page.locator('text="Loading..."').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
        await this.page.waitForTimeout(600);
        continue;
      }

      // Modal opened directly from the dropdown item
      if (await isModalOpen()) {
        logger.info('  Modal opened (dropdown item — direct)');
        return;
      }

      // ── Step 3: sidebar OR slow modal — reset state cleanly for next attempt ──
      // DO NOT click the sidebar "Customise columns" [role="button"] here.
      // Clicking it corrupts DOM state: subsequent attempts find the sidebar button
      // as a "new" element and keep looping on it instead of finding the modal-opener.
      // Proven pattern (March 30 log): attempt 1 opens sidebar → Escape reset →
      // attempt 2 finds the modal-opener div ("Customise columns", no trailing dots)
      // and opens modal directly — WITHOUT any sidebar button interaction.
      //
      // Also handles the false-negative case: if isModalOpen() timed out but the modal
      // IS actually open, Escape here closes it cleanly.  waitForModalDetached() then
      // ensures the modal DOM fully unmounts BEFORE the next columnsBtn click, preventing
      // the "intercepts pointer events" → "Target page closed" error (failure_knowledge #17).
      logger.info('  Sidebar/slow-modal — resetting state for next attempt');
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
      await waitForModalDetached();
    }

    throw new Error('configureColumns: could not open Customise columns modal after 3 attempts');
  }

  /**
   * Open "Customise columns" and tick every required metric column.
   * Call this ONCE per run — columns persist when you change the date range.
   */
  async configureColumns(): Promise<void> {
    logger.info('Configuring columns...');
    await this.assertNotRedirectedToAuth();

    if (await this.allColumnsAlreadyConfigured()) {
      logger.info('✅ Columns already configured — skipping modal');
      return;
    }

    await this.openCustomiseColumnsModal();

    // Page-wide selector — necessary because Meta renders the modal input via a
    // React portal outside the [data-surface*="customize_columns_modal"] subtree.
    // input:focus is intentionally NOT used (failure_knowledge.md Entry #4).
    // [data-surface*="customize_columns_modal"] input is intentionally NOT used —
    // portal puts the search input outside that subtree.
    const getSearchInput = async () => {
      const byPlaceholder = this.page
        .locator('input[placeholder*="Search for metrics" i], input[placeholder*="column settings" i]')
        .first();
      if (await byPlaceholder.isVisible({ timeout: 2_000 }).catch(() => false)) return byPlaceholder;
      // Fallback: any input with a placeholder attribute — excludes bare inputs like campaign bar.
      return this.page.locator('input[placeholder]').last();
    };

    // Use Playwright click() — not JS document.querySelector().focus().
    // click() verifies the element is visible, scrolls to it if needed, and
    // fires a real pointer event that React's focus handler responds to.
    const focusSearchInput = async () => {
      const inp = await getSearchInput();
      await inp.click({ timeout: 3_000 }).catch(() => {});
    };

    await focusSearchInput();
    logger.info('  Customise columns modal open — search input ready');

    // ── Search for each required metric and tick its checkbox ──────────────
    for (const col of REQUIRED_COLUMNS) {
      await focusSearchInput();
      const searchInput = await getSearchInput();

      await searchInput.clear({ timeout: 5_000 }).catch(() => {});
      await searchInput.fill(col.search, { timeout: 5_000 }).catch(() => {});
      await this.page.waitForTimeout(400);

      // Page-wide — Meta portals the search result list outside the modalRoot subtree.
      // After fill(), search narrows to only matching columns, so page-wide li is safe.
      const rows     = this.page.locator('li, [role="listitem"]');
      const rowCount = await rows.count();
      let found      = false;

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        if (!await row.isVisible({ timeout: 200 }).catch(() => false)) continue;
        const firstLine = ((await row.innerText().catch(() => '')).split('\n')[0] ?? '').trim();
        if (!col.match.test(firstLine)) continue;

        if (col.subOption) {
          // Row has inline sub-option toggles (e.g. Total / Value / Cost).
          // Three cascading strategies to handle varying DOM structures.
          let subClicked = false;

          // Strategy 1: look within the matched row (relaxed match, longer timeout)
          const subEl = row.getByText(col.subOption, { exact: false }).first();
          if (await subEl.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const isSelected = await subEl.evaluate((el: Element) =>
              el.getAttribute('aria-pressed') === 'true' ||
              el.getAttribute('aria-checked') === 'true' ||
              el.getAttribute('aria-selected') === 'true',
            ).catch(() => false);
            if (!isSelected) {
              await subEl.click();
              await this.page.waitForTimeout(250);
              logger.info(`  ✓ Sub-option selected (strategy 1): "${col.subOption}" in "${firstLine}"`);
            } else {
              logger.info(`  Already selected (strategy 1): "${col.subOption}" in "${firstLine}"`);
            }
            subClicked = true;
          }

          // Strategy 2: sub-options may be sibling li elements following the parent row
          if (!subClicked) {
            for (let j = i + 1; j < Math.min(i + 5, rowCount); j++) {
              const sibling = rows.nth(j);
              if (!await sibling.isVisible({ timeout: 200 }).catch(() => false)) continue;
              const sibText = ((await sibling.innerText().catch(() => '')).split('\n')[0] ?? '').trim();
              if (sibText.toLowerCase() !== col.subOption.toLowerCase()) continue;
              const isSelected = await sibling.evaluate((el: Element) =>
                el.getAttribute('aria-pressed') === 'true' ||
                el.getAttribute('aria-checked') === 'true' ||
                el.getAttribute('aria-selected') === 'true',
              ).catch(() => false);
              if (!isSelected) {
                await sibling.click();
                await this.page.waitForTimeout(250);
                logger.info(`  ✓ Sub-option selected (strategy 2 sibling): "${col.subOption}"`);
              } else {
                logger.info(`  Already selected (strategy 2 sibling): "${col.subOption}"`);
              }
              subClicked = true;
              break;
            }
          }

          // Strategy 3: page-level search scoped to the modal
          if (!subClicked) {
            const modalSubEl = this.page
              .locator('[data-surface*="customize_columns_modal"]')
              .getByText(col.subOption, { exact: true })
              .first();
            if (await modalSubEl.isVisible({ timeout: 2_000 }).catch(() => false)) {
              const isSelected = await modalSubEl.evaluate((el: Element) =>
                el.getAttribute('aria-pressed') === 'true' ||
                el.getAttribute('aria-checked') === 'true' ||
                el.getAttribute('aria-selected') === 'true',
              ).catch(() => false);
              if (!isSelected) {
                await modalSubEl.click();
                await this.page.waitForTimeout(250);
                logger.info(`  ✓ Sub-option selected (strategy 3 modal): "${col.subOption}"`);
              } else {
                logger.info(`  Already selected (strategy 3 modal): "${col.subOption}"`);
              }
              subClicked = true;
            }
          }

          if (!subClicked) {
            logger.warn(`  ✗ Sub-option "${col.subOption}" not found via any strategy for "${firstLine}"`);
          }
        } else {
          const cb      = row.locator('input[type="checkbox"]').first();
          const checked = await cb.isChecked().catch(() => false);
          if (!checked) {
            await row.click();
            await this.page.waitForTimeout(250);
            logger.info(`  ✓ Checked: "${firstLine}"`);
          } else {
            logger.info(`  Already checked: "${firstLine}"`);
          }
        }
        found = true;
        break;
      }
      if (!found) logger.warn(`  ✗ Not found: "${col.search}"`);
    }

    // ── Apply ──────────────────────────────────────────────────────────────
    // Meta uses different button labels across accounts — try in order.
    const applyTexts = [/^apply$/i, /apply changes/i, /apply/i, /^save$/i, /^done$/i];
    let applyBtn = null;
    for (const pattern of applyTexts) {
      const candidate = this.page
        .locator('[role="button"], button')
        .filter({ hasText: pattern })
        .last();
      if (await candidate.isVisible({ timeout: 3_000 }).catch(() => false)) {
        applyBtn = candidate;
        logger.info(`  Apply button matched: ${pattern}`);
        break;
      }
    }
    if (!applyBtn) throw new Error('Customise columns: Apply/Save/Done button not found');
    await applyBtn.click();
    await this.page.waitForTimeout(1_200);

    logger.info('✅ Columns configured');
  }
}
