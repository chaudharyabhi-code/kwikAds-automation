# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

KwikAds is a GoKwik product that integrates with Meta (Facebook) Ads accounts to optimise campaigns for D2C brands. This framework validates the full KwikAds integration stack across four flows:

1. **Benchmark parity** — KwikAds dashboard metrics exactly match Meta Ads Manager
2. **Kwikpass install + storefront pixel** — Kwikpass is installed on each store and `sp/op1` / `e/op5` events fire on homepage + PDP
3. **Event-tracking toggle state** — The platform toggle is ON in the GK dashboard for each merchant
4. **Admin toggle write** — PATCH toggle flip lands and can be restored (write validation)

Every test run is non-destructive. The admin override spec always restores the original toggle state in a `finally` block.

---

## Commands

### One-time session setup (run in order before first test)
```bash
npm install                    # install dependencies
x         # install Playwright browsers

npm run meta:login             # Meta Ads Manager    → meta-profile/
npm run gokwik:login           # GK dashboard        → gokwik-profile/      (Google SSO auto-clicks)
npm run shopify:login          # Shopify Partner      → shopify-partner-profile/
npm run gkadmin:login          # GK Admin bootstrap   → gk-admin.state.json  (per-store Kwikpass check)
npm run storefront:login       # Storefront passwords → storefront-profile/   (run once per store handle)

# Or use the combined helper (skips sessions that are still valid):
npm run login:all
npm run login:force            # same but refreshes everything unconditionally
```

### Run tests
```bash
npm test                       # run all tests (list reporter)
npm run test:headed            # run with visible browser
npm run report                 # open HTML report after any run
```

### Run individual specs
```bash
# Benchmark: KwikAds API vs Meta Ads Manager
npx playwright test src/tests/meta-vs-dashboard.spec.ts --reporter=list

# Toggle state read-only check
npx playwright test src/tests/kwikads-toggle.spec.ts --reporter=list --headed

# Admin toggle flip + restore
npx playwright test src/tests/kwikads-admin-override.spec.ts --reporter=list --headed

# Storefront pixel firing check
npx playwright test src/tests/kwikads-storefront-events.spec.ts --reporter=list --headed

# 3-step combined validator (kwikpass + storefront + verdict)
npx playwright test --project=kwikads-validator --reporter=list --headed

# Verdict assembler unit tests (no browser)
npx playwright test src/tests/verdict-assembler.test.ts --reporter=list

# Toggle + admin override MUST share --workers=1 (both lock gokwik-profile/)
npx playwright test \
  src/tests/kwikads-toggle.spec.ts \
  src/tests/kwikads-admin-override.spec.ts \
  --workers=1 --reporter=list --headed
```

### Discovery utilities (not tests — manual tools)
```bash
npm run shopify:scrape-stores              # list dev stores → src/testdata/shopifyStores.json
npm run shopify:observe                    # interactive store picker, records network trace
npm run shopify:observe -- prnab-test     # specific store by handle
```

---

## Environment Setup

`.env` is gitignored. Create it at the project root:
```
API_BASE_URL=https://gkx.gokwik.co
KWIKADS_USERNAME=<your-email>
KWIKADS_PASSWORD=<your-password>
META_EMAIL=<meta-account-email>
META_PASSWORD=<meta-account-password>
GOKWIK_SSO_EMAIL=som.shekhar@gokwik.co
KWIK_AI_BASE_URL=https://api-gw-v4.dev.gokwik.in
KWIK_AI_DASHBOARD_URL=https://qa-mdashboard.dev.gokwik.in
```

---

## Key URLs

| Purpose | URL |
|---|---|
| KwikAds QA Dashboard | `https://qa-mdashboard.dev.gokwik.in/kwikads/benchmark` |
| KwikAds Platforms page | `https://qa-mdashboard.dev.gokwik.in/kwikads/platforms` |
| KwikAds Production | `https://dashboard.gokwik.co/kwikads/benchmark` |
| KwikAds API Base | `https://gkx.gokwik.co` |
| KwikAds QA API | `https://api-gw-v4.dev.gokwik.in` |
| Swagger (VPN required) | `https://qa-kwikads-be.dev.gokwik.io/swagger-docs#/` |
| Meta Ads Manager | `https://adsmanager.facebook.com` |

---

## API Reference

### Benchmark
**`POST /ka/api/v1/bm/op1`** — fetch period-over-period metrics for one or more merchants.
```json
{
  "periodOne": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
  "periodTwo": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" },
  "merchantIds": ["19g6im7uxama1"],
  "metrics": ["cpm", "ctr", "roas", "spend"],
  "categories": [],
  "tags": []
}
```
`periodOne` = "before", `periodTwo` = "after". Response: `data.data[] → adAccounts[] → metrics[key].before/after`.

### Platforms (toggle)
| Method | Endpoint | Purpose |
|---|---|---|
| GET (intercepted) | `/ka/api/v1/m/op2` | Read toggle state — intercepted by `KwikAdsPlatformsPage.readPlatformState()` |
| PATCH | `/ka/api/v1/m/op6/<id>` | Flip toggle — called via `togglePlatform()` with `gk-merchant-id` header |

PATCH body: `{ "isActive": true/false }`. Required header: `gk-merchant-id: <merchantId>`. Response: `{ data: { isActive: boolean } }`.

### Storefront events
| Endpoint | Fires on |
|---|---|
| `POST /qa/ka/api/v1/sp/op1` | Homepage load, PDP load — body: `{ merchant_id, label, … }` |
| `POST /qa/ka/api/v1/e/op5` | Homepage load, PDP load — body: `{ events: [{ event_name, … }] }` |

---

## Test Merchants

```typescript
// Full registry in src/testdata/merchants.ts
// Filter by tag to get the right subset for each spec.
```

| Name | merchantId | adAccountId | shopifyHandle | Tags |
|---|---|---|---|---|
| qa.gokwik (prnab-test) | `4bzi40ahksbqurl7` | `act_1035682277234487` | `prnab-test` | `@kwikads-toggle` |
| som-qa-store | `39028imn4dzg9a` | — | `som-qa-store` | `@kwikads-storefront` |
| astro-store-9980 | TBD (live from sp/op1) | — | `astro-store-9980` | `@kwikads-storefront` |
| Creare X Unrush | `19g6hlyr50n6j` | `act_1543438996237925` | — | `@meta-benchmark @critical` |
| Macrame Cords Pari | `19g6im7uxama1` | `act_1247455895764678` | — | `@meta-benchmark @regression` |
| Raho Saada | `19g6ila23ecj7` | `act_1136644150469466` | — | `@meta-benchmark @regression` |
| New Ads Test | `19fan7mwgshu` | `act_3781545225208934` | — | `@meta-benchmark @regression` |

**Exports per spec:**
- `META_BENCHMARK_MERCHANTS` → `meta-vs-dashboard.spec.ts`
- `KWIKADS_TOGGLE_MERCHANTS` → `kwikads-toggle.spec.ts`, `kwikads-admin-override.spec.ts`
- `KWIKADS_STOREFRONT_MERCHANTS` → `kwikads-storefront-events.spec.ts`

---

## 5 Persistent Auth Sessions

Each system is a separate product with its own login. All use persistent Chromium profiles (real device fingerprint — sessions last days to weeks).

| Profile directory | Login script | Used by | What it stores |
|---|---|---|---|
| `meta-profile/` | `npm run meta:login` | `meta-vs-dashboard.spec.ts` | Meta Ads Manager session |
| `gokwik-profile/` | `npm run gokwik:login` | toggle + admin specs, validator | GK dashboard IndexedDB + cookies |
| `shopify-partner-profile/` | `npm run shopify:login` | `gkadmin:login`, `shopify:observe` | Shopify Partner session |
| `storefront-profile/` | `npm run storefront:login -- <handle>` | storefront events spec, validator | Shopify storefront password cookies |
| `gk-admin.state.json` | written by `npm run gkadmin:login` | `kwikads-validator.spec.ts` (disk read) | Kwikpass install state per store |

**Critical:** `gokwik-profile/` stores GK dashboard auth in **IndexedDB/sessionStorage**, not cookies. `storageState({ path })` cannot capture it. A persistent profile is mandatory for any spec that drives the GK dashboard SPA. `gk-admin.state.json` only captures OAuth relay cookies — it is NOT a substitute for `gokwik-profile/`.

**SingletonLock:** Chrome writes `SingletonLock` to the profile dir. If a run exits abnormally, the next run fails with "profile in use". Both toggle specs clean this up in `beforeAll`:
```typescript
try { fs.unlinkSync(path.join(GokwikSessionStore.getProfileDir(), 'SingletonLock')); } catch {}
```

---

## Architecture

```
src/
├── api/
│   └── BaseApiClient.ts                # Axios — fetchBenchmarkData(), retry on 5xx
│
├── auth/
│   ├── GoogleSSOHelper.ts             # tryClickGoogleAccount(page, email) — 4 selector strategies
│   ├── SessionChecker.ts             # checkAllSessions() — disk-only validity check, no browser
│   ├── GokwikSessionStore.ts         # gokwik-profile/ + gokwik.state.json; getCookieHeaderFor()
│   ├── GkAdminAuthManager.ts         # bootstrapStores() — Ctrl+K → kwikpass search → popup → GK SSO
│   ├── GkAdminSessionStore.ts        # gk-admin.state.json path + hasState()
│   ├── StorefrontSessionStore.ts     # storefront-profile/ path + hasProfile()
│   ├── MetaAuthManager.ts            # getAuthenticatedContext() — persistent meta-profile/
│   ├── MetaSessionStore.ts           # meta-profile/ profile dir + clear()
│   ├── ShopifyPartnerAuthManager.ts  # getAuthenticatedContext() — shopify-partner-profile/
│   └── ShopifyPartnerSessionStore.ts # shopify-partner-profile/ + shopify-partner.state.json
│
├── config/
│   └── env.config.ts                 # All env vars — single typed object, read once
│
├── pages/
│   ├── KwikAdsPlatformsPage.ts       # readPlatformState(adAccountId) + togglePlatform(id, isActive, apiBase, merchantId)
│   ├── StorefrontPage.ts             # gotoHome(handle) + viewFirstProduct() — captures sp/op1 + e/op5
│   ├── errors.ts                     # StorefrontProtectedError (thrown when /password gate not bypassed)
│   ├── MetaAdsNavigator.ts           # goToAdAccount(), setDateRange(), configureColumns()
│   └── MetaDataScraper.ts            # scrapeTotalsRow() → MetaMetrics; scroll + virtualisation handling
│
├── scripts/
│   ├── meta-login.ts                 # interactive Meta login → meta-profile/
│   ├── gokwik-login.ts               # Google SSO → gokwik-profile/ + gokwik.state.json
│   ├── gokwik-keepalive.ts           # session refresh before JWT TTL expires
│   ├── shopify-partner-login.ts      # Shopify Partner login → shopify-partner-profile/
│   ├── gk-admin-login.ts             # per-store Kwikpass check → gk-admin.state.json
│   ├── storefront-login.ts           # storefront password cache → storefront-profile/
│   ├── login-all.ts                  # orchestrates all login scripts with SessionChecker
│   ├── scrape-shopify-stores.ts      # scrapes dev store list → src/testdata/shopifyStores.json
│   └── shopify-observe.ts            # interactive store observer for reverse-engineering
│
├── services/
│   ├── BenchmarkService.ts           # run(config) — orchestrates API fetch + dual-period Meta scrape + compare
│   └── DataComparator.ts             # compare(meta, api) → ComparisonReport; formula: ((meta-kwikads)/kwikads)×100
│
├── testdata/
│   ├── merchants.ts                  # ALL_MERCHANTS registry + filtered exports per spec
│   ├── shopifyStoreslist.ts          # loadShopifyStores() — reads shopifyStores.json at runtime
│   └── queries.ts                    # Kwik AI test query strings
│
├── tests/
│   ├── meta-vs-dashboard.spec.ts     # Spec 1: KwikAds API vs Meta Ads Manager benchmark parity (commented out)
│   ├── kwikads-toggle.spec.ts        # Spec 2: toggle state read — TOGGLE_ON/OFF/BLOCKED/META_NOT_ONBOARDED
│   ├── kwikads-admin-override.spec.ts # Spec 3: PATCH toggle flip + restore
│   ├── kwikads-storefront-events.spec.ts # Spec 4: sp/op1 + e/op5 firing on homepage + PDP
│   ├── kwikads-validator.spec.ts     # Spec 5: 3-step combined validator (disk + storefront + platform)
│   └── verdict-assembler.test.ts     # Unit tests — covers all 6 verdict states (no browser)
│
├── utils/
│   ├── concurrency.ts               # runWithConcurrency(items, worker, limit) — bounded parallel execution
│   ├── formatting.ts                # number formatters, date helpers
│   ├── logger.ts                    # Winston — console + reports/automation.log
│   ├── math.ts                      # diffPercent formula
│   ├── network-observer.ts          # observeNetwork(page, patterns) → { buckets, stop() }
│   └── network-types.ts             # Captured, ResponseLog, ObserverOptions types
│
└── validators/
    └── verdict-assembler.ts         # assembleVerdict(input) → 6-state pure function, no browser
```

---

## Key Design Patterns

**Orchestrator**: `BenchmarkService.run()` is the single entry point for the benchmark flow. All other classes are pure helpers. Browser cleanup is guaranteed via `try/finally`.

**Persistent Chromium profiles**: All 4 auth sessions use `chromium.launchPersistentContext(profileDir)` — real Chrome fingerprint on disk, sessions last days to weeks. No 2FA re-prompt on reuse. `meta.state.json` / cookie-only state are not used for SPA-backed dashboards.

**observeNetwork pattern**: `observeNetwork(page, patterns)` arms a response listener before any navigation fires, then returns live `buckets` and a `stop()` function. Eliminates the race condition of attaching a listener after the response has already fired.
```typescript
const { buckets, stop } = observeNetwork(page, { m_op2: [/\/ka\/api\/v1\/m\/op2/] });
await page.goto(url);
const captured = await stop();
```

**apiBase derivation**: `KwikAdsPlatformsPage` derives the API base URL live from the intercepted `m/op2` response URL — strips from `/m/op2` onward. No env var for QA vs prod switching needed.
```typescript
const apiBase = responseUrl.replace(/\/m\/op2.*$/, '');
```

**`page.evaluate` fetch**: `togglePlatform()` sends the PATCH request via `page.evaluate` so the browser's own session cookies are included automatically. No token management needed.

**Pure verdict assembler**: `assembleVerdict()` has zero Playwright imports — pure function, unit-testable without a browser. 8 unit tests in `verdict-assembler.test.ts`.

**runWithConcurrency**: `GkAdminAuthManager.bootstrapStores()` runs the first store serially (absorbs cold-start Google SSO) then runs remaining stores in parallel tabs bounded at concurrency 3.

**Shopify Dawn `full-unstyled-link` workaround**: Shopify Dawn's product card links are `position:absolute; inset:0` inside `overflow:hidden` parents. Playwright reports them as hidden. Fix: `link.getAttribute('href')` + `page.goto(productUrl)` — bypasses all visibility checks.

**Dual-period scrape**: `BenchmarkService.run()` scrapes Meta twice (one per period). `configureColumns()` runs once. Only `setDateRange()` changes between scrapes.

**Two-source comparison**: `DataComparator.compare()` computes `((meta - kwikads) / kwikads) * 100` per metric per period. Flags anything beyond the threshold (default 5%).

**Retry logic**: `BaseApiClient` retries on 5xx and network errors (up to 3 times, linear back-off). Never retries on 4xx.

---

## KwikAds Dashboard — Benchmark Module

Period-over-period comparison of Meta Ads metrics. Filters: Date Range 1 (Before), Date Range 2 (After), Merchant selector, Metrics chips (CPM, CTR, ROAS, Spend), Categories, Tags. Table shows: Merchant | Account | Metric BEFORE | AFTER | Δ%.

Categories: Others, Apparel & Footwear, Food & Beverage, Miscellaneous Goods, Home & Living, Beauty & Personal Care.

---

## Meta Ads Manager — Scraping Approach

- Must run **headful** — Meta blocks headless browsers (blank white page)
- `meta-profile/` persistent profile — Meta sees same device fingerprint on every run; no 2FA
- Metrics not visible by default — `configureColumns()` ticks: Amount spent, Results ROAS, CPM, CTR (all)
- Scraped from the **totals row**: `"Results from N campaigns"`
- CTR pattern is `'ctr \\(all\\)'` — NOT `'^ctr'` (which matches the wrong "CTR (link click-through rate)" column)

### Meta UI DOM facts (confirmed via live inspection)

| Element | Confirmed selector |
|---|---|
| Columns button | `[role="button"]` with text `"Columns: Performance"` |
| Date range button | `[role="button"]` with text `"Last 30 days: …"` |
| Calendar day cell | `div[role="button"][aria-label="Wednesday, 5 March 2026"]` |

### Critical: Two "Customise columns" elements

After clicking the Columns button, TWO elements match `/customiz|customis/i`:
1. `<u>` inside `[role="link"]` → opens **sidebar** (wrong — no search)
2. `<div>` "Customise columns" → opens **modal** (correct — has search)

Use DOM-diff approach (`waitForFunction` + `elementHandle.click()`) — do NOT use `.last().click()` (coordinate-based, lands on nav links). See `MetaAdsNavigator.ts`.

### Checkbox detection in Customize columns modal
Strategies tried in order: `[role="checkbox"]` by name → `[aria-checked]` near text → `label` → `input[type="checkbox"]` (safe — search narrows to 1 result) → row click fallback.

### Date picker — aria-label approach
Calendar cells: `div[role="button"][aria-label="${weekday}, ${day} ${monthName} ${year}"]`. Use `new Date(y, m-1, d)` for weekday — JS months are 0-indexed.

### MetaDataScraper scroll rules
- Use `page.mouse.wheel()` for horizontal scroll — NOT `scrollLeft =` inside `evaluate()` (only moves header, not data)
- Wait ≥ 500ms after each 600px right scroll (React virtualisation needs time to render)
- `isDashText()` checks only: `'—'`, `'–'`, `'--'`, `'-'` — empty string is NOT a dash

---

## Known Data Mismatch Bugs (data pipeline, not scraping errors)

| Merchant | Metric | KwikAds | Meta | Off by |
|---|---|---|---|---|
| Macrame Cords Pari | Spend | ₹14.7k | ₹16,393 | ~11% |
| Macrame Cords Pari | CPM | ₹119.02 | ₹131.45 | ~10% |
| Macrame Cords Pari | ROAS | ~5.3x | `—` (mixed objectives) | −100% |
| Raho Saada | CTR | lower | higher | ~19–20% (all-clicks vs link-clicks formula) |
| Raho Saada | ROAS | ~3.5–4.2x | `—` (mixed objectives) | −100% |

These are **real bugs in the KwikAds data pipeline**, not scraper bugs. Do not fix by adjusting thresholds.

---

## Coding Conventions

- All credentials via `envConfig` — never hardcoded
- `*.state.json` files and `*-profile/` directories are gitignored — never commit them
- Meta scraping always runs headful; `headless: false` is also required for GK dashboard SPA
- Use `getByRole`, `getByText`, `locator` with aria attributes — avoid CSS class selectors
- Mismatch threshold default is 5% — override per test via `BenchmarkRunConfig.mismatchThreshold`
- `--workers=1` is mandatory when running specs that share a persistent profile (`kwikads-toggle.spec.ts` + `kwikads-admin-override.spec.ts` both use `gokwik-profile/`)
- `page.waitForTimeout` is banned in new modules — use `waitForResponse`, `waitForSelector`, or `observeNetwork`. Exception: `MetaAdsNavigator.ts` and `MetaDataScraper.ts` (React virtualisation timing)
- The `SingletonLock` cleanup pattern (`fs.unlinkSync`) must appear in `beforeAll` of every spec that calls `launchPersistentContext`

---

## AUTOMATION TEAM FRAMEWORK

All new automation work in this repo follows the 4-agent model below. Every task — regardless of size — goes through all six phases in order.

### Agents

**@PM — Project Manager**
Owns scope, task decomposition, sequencing, and delivery tracking.
- First to respond on any new task
- Breaks work into numbered subtasks with clear ownership tags (@FE / @BE / @SDET)
- Defines what "done" means for the task
- Does NOT write code. Does NOT design assertions. Does NOT pick locators.
- Output format: numbered plan with owner tags, blockers called out explicitly

**@FE — Frontend Automation Engineer**
Owns all UI-layer automation.
- Page objects (`/pages`), locators, UI interactions, rendering validations
- Reusable UI methods, component-level helpers
- Test flow steps that touch the browser directly
- Does NOT own API validation logic. Does NOT write network interceptors.
- Output format: TypeScript class or method block, always with the correct file path header

**@BE — Backend / Integration Automation Engineer**
Owns all non-UI automation.
- Network interception (`/network`), API helpers (`/api`), response validators (`/validators`)
- Payload parsers, data extractors, mock factories (`/fixtures`, `/data`)
- Utility functions shared across tests (`/utils`, `/helpers`)
- Does NOT own page objects. Does NOT write locators.
- Output format: TypeScript function/module block, always with the correct file path header

**@SDET — Senior SDET / QA Architect**
Owns test quality, strategy, and framework governance.
- Test structure (`/tests`), spec design, assertion robustness
- Edge cases, negative scenarios, boundary conditions
- Regression tagging, test grouping (`@smoke`, `@regression`, `@critical`)
- Framework-level decisions: fixture design, test data strategy, config hygiene
- Reviews @FE and @BE output for maintainability before finalising
- Does NOT write first-pass implementation. Reviews and hardens only.
- Output format: annotated review block + hardened test spec

### Ownership Matrix

| Directory        | Owner  | What lives here                                      |
|------------------|--------|------------------------------------------------------|
| `/pages`         | @FE    | Page objects, component helpers, UI action methods   |
| `/tests`         | @SDET  | Spec files, test suites, test groups                 |
| `/utils`         | @BE    | Shared utility functions, formatters, parsers        |
| `/validators`    | @BE    | Response schema validators, assertion helpers        |
| `/fixtures`      | @SDET  | Playwright fixtures, test data factories             |
| `/network`       | @BE    | Route interceptors, request/response mocks           |
| `/api`           | @BE    | Direct API call wrappers, API client helpers         |
| `/data`          | @BE    | Static test data, JSON payloads, seed files          |
| `/helpers`       | @BE    | Domain-specific helper logic (not generic utils)     |
| `/constants`     | @SDET  | Enums, string constants, config keys                 |
| `/config`        | @SDET  | Playwright config, environment config, CI config     |

**Mapping to current project structure:**

| Framework path | Current path |
|---|---|
| `/pages` (UI layer) | `src/pages/` |
| `/tests` | `src/tests/` |
| `/api` | `src/api/BaseApiClient.ts` |
| `/validators` | `src/validators/verdict-assembler.ts`, `src/services/DataComparator.ts` |
| `/utils` | `src/utils/` |
| `/network` | `src/utils/network-observer.ts` (merged into utils) |
| `/config` | `src/config/env.config.ts`, `playwright.config.ts` |
| `/auth` | `src/auth/` (all auth managers + session stores consolidated) |
| `/services` | `src/services/BenchmarkService.ts` |

### Delivery Lifecycle

```
Phase 1 → SCOPE      @PM   understands the task, defines boundaries, creates plan
Phase 2 → SPLIT      @PM   assigns subtasks to @FE / @BE / @SDET with file targets
Phase 3 → BUILD      @FE + @BE implement their respective pieces independently
Phase 4 → TEST       @SDET writes or reviews the spec, hardens assertions, adds edge cases
Phase 5 → REVIEW     @SDET reviews @FE and @BE output, flags anything unmaintainable
Phase 6 → CLOSE      @PM confirms all subtasks done, calls out any open items
```

### Output Format

Every agent block must start with a role header:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@PM — Scope & Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@FE — /pages/ExamplePage.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@BE — /api/exampleClient.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@SDET — /tests/example.spec.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@PM — Close
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Invocation

**Full task (auto-orchestrated):**
```
New task: [feature or module name]
Repo path: [relative path]
Description: [what needs to be automated]
Context: [existing page objects, APIs, or test patterns]
```
→ @PM responds first, then all agents execute their phases in sequence.

**Direct agent call:** `"@FE build the page object for X"` — only that agent responds.

### Permanent Rules (never break)

1. TypeScript strict mode always. No `any` types unless unavoidable — document why.
2. All locators use `data-testid` or semantic roles first. CSS selectors are last resort.
3. No hardcoded waits (`page.waitForTimeout`) in new modules. Use `waitForResponse`, `waitForSelector`, or `observeNetwork`. **Exception**: `MetaAdsNavigator.ts` and `MetaDataScraper.ts` — React virtualisation timing (scoped to those files only).
4. Every test must be independently runnable — no shared mutable state between specs.
5. Page objects never contain assertions. Assertions live in test specs or `@SDET` validator helpers.
6. Network interceptors are always scoped to the test — set up in `beforeEach`, torn down in `afterEach`.
7. Every new file must have a single-line comment at the top: `// Owner: @FE | @BE | @SDET` and `// Scope: [feature name]`.
8. Every spec that calls `launchPersistentContext` must clean up `SingletonLock` in `beforeAll`.
9. Specs sharing the same persistent profile directory must run with `--workers=1`.

### Current Org Context

```
Framework:      Playwright + TypeScript
Product:        KwikAds (performance marketing platform — GoKwik)
Active modules: Benchmark parity, Toggle state, Storefront pixel, Admin override, Kwik AI Assistant
Test runner:    Playwright Test (@playwright/test v1.58.2)
CI:             GitHub Actions (.github/workflows/kwikads-benchmark.yml)
API base URL:   https://gkx.gokwik.co  (prod) / https://api-gw-v4.dev.gokwik.in  (QA)
Meta base URL:  https://adsmanager.facebook.com
Auth strategy:  5 persistent Chromium profiles — meta-profile/, gokwik-profile/,
                shopify-partner-profile/, storefront-profile/, gk-admin.state.json
                All managed by npm run login:all
```
