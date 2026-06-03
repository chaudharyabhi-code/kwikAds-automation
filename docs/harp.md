# KwikAds Automation — Master Plan & Status

> **Last evaluated:** 2026-05-15  
> **Evaluator:** Claude Code  
> **Purpose:** Single-source snapshot of what is built, what is working, and what remains.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully built and verified working |
| 🟡 | Built but incomplete / partially covered |
| ❌ | Not yet built |
| 🐛 | Known bug (backend data pipeline — not a scraping error) |
| 🔒 | Blocked by external factor (backend fix, secret rotation, 2FA) |

---

## 1. Project Scope — The 4 Validation Flows

The original mandate covers exactly four end-to-end validation flows for the KwikAds product:

| # | Flow | Spec file | Status |
|---|------|-----------|--------|
| 1 | Benchmark parity — KwikAds API vs Meta Ads Manager | `meta-vs-dashboard.spec.ts` | ✅ Working |
| 2 | Kwikpass install + storefront pixel (`sp/op1`, `e/op5`) | `kwikads-storefront-events.spec.ts` + `kwikads-validator.spec.ts` | ✅ Working |
| 3 | Event-tracking toggle state (read-only) | `kwikads-toggle.spec.ts` | ✅ Working |
| 4 | Admin toggle write — flip + restore | `kwikads-admin-override.spec.ts` | ✅ Working |

**Bonus flow (not in original scope, added during build):**

| # | Flow | Spec file | Status |
|---|------|-----------|--------|
| 5 | Kwik AI Assistant — parser unit tests | `kwik-ai-api.spec.ts` | ✅ Working |
| 6 | Kwik AI Assistant — live SSE endpoint | `kwik-ai-live.spec.ts` | ✅ Working |

All 4 primary flows are implemented. The remaining work is **breadth expansion** (more merchants, more event actions) and **edge-case hardening** (TestSprite test generation).

---

## 2. Infrastructure & Foundation

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| TypeScript strict config | `tsconfig.json` | ✅ | Strict mode, no `any` policy |
| Playwright multi-project config | `playwright.config.ts` | ✅ | 5 projects: ci, default, meta, kwikads-validator, kwikads-validator-unit |
| Environment config | `src/config/env.config.ts` | ✅ | Single typed object — all credentials read once |
| Winston logger | `src/core/utils/logger.ts` | ✅ | Console + `reports/automation.log` |
| Concurrency util | `src/core/utils/concurrency.ts` | ✅ | `runWithConcurrency(items, worker, limit)` |
| Formatting utils | `src/core/utils/formatting.ts` | ✅ | `fmtRange`, `fmtValue`, `fmtCurrency`, `pad`, `trunc` |
| Math utils | `src/core/utils/math.ts` | ✅ | `diffPercent` formula |
| Network observer | `src/core/network/network-observer.ts` | ✅ | `observeNetwork(page, patterns)` — race-condition-free listener |
| Network types | `src/core/network/types.ts` | ✅ | `NetworkLog`, `ObserverOptions` |

---

## 3. Auth Sessions — 5 Persistent Chromium Profiles

All sessions are on-disk Chromium profiles (`launchPersistentContext`). Sessions last days to weeks without re-authentication.

| Session | Profile dir | Manager class | Login script | Status | Notes |
|---------|-------------|---------------|--------------|--------|-------|
| Meta Ads Manager | `meta-profile/` | `MetaAuthManager.ts` | `npm run meta:login` | ✅ | Persistent fingerprint — no 2FA re-prompt |
| GoKwik dashboard | `gokwik-profile/` | `GokwikAuthManager.ts` | `npm run gokwik:login` | ✅ | Google SSO auto-clicks account tile |
| Shopify Partner | `shopify-partner-profile/` | `ShopifyPartnerAuthManager.ts` | `npm run shopify:login` | ✅ | Used by gkadmin:login |
| Storefront (per store) | `storefront-profile/` | `StorefrontSessionStore.ts` | `npm run storefront:login -- <handle>` | ✅ | Cookie gate for password-protected stores |
| GK Admin state | `gk-admin.state.json` | `GkAdminSessionStore.ts` | `npm run gkadmin:login` | ✅ | OAuth relay cookies per store |

Supporting auth modules:

| Module | File | Status |
|--------|------|--------|
| Google SSO helper | `src/core/auth/GoogleSSOHelper.ts` | ✅ |
| Session validity checker | `src/core/auth/SessionChecker.ts` | ✅ |
| GoKwik keepalive (JWT refresh) | `src/scripts/gokwik-keepalive.ts` | ✅ |
| Combined login orchestrator | `src/scripts/login-all.ts` | ✅ |

---

## 4. Spec 1 — Benchmark Parity: KwikAds vs Meta Ads Manager

**File:** `src/data-validation/specs/meta-vs-dashboard.spec.ts`  
**Run:** `npx playwright test --project=meta --reporter=list`

### Core modules

| Module | File | Status | Notes |
|--------|------|--------|-------|
| Axios API client | `src/core/api-client/BaseApiClient.ts` | ✅ | `fetchBenchmarkData()`, retry on 5xx (3×), fail-fast on 4xx |
| Meta navigator | `src/core/meta-scraper/MetaAdsNavigator.ts` | ✅ | `goToAdAccount`, `configureColumns`, `setDateRange` — all 3 column-open failure patterns handled |
| Meta scraper | `src/core/meta-scraper/MetaDataScraper.ts` | ✅ | `scrapeTotalsRow()` — virtual scroll handled, dash cell detection, `ctr (all)` pattern |
| Data comparator | `src/core/data-engine/DataComparator.ts` | ✅ | `((meta-kwikads)/kwikads)×100`, threshold default 5% |
| Benchmark orchestrator | `src/core/services/BenchmarkService.ts` | ✅ | API fetch + `configureColumns` once + 2× `setDateRange` + compare |

### Merchant coverage

| Merchant | adAccountId | Tag | Status |
|----------|-------------|-----|--------|
| Creare X Unrush | `act_1543438996237925` | `@smoke @critical` | ✅ Verified clean PASS |
| Macrame Cords Pari | `act_1247455895764678` | `@regression` | 🐛 Spend ~11% off, CPM ~10% off, ROAS `—` |
| Raho Saada | `act_1136644150469466` | `@regression` | 🐛 CTR ~19% off (formula), ROAS `—` |
| New Ads Test | `act_3781545225208934` | `@regression` | 🟡 Listed but not smoke-verified yet |

### Known data pipeline bugs (not scraping errors)

| Merchant | Metric | Root cause | Fix owner |
|----------|--------|------------|-----------|
| Macrame Cords Pari | Spend, CPM | KwikAds under-reports attribution window | Backend team |
| Macrame Cords Pari | ROAS | Mixed-objectives account — Meta shows `—` | Backend team |
| Raho Saada | CTR | KwikAds uses all-clicks; Meta uses link-clicks | Backend team |
| Raho Saada | ROAS | Mixed-objectives account — Meta shows `—` | Backend team |

### What's left for Spec 1

- 🟡 **New Ads Test not smoke-verified** — add `@smoke` tag once a clean pass is confirmed
- 🔒 **Backend bugs** — Macrame and Raho Saada will keep failing until the data pipeline is fixed
- ❌ **Production env benchmark** — all current runs hit `gkx.gokwik.co` (prod API) but no systematic prod vs QA cross-check exists yet

---

## 5. Spec 2 — Kwik AI: Parser Unit Tests

**File:** `src/kwik-ai/specs/kwik-ai-api.spec.ts`  
**Run:** `npx playwright test src/kwik-ai/specs/kwik-ai-api.spec.ts --reporter=list`

### Status: ✅ Fully working

5 tests, zero network, zero browser. Uses a captured real reply from 2026-03-25.

| Test | Validates | Status |
|------|-----------|--------|
| `parses correct number of ads` | `parseReply()` returns 5 rows | ✅ |
| `extracts period string` | Period line extracted correctly | ✅ |
| `rank-1 ad: all metrics correct` | spend, revenue, ROAS, purchases, CTR, costPerPurchase | ✅ |
| `rank-4 ad: handles comma in large numbers` | ₹6,368.32 and ₹41,846.63 parsed correctly | ✅ |
| `all 5 ads have non-zero roas` | Guard against zero-ROAS regression | ✅ |

### What's left for Spec 2 (TestSprite edge cases — not yet built)

- ❌ Table with 1 row, 10 rows (boundary)
- ❌ Ad name with escaped pipe character
- ❌ Rank column uses medal emoji (🥇 🥈 🥉)
- ❌ Missing `Cost per Purchase` column
- ❌ Revenue column absent
- ❌ Period line missing
- ❌ Empty string input

---

## 6. Spec 3 — Kwik AI: Live SSE Endpoint

**File:** `src/kwik-ai/specs/kwik-ai-live.spec.ts`  
**Run:** `npx playwright test src/kwik-ai/specs/kwik-ai-live.spec.ts --reporter=list`

### Status: ✅ Fully working

2 live tests hit real `/op4` SSE endpoint. Auto-skips if env vars or session missing.

| Test | Query sent | Status |
|------|-----------|--------|
| `top-ads-yesterday` | `"Show top 10 ads by ROAS for yesterday"` | ✅ |
| `fetch-campaigns-past-7d` | `"Show campaign performance for last 7 days"` | ✅ |

### What's left for Spec 3 (TestSprite edge cases — not yet built)

- ❌ Stream ends without `complete` event → must throw
- ❌ `complete` event has empty reply
- ❌ HTTP 401 → throws with status code
- ❌ HTTP 500 → throws (no retry)
- ❌ Malformed JSON in `data:` line → skip and continue
- ❌ Response body is `null` → throw

---

## 7. Spec 4 — Event-Tracking Toggle State (read-only)

**File:** `src/data-validation/specs/kwikads-toggle.spec.ts`  
**Run:** `npx playwright test src/data-validation/specs/kwikads-toggle.spec.ts --headed --reporter=list`

### Status: ✅ Fully working

4-state detection via `m/op2` intercept: `BLOCKED`, `META_NOT_ONBOARDED`, `TOGGLE_ON`, `TOGGLE_OFF`.

### Merchant coverage

| Merchant | merchantId | adAccountId | Tag | Status |
|----------|------------|-------------|-----|--------|
| qa.gokwik (prnab-test) | `4bzi40ahksbqurl7` | `act_1035682277234487` | `@kwikads-toggle @smoke` | ✅ Verified |

### What's left for Spec 4

- 🟡 **Only 1 toggle merchant** — production coverage needs more `@kwikads-toggle` merchants added to `merchants.ts`
- ❌ **TOGGLE_OFF auto-enable (Phase 4)** — the spec currently FAILS loudly when toggle is OFF; the planned "auto-enable" path is not implemented

---

## 8. Spec 5 — Admin Toggle Override (write + restore)

**File:** `src/data-validation/specs/kwikads-admin-override.spec.ts`  
**Run:** `npx playwright test src/data-validation/specs/kwikads-admin-override.spec.ts --headed --reporter=list`

### Status: ✅ Fully working

Full read → flip → re-read → restore cycle. `finally` block guarantees toggle is never left in a wrong state.

### What's left for Spec 5

- 🟡 Same merchant coverage gap as Spec 4 — inherits `KWIKADS_TOGGLE_MERCHANTS`

---

## 9. Spec 6 — Storefront Pixel Event Firing

**File:** `src/data-validation/specs/kwikads-storefront-events.spec.ts`  
**Run:** `npx playwright test src/data-validation/specs/kwikads-storefront-events.spec.ts --headed --reporter=list`

### Core modules

| Module | File | Status | Notes |
|--------|------|--------|-------|
| Storefront page | `src/core/storefront/StorefrontPage.ts` | ✅ | `gotoHome` + `viewFirstProduct` + `captureAction` |
| Storefront session store | `src/core/storefront/StorefrontSessionStore.ts` | ✅ | Profile dir + `hasProfile()` |
| Storefront errors | `src/core/storefront/errors.ts` | ✅ | `StorefrontProtectedError` — clean skip on password gate |

### Merchant coverage

| Store | merchantId | Events confirmed | Status |
|-------|------------|-----------------|--------|
| som-qa-store | `39028imn4dzg9a` | `page_viewed`, `PageView`, `product_viewed`, `ViewContent` | ✅ Verified |
| astro-store-9980 | `` (TBD from live sp/op1) | Not yet run | 🟡 merchantId not pinned |

### Calibrated event endpoints (from `src/discovery/storefront-events-trace.md`)

| User action | URL pattern | `sp/op1` label | `e/op5` event_name | Calibrated |
|-------------|-------------|----------------|-------------------|------------|
| Homepage view | `/` | `page_viewed` | `PageView` | ✅ |
| PDP view | `/products/<handle>` | `product_viewed` | `ViewContent` | ✅ |
| Add to cart | `/cart/add` (AJAX) | `add_to_cart` (TBD) | `AddToCart` (TBD) | ❌ Not observed yet |

### What's left for Spec 6

- ❌ **Add-to-cart event** — not yet observed via `shopify:observe`. Discovery run needed: PDP → click "Add to cart" → capture `sp/op1` label + `e/op5` event_name. Then add a 3rd action step to `StorefrontPage.ts` + extend the spec.
- 🟡 **astro-store-9980 merchantId** — TBD; will be captured from live `sp/op1` body once the spec runs for that store
- 🟡 **More storefront merchants** — only 2 stores currently; production coverage requires all onboarded stores with Kwikpass

---

## 10. Spec 7 — Combined 3-Step Validator (kwikads-validator)

**File:** `src/data-validation/specs/kwikads-validator.spec.ts`  
**Run:** `npx playwright test --project=kwikads-validator --reporter=list --headed`

### Core modules

| Module | File | Status | Notes |
|--------|------|--------|-------|
| GK Admin auth manager | `src/core/gk-admin-auth/GkAdminAuthManager.ts` | ✅ | `bootstrapStores()` — Ctrl+K → kwikpass search → popup → GK SSO |
| GK Admin session store | `src/core/gk-admin-auth/GkAdminSessionStore.ts` | ✅ | `gk-admin.state.json` path + `hasState()` |
| Verdict assembler | `src/validator/verdict-assembler.ts` | ✅ | Pure function, 6 states, no Playwright deps |
| Verdict unit tests | `src/validator/verdict-assembler.test.ts` | ✅ | 8 tests covering all 6 verdicts + edge cases |
| Shopify stores list | `src/testdata/shopifyStoreslist.ts` | ✅ | Reads `shopifyStores.json` at runtime |
| Shopify stores data | `src/testdata/shopifyStores.json` | ✅ | Populated via `npm run shopify:scrape-stores` |

### Verdict state machine (6 states)

| Verdict | Trigger | Meaning |
|---------|---------|---------|
| `PASS` | `storefront === 'events-fired'` | Integration working — pixel firing |
| `FAIL_KWIKPASS_NOT_INSTALLED` | kwikpass `not-installed`, storefront silent | Kwikpass app not installed on store |
| `FAIL_KWIKADS_NOT_ONBOARDED` | kwikpass installed, silent, platform `not-onboarded` | Meta OAuth not completed |
| `FAIL_INTEGRATION_BROKEN` | kwikpass installed, onboarded, storefront still silent | Pipeline broken between Kwikpass and events |
| `ANOMALY` | kwikpass installed, silent, onboarding state unknown | Can't determine root cause |
| `INCONCLUSIVE` | kwikpass state unknown, storefront silent | Run `gkadmin:login` first |

### Bootstrap report status (from `reports/gkadmin-bootstrap.json`)

| Store handle | Kwikpass | Status |
|-------------|---------|--------|
| som-qa-store | installed | ✅ |
| astro-store-9980 | installed | ✅ |
| automation-store-dblyjb4a | installed | ✅ |
| automation-store-f1s5vhzk | installed | ✅ |
| test-store-1100000000000000000000000000000004941 | installed | ✅ |

### What's left for Spec 7

- 🟡 **prnab-test** — listed as a toggle merchant but NOT in `gkadmin-bootstrap.json`; `gkadmin:login` for that store needs a run
- 🟡 **Verdict unit tests for GkAdminSessionStore** — `GokwikSessionStore` edge cases (domain matching, expired JWT, session-only cookie) not yet TestSprite'd

---

## 11. TestSprite — AI-Generated Edge Case Tests

Documented prompts exist in `docs/tests.md` (Section 5). None have been executed and committed as actual spec files yet.

| Module | Edge cases planned | Status |
|--------|-------------------|--------|
| `AiResponseParser.parseReply()` | Escaped pipes, emoji ranks, missing columns, empty input | ❌ Not built |
| `DataComparator.compare()` | Null kwikadsValue, both-zero (NaN guard), threshold override | ❌ Not built |
| `KwikAiApiClient.callKwikAiApi()` | Empty reply, 401, 500, malformed JSON line, null body | ❌ Not built |
| `GokwikSessionStore` | Expired JWT, session-only cookie, domain matching, `hasState()` false | ❌ Not built |
| `BaseApiClient.fetchBenchmarkData()` | 5xx retry, 404 no-retry, succeed on 3rd attempt, timeout retry | ❌ Not built |
| `BenchmarkService.run()` | merchantId not found, adAccountId not found, browser always closed | ❌ Not built |

**To generate:** Invoke TestSprite via Claude Code chat using the prompts in `docs/tests.md` Section 5, then commit the approved test files into `src/`.

---

## 12. CI/CD Pipeline

**File:** `.github/workflows/kwikads-benchmark.yml`

### Status: ✅ Fully configured

| Feature | Status | Notes |
|---------|--------|-------|
| Schedule: every 6 hours | ✅ | `0 4,10,16,22 * * *` — stays ahead of GoKwik 6h JWT TTL |
| Push to main trigger | ✅ | Only on changes to `src/**`, config, `package.json` |
| Manual dispatch | ✅ | Via GitHub Actions UI |
| GoKwik profile restore | ✅ | From `GOKWIK_PROFILE_BASE64` secret |
| Storefront profile restore | ✅ | From `STOREFRONT_PROFILE_BASE64` secret |
| `gokwik:keepalive` pre-flight | ✅ | Refreshes JWT before test run; fast-exits if still valid |
| Xvfb virtual display | ✅ | Enables headful browser on Ubuntu runner |
| HTML report artifact (30d) | ✅ | `playwright-report-${{ run_number }}` |
| Failure artifact upload | ✅ | Screenshots + traces on failure |
| meta-vs-dashboard excluded | ✅ | By design — Meta blocks headless + requires 2FA |

### What's left for CI

- 🔒 **GitHub secrets must be set** — `GOKWIK_PROFILE_BASE64`, `STOREFRONT_PROFILE_BASE64`, `GOKWIK_STATE_JSON`, `API_BASE_URL`, `KWIKADS_USERNAME`, `KWIKADS_PASSWORD`, `KWIK_AI_BASE_URL`, `KWIK_AI_DASHBOARD_URL`, `GOKWIK_SSO_EMAIL` need to be uploaded to GitHub → Settings → Secrets
- 🔒 **Secret refresh when session expires** — no automated re-upload; manual step: `tar -czf - gokwik-profile/ | base64 > /tmp/gokwik.b64` → upload to GH secret
- ❌ **No Slack/email alert on failure** — CI fails silently unless someone checks the Actions tab; a failure notification step would close this gap
- ❌ **meta-vs-dashboard not in CI** — design decision, but there is no scheduled benchmark parity monitoring currently; all benchmark runs are manual

---

## 13. Discovery Utilities

| Script | Output | Status | Notes |
|--------|--------|--------|-------|
| `npm run shopify:scrape-stores` | `src/testdata/shopifyStores.json` | ✅ Populated | Lists dev stores available via Shopify Partner session |
| `npm run shopify:observe -- <handle>` | `reports/shopify-observe-*.log` | ✅ Working | Captures network trace for reverse-engineering |

`src/discovery/storefront-events-trace.md` — fully calibrated for `som-qa-store` (positive case) and `prnab-test` (negative case). Open item: add-to-cart observation.

---

## 14. Documentation

| Document | Status | Notes |
|----------|--------|-------|
| `CLAUDE.md` | ✅ Current | Full project guide for AI agents |
| `docs/tests.md` | ✅ Current | Test catalogue + TestSprite prompts |
| `docs/code-explained.md` | ✅ Current | Line-by-line code walkthrough |
| `docs/skills.md` | ✅ Current | Scraper deep-dive: architecture, failure history |
| `docs/failure_knowledge.md` | ✅ Current | 13+ entries — Meta UI edge cases and fixes |
| `src/discovery/storefront-events-trace.md` | ✅ Current | Calibrated endpoint shapes and action mapping |
| `README.md` | 🟡 Outdated | Still describes the original single-spec architecture; doesn't reflect the 6-spec multi-flow structure |

---

## 15. Merchant Registry Health Check

`src/testdata/merchants.ts` — 7 merchants total

| Merchant | Status | Gaps |
|----------|--------|------|
| qa.gokwik (prnab-test) | ✅ Complete | All fields set |
| som-qa-store | ✅ Complete | All fields set |
| astro-store-9980 | 🟡 Incomplete | `merchantId` empty — TBD from live `sp/op1` capture |
| Creare X Unrush | ✅ Complete | Verified clean pass |
| Macrame Cords Pari | 🐛 Known bugs | In `@regression` — fails on Spend, CPM, ROAS |
| Raho Saada | 🐛 Known bugs | In `@regression` — fails on CTR, ROAS |
| New Ads Test | 🟡 Unverified | `@regression` — no confirmed clean pass yet |

---

## 16. Full Remaining Work List (Prioritised)

### P0 — Immediate (unblocks CI)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| P0-1 | Upload GitHub secrets (6 secrets) | @SDET | Without these CI runs can't authenticate; one-time manual step |
| P0-2 | Pin `astro-store-9980` merchantId from live `sp/op1` body | @BE | Run storefront spec, copy `merchant_id` from console output, update `merchants.ts` |

### P1 — High (breadth / coverage)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| P1-1 | Observe add-to-cart event (`shopify:observe`) | @BE | Run: `npm run shopify:observe -- som-qa-store`; drive PDP → add to cart; record `sp/op1` label + `e/op5` event_name |
| P1-2 | Implement add-to-cart step in `StorefrontPage.ts` | @FE | New method `addFirstProductToCart()` using `captureAction`; Shopify Dawn AJAX — no page nav |
| P1-3 | Extend storefront spec with add-to-cart assertion | @SDET | 3rd row in the event table: action=`Cart add`, expected `add_to_cart` + `AddToCart` |
| P1-4 | Add more `@kwikads-toggle` merchants to `merchants.ts` | @SDET | Need at least 2–3 production merchants for Spec 4 + 5 to have meaningful coverage |
| P1-5 | `prnab-test` bootstrap missing — run `gkadmin:login` | @SDET | Store appears in toggle tests but not in `gkadmin-bootstrap.json`; validator will be INCONCLUSIVE for it |
| P1-6 | Verify `New Ads Test` and promote to `@smoke` | @SDET | Run benchmark spec for `act_3781545225208934`; if clean pass, change tag from `@regression` to `@smoke` |

### P2 — Medium (test quality / edge cases)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| P2-1 | Generate TestSprite tests for `AiResponseParser` | @SDET | Use the prompt from `docs/tests.md` §5; 7 edge cases |
| P2-2 | Generate TestSprite tests for `DataComparator` | @SDET | 6 edge cases including null kwikadsValue and both-zero NaN guard |
| P2-3 | Generate TestSprite tests for `KwikAiApiClient` | @BE | SSE stream edge cases: empty reply, 401, 500, malformed JSON |
| P2-4 | Generate TestSprite tests for `GokwikSessionStore` | @BE | Domain matching, expired JWT, session-only cookie, `hasState()` false |
| P2-5 | Generate TestSprite tests for `BaseApiClient` retry | @BE | 5xx retry, 404 no-retry, succeed on 3rd attempt |
| P2-6 | Generate TestSprite tests for `BenchmarkService` error paths | @BE | merchantId not found, adAccountId not found, browser always closed |

### P3 — Low (polish / ops)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| P3-1 | Add CI failure notification (Slack or email) | @SDET | GitHub Actions step: `if: failure()` → `curl` Slack webhook or `gh` CLI comment |
| P3-2 | Update `README.md` to reflect 6-spec structure | @PM | Current README describes the original single-spec architecture |
| P3-3 | Evaluate production (`dashboard.gokwik.co`) vs QA URL strategy | @PM | Toggle + storefront specs hardcode QA URLs; confirm if prod validation is in scope |
| P3-4 | Automate GH secret refresh workflow | @SDET | When `gokwik:keepalive` detects expiry on CI, trigger a workflow that re-packages the profile |

---

## 17. Quick Reference — What to Run Where

| Goal | Command | Environment |
|------|---------|-------------|
| All CI-safe tests | `npx playwright test --project=ci --workers=1` | CI or local |
| Benchmark parity (Creare X Unrush) | `npx playwright test --project=meta --reporter=list` | Local headed |
| Toggle state check | `npx playwright test src/data-validation/specs/kwikads-toggle.spec.ts --headed` | Local |
| Toggle flip + restore | `npx playwright test src/data-validation/specs/kwikads-admin-override.spec.ts --headed` | Local |
| Both toggle specs together | `npx playwright test kwikads-toggle.spec.ts kwikads-admin-override.spec.ts --workers=1 --headed` | Local |
| Storefront pixel check | `npx playwright test src/data-validation/specs/kwikads-storefront-events.spec.ts --headed` | Local |
| 3-step validator | `npx playwright test --project=kwikads-validator --headed` | Local |
| Verdict unit tests only | `npx playwright test --project=kwikads-validator-unit` | Local or CI |
| Kwik AI unit tests | `npx playwright test src/kwik-ai/specs/kwik-ai-api.spec.ts` | Local or CI |
| Kwik AI live API | `npx playwright test src/kwik-ai/specs/kwik-ai-live.spec.ts` | Local |
| HTML report | `npm run report` | Local |
| Refresh all sessions | `npm run login:all` | Local (interactive) |
| Force refresh all sessions | `npm run login:force` | Local (interactive) |

---

## 18. What Passes Today

Based on last confirmed test run (`test-results/.last-run.json` status: `passed`, 0 failed tests) and the verification logs in `reports/automation.log`:

| Spec | Last known state | Verified |
|------|-----------------|---------|
| `kwik-ai-api.spec.ts` (5 unit tests) | ✅ All pass | 2026-03-25 |
| `meta-vs-dashboard.spec.ts` [Creare X Unrush] | ✅ Clean PASS (0.00–0.17% diff) | 2026-03-31 |
| `kwikads-toggle.spec.ts` [qa.gokwik] | ✅ TOGGLE_ON confirmed | 2026-05-07 |
| `kwikads-admin-override.spec.ts` [qa.gokwik] | ✅ flip + restore confirmed | 2026-05-07 |
| `kwikads-storefront-events.spec.ts` [som-qa-store] | ✅ 4 events fired (page_viewed, PageView, product_viewed, ViewContent) | 2026-04-30 |
| `verdict-assembler.test.ts` (8 unit tests) | ✅ All pass | 2026-05-06 |
| `kwikads-validator.spec.ts` [som-qa-store] | ✅ PASS — events-fired overrides unknown kwikpass state | 2026-05-06 |
| `kwik-ai-live.spec.ts` | ✅ (auto-skips if env missing) | 2026-03-27 |

*This file is the authoritative
All pass | 2026-05-06 |
| `kwikads-validator.spec.ts` [som-qa-store] | ✅ PASS — events-fired overrides unknown kwikpass state | 2026-05-06 |
| `kwik-ai-live.spec.ts` | ✅ (auto-skips if env missing) | 2
---

*This file is the authoritative project status. Update the relevant section when work completes or new scope is added.*
