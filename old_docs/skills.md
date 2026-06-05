# KwikAds Automation — Engineering Playbook

> **Purpose**: A living reference for every hard-won insight in this codebase.
> Read before touching `MetaDataScraper.ts`, `MetaAdsNavigator.ts`, or `BenchmarkService.ts`.
> Last audited: March 25, 2026 — all 7 metrics scraping correctly.

---

## Table of Contents

1. [Tech Stack (Currently in Use)](#1-tech-stack-currently-in-use)
2. [Plugins & Extensions Recommended](#2-plugins--extensions-recommended)
3. [Environment Setup](#3-environment-setup)
4. [Debugging Playbook](#4-debugging-playbook)
5. [Reusable Patterns](#5-reusable-patterns)
6. [What to Learn Next](#6-what-to-learn-next)
7. [Advancement Roadmap](#7-advancement-roadmap)

---

## Last Verified Working State (March 25, 2026)

### Creare X Unrush — `act_1543438996237925`

All 7 metrics confirmed clean PASS. Periods: 10–16 Mar and 17–23 Mar 2026.
All diffs within 5% threshold (worst case: ROAS 0.16%).

### Known data-pipeline mismatches (real bugs, not scraping errors)

| Merchant | Metric | Diff | Root cause |
|---|---|---|---|
| Macrame Cords Pari | SPEND | ~7–14% | KwikAds data pipeline under-reports spend |
| Macrame Cords Pari | CPM | ~6–12% | Derived from spend — same root cause |
| Macrame Cords Pari | ROAS | −100% | Meta shows `—` (mixed objectives); KwikAds computes ~5.3x |
| Raho Saada | CTR | ~19–20% | KwikAds CTR formula differs (all clicks vs link clicks) |
| Raho Saada | ROAS | −100% | Meta shows `—` (mixed objectives); KwikAds computes ~3.5–4.2x |

---

## 1. Tech Stack (Currently in Use)

### `@playwright/test` — v1.58.2

**What it is**: Test runner + browser automation engine. Used for both E2E browser tests and the scraping engine.

**Where used**:
- `src/core/meta-scraper/MetaAdsNavigator.ts` — navigation, date picker, column config
- `src/core/meta-scraper/MetaDataScraper.ts` — table scroll, `page.evaluate`, metric read
- `src/core/meta-scraper/MetaAuthManager.ts` — `chromium.launchPersistentContext`
- `src/data-validation/specs/meta-vs-dashboard.spec.ts` — live E2E test
- `src/data-validation/specs/mock-validation.spec.ts` — 6 pure-logic comparator tests
- `playwright.config.ts` — test runner config

**How used (specific patterns)**:
```typescript
// Persistent context (MetaAuthManager.ts:30) — not chromium.launch()
chromium.launchPersistentContext(MetaSessionStore.getProfileDir(), {
  headless: false,                // always headful — Meta blocks headless Chromium
  viewport: { width: 1920, height: 1080 },
  args: [...(isCI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
})

// Wheel scroll (MetaDataScraper.ts:378) — never scrollIntoView inside evaluate()
await this.page.mouse.wheel(600, 0);
await this.page.waitForTimeout(500);

// DOM-diff for modal open (MetaAdsNavigator.ts:324) — immune to stale panel links
const newElemHandle = await this.page.waitForFunction(
  (existing) => { /* find element not in snapshot */ },
  before, { timeout: 5_000 }
);
```

**Known issues in this codebase**:
- `playwright.config.ts:11` has `headless: true` but `MetaAuthManager.ts:34` hardcodes `headless: false`. The config value is **never used** for Meta scraping. Misleads new contributors.
- `retries: 0` in config means a single Meta UI flicker kills the entire CI run.
- `mock-validation.spec.ts` runs 6 pure-logic comparator tests through Playwright — adds ~3s startup overhead for tests that need zero browser.
- `workers: 1` is mandatory (shared persistent Chrome profile). Cannot parallelise.

**Recommended improvements**:
- Set `headless: false` in config (or add an inline comment explaining the override)
- Set `retries: 1` for the live E2E spec only
- Move `mock-validation.spec.ts` to Vitest for <200ms test execution and coverage reports

---

### `axios` — v1.13.6

**What it is**: HTTP client. Used exclusively for KwikAds API calls.

**Where used**: `src/core/api-client/BaseApiClient.ts`

**How used**:
```typescript
// Single AxiosInstance with request interceptor for auth (BaseApiClient.ts:62)
this.http = axios.create({
  baseURL: envConfig.apiBaseUrl,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});
this.http.interceptors.request.use((config) => {
  if (this.authToken) config.headers['Authorization'] = `Bearer ${this.authToken}`;
  return config;
});

// Manual linear backoff retry — retries on 5xx and network errors, never on 4xx
// Attempt 1 → 1s wait → Attempt 2 → 2s wait → Attempt 3 → throw
const delay = RETRY_DELAY_MS * attempt; // linear, not exponential
```

**Known issues in this codebase**:
- Linear backoff (`delay = 1000 * attempt` → 1s, 2s) is not exponential. For a prod API under load, exponential backoff with jitter is preferred.
- `MAX_RETRIES = 3` but the condition is `attempt < MAX_RETRIES`, so only 2 retries actually occur (attempts 1 and 2 trigger retry; attempt 3 throws). The variable name is slightly misleading.
- No interceptor-based retry — the retry logic is a manual recursive wrapper. `axios-retry` is simpler and handles edge cases like request deduplication.

**Recommended improvements**: Replace manual `withRetry` with `axios-retry` (exponential backoff + jitter).

---

### `winston` — v3.19.0

**What it is**: Structured logger. Writes to both console and file.

**Where used**: `src/core/utils/logger.ts`, imported by every class.

**How used**:
```typescript
// Console (colorized) + file transport
createLogger({
  transports: [
    new transports.Console({ format: combine(colorize(), timestamp(), printf(...)) }),
    new transports.File({ filename: 'reports/automation.log', format: combine(timestamp(), printf(...)) }),
  ],
})
```

**Known issues in this codebase**:
- `reports/automation.log` is written to `reports/` which is in `.gitignore`. The GitHub Actions CI workflow uploads `reports/html/**` as an artifact but NOT `reports/automation.log`. Debug logs are lost when a CI run fails.
- No log rotation. Long-running CI would accumulate a large `automation.log` file.

**Recommended improvements**: Change log path to `test-results/automation.log` (already uploaded by CI) or add `reports/automation.log` to the artifact upload path in `.github/workflows/kwikads-benchmark.yml`.

---

### `typescript` — v5.9.3

**What it is**: TypeScript compiler. This project uses the most aggressive strict config available.

**Where used**: All `.ts` source files. `tsconfig.json` settings:
- `"strict": true` — all strict flags enabled
- `"noUncheckedIndexedAccess": true` — array/Record access returns `T | undefined`
- `"exactOptionalPropertyTypes": true` — `{ x?: string }` cannot be set to `undefined` explicitly

**How used pattern**:
```typescript
// noUncheckedIndexedAccess forces this pattern throughout (e.g. MetaDataScraper.ts:309)
const el = hitElements[eIdx]!;  // non-null assertion justified by loop bounds

// exactOptionalPropertyTypes forces null-aware field access (BaseApiClient.ts:69)
apiAccount.metrics[apiKey]?.before ?? null
```

**Known issues in this codebase**:
- No ESLint. TypeScript strict mode is the only static quality gate. ESLint's `@typescript-eslint` catches runtime patterns (e.g. unbound `this`, unsafe `.evaluate()` return types) that the compiler does not.
- No `tsc --noEmit` in CI. A broken `.ts` file would only surface at runtime via `ts-node` error output.

**Recommended improvements**: Add `"typecheck": "tsc --noEmit"` to `package.json` scripts. Add as a CI step before running tests.

---

### `ts-node` — v10.9.2 (devDependency)

**What it is**: TypeScript execution engine for scripts.

**Where used**: `src/scripts/meta-login.ts` (one-time interactive login), invoked via `npm run meta:login`.

**How used**: `"meta:login": "ts-node src/scripts/meta-login.ts"` in `package.json`. Uses the `ts-node/esm` loader via `tsconfig.json`.

**Note**: `ts-node` is only needed for the one-off login script. The test runner (`playwright test`) handles TypeScript compilation for `src/**` via its own built-in TS support.

---

### `dotenv` — v17.3.1

**What it is**: Loads `.env` file into `process.env` at startup.

**Where used**: `src/config/env.config.ts` — single typed object that all other modules import.

**How used**:
```typescript
// env.config.ts — single source of truth, no direct process.env access elsewhere
import 'dotenv/config';
export const envConfig = {
  apiBaseUrl:    process.env.API_BASE_URL    ?? '',
  kwikadsUser:   process.env.KWIKADS_USERNAME ?? '',
  kwikadsPass:   process.env.KWIKADS_PASSWORD ?? '',
  metaEmail:     process.env.META_EMAIL       ?? '',
  metaPassword:  process.env.META_PASSWORD    ?? '',
  isCI:          process.env.CI === 'true',
};
```

---

### `chromium.launchPersistentContext` (Playwright built-in)

**What it is**: Launches Chromium with a real on-disk Chrome profile directory instead of an ephemeral browser instance.

**Where used**: `src/core/meta-scraper/MetaAuthManager.ts:30`

**Why this pattern exists**: Cookie injection (`storageState`) into a blank browser creates a new device fingerprint on every run. Meta interprets this as a login from a new device and requires 2FA. `launchPersistentContext` preserves the full browser profile — same fingerprint every run — so Meta treats it as the same device. Sessions last days to weeks instead of 15–20 hours.

**Profile location**: `meta-profile/` at project root (gitignored). Approximately 30–50 MB.

**To force a clean re-login**: `rm -rf meta-profile/` then `npm run meta:login`.

---

### GitHub Actions — `.github/workflows/kwikads-benchmark.yml`

**What it is**: CI/CD pipeline. Runs the benchmark daily and on push to main.

**Key details**:
- **Triggers**: `schedule` (cron `0 6 * * *` — 06:00 UTC daily) + `push` to main
- **Xvfb**: Required for `headless: false` (Meta scraping) on a Linux CI runner with no display
- **Cache**: `actions/cache` with key `meta-profile-${{ runner.os }}-v1` — persists the Chromium profile across runs so the session survives
- **Artifacts**: Uploads `reports/html/**`, `reports/*.png`, `test-results/**` on failure

**Known issues in this codebase**:
- Cache key `meta-profile-${{ runner.os }}-v1` is static. A corrupted or expired profile is silently restored from cache, causing cryptic failures. Add a `restore-keys` fallback and a way to bust the cache (increment `v1` → `v2` manually).
- No `tsc --noEmit` step before running tests. TypeScript errors surface only at runtime.
- `reports/automation.log` is not included in the artifact upload paths.

---

## 2. Plugins & Extensions Recommended

| Tool / Plugin | Category | Why This Project Needs It | Install Command | Priority |
|---|---|---|---|---|
| `eslint` + `@typescript-eslint` | Code Quality | No linting. TS strict mode misses runtime patterns: unbound `this` in `page.evaluate`, unsafe index access in loops. | `npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin` | P1 |
| `prettier` | Formatting | No enforced style. Spacing inconsistencies in `METRIC_PATTERNS`. Autofix prevents style drift over time. | `npm i -D prettier` | P1 |
| `husky` + `lint-staged` | Pre-commit | Nothing blocks broken TypeScript or unformatted code from reaching `main`. `tsc --noEmit` + ESLint on commit. | `npm i -D husky lint-staged && npx husky init` | P1 |
| `playwright-extra` + `puppeteer-extra-plugin-stealth` | Anti-detection | Meta actively fingerprints Playwright. Today's mitigation (`headless: false`) works. Stealth also patches navigator.webdriver, canvas, WebGL — buys runway when Meta tightens detection. | `npm i playwright-extra puppeteer-extra-plugin-stealth` | P1 |
| Playwright `retries: 1` | Resilience | `retries: 0` means a single Meta UI flicker kills the entire CI run. One retry for the live E2E spec halves flake-induced failures. | Edit `playwright.config.ts` only | P1 |
| `vitest` + `@vitest/ui` | Unit Testing | `mock-validation.spec.ts` runs 6 pure-logic tests through Playwright (adds ~3s overhead, no coverage). Vitest executes them in <200ms with full coverage reports and watch mode. | `npm i -D vitest @vitest/ui` | P2 |
| `allure-playwright` | Reporting | Playwright HTML report shows only the latest run. Allure adds historical trend charts — essential for answering "is the spend mismatch getting worse?" over weeks. | `npm i -D allure-playwright allure-commandline` | P2 |
| `msw` (Mock Service Worker) | API Mocking | `BaseApiClient` retry logic, auth failure paths, and malformed API responses have zero isolated tests. MSW intercepts Axios calls for controlled testing. | `npm i -D msw` | P2 |
| `@faker-js/faker` | Test Data | Merchant IDs and date ranges are hardcoded in test files. Faker generates valid random test data programmatically. | `npm i -D @faker-js/faker` | P2 |
| `@sentry/node` | Error Tracking | CI failures at 06:00 UTC go unnoticed until someone manually checks GitHub Actions. Sentry captures `logger.error()` output and pages via Slack. | `npm i @sentry/node` | P2 |
| `axios-retry` | Retry Logic | Replaces the manual `withRetry` recursive wrapper in `BaseApiClient.ts` with exponential backoff + jitter. Handles idempotency keys and deduplication. | `npm i axios-retry` | P3 |
| `@axe-core/playwright` | Accessibility | Zero accessibility coverage. Axe scans pages that Playwright opens — useful if the KwikAds dashboard is tested in future. | `npm i -D @axe-core/playwright` | P3 |

---

## 3. Environment Setup

### Prerequisites

```bash
node --version  # must be ≥ 20
npm  --version  # must be ≥ 10
git  --version  # any recent version
```

On Linux/CI: also need `xvfb` for headful Chromium without a physical display:
```bash
sudo apt-get install -y xvfb
```

### Step-by-step

**1. Clone the repo**
```bash
git clone <repo-url>
cd KwikAds_Automation
```

**2. Install Node dependencies**
```bash
npm install
```

**3. Install Playwright's Chromium browser**
```bash
npx playwright install --with-deps chromium
```
`--with-deps` also installs system libraries (libglib, libnss, etc.) needed for headful Chromium.

**4. Create `.env` at the project root**
```
API_BASE_URL=https://gkx.gokwik.co        # KwikAds API base — no trailing slash
KWIKADS_USERNAME=your-email@example.com    # KwikAds login
KWIKADS_PASSWORD=yourpassword              # KwikAds login
META_EMAIL=your-meta-account@example.com  # Facebook account used for Ads Manager
META_PASSWORD=yourmetapassword             # Facebook password
```

**5. One-time Meta login (human step — only required once)**
```bash
npm run meta:login
```
A Chromium window opens. The script fills your Meta credentials and waits up to 5 minutes. Complete 2FA in the browser. After 2FA, the session is saved to `meta-profile/` on disk. You won't be prompted for 2FA again until Meta genuinely expires the session (usually weeks).

**6. Run the tests**
```bash
npm test                  # all specs (headful, reuses saved session)
npm run test:headed       # explicit headed mode (same as default for Meta)
npm run test:mock         # only mock-validation.spec.ts (no browser, no API)
```

**7. Verify it worked**
A successful run prints a ComparisonReport to stdout:
```
PASS — Creare X Unrush: all metrics within 5% tolerance
```
Or for merchants with known bugs:
```
FAIL — Macrame Cords Pari: mismatch in [SPEND(before/after), CPM(before/after), ROAS(before/after)]
```
Both are expected outcomes — FAIL means the data-pipeline bug is being caught correctly.

**8. View the HTML report**
```bash
npm run report
```
Opens `reports/html/index.html` in your browser.

### CI environment notes

The GitHub Actions workflow handles Xvfb automatically:
```yaml
- run: Xvfb :99 -screen 0 1920x1080x24 &
- run: npm test
  env:
    DISPLAY: :99
    CI: true
```
The `meta-profile/` directory is cached between runs. If the cache is cold (first run or busted), you must seed the profile by running `npm run meta:login` locally first, committing the profile (NO — never commit it), or using a GitHub Actions secret to restore it.

### Session management

- `meta-profile/` = persistent Chrome profile (gitignored, ~30–50 MB)
- Never delete `meta-profile/` casually — you will need to re-run interactive login
- To force a fresh login: `rm -rf meta-profile/` then `npm run meta:login`
- Session validity check on every run: `MetaAuthManager` navigates to Ads Manager and inspects the resulting URL. If it redirects to `/login`, session is dead → interactive login.

---

## 4. Debugging Playbook

### Failure 1: Blank white page on Meta Ads Manager

**Symptom**: Browser opens, navigates to `adsmanager.facebook.com`, shows a white page or a "something went wrong" message. No campaigns table renders.

**Root cause**: Playwright is running headless (`headless: true`). Meta detects headless Chromium via navigator property fingerprinting and returns a blank page.

**Diagnosis**: Check `MetaAuthManager.ts:34`. The `headless: false` flag must always be set. If someone changed `playwright.config.ts:11` to `headless: true` AND it somehow overrode the persistent context launch options, this would manifest.

**Fix**: `MetaAuthManager.ts` always passes `headless: false` directly to `launchPersistentContext` — this is correct. The config's `headless: true` is irrelevant because it applies to `page.launch()` calls, not `launchPersistentContext`. No code change needed; add a comment to `playwright.config.ts:11` to prevent confusion.

---

### Failure 2: 2FA prompt appears on every test run

**Symptom**: `npm run meta:login` was run once, but every subsequent `npm test` still prompts for 2FA.

**Root cause**: `meta-profile/` directory is missing, empty, or being rebuilt from scratch. Cookies/session are not persisting.

**Diagnosis**: `ls -la meta-profile/` — directory should exist and contain Chrome profile files. If empty or missing, the persistent context starts fresh.

**Fix**: Run `npm run meta:login` on a machine where `meta-profile/` will be preserved. Ensure `.gitignore` lists `meta-profile/` (so it's not accidentally committed or deleted). If running on CI, ensure the Actions cache restores `meta-profile/` before the test step.

---

### Failure 3: Wrong CTR values (too low — 1–2% instead of 3–4%)

**Symptom**: CTR comparison shows Meta reporting ~1.5% while expected is ~3.7%. The diff is huge (50%+).

**Root cause**: `METRIC_PATTERNS.ctr` matched the wrong column. Meta shows two CTR columns: `CTR (link click-through rate)` (leftward, appears first) and `CTR (all)` (far right). An incorrect pattern like `'^ctr'` matches whichever appears first in the header scan — usually link CTR.

**Diagnosis**: Check `[step0]` log output. If `ctr:found→X @x=<small_number>` appears in the first scroll step (small x offset = leftward column), the scraper is picking up link CTR instead of CTR (all). CTR (all) is far right (~x = 1500–2000 after 4 scroll steps).

**Fix**: `MetaDataScraper.ts:20` must be:
```typescript
ctr: 'ctr \\(all\\)',
```
NOT `'^ctr'` or `'ctr'`. The escaped parentheses match the literal `CTR (all)` header text. The double backslash is required because this string is compiled into a `RegExp` inside `page.evaluate()`.

---

### Failure 4: All metrics return the same value (usually the spend value)

**Symptom**: `spend`, `cpm`, `ctr`, `roas` all log the same number (the spend amount). Obviously wrong.

**Root cause**: `scrollIntoView()` or `scrollLeft = X` was used inside `page.evaluate()`. This moves only the **header container**; the **data container** stays at its current scroll position. `elementsFromPoint(headerX, totalsY)` then hits the data column that happens to be at `scrollLeft = 0` — for all metrics, returning the same leftmost value.

**Diagnosis**: Search for `scrollIntoView` or `scrollLeft` in `MetaDataScraper.ts`. Should not appear anywhere inside `page.evaluate()`.

**Fix**: Only use `page.mouse.wheel(deltaX, 0)` from Playwright — Meta's React event handler intercepts wheel events and moves BOTH scroll containers simultaneously.

---

### Failure 5: Dash cells retried 15 times; adjacent column value bleeds in

**Symptom**: ROAS or Link Clicks shows a non-zero value that exactly matches the adjacent column (e.g. CTR value appearing for ROAS). The metric should be `0` (dash cell).

**Root cause**: The `resolved` Set is not marking dash cells as resolved. On subsequent scroll steps, the column shifts and `elementsFromPoint(headerX, totalsY)` hits the adjacent column — returning its value for the unresolved metric key.

**Diagnosis**: Check scraper log for `roas:dash→0` or `clicks:dash→0`. If these lines don't appear and `roas:miss` is logged 15 times, the dash detection is failing. Check `isDashText()` and `primaryTextAtPoint()`.

**Fix**: Ensure `resolved.add(k)` is called for `dashKeys` (line ~368 in `MetaDataScraper.ts`). Also ensure `primaryTextAtPoint` uses the `innerText` fallback for CSS pseudo-element dashes.

---

### Failure 6: Columns modal doesn't open (sidebar opens instead)

**Symptom**: `configureColumns()` opens a sidebar panel with column presets. The sidebar has no search input. The code tries to type in a search box and the test hangs or fails.

**Root cause**: The Columns dropdown has two "Customise columns" text nodes. Clicking the wrong one opens a sidebar, not the search-enabled modal.

**Diagnosis**: Check logger output for `"Sidebar open — clicking [role=button] Customise columns"`. If this appears and then the modal still doesn't open, the sidebar button is also failing.

**Fix**: `MetaAdsNavigator.ts` uses a DOM-diff approach (`snapshotCustomisePositions`) to find the NEW "Customise columns" element that appears after clicking the Columns button — and falls back to clicking the sidebar's `[role="button"]` if needed. The modal is detected by `[data-surface*="customize_columns_modal"]`. Do not revert to a simple `.last()` text selector — the DOM-diff approach is more robust against DOM changes.

---

### Failure 7: Calendar click fails (`day is disabled` or `Could not navigate calendar`)

**Symptom**: `MetaAdsNavigator.setDateRange()` throws `Day "Wednesday, 5 March 2026" is disabled` or `Could not navigate calendar to Mar 2026`.

**Root cause (case A — disabled day)**: The target date is in the future, or Meta has disabled it for this account. Not a code bug.

**Root cause (case B — can't navigate)**: `buildAriaLabel()` generates the wrong string. JavaScript `Date` months are 0-indexed: `new Date(2026, 2, 5)` = March 5 (month=2 for March). If the month offset is wrong, the `aria-label` won't match any calendar cell.

**Diagnosis (case B)**: Add a `logger.info(label)` call before `this.page.locator(...)` in `clickDay()`. Compare the logged string to what the Meta calendar actually shows in the DOM (inspect element on the day cell).

**Fix**: `buildAriaLabel()` at `MetaAdsNavigator.ts:144` uses `new Date(year, month - 1, day)` — the `month - 1` compensates for JS's 0-indexed months. This is correct. If the label still mismatches, check whether Meta changed the `aria-label` format (e.g. from `"5 March"` to `"March 5"`).

---

### Failure 8: CI fails silently with `meta-profile/` session expired

**Symptom**: GitHub Actions run fails with a login redirect error or a `2FA required` message. The cache restore log shows a cache hit.

**Root cause**: The `meta-profile/` cache key (`meta-profile-${{ runner.os }}-v1`) is static. An expired profile is silently restored from cache and the test fails.

**Diagnosis**: In the Actions log, check "Post Cache" — if the profile was restored from cache but the session is expired, `MetaAuthManager` will detect the `/login` redirect and attempt `runInteractiveLogin()`. On CI there is no human to complete 2FA — the run fails after the 5-minute timeout.

**Fix**:
1. Add `restore-keys: meta-profile-${{ runner.os }}-` to the cache action so an older but different-key profile is tried as a fallback.
2. When the CI session expires, run `npm run meta:login` locally, then update the cached profile (requires uploading the profile securely — use GitHub Actions secrets or a private artifact).
3. Increment the cache key suffix (`v1` → `v2`) to force a cache miss when you need a clean profile.

---

### Failure 9: `reports/automation.log` is missing in CI artifacts

**Symptom**: When a CI run fails, the downloaded artifact contains HTML reports and screenshots but no `automation.log`. Cannot see Winston log output to diagnose the failure.

**Root cause**: `logger.ts` writes to `reports/automation.log`. The CI workflow uploads `reports/html/**` and `reports/*.png` but not `reports/automation.log`.

**Fix**: In `.github/workflows/kwikads-benchmark.yml`, change the artifact upload path:
```yaml
- uses: actions/upload-artifact@v4
  with:
    path: |
      reports/html/**
      reports/*.png
      reports/automation.log    # ← add this line
      test-results/**
```

---

### Failure 10: TypeScript error only surfaces at runtime

**Symptom**: CI run starts, `ts-node` emits a TS error to stderr, and the test crashes before any browser opens.

**Root cause**: No `tsc --noEmit` step in CI. TypeScript errors are not caught before test execution.

**Fix**: Add to `package.json`:
```json
"scripts": {
  "typecheck": "tsc --noEmit"
}
```
And add to `.github/workflows/kwikads-benchmark.yml` before the test step:
```yaml
- run: npm run typecheck
```

---

### Failure 11: `headless: true` in `playwright.config.ts` confuses contributors

**Symptom**: A new engineer reads `playwright.config.ts:11` (`headless: true`), assumes the tests run headless, adds logic that breaks in headless mode, and Meta scraping fails.

**Root cause**: The config says `headless: true` but `MetaAuthManager.ts:34` overrides it with `headless: false` for the persistent context launch. The config value is effectively ignored for Meta scraping.

**Fix**: Add a comment or change the config:
```typescript
use: {
  headless: false,  // MetaAuthManager.ts overrides this to false — Meta blocks headless Chromium
```

---

### Useful debug commands

```bash
# Run with Playwright inspector (pause on first action)
PWDEBUG=1 npm test

# Run headed so you can watch the browser
npm run test:headed

# Run only the mock tests (no browser, fast)
npm run test:mock

# See what Playwright is doing step by step
npx playwright test --debug

# Check scraper logs after a run
cat reports/automation.log | grep -E "step|found|miss|dash"
```

---

## 5. Reusable Patterns

### Pattern 1: Persistent Chrome Profile (`MetaAuthManager.ts`)

**Problem**: Cookie injection into a blank browser triggers 2FA on every run. Meta fingerprints the browser as a new device.

**Solution**: `chromium.launchPersistentContext()` — a full Chrome profile on disk. Meta sees the same device fingerprint every run.

```typescript
// MetaAuthManager.ts:30
this.context = await chromium.launchPersistentContext(
  MetaSessionStore.getProfileDir(), // 'meta-profile/'
  { headless: false, viewport: { width: 1920, height: 1080 } }
);
```

**Session check**: Navigate to Ads Manager, inspect URL. If redirected to `/login` → session dead. Otherwise → already logged in.

**Key insight**: This is NOT the same as `storageState`. A persistent profile includes IndexedDB, cookies, local storage, service workers, and the browser's device ID — everything Meta uses for recognition.

---

### Pattern 2: Wheel Scroll for Table Navigation (`MetaDataScraper.ts`)

**Problem**: Meta's Ads Manager table has two independent scroll containers (header + data). `scrollIntoView()` or `scrollLeft = X` inside `page.evaluate()` moves only the header, desyncing the two containers. Every metric then reads the same value from whatever data column happens to be at scroll offset 0.

**Solution**: Always use `page.mouse.wheel()` from Playwright — Meta's React wheel event handler keeps both containers in sync.

```typescript
// MetaDataScraper.ts:378 — never inside page.evaluate()
await this.page.mouse.wheel(600, 0);   // scroll right 600px
await this.page.waitForTimeout(500);   // wait 500ms+ for React to re-render
```

**Reset pattern**: `resetTableScroll()` scrolls right briefly (triggers virtualisation), then scrolls left 12 × 700px (guarantees both containers reach `scrollLeft = 0`).

---

### Pattern 3: `resolved` Set — Preventing Dash Cell Bleed (`MetaDataScraper.ts`)

**Problem**: Meta shows `—` in the totals row for metrics it can't aggregate (ROAS, sometimes clicks). Without tracking, a dash cell would be retried 15 times. After enough right-scrolling, the header aligns with a different data column and the metric picks up that column's value.

**Solution**: Track every metric that has been definitively answered — either with a real value or a confirmed dash. Never retry resolved metrics.

```typescript
const resolved = new Set<string>();

// After finding a real value:
resolved.add(k);

// After confirming a dash:
resolved.add(k); // out[k] stays 0 — Meta has no aggregate for this metric

// Skip resolved keys at start of each scroll step:
const skip = Array.from(resolved);
```

---

### Pattern 4: DOM-Diff for Opening the Columns Modal (`MetaAdsNavigator.ts`)

**Problem**: After clicking the Columns toolbar button, a "Customise columns" link appears in a dropdown. But TWO elements match the text — one opens a sidebar, one opens the search-enabled modal. Position-based selection (`.first()`, `.last()`) breaks when Meta rearranges the DOM.

**Solution**: Snapshot all "customise" text element positions BEFORE the click. After the click, find the element that is NEW (not in the snapshot). Click that element directly via `elementHandle.click()` — targeting the DOM node directly avoids coordinate-based misses when the dropdown dismisses.

```typescript
// Snapshot before click (MetaAdsNavigator.ts:316)
const before = await snapshotCustomisePositions();
await columnsBtn.click();

// Wait for a new "customise" element to appear (MetaAdsNavigator.ts:324)
const newElemHandle = await this.page.waitForFunction(
  (existing) => { /* find element whose {x,y} is not in existing */ },
  before, { timeout: 5_000 }
);
```

**Modal detection**: `[data-surface*="customize_columns_modal"]` with `state: 'attached'` — this attribute is only present on the real search modal, not the sidebar.

---

### Pattern 5: `try/finally` Browser Cleanup (`BenchmarkService.ts`)

**Problem**: If the API call succeeds but scraping fails mid-way, the browser stays open and leaks resources. On CI this eventually causes OOM.

**Solution**: Always close the browser in `finally`, regardless of success or failure.

```typescript
// BenchmarkService.ts:80
try {
  const context = await auth.getAuthenticatedContext();
  // ... all scraping ...
  return report;
} finally {
  await auth.close(); // always runs — even if an error was thrown
}
```

---

### Pattern 6: Single Axios Instance with Interceptor (`BaseApiClient.ts`)

**Problem**: Auth tokens need to be attached to every request, but tokens may be updated after instance creation.

**Solution**: One `AxiosInstance` with a request interceptor. The interceptor reads `this.authToken` at call time — not at construction time — so token updates are always reflected.

```typescript
// BaseApiClient.ts:68
this.http.interceptors.request.use((config) => {
  if (this.authToken) config.headers['Authorization'] = `Bearer ${this.authToken}`;
  return config;
});
```

---

### Pattern 7: `buildAriaLabel()` for Calendar Day Cells (`MetaAdsNavigator.ts`)

**Problem**: Meta's calendar day cells use `aria-label="Wednesday, 5 March 2026"`. Building this string incorrectly (wrong weekday or month name) causes the locator to find nothing.

**Solution**: `new Date(year, month - 1, day)` builds the Date object (months are 0-indexed in JS). Use the `getDay()` result to look up the weekday string.

```typescript
// MetaAdsNavigator.ts:144
private buildAriaLabel(day: number, month: number, year: number): string {
  const dateObj  = new Date(year, month - 1, day); // month - 1 for JS 0-indexed months
  const weekday  = WEEKDAYS[dateObj.getDay()];
  const monthName = MONTHS[month - 1];
  return `${weekday}, ${day} ${monthName} ${year}`; // e.g. "Wednesday, 5 March 2026"
}
```

---

## 6. What to Learn Next

| Topic | Why It Matters for This Project | Best Resource | Time to Project-Ready |
|---|---|---|---|
| Playwright internals (CDP, browser contexts, isolation) | Explains WHY `page.mouse.wheel()` works when `scrollIntoView()` doesn't. Enables writing better selectors and understanding `page.evaluate()` serialisation constraints. | [playwright.dev/docs/api/class-page](https://playwright.dev/docs/api/class-page) + Playwright source on GitHub | 1 day |
| TypeScript strict mode — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | This project uses the most aggressive TS config. Understanding WHY these flags exist prevents the urge to add `// @ts-ignore` and explains the `??` and `!` patterns throughout the code. | [TypeScript Deep Dive — basarat.gitbook.io](https://basarat.gitbook.io/typescript) | 2 days |
| React virtualised tables (windowing) | Meta Ads Manager is a virtualised table — React only renders rows/columns currently in the viewport. Understanding this explains the 500ms wait after each wheel event and why `elementsFromPoint` misses off-screen columns. | [React Window docs](https://react-window.vercel.app/) | 1 day |
| OAuth 2.0 + Facebook session management | Meta session management is the #1 fragility point of this project. Understanding OAuth 2.0, refresh tokens, and how Facebook persists device trust helps design a more robust re-auth strategy. | [Auth0: OAuth 2.0 Simplified](https://auth0.com/intro-to-iam/what-is-oauth-2) | 4 hours |
| Axios interceptors + `axios-retry` | `BaseApiClient` uses a manual recursive retry wrapper. Replacing it with `axios-retry` is a P3 improvement but requires understanding how interceptors chain. | [`axios-retry` npm docs](https://www.npmjs.com/package/axios-retry) | 2 hours |

---

## 7. Advancement Roadmap

### ADVANCEMENT 1: AI-Assisted Test Generation

**What it is**: Use the Claude API (or a local LLM) to auto-generate `mock-validation.spec.ts` test cases from the `DataComparator.ts` type definitions and the known-bug table in this file.

**What it replaces**: 6 manually written edge cases that cover only 4 metrics. `impressions`, `clicks`, and `cpc` are scraped but never validated by a comparator test. Boundary cases (zero division, negative diff, null KwikAds value) are partially covered.

**Expected impact**: 3× comparator coverage in one afternoon. Catches regressions in the `calcDiffPercent` formula and `METRIC_MAP` extensions.

**Complexity**: Low — `DataComparator` is pure logic with no side effects. Input-output pairs are trivial to generate.

**Suggested implementation**:
1. Extract `DataComparator.ts` types and the known-bug table into a prompt
2. Send to Claude API: "Generate 20 TypeScript test cases for this comparator function, including: zero kwikadsValue, null kwikadsValue, both periods mismatch, only one period mismatch, dash (0) Meta value vs KwikAds value, all 7 metrics"
3. Pipe output to `src/data-validation/specs/comparator.spec.ts`
4. Run with `npm run test:mock`

---

### ADVANCEMENT 2: Self-Healing Selectors

**What it is**: A `SelectorRegistry` class that maps logical names to an ordered list of fallback selectors. `MetaAdsNavigator` calls `tryLocator(name)` — it loops through the list and returns the first one that resolves. On success, logs which fallback was used. If the primary selector stopped working, the log makes it immediately obvious.

**What it replaces**: The DOM-diff approach in `openCustomiseColumnsModal()` is already resilient, but hardcoded selectors like `[data-surface*="customize_columns_modal"]` and `div[role="button"][aria-label="${label}"]` will break when Meta changes their DOM. Currently each breakage requires a human debugging session.

**Expected impact**: Meta DOM changes → self-correcting run that logs which fallback worked. Debugging time drops from hours to minutes.

**Complexity**: Medium — new `SelectorRegistry` class + integration into `MetaAdsNavigator`.

**Suggested implementation**:
```json
// selectors.json
{
  "columnsModal": [
    "[data-surface*='customize_columns_modal']",
    "[aria-label*='Customize columns' i]",
    "[role='dialog']:has(input[placeholder*='Search' i])"
  ],
  "columnsBtn": [
    "[role='button']:has-text('Columns')",
    "[aria-label*='Columns' i]"
  ]
}
```
`SelectorRegistry.tryLocator(page, name)` loops through the array, calls `locator(sel).first().waitFor({ timeout: 2000 })`, returns on first success.

---

### ADVANCEMENT 3: LLM-Based Anomaly Detection on Scraped Data

**What it is**: After each benchmark run, serialize the `ComparisonReport` and the last 30 days of results to JSON. Send to Claude API with a system prompt: "Classify this mismatch — is it a new bug, a known pattern, or data noise? Estimate the root cause."

**What it replaces**: The current binary pass/fail threshold (5%). A merchant's spend mismatch could grow from 5% to 11% over 3 weeks and never trigger an alert until it crosses the threshold. An LLM can detect the trend from the history.

**Expected impact**: Catches slow-creeping data pipeline degradation before it becomes a merchant complaint. Auto-classifies by pattern (spend under-reporting vs CTR formula mismatch vs ROAS objective mixing) — reducing human triage time.

**Complexity**: Medium — requires a `reports/history.json` append-only log, an `AnomalyAnalyzer` class, and a Claude API call.

**Suggested implementation**:
```typescript
// AnomalyAnalyzer.ts
class AnomalyAnalyzer {
  async analyze(report: ComparisonReport, history: ComparisonReport[]): Promise<string> {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: buildPrompt(report, history) }],
    });
    return response.content[0].text; // classification + root cause
  }
}
```
Post the classification to a Slack webhook or GitHub issue.

---

### ADVANCEMENT 4: MCP Tool Server Wrapping the Scraper

**What it is**: Expose `BenchmarkService.run()` as a Model Context Protocol (MCP) tool so any Claude agent in the GoKwik infrastructure can call "check merchant X for dates Y–Z" as a tool call — without a human running `npm test`.

**What it replaces**: The scraper is only invokable via `npm test`. No programmatic on-demand access. A Slack bot asking "how is Macrame Cords Pari doing this week?" has no way to trigger the scraper.

**Expected impact**: Other agents (Slack bot, dashboard health monitor, on-call runbook) can invoke the scraper on demand. Converts the tool from a scheduled batch job into a queryable service.

**Complexity**: Medium-High — MCP server wrapper + handling the headful Chromium requirement in a server process context.

**Suggested implementation**:
```typescript
// src/mcp-server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
const server = new Server({ name: 'kwikads-scraper', version: '1.0.0' });

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { merchantId, adAccountId, periodOne, periodTwo } = req.params.arguments;
  const service = new BenchmarkService();
  const report  = await service.run({ merchantId, adAccountId, periodOne, periodTwo });
  return { content: [{ type: 'text', text: JSON.stringify(report) }] };
});
```

---

### ADVANCEMENT 5: Multi-Merchant Agent with GitHub Actions Sharding

**What it is**: A `merchants.config.json` registry with all active merchants and their priority scores (based on last mismatch severity × days since last run). GitHub Actions matrix dispatches 4 parallel shards — each shard handles a subset of merchants. A `merge-results.ts` script combines shard artifacts into one Allure report.

**What it replaces**: Sequential single-merchant runs. At 5 minutes per merchant, 8 merchants would take 40 minutes. 4 parallel shards reduce this to ~10 minutes.

**Expected impact**: Full fleet validation (all active merchants) in under 15 minutes on CI.

**Complexity**: High — sharding logic, pre-seeded Chrome profile per shard, results aggregation, and ensuring the persistent Chrome profile is available in each shard.

**Suggested implementation**:
```json
// merchants.config.json
[
  { "merchantId": "19g6im7uxama1", "adAccountId": "act_1247455895764678", "priority": 3 },
  { "merchantId": "19fan7mwgshu",  "adAccountId": "act_3781545225208934", "priority": 1 },
  { "merchantId": "19g6hlyr50n6j", "adAccountId": "act_1543438996237925", "priority": 2 }
]
```
GitHub Actions matrix:
```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```
Merge step: `npx allure generate --clean` after downloading all shard artifacts.

---

## Appendix: METRIC_PATTERNS (actual code — MetaDataScraper.ts:17)

```typescript
const METRIC_PATTERNS: Record<string, string> = {
  spend:       'amount spent|total spend',
  cpm:         'cpm|cost per 1,000',
  ctr:         'ctr \\(all\\)',        // matches "CTR (all)" — NOT "CTR (link click-through rate)"
  roas:        '^purchase roas',       // matches "Purchase ROAS" column
  impressions: '^impressions$',
  clicks:      '^link clicks$',
  cpc:         '^cpc',
};
```

These are plain strings (not `RegExp` objects). They must be serialisable — `RegExp` instances cannot cross the `page.evaluate()` context boundary. Inside `evaluate()`, they are compiled: `new RegExp(pat, 'i')`.

**Common mistake**: Writing `'^ctr'` matches both `CTR (all)` and `CTR (link click-through rate)`. The scraper will pick up whichever column header appears first in the DOM — usually link CTR (leftward), which is lower than CTR (all). Always use the fully qualified pattern with escaped parentheses.

## Appendix: REQUIRED_COLUMNS (actual code — MetaAdsNavigator.ts:26)

```typescript
const REQUIRED_COLUMNS = [
  { search: 'Amount spent',    match: /^amount spent$/i },
  { search: 'CTR (all)',       match: /^ctr \(all\)$/i },
  { search: 'Purchase ROAS',   match: /^purchase roas/i, subOption: 'Total' },
  { search: 'CPM',             match: /^cpm/i },
  { search: 'Impressions',     match: /^impressions$/i },
  { search: 'Link clicks',     match: /^link clicks$/i },
  { search: 'CPC (all)',       match: /^cpc/i },
];
```

`subOption: 'Total'` for Purchase ROAS means the code clicks the "Total" sub-option toggle inside the ROAS row (rather than "Value" or "Cost"). Three strategies are tried in `configureColumns()` to find and click this sub-option.

---

## 8. TestSprite — AI-Powered Test Generation

> **Status**: Configured via `.mcp.json`. Requires Claude Code restart to activate MCP connection.
> **API Key**: Set in `.mcp.json` → `env.API_KEY`
> **Node.js requirement**: ≥ 22

---

### What TestSprite Does

TestSprite is an AI testing agent that plugs into Claude Code via MCP. Given a description of what you want tested, it:
1. Analyses your codebase and types
2. Generates a complete test plan
3. Executes tests in an isolated cloud sandbox
4. Reports results and self-heals brittle assertions

It does **not** replace your existing Playwright specs — it generates additional tests and runs them in its own sandbox. Your `npm test` workflow is unchanged.

---

### How to Invoke (Claude Code MCP)

Once the MCP is connected (after restarting Claude Code), use natural-language prompts directly in the chat:

```
"TestSprite: test the AiResponseParser module"
"TestSprite: generate API tests for the /op4 SSE endpoint"
"TestSprite: test the DataComparator with edge cases — zero spend, null values, mixed objectives"
"TestSprite: test the benchmark end-to-end flow for merchant 19g6hlyr50n6j"
```

TestSprite reads the relevant source files and types automatically — you do not need to provide file paths.

---

### Module Suitability

| Module | Suitability | Why | Suggested prompt |
|---|---|---|---|
| `AiResponseParser.ts` | ⭐⭐⭐⭐⭐ **Best fit** | Pure function, no I/O, well-typed inputs/outputs | `"Test parseReply() with: empty table, missing columns, medal emoji ranks, escaped pipes in campaign names, multi-table responses"` |
| `DataComparator.ts` | ⭐⭐⭐⭐⭐ **Best fit** | Pure function, typed ComparisonReport, deterministic | `"Test compare() with: zero kwikadsValue (div by zero), null kwikadsValue, both periods mismatch, only after-period mismatch, dash (0) Meta ROAS, all 7 metrics"` |
| `KwikAiApiClient.ts` | ⭐⭐⭐⭐ **Good fit** | SSE stream parsing logic can be tested with mock streams | `"Test callKwikAiApi() SSE stream parsing — complete event, missing complete event, HTTP error, malformed JSON in stream"` |
| `GokwikSessionStore.ts` | ⭐⭐⭐⭐ **Good fit** | File I/O with clear state machine, easy to mock | `"Test GokwikSessionStore — expired cookie, session-only cookies (expires: -1), domain matching for subdomains, file older than 7 days"` |
| `BaseApiClient.ts` | ⭐⭐⭐ **Good fit** | Retry logic, interceptors — testable with mock axios | `"Test fetchBenchmarkData() retry logic — 5xx triggers retry, 4xx does not, 3 retries max, network error retried"` |
| `MetaDataScraper.ts` | ⭐⭐ **Limited** | Requires a live browser + Meta DOM — sandbox can't replicate | Use for unit-testing helper functions like `isDashText()`, not the full scrape |
| `MetaAdsNavigator.ts` | ⭐ **Not suited** | Deeply dependent on live Meta DOM structure | Manual testing only — this is a browser automation layer |
| `BenchmarkService.ts` | ⭐⭐ **Partial** | Orchestrator logic testable with mocked dependencies | `"Test BenchmarkService.run() — merchant not found in response, ad account not found, API 5xx"` |

---

### Best Practices for This Project

**1. Lead with types, not files**
TestSprite works best when you describe the input/output contract:
```
"Test parseReply() — input: markdown string, output: { period: string|null, ads: AdRow[] }
 Edge cases: empty table, no period line, medal emoji ranks, pipe characters in ad names"
```

**2. Always specify the merchant/account for live API tests**
```
"Test the /op4 endpoint for merchant 19g6hlyr50n6j (act_1543438996237925) — 
 verify the SSE stream returns a complete event with a non-empty reply field"
```

**3. Use TestSprite for comparator edge cases you haven't manually written**
The `DataComparator` has known gaps: `impressions`, `clicks`, `cpc` have no comparator tests. TestSprite can fill these quickly:
```
"Generate comparator tests for impressions, clicks, and cpc metrics.
 Include: both periods match, only period-one mismatches, kwikadsValue is null"
```

**4. Do not use TestSprite for Meta browser scraping tests**
Meta's Ads Manager DOM changes frequently and blocks headless browsers. TestSprite's cloud sandbox cannot replicate the persistent Chrome profile or the live Meta session. Scraping tests remain manual.

**5. Run TestSprite results alongside existing tests — don't replace**
TestSprite generates tests in its sandbox. Once you're happy with the generated test, copy it into `src/` as a proper spec file and add it to the test suite.

---

### Module-Specific Quick Prompts

Copy-paste these into Claude Code chat when the TestSprite MCP is connected:

```
# Parser edge cases
TestSprite: test AiResponseParser.parseReply() with these cases:
  - Table with only 1 row
  - Table with 10 rows (large response)
  - Ad name contains escaped pipe: "Kwikads \| Interest \| CBO"
  - Rank column uses medal emoji (🥇 🥈 🥉) instead of numbers
  - Missing Cost per Purchase column
  - Revenue column absent (some queries don't return it)
  - Period line is missing entirely

# Comparator edge cases
TestSprite: test DataComparator.compare() with these cases:
  - kwikadsValue is null (metric not in API response)
  - metaValue is 0 and kwikadsValue is 0 (both zero — diff should be null)
  - metaValue is 0 and kwikadsValue is non-zero (100% mismatch)
  - Only periodOne mismatches, periodTwo is within threshold
  - All 7 metrics: spend, cpm, ctr, roas, impressions, clicks, cpc

# API client SSE parsing
TestSprite: test KwikAiApiClient SSE stream parsing:
  - Stream ends without a complete event → should throw
  - complete event has empty reply field → result.reply is empty string
  - HTTP 401 response → should throw with status code in message
  - HTTP 500 response → should throw (not retry — that's BaseApiClient's job)
  - Malformed JSON in data: line → should skip and continue
```

---

### Connecting TestSprite (Checklist)

- [ ] `.mcp.json` has your API key in `env.API_KEY`
- [ ] Node.js ≥ 22 installed (`node --version`)
- [ ] `npx @testsprite/testsprite-mcp@latest` runs without error
- [ ] Claude Code restarted after `.mcp.json` was saved
- [ ] Verify: `! claude mcp list` shows `TestSprite ✓ Connected`

