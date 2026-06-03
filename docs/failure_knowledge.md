# KwikAds Automation — Failure Knowledge Base

Compiled from all test runs and debugging sessions. Each entry documents a real failure,
its root cause, the symptom that identifies it, and the fix that was applied.
Reference this before touching `MetaAdsNavigator.ts` or `MetaDataScraper.ts`.

---

## 1. Wrong Columns Button Opens "Suggested Columns" Panel

**Symptom**
- `configureColumns` times out or opens the wrong panel
- Logs show "Suggested columns" panel instead of the search modal
- Apply button timeout

**Root cause**
Meta's toolbar has **two `[role="button"]` elements with "Columns" in the text**:
1. The first in DOM order → opens a "Suggested columns" side-panel (WRONG)
2. The one immediately left of the "Breakdown" button → opens the customise dropdown (CORRECT)

Using `locator('[role="button"]').filter({ hasText: /^Columns/i }).first()` always clicks the wrong one.

**Fix (MetaAdsNavigator.ts — `openCustomiseColumnsModal`)**
Find the Breakdown button's bounding box X, then loop through all "Columns" buttons and pick the one with the smallest positive distance to the left of Breakdown:
```typescript
const bdBox = await breakdown.boundingBox();
// pick allColumnsBtns.nth(i) where bdBox.x - box.x is smallest positive
```

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` — column button selection block.

---

## 2. Pre-Open Sidebar Toggles Closed Instead of Opening Modal

**Symptom**
- Logs: "Modal opened (sidebar)" but then Apply timeout — modal was never open
- 3 attempts all fail the same way

**Root cause**
The persistent Chrome profile can leave the "Change table columns and metrics" sidebar OPEN
from a prior session. The sidebar contains a `<div>` "Customise columns" heading. Clicking it
when the sidebar is already open **closes** the sidebar (toggle behaviour), not opens the modal.

**Fix (MetaAdsNavigator.ts — `openCustomiseColumnsModal`)**
DOM diff approach: snapshot all visible "customise" text node positions BEFORE clicking the
Columns button. After the click, use `waitForFunction` to find a text node that is NEW (not
in the snapshot). This new element is the fresh dropdown item, not the stale sidebar heading.

```typescript
const before = await snapshotCustomisePositions();
await columnsBtn.click();
// waitForFunction returns the NEW element that appeared
```

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` — DOM diff block.

---

## 3. `page.mouse.click(x, y)` on Dropdown Item Navigates Away

**Symptom**
- Logs: `"Click navigated away (→ https://www.facebook.com/...)"` — URL guard triggered
- Merchant 2 (Raho Saada) never opens the modal after 3 attempts
- Old error: `Error: locator.click: Target page, context or browser has been closed`

**Root cause**
`page.mouse.click(x, y)` clicks at absolute viewport coordinates. When a dropdown is open,
clicking the dropdown item can sometimes:
1. Cause the dropdown to dismiss (focus change)
2. Land the coordinate click on a **navigation link** underneath the dropdown

The nav link navigates the page to facebook.com, closing the Ads Manager context.

**Fix (MetaAdsNavigator.ts — `openCustomiseColumnsModal`)**
Return the actual DOM `Element` from `waitForFunction` (Playwright returns an `ElementHandle`
when the function returns a DOM element). Then use `elementHandle.click()` which:
- Targets the element directly (not coordinates)
- Scrolls it into view
- Waits for it to be actionable
- Clicks its center — immune to z-order / coordinate-landing issues

```typescript
const newElemHandle = await this.page.waitForFunction(
  (existing) => { /* ... return actualElement or null ... */ },
  before, { timeout: 5_000 }
).catch(() => null);
const elemHandle = newElemHandle?.asElement();
await elemHandle.click({ timeout: 5_000 });
```

URL guard still present as belt-and-suspenders. If click still navigates away:
`page.goto(urlBeforeClick)` + wait for loading overlay + `continue`.

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` — element handle click block.

---

## 4. Search Bar Focus Goes to Background Filter Bar, Not Modal Input

**Symptom**
- Metric names typed into the page-level campaign search/filter bar
- Wrong columns checked (or nothing found)
- Columns are not configured after Apply

**Root cause**
After opening the modal, `focusedInput.fill(...)` targets `input:focus`. If the modal's input
never received programmatic focus, `input:focus` resolves to the page-level filter bar instead.
The page-level filter bar searches campaigns, not column metrics.

**Fix (MetaAdsNavigator.ts — `configureColumns`)**
JS TreeWalker focus: walk DOM text nodes for "Drag and drop to arrange columns" (confirmed
present in modal), walk UP from that node's parent until an `<input>` is found, call `.focus()`.

```typescript
const focusModalInput = () => this.page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while ((node = walker.nextNode())) {
    if (/drag and drop to arrange columns/i.test(node.textContent)) {
      let el = node.parentElement;
      for (let i = 0; i < 15 && el; i++) {
        const input = el.querySelector('input');
        if (input) { input.focus(); break; }
        el = el.parentElement;
      }
    }
  }
});
```

`resolveSearchInput()` fallback: if `input:focus` not visible, scope to
`[data-surface*="customize_columns_modal"] input` or `input[placeholder].last()`.

**File**: `MetaAdsNavigator.ts` → `configureColumns()` — `focusModalInput` and `resolveSearchInput`.

---

## 5. ROAS Scraping Returns Impressions/Spend Value Instead of Ratio

**Symptom**
- `roas` value is 128,714 or 157,668 (same as impressions count) instead of ~2–5×
- `diags` shows `roas:found="128,714"→128714`
- `spend` may also return the same wrong value (both = impressions)

**Root cause — Part A: Wrong column header matched**
Old ROAS pattern `'purchase roas|results roas|roas'` could match "Purchase ROAS" column
(which displays total purchase value in INR, not a ratio) before "Results ROAS" (the ratio).
`allHeaders.find(...)` returns the first DOM match, which might be Purchase ROAS.

**Fix**: Changed ROAS METRIC_PATTERN to `'^results roas$'` (anchored exact match).
**File**: `MetaDataScraper.ts` → `METRIC_PATTERNS.roas`.

**Root cause — Part B: Scroll-container misalignment between header and data rows**
Meta's table has two independent scroll containers: one for headers and one for data rows.
After scrolling, they can end up with slightly different scroll offsets.
`hRect.right - 5` (right edge of column header) can land inside the NEXT column's data cell
if the data row container is scrolled slightly differently from the header container.
When this happens, `elementsFromPoint(hitX, totalsY)` returns the adjacent column's cell
(e.g. impressions = 128,714) instead of the intended cell.

**Fix**: Try **3 hitX candidates** per column: `right-5`, `60%-from-left`, `center`.
Also filter `elementsFromPoint` results by width: skip elements with
`elBox.width > hRect.width * 5 + 50` (these are multi-column containers).
**File**: `MetaDataScraper.ts` → `readMetrics()` → inner hitElements loop.

---

## 6. `input:focus.clear()` / `fill()` Hangs for 30s per Column (21-min test run)

**Symptom**
- Test takes 21+ minutes (vs expected 3–5 min)
- Each column in `configureColumns` waits 30s before timing out
- Logs: no "Checked:" entries — columns not found

**Root cause**
`focusedInput.clear()` and `focusedInput.fill()` with no explicit `timeout` option use
Playwright's default 30s timeout. If `input:focus` is not visible/actionable (no focused
input), each call burns 30s before throwing. With 7 columns × 30s = 3.5 minutes of hangs.

**Fix**: Pass `{ timeout: 5_000 }` explicitly on both `clear()` and `fill()`.
Also `.catch(() => {})` on `clear()` so a stale focus doesn't abort the whole loop.
**File**: `MetaAdsNavigator.ts` → `configureColumns()` — column loop `clear` / `fill` calls.

---

## 7. Two "Customise columns" Elements — Must Click `.last()`

**Symptom**
- `getByRole('link').first()` or `getByText(/customis/).first()` opens a sidebar with NO
  search input (old-style "Customise columns..." link inside a `<form>` in the left panel)
- Modal search doesn't appear
- Columns can't be configured

**Root cause**
After clicking the Columns button dropdown, TWO elements match `/customis|customiz/`:
1. `<u>` inside `[role="link"]` "Customise columns..." in a pre-existing panel form → opens
   a sidebar with NO search input (wrong)
2. The fresh dropdown item (new in DOM after click) → opens the sidebar / modal (correct)

Using `.first()` captures the stale element in the pre-existing panel.

**Fix**: DOM diff approach (see entry #2 above) which only finds elements NEW after the click.
Also: `await this.page.getByText(/customiz|customis/i).last()` as a last-resort fallback
because `.last()` tends to hit the freshest / most recently rendered element.

---

## 8. Meta Headless = Blank White Page

**Symptom**
- Page loads but DOM is completely empty — no table, no buttons, nothing
- All locators time out immediately

**Root cause**
Meta actively blocks headless Chromium. It detects automation and shows a blank page.

**Fix**: Always run Meta scraping with `headless: false` (headful browser).
Session is persisted via `meta-profile/` directory (`chromium.launchPersistentContext`).
**File**: `MetaAuthManager.ts` — `headless: false` in launch options. Never change this.

---

## 9. 2FA Triggered on Every Run (Old `meta.state.json` Approach)

**Symptom**
- Every test run prompts for 2FA / OTP
- Tests cannot run unattended

**Root cause**
Old approach saved cookies to `meta.state.json` and loaded them into a blank Chromium context.
Meta sees a blank browser fingerprint as a NEW DEVICE → triggers 2FA every 15–20 hours.

**Fix**: Use `chromium.launchPersistentContext('meta-profile/')` which maintains a full
Chrome profile on disk. Meta sees the same device fingerprint every run → sessions last
days to weeks. 2FA only triggered when Meta genuinely expires the session.

**Files**: `MetaSessionStore.ts` (now only `getProfileDir()`, `hasProfile()`, `clear()`).
`MetaAuthManager.ts` → `getAuthenticatedContext()` uses `launchPersistentContext`.

Session validity check: navigate to Ads Manager → if redirected to `/login` or `/checkpoint`,
session is dead → run `npm run meta:login` interactively.

---

## 10. Calendar "Month Not Found" — Day Click Fails

**Symptom**
- `Error: Could not navigate calendar to Mar 2026`
- Or `Error: Day "Wednesday, 5 March 2026" is disabled`

**Root cause**
`ensureMonthVisible` uses `text="${monthShort}"` which matches short month names (e.g. "Mar").
If the calendar initially shows a month 12+ months away, the forward loop exhausts its 12
iterations without reaching the target.

**Fix**: Forward loop tries 12 steps; backward loop tries 24 steps as fallback.
`buildAriaLabel` uses `new Date(year, month - 1, day)` (JS months are 0-indexed) to get the
correct weekday name for the aria-label `"Weekday, D Month YYYY"`.

**File**: `MetaAdsNavigator.ts` → `ensureMonthVisible()`, `buildAriaLabel()`.

---

## Quick Reference: What to Check When Things Break

| Symptom | Likely cause | File to check |
|---------|-------------|---------------|
| Apply button timeout | Modal not opened | `openCustomiseColumnsModal()` |
| Wrong metric values (too large, looks like impressions) | hitX misalignment or wrong header matched | `MetaDataScraper.ts` `readMetrics()` |
| ROAS = impressions count | ROAS pattern matched wrong column | `METRIC_PATTERNS.roas` |
| Search types in wrong bar | Modal input focus lost | `configureColumns()` `focusModalInput` |
| Page navigates to facebook.com mid-run | Coordinate click hit nav link | URL guard + `elemHandle.click()` |
| Blank page, nothing loads | Headless mode accidentally enabled | `MetaAuthManager.ts` `headless: false` |
| 2FA every run | Profile dir deleted / session expired | Run `npm run meta:login` |
| Test takes 20+ minutes | `clear()`/`fill()` missing `timeout` option | Column loop in `configureColumns()` |
| "Target page has been closed" | Coordinate click navigated away, retry hit closed page | URL guard in `openCustomiseColumnsModal()` |
| Columns show as "already configured" but wrong values scraped | Persistent profile has stale/different column set | Delete `meta-profile/`, re-run `meta:login`, reconfigure |
| `isModalOpen()` always false — attempts 1/3, 2/3, 3/3 with no "Modal opened" log | `isModalOpen()` uses `getByText()` which cannot match placeholder attributes | Revert to `[data-surface*="customize_columns_modal"]` with `state: 'attached'` |

---

## 11. `isModalOpen()` False Negative — `getByText()` Cannot Match Placeholder Attributes

**Symptom**
- Log shows "Clicking dropdown item: Customise columns" but immediately "openModal attempt 2/3"
- Three attempts all fail, throws "could not open modal after 3 attempts"
- The dropdown click IS happening (item text logged) but modal is never detected

**Root cause**
`getByText(/drag and drop to arrange columns/i)` was used as the `isModalOpen()` signal.
"Drag and drop to arrange columns" is the **placeholder attribute** of the modal's `<input>` element, not a visible text node. Playwright's `getByText()` walks the DOM looking for text nodes — it cannot see `placeholder=""` attributes. So `isModalOpen()` always returned false even when the modal was fully rendered.

**Fix**
Use `[data-surface*="customize_columns_modal"]` with `state: 'attached'`:
```typescript
const isModalOpen = async (): Promise<boolean> =>
  this.page
    .locator('[data-surface*="customize_columns_modal"]')
    .first()
    .waitFor({ state: 'attached', timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
```
Meta sets the `data-surface` attribute only on the real search modal, not on the sidebar. `state: 'attached'` fires as soon as React mounts the node — faster than `state: 'visible'`.

**Rule: never use `getByText()` to detect an element whose unique text is in a placeholder attribute.**

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` → `isModalOpen`.

---

## 12. Step 3 Sidebar Button Click Corrupts Attempt Loop State

**Date confirmed**: 2026-03-31

**Symptom**
- All 3 attempts log `"Sidebar opened — looking for inner modal trigger"` then throw
  `"configureColumns: could not open Customise columns modal after 3 attempts"`
- Each attempt finds the same sidebar button repeatedly — never finds the modal-opener div

**Root cause**
After `elemHandle.click()` opens the sidebar, the old Step 3 tried to click the sidebar's
`[role="button"]` "Customise columns" button to trigger the modal. Clicking it:
1. Did NOT open the modal (`isModalOpen()` returned false)
2. Left the sidebar in a **half-open / repositioned state**
3. On the next attempt, `snapshotCustomisePositions()` captured the sidebar button at its
   new position. After clicking Columns again, the DOM-diff found the **sidebar button**
   as "new" (position changed) and kept clicking it — looping on it all 3 attempts.

**Fix** (`MetaAdsNavigator.ts` — `openCustomiseColumnsModal()` Step 3)
Remove the sidebar button click entirely. Replace with clean double-Escape + longer waits:
```typescript
// DO NOT click the sidebar [role="button"] here — it corrupts DOM state
// Escape reset lets attempt 2 find the modal-opener div directly
logger.info('  Sidebar opened — resetting state for next attempt');
await this.page.keyboard.press('Escape');
await this.page.waitForTimeout(500);
await this.page.keyboard.press('Escape');
await this.page.waitForTimeout(300);
```

**Why attempt 2 works without Step 3**
Confirmed from automation.log (March 30–31, multiple runs):
- Attempt 1: DOM-diff finds "Customise columns..." `[role="link"]` → sidebar opens → Escape
- Attempt 2: Escape reset shifts DOM positions. DOM-diff now finds "Customise columns"
  (no trailing dots — the modal-opener div) as the new element → `elemHandle.click()` →
  `"Modal opened (dropdown item — direct)"`

**Confirmed working log pattern** (automation.log March 30 13:51, line 9075–9091):
```
openModal attempt 1/3
Clicking dropdown item: "Customise columns..."
openModal attempt 2/3
Clicking dropdown item: "Customise columns"
Modal opened (dropdown item — direct)
✅ Columns configured
```
Also confirmed direct 1-attempt open (March 30 13:50, line 9027–9043):
```
openModal attempt 1/3
Clicking dropdown item: "Customise columns"
Modal opened (dropdown item — direct)
✅ Columns configured
```

**Rule**: Never click the sidebar's internal "Customise columns" button between attempts.
The sidebar button does not reliably open the modal and poisons the DOM snapshot for the next attempt.

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` → Step 3 (lines ~440–461)

---

## 13. Coordinate-Based Clicks on Dropdown Items Navigate Away or Kill Page Context

**Date confirmed**: 2026-03-31

**Symptom A** — `page.getByText().last().click()`:
- Log: `"Click navigated away (→ https://www.facebook.com/ads/manager/...)"` → URL guard loops
- Test fails: `"could not open Customise columns modal after 3 attempts"`

**Symptom B** — DOM-diff returning a non-link element (`modalEl`) then `elemHandle.click()`:
- Error: `"page.waitForTimeout: Target page, context or browser has been closed"`
- Occurs immediately after the click — page context is destroyed

**Root cause A** (`page.getByText().last().click()`)
Playwright resolves the locator, gets bounding box, then calls `page.mouse.click(x, y)`.
When the dropdown is open, clicking by coordinates can land on a navigation link underneath
the dropdown element. Link navigates the page. URL guard catches it but can't recover cleanly.

**Root cause B** (DOM-diff returning `modalEl` — non-link element)
"Improving" selection to prefer non-link elements accidentally returns the sidebar's
`[role="button"]` "Customise columns" component. Before clicking Columns, this button has
zero bounding box (invisible). After clicking Columns, it becomes visible (new to diff).
`elemHandle.click()` on this button kills the browser context (possibly opens a dialog or
triggers React's error boundary that tears down the page).

**Rule**
- ALWAYS use `elementHandle.click()` returned from the DOM-diff `waitForFunction`
- NEVER use `page.getByText().last().click()` — coordinate-based, hits nav links
- NEVER change the DOM-diff to prefer non-link elements — the sidebar button masquerades
  as a "non-link" element and kills the page context when clicked

**File**: `MetaAdsNavigator.ts` → `openCustomiseColumnsModal()` — Step 2 click block

---

## Verified Working Run — 2026-03-31 (benchmark test meta-vs-dashboard)

**Test**: `src/data-validation/specs/meta-vs-dashboard.spec.ts`
**Merchant**: Creare X Unrush (`act_1543438996237925`)
**Periods**: 16 Mar – 22 Mar 2026 (before) / 23 Mar – 29 Mar 2026 (after)
**Duration**: 54.6s (headed browser, persistent Chrome profile)
**Result**: 1 passed — all 8 metric comparisons within 5% threshold

```
SPEND   Period1: 260953.60  Period2: 223941.19  | 0.00% / 0.00%  ✓
CPM     Period1: 809.83     Period2: 740.15     | 0.00% / -0.00% ✓
CTR     Period1: 3.95       Period2: 3.87       | 0.02% / 0.12%  ✓
ROAS    Period1: 2.51       Period2: 2.60       | -0.17% / -0.08% ✓
```

**Scraper also resolved** (not tested in benchmark, visible in Meta table):
```
IMPRESSIONS  322233 / 302561
CLICKS       11002  / 9991
CPC          23.72  / 22.41
```

**Code state at time of passing run**:
- `MetaAdsNavigator.ts` — `openCustomiseColumnsModal()`:
  - Step 2: original DOM-diff returning first link ancestor via `elementHandle.click()`
  - Step 3: sidebar button click REMOVED — only Escape × 2 + wait
- `AiResponseParser.ts` — `parseReply()`:
  - Added `region` to table header detection (fixes demographics query)
  - Added `getCell(c, 'region')` as adName fallback
  - Added `costpurchase` fallback alongside `costperpurchase`

---

## 14. "Account Updates" Dialog Intercepts Date Picker Update Button

**Symptom**
- Both period 1 and period 2 scrapes return **identical** values (~987K spend for Creare X Unrush)
- Log shows `✓ Clicked Update` but the table date range never changes
- `No "Account Updates" dialog detected — continuing` before each Update click (selector not matching)
- KwikAds API values are correct (user-verified against Meta manually)

**Root cause**
Meta renders an "Account Updates" notification overlay after certain page interactions. Two issues compounded:

1. `clickUpdateButton()` used `:has-text("Update")` — substring CSS match. "Account Updates" contains "Update" → dialog container clicked instead of date picker button.
2. `dismissAccountUpdatesDialog()` used `[data-surface*="ads_progress_dialog_modal"]` — attribute value changed in a Meta deploy, no longer matched, dialog never dismissed.

Result: dialog present → `clickUpdateButton()` hits dialog → date picker Update never pressed → both scrapes read default "Last 30 days" data (~987K).

**Secondary trap**
After fixing dismiss to `getByText('Account Updates')`, calling dismiss BEFORE `clickUpdateButton()` (while picker still open) caused the picker to close via its click-outside handler → Update button disappeared → 5 s TimeoutError.

**Rule: never call `dismissAccountUpdatesDialog()` while the date picker is open.**

**Fix applied (MetaAdsNavigator.ts)**

| Method | Change |
|---|---|
| `clickUpdateButton()` | `filter({ hasText: /^Update$/i })` — anchored regex; also scoped to `[role="dialog"],[role="tooltip"]` first, page-wide fallback |
| `dismissAccountUpdatesDialog()` | `getByText('Account Updates')` — text-based, survives Meta deploys |
| `setDateRange()` | Removed dismiss call entirely — exact-match Update is immune to the dialog |
| `openDatePicker()` | Added `getByText('Custom', { exact: true })` click after opening — required when Meta defaults to a named preset (e.g. "Last 30 days"); without it, day clicks don't register as a custom range |

**Verified Passing Run — 2026-04-05 10:47**

```
Test:     src/data-validation/specs/meta-vs-dashboard.spec.ts
Merchant: Creare X Unrush (act_1543438996237925)
Periods:  21 Mar – 27 Mar 2026 (before) / 28 Mar – 03 Apr 2026 (after)
Duration: 1.7 min (headed, persistent Chrome profile)
Result:   1 passed — all 8 metrics at 0.00% diff

SPEND   203333     / 170996.16  | 0.00% / 0.00%   ✓
CPM     755.36     / 697.80     | 0.00% / 0.00%   ✓
CTR     4.03       / 3.56       | 0.02% / -0.08%  ✓
ROAS    2.27       / 3.29       | -0.12% / -0.10% ✓
IMPRESSIONS  269186 / 245049
CLICKS       9480   / 7040
CPC          21.45  / 24.29
```

---

## 15. "Results from N campaigns" Count Extracted as Metric Value (SPEND / ROAS = 50)

**Date confirmed**: 2026-05-05

**Symptom**
- Period 2 scrape: `spend→50 @x=1238` and `roas→50 @x=1384` — both exactly equal the campaign count
- Period 1 correct; only Period 2 affected
- diags: `spend:found→50 @x=1238 | roas:found→50 @x=1384` at step0
- CPM and CTR at the same step are correct

**Root cause**
Meta renders the totals-row label as `"Results from <b>50</b> campaigns"`. The `<b>50</b>` leaf:
1. Passes the text filter `if (/Results from|campaigns?/i.test(text))` — the leaf text is just `"50"`
2. Passes the `if (!/\d/.test(text))` check — it contains a digit
3. Has `getBoundingClientRect()` reporting `width=0, height=0` during a React re-render that follows a date-range change
4. Because `nb.width === 0`, the old code `if (nb.width > 0 && nb.height > 0)` skipped the column-bounds check entirely — the leaf was accepted with no position validation
5. `stripToNumber("50")` returns 50, which matches `if (val !== 0)` — extracted as the metric value

This only affects Period 2 (not Period 1) because after `setDateRange(periodTwo)` the table re-renders. During the re-render, the SPEND and ROAS data cells momentarily have zero dimensions while React virtualises them. The `"50"` leaf from the sticky label column, having zero dimensions itself, is the first non-zero value found — so it wins.

**Two fixes applied to `MetaDataScraper.ts` — `extractValueFromElement()` (appears in both `readMetrics` and `readRowMetrics`)**

Fix A — zero-dimension guard:
```typescript
// Old — bounds check skipped when width/height are 0:
if (nb.width > 0 && nb.height > 0) {
  const cx = nb.left + nb.width / 2;
  if (cx < hLeft - tolerancePx || ...) continue;
}

// New — skip zero-dimension nodes outright:
if (nb.width === 0 || nb.height === 0) continue;
const cx = nb.left + nb.width / 2;
if (cx < hLeft - tolerancePx || ...) continue;
```

Fix B — ancestor label check:
```typescript
// Before the bounds check, walk up ≤8 ancestors.
// If any ancestor's textContent matches "Results from N", skip this leaf.
let anc: Element | null = (node as HTMLElement).parentElement;
let inResultsLabel = false;
for (let d = 0; d < 8 && anc !== null; d++) {
  if (/Results from \d+/i.test(anc.textContent || '')) { inResultsLabel = true; break; }
  anc = anc.parentElement;
}
if (inResultsLabel) continue;
```

Both fixes are required together for defence-in-depth. Fix A prevents zero-dimension bypass. Fix B catches the case where the node has dimensions but its center falls within a wide row container's bounds.

**Rule**: Never trust a numeric leaf without verifying it has rendered dimensions AND is not descended from the totals-row label element.

---

## 16. `getSearchInput()` Resolves to Global Campaign Search Bar (Re-occurrence of Entry #4)

**Date confirmed**: 2026-05-05

**Symptom**
- Columns not configured; "Not found:" entries in log for all metrics
- OR: metric values all match the same value (filtered campaigns — global bar searched)
- `configureColumns` logs "Customise columns modal open — search input ready" but columns still wrong

**Root cause**
The `getSearchInput()` fallback `this.page.locator('input[placeholder]').last()` resolves to Meta's global campaign search/filter bar when:
- The modal's placeholder text doesn't match `"Search for metrics"` or `"column settings"` (Meta changed copy)
- `.last()` DOM order happens to put the global bar after the modal input

**Fix applied (`MetaAdsNavigator.ts` — `configureColumns()` → `getSearchInput`)**

Replaced single-locator approach with 4-strategy cascade:

1. **Placeholder match** (fast path) — `input[placeholder*="Search for metrics" i]` etc.
2. **Spatial** — loop through `input[placeholder]` locators, find the one whose center point is inside `[data-surface*="customize_columns_modal"]` bounding box. The campaign bar is in the top toolbar (different Y), the modal search is in the right panel — always distinct positions.
3. **DOM TreeWalker** — walk text nodes for `"drag and drop to arrange"` (unique to modal body), walk up to nearest `<input>`, return its `placeholder` attribute as a stable selector target.
4. **Last resort** — `input[placeholder].last()` with `logger.error` — if this fires, it's visible in logs immediately.

**Rule**: Never use `input:focus` or `input[placeholder].last()` as the primary search input resolver. Spatial bounding box is the canonical reliable approach. Add new placeholder variants to Strategy 1 when Meta changes copy — Strategy 2 is always the safety net.

---

## 17. 8-Level Ancestor Check in `extractValueFromElement` Rejects ALL Metric Values

**Date confirmed**: 2026-05-05

**Symptom**
- `spend:miss @x=1238 raw=[₹222,734.81|Total Spent|—|​]` — the value IS visible in the raw dump but rejected
- `spend:found→99 @x=38` — a small number from far-left of the viewport picked up instead
- Period 1 correct, Period 2 wrong (or both wrong if the re-render race fires during Period 1 as well)
- Logs show `[step0]` having `spend:miss` with raw containing the correct value

**Root cause**
Walking 8 ancestor levels up from any leaf in the totals row eventually reaches the **totals row container** itself, whose `textContent` includes "Results from N campaigns" as part of the full row text. This caused `inResultsLabel = true` for every leaf in every metric cell → ALL values rejected. After rejection, the `spend:found→99 @x=38` line shows the scraper eventually picking up "99" or a similarly wrong small number from an offscreen-left element with positive bounds.

The zero-dimension guard that was added alongside (skip nodes with `width === 0 || height === 0`) was correct in intent but insufficient in isolation — it blocked the original "50" bleed-through but did not help when the ancestor check was overly broad.

**Fix applied (`MetaDataScraper.ts` — `extractValueFromElement`, both in `readMetrics` and `readRowMetrics`)**
Replaced the 8-level ancestor walk + zero-dim skip with a **parent-bounds fallback**:
```typescript
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
```

Why this correctly handles both cases:
- `<b>50</b>` inside "Results from N campaigns": leaf has zero dims → parent is the leftmost "Results" cell → parent cx ≈ 0 → rejected by column bounds for spend/roas ✓
- Valid metric leaf (e.g. `₹222,734.81`) that is momentarily zero-dim during React re-render: parent is the correct metric cell → parent cx is within column bounds → NOT rejected ✓

**Rule**: Never walk more than 1–2 ancestor levels to detect "Results" ancestry — the totals row container contains the entire row text, so any deeper walk will false-positive on real metric leaves. Use column-bounds position as the sole filter; fall back to parent bounds when the leaf's own bounds are zero.

