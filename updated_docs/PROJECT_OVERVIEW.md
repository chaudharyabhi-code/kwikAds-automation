# KwikAds Automation — Project Overview

---

## What is this project?

KwikAds is a GoKwik product that integrates with Meta (Facebook) Ads accounts to optimise campaigns for D2C brands. This Playwright + TypeScript framework validates the full KwikAds integration stack.

**Language:** TypeScript  
**Test Runner:** Playwright Test (`@playwright/test`)  
**Spec files:** `.spec.ts` (not `.spec.js`)

---

## Folder Structure — Full Map

```
kwikAds-automation/
├── src/
│   ├── api/                           # HTTP clients (Axios)
│   ├── auth/                          # All auth managers + session stores (consolidated)
│   ├── config/                        # Env config wrapper
│   ├── pages/                         # All page objects (UI layer)
│   ├── scripts/                       # One-time login/setup scripts (not tests)
│   ├── services/                      # Orchestrators + comparison logic
│   ├── testdata/                      # Merchants list, queries, store list
│   ├── tests/                         # ALL TEST SPEC FILES live here
│   ├── utils/                         # logger, formatting, math, concurrency, network
│   └── validators/                    # Pure verdict logic
│
├── meta-profile/                      # Saved Chrome profile — Meta Ads Manager
├── gokwik-profile/                    # Saved Chrome profile — GK Dashboard
├── shopify-partner-profile/           # Saved Chrome profile — Shopify Partner
├── storefront-profile/                # Saved Chrome profile — Shopify Storefront
├── playwright.config.ts
├── .env                               # Credentials (gitignored)
└── package.json
```

---

## Test Cases

There are **5 spec files** in `src/tests/`:

| Spec File | Status | What it tests |
|---|---|---|
| `kwikads-toggle.spec.ts` | ✅ Active | Toggle state is ON for each merchant (read-only) |
| `kwikads-admin-override.spec.ts` | ✅ Active | PATCH toggle flip + restore (write validation) |
| `kwikads-storefront-events.spec.ts` | ✅ Active | `sp/op1` + `e/op5` pixel events fire on homepage + PDP |
| `kwikads-validator.spec.ts` | ✅ Active | 3-step combined validator (kwikpass + storefront + toggle) |
| `meta-vs-dashboard.spec.ts` | ⚠️ Commented out | KwikAds API vs Meta Ads Manager benchmark parity |

Plus **1 unit test file** (no browser):

| File | What it tests |
|---|---|
| `src/tests/verdict-assembler.test.ts` | 8 unit tests for `assembleVerdict()` — all 6 verdict states |

> Test count per spec is dynamic — one test is generated per merchant in the merchant list (e.g. if 2 merchants → 2 tests per spec).

---

## What Each Folder Does

### `src/config/`
**Not a test.** Typed TypeScript wrapper around `.env`.  
Exports a single `envConfig` object used by the entire codebase.

```
.env  ──read by──▶  env.config.ts  ──imported by──▶  all modules
(raw secrets)       (typed wrapper)                   (never read .env directly)
```

Why needed: without it, every file would read `process.env.X` (type: `string | undefined` — unsafe). With it, every file gets `envConfig.apiBaseUrl` (type: `string` — safe, autocompleted).

---

### `src/api/`
**Not a test.** HTTP client layer.

| File | What it does |
|---|---|
| `BaseApiClient.ts` | Axios HTTP client — `fetchBenchmarkData()`, retries on 5xx, never retries 4xx |

---

### `src/auth/`
**Not tests.** All authentication managers and session stores — consolidated from 4 scattered folders.

| File | What it does |
|---|---|
| `GoogleSSOHelper.ts` | `tryClickGoogleAccount(page, email)` — 4 selector strategies for Google SSO auto-click |
| `SessionChecker.ts` | `checkAllSessions()` — disk-only validity check, no browser |
| `GokwikSessionStore.ts` | Manages `gokwik-profile/` persistent context + `gokwik.state.json` |
| `GkAdminAuthManager.ts` | `bootstrapStores()` — Ctrl+K → kwikpass search → popup → GK SSO |
| `GkAdminSessionStore.ts` | Manages `gk-admin.state.json` path + `hasState()` |
| `StorefrontSessionStore.ts` | Manages `storefront-profile/` path + `hasProfile()` |
| `MetaAuthManager.ts` | Launches persistent `meta-profile/` Chromium context |
| `MetaSessionStore.ts` | Manages `meta-profile/` profile dir + `clear()` |
| `ShopifyPartnerAuthManager.ts` | Launches persistent `shopify-partner-profile/` context |
| `ShopifyPartnerSessionStore.ts` | Manages `shopify-partner-profile/` + `shopify-partner.state.json` |

---

### `src/pages/`
**Not tests.** All UI-layer page objects.

| File | What it does |
|---|---|
| `KwikAdsPlatformsPage.ts` | `readPlatformState(adAccountId)` + `togglePlatform()` — toggle read/write |
| `StorefrontPage.ts` | `gotoHome(handle)` + `viewFirstProduct()` — captures `sp/op1` + `e/op5` |
| `errors.ts` | `StorefrontProtectedError` — thrown when `/password` gate is not bypassed |
| `MetaAdsNavigator.ts` | `goToAdAccount()`, `setDateRange()`, `configureColumns()` |
| `MetaDataScraper.ts` | `scrapeTotalsRow()` → `MetaMetrics`; scroll + React virtualisation handling |

---

### `src/services/`
**Not tests.** Orchestrators and comparison logic.

| File | What it does |
|---|---|
| `BenchmarkService.ts` | Single entry point for benchmark flow — API fetch + dual Meta scrape + compare |
| `DataComparator.ts` | `compare(meta, api)` → `ComparisonReport`; formula: `((meta-kwikads)/kwikads)×100` |

---

### `src/utils/`
**Not tests.** Generic helpers shared across the entire codebase.

| File | What it does |
|---|---|
| `logger.ts` | Winston — console + `reports/automation.log` |
| `formatting.ts` | Number formatters, date helpers |
| `math.ts` | `diffPercent` formula |
| `concurrency.ts` | `runWithConcurrency(items, worker, limit)` — bounded parallel execution |
| `network-observer.ts` | `observeNetwork(page, patterns)` → `{ buckets, stop() }` — race-condition-free response capture |
| `network-types.ts` | `Captured`, `ResponseLog`, `ObserverOptions` types |

---

### `src/validators/`
**Pure business logic.**  
`verdict-assembler.ts` — takes kwikpass state + storefront events + toggle state → returns one of 6 verdicts. Zero Playwright imports — pure function, testable without a browser.

---

### `src/tests/`
**These ARE the tests.** All Playwright spec files and unit tests live here.

---

### `src/scripts/`
**Not tests.** One-time setup tools — run manually before running tests to create auth sessions.

| Script | Command | What it does |
|---|---|---|
| `meta-login.ts` | `npm run meta:login` | Opens browser → you log into Meta → saves `meta-profile/` |
| `gokwik-login.ts` | `npm run gokwik:login` | Auto Google SSO → saves `gokwik-profile/` |
| `shopify-partner-login.ts` | `npm run shopify:login` | Saves Shopify Partner session |
| `gk-admin-login.ts` | `npm run gkadmin:login` | Checks Kwikpass install per store → saves `gk-admin.state.json` |
| `storefront-login.ts` | `npm run storefront:login` | Saves storefront password cookie |
| `login-all.ts` | `npm run login:all` | Runs all above in order, skips still-valid sessions |
| `gokwik-keepalive.ts` | manual | Refreshes GK dashboard session before it expires |
| `scrape-shopify-stores.ts` | `npm run shopify:scrape-stores` | Discovers dev stores → saves `shopifyStores.json` |
| `shopify-observe.ts` | `npm run shopify:observe` | Records network traffic for reverse engineering |

---

### `src/testdata/`
**Not tests.** Static data consumed by specs.

| File | What it contains |
|---|---|
| `merchants.ts` | Full merchant registry + filtered exports per spec (`META_BENCHMARK_MERCHANTS`, `KWIKADS_TOGGLE_MERCHANTS`, etc.) |
| `shopifyStoreslist.ts` | `loadShopifyStores()` — reads `shopifyStores.json` at runtime |
| `queries.ts` | Kwik AI test query strings |

---

## The 5 Chrome Profile Folders

Each is a **saved persistent Chrome browser session** on disk. Created once by a login script, reused by every test run. All live at the **project root** — not inside `src/`.

| Folder | Login script | Used by | Session lasts |
|---|---|---|---|
| `meta-profile/` | `npm run meta:login` | `meta-vs-dashboard.spec.ts` | 1–2 weeks |
| `gokwik-profile/` | `npm run gokwik:login` | toggle + admin + validator specs | days–weeks |
| `shopify-partner-profile/` | `npm run shopify:login` | `gkadmin:login` script | days–weeks |
| `storefront-profile/` | `npm run storefront:login` | storefront events + validator specs | days–weeks |
| `gk-admin.state.json` | `npm run gkadmin:login` | `kwikads-validator.spec.ts` (disk read) | varies |

> **Why persistent profiles?** Meta blocks headless browsers. GK dashboard stores auth in IndexedDB (not cookies) — `storageState()` cannot capture it. Persistent profiles solve both problems.

> **SingletonLock:** If a run crashes, Chrome leaves a `SingletonLock` file in the profile dir. Delete it manually or the next run will fail with "profile in use".

---

## `.env` vs `src/config/env.config.ts`

| | `.env` | `env.config.ts` |
|---|---|---|
| What | Raw secrets/values plain text | Typed TypeScript wrapper |
| Example | `API_BASE_URL=https://...` | `envConfig.apiBaseUrl` |
| Who reads it | `env.config.ts` only | All modules |
| Committed? | No (gitignored) | Yes |

---

## Where to Write a New Test

| Scenario | File location |
|---|---|
| New test spec | `src/tests/your-new-spec.spec.ts` |
| New GK dashboard UI interactions | `src/pages/` |
| New API client | `src/api/` |
| New auth manager or session store | `src/auth/` |
| New utility | `src/utils/` |
| New pure validator/assertion helper | `src/validators/` |
| New test data | `src/testdata/` |

**If your spec uses `gokwik-profile/`:**
- Clean up `SingletonLock` in `beforeAll`
- Run with `--workers=1` alongside any other spec that also uses `gokwik-profile/`
