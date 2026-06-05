# KwikAds Automation — Test Documentation

**Total tests:** 10 + N (Specs 4–6 = 1 test per merchant in their respective merchant lists)
**Spec files:** 6 (Specs 3–6 skip automatically if env/session not ready)
**TestSprite:** AI-generated tests via MCP — see [Section 5](#5--testsprite--ai-generated-tests) below

---

## Run Commands

### Run all tests
```bash
npm test
# or:
npx playwright test --reporter=list
```

### Run with visible browser (required for Meta scraping)
```bash
npm run test:headed
```

### Run a single spec
```bash
# Benchmark validation (requires live Meta session + network)
npx playwright test src/data-validation/specs/meta-vs-dashboard.spec.ts --reporter=list

# Kwik AI parser unit tests (no browser, no network)
npx playwright test src/kwik-ai/specs/kwik-ai-api.spec.ts --reporter=list

# Kwik AI live API tests (requires KWIK_AI_BASE_URL in .env + valid gokwik session)
npx playwright test src/kwik-ai/specs/kwik-ai-live.spec.ts --reporter=list

# KwikAds toggle-state check (requires gokwik-profile/)
npx playwright test src/data-validation/specs/kwikads-toggle.spec.ts --reporter=list --headed

# KwikAds admin toggle write + restore (requires gokwik-profile/)
npx playwright test src/data-validation/specs/kwikads-admin-override.spec.ts --reporter=list --headed

# KwikAds storefront pixel firing (requires storefront-profile/)
npx playwright test src/data-validation/specs/kwikads-storefront-events.spec.ts --reporter=list --headed

# Run toggle + admin-override together (MUST use --workers=1 — both share gokwik-profile/)
npx playwright test \
  src/data-validation/specs/kwikads-toggle.spec.ts \
  src/data-validation/specs/kwikads-admin-override.spec.ts \
  --workers=1 --reporter=list --headed
```

### Run a single test by name
```bash
npx playwright test --grep "rank-1 ad" --reporter=list
npx playwright test --grep "comma" --reporter=list
npx playwright test --grep "toggle state" --reporter=list
```

### Open HTML report after any run
```bash
npm run report
# or directly:
npx playwright show-report reports/html
```

### One-time setup (authenticate each platform once)
```bash
npm run meta:login            # authenticate Meta                  → meta-profile/
npm run gokwik:login          # authenticate GoKwik dashboard      → gokwik-profile/   (Google SSO auto-clicks)
npm run shopify:login         # authenticate Shopify Partner        → shopify-partner-profile/
npm run gkadmin:login         # bootstrap GK admin via Shopify popup → gk-admin.state.json
npm run storefront:login      # cache storefront password cookies   → storefront-profile/

# Or bootstrap all sessions in one command:
npm run login:all             # smart — skips sessions that are still valid
npm run login:force           # refreshes all sessions unconditionally
```

> `gokwik:login` uses persistent Chromium profile (`gokwik-profile/`). Google SSO auto-clicks the account tile matching `GOKWIK_SSO_EMAIL` from `.env` — no manual click needed after the first run.

> `gkadmin:login` opens each store's admin → searches "kwikpass" → clicks the app → completes manual Google SSO once → saves combined cookies to `gk-admin.state.json`. First store is interactive (5-min budget); the rest run silently in parallel (concurrency 3).

> `storefront:login` opens the store URL in `storefront-profile/`. If a password gate appears, you enter the dev-store password once; the cookie is saved and reused on all future runs. Run once per store handle.

### Discovery / observation utilities (not tests — manual tools)
```bash
npm run shopify:scrape-stores                 # one-time: list dev stores → src/testdata/shopifyStores.json
npm run shopify:observe                       # interactive store picker, captures nav + tracking-shaped requests
npm run shopify:observe -- prnab-test         # specific store by handle
```

> `shopify:observe` is for reverse-engineering flows. It opens a store admin, lets you click around, and records every navigation + interesting network request to `reports/shopify-observe-<store>-<ts>.log`. Use it to confirm the URLs / endpoints a manual flow walks through before automating it.

---

## Spec 1 — Benchmark: KwikAds vs Meta Data Validation

**File:** `src/data-validation/specs/meta-vs-dashboard.spec.ts`
**Tests:** 1 | **Browser required:** Yes (headful — Meta blocks headless) | **Network required:** Yes

| # | Test name | What it validates |
|---|---|---|
| 1 | `[Creare X Unrush] metrics match Meta Ads Manager` | Fetches KwikAds API benchmark data, scrapes Meta Ads Manager for the same periods, asserts all metrics are within 5% tolerance |

**Pre-conditions:**
- Valid Meta session in `meta-profile/` (run `npm run meta:login` once if missing)
- `.env` with `API_BASE_URL`, `KWIKADS_USERNAME`, `KWIKADS_PASSWORD`

---

## Spec 2 — Kwik AI: AiResponseParser Unit Tests

**File:** `src/kwik-ai/specs/kwik-ai-api.spec.ts`
**Tests:** 5 | **Browser required:** No | **Network required:** No

Uses `REAL_REPLY` — exact markdown table captured from a live KwikAI API call on 2026-03-25 for account `act_1543438996237925` (Creare X Unrush), last 7 days.

| # | Test name | What it validates |
|---|---|---|
| 1 | `parses correct number of ads` | `parseReply()` returns exactly 5 ad rows |
| 2 | `extracts period string` | Period line `"Last 7 days (March 19-25, 2026)"` extracted correctly |
| 3 | `rank-1 ad: all metrics correct` | Alba Dress (Wine) — spend, revenue, ROAS, purchases, CTR, costPerPurchase all match captured values |
| 4 | `rank-4 ad: handles comma in large spend and revenue` | `₹6,368.32` and `₹41,846.63` parsed correctly despite thousands separators |
| 5 | `all 5 ads have non-zero roas` | Every row in the table has ROAS > 0 |

---

## Spec 3 — Kwik AI: Live API Responses

**File:** `src/kwik-ai/specs/kwik-ai-live.spec.ts`
**Tests:** 2 | **Browser required:** No | **Network required:** Yes (hits real `/op4` SSE endpoint)

Calls the real KwikAI Assistant API for merchant **Creare X Unrush** (`act_1543438996237925`), parses the reply with `AiResponseParser`, and prints a formatted table to stdout. Skips automatically if env vars or session are missing.

**Pre-conditions:**
- `.env` contains `KWIK_AI_BASE_URL=https://api-gw-v4.dev.gokwik.in`
- `.env` contains `KWIK_AI_DASHBOARD_URL=https://qa-mdashboard.dev.gokwik.in`
- Valid GoKwik session in `gokwik-profile/` (run `npm run gokwik:login` once if missing)

| # | Test label | Query sent to API | What it validates |
|---|---|---|---|
| 1 | `top-ads-yesterday` | `"Show top 10 ads by ROAS for yesterday"` | API returns reply, parser finds ≥1 ad row, prints table |
| 2 | `fetch-campaigns-past-7d` | `"Show campaign performance for last 7 days"` | API returns reply, parser finds ≥1 ad row, prints table |

**Sample output:**
```
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
KwikAI Response — [top-ads-yesterday]  Period: Yesterday (March 28, 2026)
Total ads: 10
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
#   | Ad Name (truncated to 35)           | Campaign        | Spend      | Revenue     | ROAS    | Purch | CTR    | Cost/Purchase
────|─────────────────────────────────────|─────────────────|────────────|─────────────|─────────|───────|────────|──────────────
1   | Alba Dress (Wine) video ad          | Campaign        | ₹380.20    | ₹9,405.00   | 24.74x  | 2     | 2.59%  | ₹190.10
```

---

## Spec 4 — KwikAds: Event-Tracking Toggle State (read-only)

**File:** `src/data-validation/specs/kwikads-toggle.spec.ts`
**Tests:** 1 per merchant in `KWIKADS_TOGGLE_MERCHANTS` (currently 1) | **Browser required:** Yes (headed) | **Network required:** Yes

For each merchant, navigates to `https://qa-mdashboard.dev.gokwik.in/kwikads/platforms`, intercepts the `m/op2` API response, locates the platform row matching the merchant's `adAccountId`, and reports one of four states.

**Pre-conditions:**
- `gokwik-profile/` present (run `npm run gokwik:login` once if missing)
- Merchant must exist in `src/testdata/merchants.ts` with `@kwikads-toggle` tag

| State | Meaning | Test outcome |
|---|---|---|
| `BLOCKED` | URL redirected to `/onboarding/(kp\|ka)/` or `/login` — KwikAds not integrated | SKIPPED |
| `META_NOT_ONBOARDED` | `m/op2` returned a Meta OAuth URL — merchant hasn't completed Meta platform OAuth | SKIPPED |
| `TOGGLE_ON` | `isActive: true` in `m/op2` response | PASSES |
| `TOGGLE_OFF` | `isActive: false` in `m/op2` response | FAILS (loud) |

**On every run a `[kwikads-platforms]` line is written to `reports/automation.log`** showing `adAccountId`, `id`, `isActive`, and `apiBase`. Useful for confirming the field name on first calibration.

---

## Spec 5 — KwikAds: Admin Toggle Override (write + restore)

**File:** `src/data-validation/specs/kwikads-admin-override.spec.ts`
**Tests:** 1 per merchant in `KWIKADS_TOGGLE_MERCHANTS` (currently 1) | **Browser required:** Yes (headed) | **Network required:** Yes

Per merchant: reads current toggle state → flips it via `PATCH /ka/api/v1/m/op6/<id>` → reloads and re-reads to confirm the change → restores original state. The `finally` block guarantees the restore always runs even if the assertion fails — toggle is never left in a wrong state.

**Pre-conditions:**
- `gokwik-profile/` present (run `npm run gokwik:login` once if missing)
- Merchant must have `@kwikads-toggle` tag and a valid `merchantId` in `merchants.ts`
- Must run with `--workers=1` when combined with Spec 4 (both share `gokwik-profile/`)

| Step | What happens |
|---|---|
| READ | Navigate to `/kwikads/platforms`, intercept `m/op2`, record current `isActive` |
| PATCH | `page.evaluate` fetch → `PATCH m/op6/<id>` with `gk-merchant-id` header |
| RE-READ | Reload page, intercept `m/op2` again — authoritative confirmation the flip landed |
| RESTORE | PATCH back to original state; RE-READ again to verify |

**Sample console output:**
```
╔════════════════════════════════════════════════════════════════════════════════════════════╗
║  ADMIN TOGGLE OVERRIDE  |  qa.gokwik (prnab-test)  |  id=59  |  act_1035682277234487    ║
╠════════════════════════════════════════════════════════════════════════════════════════════╣
║  Step      State                   Before    After     ║
║  ────────────────────────────────────────────────────  ║
║  READ      TOGGLE_ON               true      —         ║
║  PATCH     —                       true      false     ║
║  RE-READ   TOGGLE_OFF              true      false     ║
║  RESTORE   TOGGLE_ON               true      true      ║
╚════════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## Spec 6 — KwikAds: Storefront Pixel Event Firing

**File:** `src/data-validation/specs/kwikads-storefront-events.spec.ts`
**Tests:** 1 per merchant in `KWIKADS_STOREFRONT_MERCHANTS` (currently 2) | **Browser required:** Yes (headed) | **Network required:** Yes

Per merchant: navigates to the Shopify storefront homepage → clicks the first product → asserts that `sp/op1` and `e/op5` events fire on both actions. Skips automatically if the store is password-gated and the profile cookie hasn't been bootstrapped.

**Pre-conditions:**
- `storefront-profile/` present (run `npm run storefront:login -- <handle>` for each store once)
- Merchant must have `@kwikads-storefront` tag and a valid `shopifyHandle` in `merchants.ts`

| Event endpoint | When it fires | What we assert |
|---|---|---|
| `sp/op1` | Homepage load + PDP load | At least 1 per action |
| `e/op5` | Homepage load + PDP load | At least 1 per action |

Stores with no `storefront-profile/` cookie for their domain will land on `/password` → spec logs the skip reason and calls `test.skip()` cleanly.

**Sample console output:**
```
════════════════════════════════════════════════════════════════════════════════════════════════
  STOREFRONT EVENTS  |  Merchant: som-qa-store  |  Verdict: ✓ PASS
════════════════════════════════════════════════════════════════════════════════════════════════
  Action          Endpoint   Event name          Merchant ID
  ──────────────────────────────────────────────────────────────────────────────────────────
  Homepage view   sp/op1     page_viewed         39028imn4dzg9a              ✓
  Homepage view   e/op5      PageView            39028imn4dzg9a              ✓
  PDP view        sp/op1     page_viewed         39028imn4dzg9a              ✓
  PDP view        e/op5      ViewContent         39028imn4dzg9a              ✓
  ──────────────────────────────────────────────────────────────────────────────────────────
  Total: 6 events  |  Final: https://som-qa-store.myshopify.com/products/...
════════════════════════════════════════════════════════════════════════════════════════════════
```

---

## 5 — TestSprite — AI-Generated Tests

**Tool:** TestSprite MCP (configured in `.mcp.json`)
**Invocation:** Natural-language prompts in Claude Code chat — no `npm` script needed
**Requires:** Claude Code restart after `.mcp.json` was saved + Node.js ≥ 22

> TestSprite runs in its own cloud sandbox. It does not affect your local `npm test` run.
> Once you approve a generated test, copy it into `src/` as a proper spec file.

---

### Run TestSprite for a specific module

Paste these prompts directly into Claude Code chat:

#### AiResponseParser — parser edge cases
```
TestSprite: test AiResponseParser.parseReply() with:
  - Table with 1 row, 5 rows, 10 rows
  - Ad name with escaped pipe: "Kwikads \| Interest \| CBO"
  - Rank column uses medal emoji (🥇 🥈 🥉)
  - Missing Cost per Purchase column
  - Revenue column absent
  - Period line missing
  - Empty string input
```

#### DataComparator — comparison logic edge cases
```
TestSprite: test DataComparator.compare() with:
  - kwikadsValue is null (metric absent from API)
  - metaValue and kwikadsValue both 0 (diff should be null, not NaN)
  - metaValue 0, kwikadsValue non-zero (100% mismatch)
  - Only periodOne mismatches, periodTwo is within 5% threshold
  - All 7 metrics: spend, cpm, ctr, roas, impressions, clicks, cpc
  - Threshold override: mismatchThreshold = 10
```

#### KwikAiApiClient — SSE stream parsing
```
TestSprite: test KwikAiApiClient.callKwikAiApi() SSE parsing:
  - Stream ends without a complete event → must throw
  - complete event has empty reply
  - HTTP 401 → throw with status code
  - HTTP 500 → throw (no retry here)
  - Malformed JSON in data: line → skip and continue
  - Response body is null → throw
```

#### GokwikSessionStore — session state management
```
TestSprite: test GokwikSessionStore with:
  - Cookie with expires < now → isExpired() returns true
  - Session-only cookie (expires: -1) → not expired by timestamp
  - State file older than 7 days → isExpired() returns true
  - Domain matching: ".gokwik.in" matches "api-gw-v4.dev.gokwik.in"
  - Exact domain match: "api-gw-v4.dev.gokwik.in" does not match "qa-mdashboard.dev.gokwik.in"
  - hasState() when file missing → false
```

#### BaseApiClient — retry logic
```
TestSprite: test BaseApiClient.fetchBenchmarkData() retry:
  - HTTP 500 → retries up to 3 times
  - HTTP 404 → does NOT retry
  - HTTP 200 after 2 failures → succeeds on 3rd attempt
  - Network timeout → retried
  - Correct Bearer token attached on every request
```

#### BenchmarkService — orchestrator error paths
```
TestSprite: test BenchmarkService.run() error handling:
  - merchantId not found in API response → throws with merchant ID in message
  - adAccountId not found → throws with account ID in message
  - browser.close() always called even when scraping throws
```

---

### Verify TestSprite is connected

```bash
! claude mcp list
# Expected: TestSprite ✓ Connected
```

### Check Node version (must be ≥ 22)

```bash
node --version
```

### Manual npx check

```bash
npx @testsprite/testsprite-mcp@latest --version
```

