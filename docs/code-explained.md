# KwikAds Automation — Code Explained (Simplified)

> **Who is this for?** Someone with ~1 year of experience learning TypeScript and Playwright automation.
> **How to read this:** Start from the top. Each section builds on the previous one. Skip nothing.
> **Last updated:** 2026-05-07 — covers all 5 auth flows, toggle write, storefront events, admin override, verdict assembler, network observer, concurrency, and Google SSO auto-click.

---

# PART 1 — What Does This Project Do?

## The Problem (in plain English)

GoKwik has a product called **KwikAds**. It pulls advertising data from Facebook (Meta) and shows it to online store owners on a dashboard. Store owners use these numbers to decide how much money to spend on ads.

**The known bug:**

| What we measure   | KwikAds says | Facebook says | How far off? |
|-------------------|-------------|---------------|-------------|
| Money spent on ads | ₹14,700 | ₹16,393 | 11% wrong |
| Cost per 1000 views | ₹119 | ₹131 | 10% wrong |
| Click rate | 3.69% | 3.79% | 3% (acceptable) |

Beyond data parity, the framework now also validates three more things:

| Question | What we check |
|----------|---------------|
| Is Kwikpass installed on the store? | GK Admin bootstrap report (from Shopify admin search) |
| Is the storefront pixel firing? | Live network requests from the store homepage / product page |
| Is the event-tracking toggle ON in the dashboard? | API intercept of `/ka/api/v1/m/op2` |

---

# PART 2 — The Full Architecture (ASCII)

This is the entire framework in one picture. Every box is a real file.

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║              KwikAds Automation Framework — Full Architecture                   ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  .env  (secrets — gitignored, never committed)                               │
  │  API_BASE_URL · KWIKADS_USERNAME · KWIKADS_PASSWORD · META_EMAIL ·           │
  │  GOKWIK_SSO_EMAIL · KWIK_AI_BASE_URL · KWIK_AI_DASHBOARD_URL                │
  └────────────────────────────────┬─────────────────────────────────────────────┘
                                   │ read once at startup
                                   ▼
                          src/config/env.config.ts
                          (single typed object shared by all files)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  5 PERSISTENT CHROME PROFILES  (each on disk, real device fingerprint)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  meta-profile/              gokwik-profile/        shopify-partner-profile/
  (Meta Ads Manager)         (GK Dashboard +        (Shopify Partner admin +
   npm run meta:login         KwikAds platforms)      GK Admin bootstrap)
                              npm run gokwik:login    npm run shopify:login

  storefront-profile/        gk-admin.state.json
  (store password cookies)   (snapshot from shopify-partner-profile
   npm run storefront:login   after Kwikpass popup flow completes)

  All 5 managed by:  npm run login:all  (smart — skips valid sessions)
                     npm run login:force (refreshes all unconditionally)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SETUP SCRIPTS  (run once per session — not before every test)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  login-all.ts ──→ SessionChecker.checkAllSessions()  (disk only, no browser)
                           │
       ┌───────────────────┼────────────────────────────────────────┐
       ▼                   ▼                  ▼                     ▼
  gokwik-login.ts  shopify-partner-   gk-admin-login.ts   storefront-login.ts
  (Google SSO       login.ts           (Ctrl+K → Kwikpass  (store password)
   auto-click       (Shopify 2FA)       popup → gokwik.*)
   via helper)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  4 TEST FLOWS  (the actual tests — run with `npx playwright test`)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  FLOW 1 ── meta-vs-dashboard.spec.ts
  ─────────────────────────────────────────────────────────────
  BenchmarkService.run()
    ├─ BaseApiClient → POST /ka/api/v1/bm/op1  (KwikAds API)
    ├─ MetaAuthManager → meta-profile/ (persistent Chrome)
    ├─ MetaAdsNavigator → go to ad account, configure columns
    ├─ MetaDataScraper → scrape Period 1 totals row
    ├─ MetaDataScraper → scrape Period 2 totals row
    └─ DataComparator → ((meta−kwikads)/kwikads)×100
       flag if |diff| > 5%

  FLOW 2 ── kwikads-validator.spec.ts
  ─────────────────────────────────────────────────────────────
  Per store in shopifyStores.json:
    Step 1  disk read → gkadmin-bootstrap.json → kwikpass state
    Step 2  StorefrontPage → storefront-profile/ → sp/op1 + e/op5
    Step 3  KwikAdsPlatformsPage → gokwik-profile/ → m/op2 response
    Step 4  assembleVerdict() → 6-state pure function
               PASS | FAIL_KWIKPASS_NOT_INSTALLED |
               FAIL_KWIKADS_NOT_ONBOARDED |
               FAIL_INTEGRATION_BROKEN | ANOMALY | INCONCLUSIVE

  FLOW 3 ── kwikads-toggle.spec.ts
  ─────────────────────────────────────────────────────────────
  KwikAdsPlatformsPage.readPlatformState(adAccountId)
    └─ observeNetwork → intercept /ka/api/v1/m/op2
       → TOGGLE_ON | TOGGLE_OFF | BLOCKED | META_NOT_ONBOARDED

  FLOW 4 ── kwikads-admin-override.spec.ts
  ─────────────────────────────────────────────────────────────
  readPlatformState()  → capture current state + id + apiBase
  togglePlatform()     → PATCH /m/op6/<id>  (gk-merchant-id header)
  readPlatformState()  → verify flip (authoritative re-read)
  togglePlatform()     → restore original state (always runs in finally)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SHARED INFRASTRUCTURE  (used by all flows)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  network-observer.ts     observeNetwork(page, patterns)
                          arm before action → poll live buckets → stop()
                          no race condition, non-blocking

  concurrency.ts          runWithConcurrency(items, worker, limit)
                          bounded parallel execution

  GoogleSSOHelper.ts      tryClickGoogleAccount(page, email)
                          auto-clicks persisted Google account tile

  SessionChecker.ts       checkAllSessions() — disk only, no browser

  logger.ts               Winston (console + reports/automation.log)
  math.ts                 diff % formula
  formatting.ts           number / date formatters
```

---

# PART 3 — The 5 Authentication Sessions

This is the most important concept in the framework to understand. We need to be logged into **5 different systems** to run all the tests.

## Why 5 sessions instead of 1?

Because each system is a completely separate product with its own login:

| Session | What it unlocks | Profile on disk |
|---------|----------------|-----------------|
| Meta Ads Manager | Scraping ad spend / CPM / ROAS | `meta-profile/` |
| GoKwik Dashboard | Reading + writing platform toggles | `gokwik-profile/` |
| Shopify Partner | Seeing all merchant stores | `shopify-partner-profile/` |
| GK Admin (via Shopify) | Confirming Kwikpass is installed | stored inside `shopify-partner-profile/` |
| Storefront | Bypassing store password gates | `storefront-profile/` |

## Why persistent profiles instead of login-every-time?

The old approach (broken): save cookies to a `.json` file, load them into a blank Chrome browser before each test.

**The problem:** a blank Chrome browser is a brand-new device. Meta and Google see a new device and trigger 2FA every single time, even if the cookie is valid. This made tests unreliable.

**The fix:** use `chromium.launchPersistentContext('meta-profile/')`. This means:
- Chrome keeps its full profile on disk — cookies, localStorage, IndexedDB, device ID, everything
- Meta and Google see the same device every run (same fingerprint)
- Sessions last days to weeks, not hours
- 2FA only happens when the session genuinely expires

Think of it like this: the old approach was using a new rental car every day and having to register it at every checkpoint. The new approach is using your own car — the checkpoints recognise your number plate.

## The global login manager — `login-all.ts`

Instead of remembering which sessions need refreshing, run one command:

```bash
npm run login:all      # smart — skips sessions that are still valid
npm run login:force    # refreshes everything unconditionally
```

What it does internally:

```
login-all.ts
  │
  ├─ SessionChecker.checkAllSessions()   ← reads disk only, no browser opened
  │     └─ prints a status table showing: valid / expired / missing
  │
  ├─ [if expired] run gokwik:login       ← step 1
  ├─ [if expired] run shopify:login      ← step 2
  ├─ [if expired] run gkadmin:login      ← step 3 (needs step 2 to run first)
  ├─ [if expired] run storefront:login   ← step 4 (per store, sequential)
  └─ [if expired] run meta:login         ← step 5 (last — may need 2FA)
```

The order matters: GK Admin login uses the Shopify Partner session, so step 2 must come before step 3.

## Google SSO auto-click — `GoogleSSOHelper.ts`

When the GK Admin popup flow redirects through Google Sign-In, and the Chrome profile already has a persisted Google account, we can click the account tile automatically instead of waiting for a human.

```
Popup opens → redirects to accounts.google.com?
  │
  ├─ Is GOKWIK_SSO_EMAIL set in .env?
  │     No → do nothing, wait for human
  │     Yes → try 4 selector strategies in order:
  │           1. [data-email="som.shekhar@gokwik.co"]
  │           2. [data-identifier="som.shekhar@gokwik.co"]
  │           3. [aria-label*="som.shekhar@gokwik.co"]
  │           4. page.getByText(email, { exact: true })
  │
  └─ Click the first one that's visible → return true
     Nothing visible → return false (human must click)
```

**Never throws.** If the page crashes mid-redirect, the helper catches the error silently and returns `false`. The outer polling loop keeps running.

---

# PART 4 — How Each Flow Works Step by Step

## Flow 1: Benchmark (Meta vs Dashboard)

**File:** `src/data-validation/specs/meta-vs-dashboard.spec.ts`
**Orchestrated by:** `BenchmarkService.ts`

```
BenchmarkRunConfig
{ merchantId, adAccountId, periodOne, periodTwo }
         │
         ▼
1. BaseApiClient.fetchBenchmarkData()
   POST /ka/api/v1/bm/op1
   Returns: { before: {spend, cpm, ctr, roas}, after: {spend, cpm, ctr, roas} }
         │
2. MetaAuthManager.getAuthenticatedContext()
   Launches meta-profile/ (headful — Meta blocks headless)
         │
3. MetaAdsNavigator.goToAdAccount(adAccountId)
   MetaAdsNavigator.configureColumns()  ← tick: Spend, ROAS, CPM, CTR (All)
   (done ONCE — columns persist for the whole run)
         │
   ┌─────┴──────────────────────────┐
   ▼                                ▼
4. setDateRange(periodOne)    setDateRange(periodTwo)
   scrapeTotalsRow()          scrapeTotalsRow()
   metaPeriodOne              metaPeriodTwo
   │                          │
   └────────────┬─────────────┘
                ▼
5. DataComparator.compare(metaPeriodOne, metaPeriodTwo, apiAccount)
   Formula: ((meta − kwikads) / kwikads) × 100
   Flag if |diff| > 5%
                │
                ▼
   ComparisonReport → printed to console + saved to automation.log
```

**Why it runs headful:** Meta Ads Manager returns a blank white page when Chromium is in headless mode. It detects automation. Running with a real visible browser avoids this.

**Why scrape twice:** The KwikAds API compares two time periods ("before" and "after"). Meta only shows one period at a time. So we set the date to period 1, scrape, then set it to period 2, scrape, then compare both.

---

## Flow 2: KwikAds Validator (3-step health check)

**File:** `src/data-validation/specs/kwikads-validator.spec.ts`

For each store in `shopifyStores.json`:

```
STEP 1 — Read bootstrap report (no browser, no network — just a file)
──────────────────────────────────────────────────────────────────────
reports/gkadmin-bootstrap.json
    └─ kwikpass: "installed" | "not-installed"    ← was read during gkadmin:login
    └─ gkAdminUrl: the URL the popup landed on

STEP 2 — Visit storefront (uses storefront-profile/)
──────────────────────────────────────────────────────────────────────
StorefrontPage.gotoHome(handle)
    ├─ goto https://<handle>.myshopify.com
    ├─ password gate? → read from storefront-profile/ cookie
    ├─ capture requests to sp/op1 and e/op5 for 2 seconds
    └─ events fired? → storefrontState = 'events-fired' or 'silent'

STEP 3 — Check platform toggle (uses gokwik-profile/, only if step 2 was silent)
──────────────────────────────────────────────────────────────────────
KwikAdsPlatformsPage.readPlatformState(adAccountId)
    ├─ observeNetwork → arm for /ka/api/v1/m/op2 BEFORE navigating
    ├─ goto /kwikads/platforms
    ├─ m/op2 fires → extract: id, adAccountId, isActive
    └─ onboardingState = 'onboarded' | 'not-onboarded' | 'unknown'

VERDICT (pure function — no browser)
──────────────────────────────────────────────────────────────────────
assembleVerdict({ kwikpass, storefront, onboarding })
    │
    ├─ storefront = events-fired               → PASS
    │  (firing events is direct proof — skip all other checks)
    │
    ├─ kwikpass = not-installed                → FAIL_KWIKPASS_NOT_INSTALLED
    ├─ kwikpass = unknown                      → INCONCLUSIVE
    │
    ├─ kwikpass installed, not onboarded       → FAIL_KWIKADS_NOT_ONBOARDED
    ├─ kwikpass installed, onboarded           → FAIL_INTEGRATION_BROKEN
    └─ kwikpass installed, onboarding unknown  → ANOMALY
```

**Key insight:** Step 1 is free — it reads from a file we wrote earlier. This means the validator runs fast because the slow Shopify login + Kwikpass search only happens during setup (`gkadmin:login`), not during every test run.

---

## Flow 3: Toggle State Check

**File:** `src/data-validation/specs/kwikads-toggle.spec.ts`

```
For each merchant in KWIKADS_TOGGLE_MERCHANTS:
    │
    ├─ Open gokwik-profile/ (SingletonLock cleared first)
    ├─ observeNetwork → arm for /ka/api/v1/m/op2
    ├─ goto /kwikads/platforms
    ├─ wait for m/op2 response → extract isActive
    │
    ├─ isActive = true  → TOGGLE_ON  → TEST PASSES ✓
    ├─ isActive = false → TOGGLE_OFF → TEST FAILS ✗
    ├─ redirected to /onboarding → BLOCKED → TEST SKIPS ⊘
    └─ no adAccountId match    → META_NOT_ONBOARDED → TEST SKIPS ⊘
```

---

## Flow 4: Admin Override (toggle write + verify)

**File:** `src/data-validation/specs/kwikads-admin-override.spec.ts`

This is the most complete test. It doesn't just read the toggle — it changes it, confirms the change happened, then puts it back.

```
1. READ current state
   readPlatformState(adAccountId)
   → { state: TOGGLE_ON, platform: { id: "59", isActive: true }, apiBase }

2. FLIP the toggle
   togglePlatform(id="59", isActive=false, apiBase, merchantId)
   → PATCH /ka/api/v1/m/op6/59
   → headers: { "gk-merchant-id": "4bzi40ahksbqurl7" }
   → body:    { "isActive": false }

3. RE-READ (authoritative — don't trust PATCH response alone)
   readPlatformState(adAccountId)
   → assert isActive is now false

4. RESTORE (runs in finally — guaranteed even if step 3 assertion fails)
   togglePlatform(id="59", isActive=true, apiBase, merchantId)
   readPlatformState(adAccountId)
   → assert isActive is back to true
```

**Why re-read instead of trusting the PATCH response?** Because the PATCH might return 200 but the change might not have propagated yet in the backend. Re-navigating to the page and re-intercepting the m/op2 response confirms the state from the server's own data return, not just the PATCH acknowledgement.

**Why restore in `finally`?** The `finally` block runs whether the test passes OR fails. This means the toggle is never left in a wrong state even if an assertion throws an error.

---

# PART 5 — The Network Observer Pattern

**File:** `src/core/network/network-observer.ts`

This is one of the most important pieces of infrastructure in the framework. Almost every flow uses it.

## The Problem It Solves

The old way to wait for an API response:

```typescript
// OLD — race condition
await page.goto(PLATFORMS_URL);
const response = await page.waitForResponse('/m/op2');  // ← what if it fired DURING goto?
```

If the API response arrives while the page is still loading (before `waitForResponse` is set up), you miss it. The test hangs forever or times out.

## The Solution

```typescript
// NEW — arm BEFORE the action
const { buckets, stop } = observeNetwork(page, {
    m_op2: [/\/ka\/api\/v1\/m\/op2/]
});

await page.goto(PLATFORMS_URL);  // action fires AFTER observer is armed

while (buckets.m_op2.length === 0 && Date.now() < deadline) {
    await page.waitForTimeout(300);  // poll the live bucket
}

const captured = await stop();  // detach listener, return results
```

**What `observeNetwork` returns:**
- `buckets` — a live object. As responses arrive, they appear here immediately. You can poll it.
- `stop()` — removes the listener and returns the final captured responses.

**It's non-blocking:** The listener runs in the background. It never pauses the page or slows down navigation. The page loads at full speed, and responses are captured as they happen.

```
Armed observer               Page navigates               m/op2 fires
     │                            │                           │
     ▼                            ▼                           ▼
  ┌──────────┐             ┌──────────────┐            ┌────────────┐
  │ listener │──watching──▶│ page loading │──response─▶│ captured!  │
  │ attached │             │              │            │ in bucket  │
  └──────────┘             └──────────────┘            └────────────┘
  (before goto)            (goto happens)              (during load)
```

No race. The response is captured regardless of when it arrives.

---

# PART 6 — File-by-File Explanation

---

## `src/config/env.config.ts`

**Job:** Read all secrets from `.env` into one typed object. Every other file imports from here — nothing is ever hardcoded.

```typescript
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const envConfig = {
  isCI: process.env.CI === 'true',
  apiBaseUrl: process.env.API_BASE_URL || 'https://gkx.gokwik.co',
  kwikadsUsername: process.env.KWIKADS_USERNAME || '',
  kwikadsPassword: process.env.KWIKADS_PASSWORD || '',
  metaEmail: process.env.META_EMAIL || '',
  metaPassword: process.env.META_PASSWORD || '',
  gokwikSsoEmail: process.env.GOKWIK_SSO_EMAIL || '',
  kwikAiBaseUrl:  process.env.KWIK_AI_BASE_URL || '',
  kwikAiDashboardUrl: process.env.KWIK_AI_DASHBOARD_URL || '',
};
```

- `process.env.KEY` reads a value from the `.env` file (loaded by dotenv above)
- `|| 'default'` means: if the value is missing or empty, use this fallback
- `export const` means other files can `import { envConfig } from '../../config/env.config'`

**Key rule:** If a new secret is added to `.env`, it MUST also be added here. No file should ever read `process.env.SOMETHING` directly — it goes through `envConfig`.

---

## `src/core/utils/logger.ts`

**Job:** Print messages to the terminal with timestamps. Saves a copy to `reports/automation.log`.

```typescript
export const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'reports/automation.log' }),
  ],
});
```

Usage anywhere in the code:

```typescript
logger.info('[gk-admin] Popup opened — waiting for gokwik landing');
logger.warn('[google-sso] Tile not found — manual SSO required');
logger.error('[kwikads-platforms] m/op2 timed out');
```

The square-bracket prefix like `[gk-admin]` is just a convention so you can grep the log for one module's messages.

---

## `src/core/auth/GoogleSSOHelper.ts`

**Job:** When a browser is on `accounts.google.com` and a known email tile is visible, click it automatically.

```typescript
export async function tryClickGoogleAccount(
  page: Page,
  email: string | undefined,
): Promise<boolean> {
  if (!email) return false;                                    // auto-click disabled
  if (!page.url().includes('accounts.google.com')) return false; // not on Google

  // Try 4 selector strategies — Google changes its UI periodically
  const selectors = [
    `[data-email="${email}"]`,         // classic chooser
    `[data-identifier="${email}"]`,    // newer chooser
    `[aria-label*="${email}"]`,        // aria fallback
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await el.click();
      return true;
    }
  }

  // Final fallback: plain text match
  const textEl = page.getByText(email, { exact: true }).first();
  if (await textEl.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await textEl.click();
    return true;
  }

  return false; // tile not found — manual login required
}
```

**Three design rules baked in:**
1. Returns `false` (not throws) in every failure case — the caller's polling loop just continues
2. Returns immediately if not on Google — fast no-op when not needed
3. Tries 4 strategies — survives Google UI refreshes without code changes

**Where it's called:**
- `gokwik-login.ts` — inside the `while` polling loop, before each `waitForTimeout(5000)`
- `GkAdminAuthManager.awaitGkAdminLanding()` — inside the `while` polling loop for the Kwikpass popup

---

## `src/core/auth/SessionChecker.ts`

**Job:** Tell you which sessions are valid, expired, or missing — without opening any browser.

```typescript
export function checkAllSessions(): SessionStatus[] { ... }
```

It checks:
- Does `meta-profile/` directory exist?
- Does `gokwik-profile/` directory exist?
- Does `shopify-partner.state.json` exist and is it recent?
- Does `gk-admin.state.json` exist and is `gkadmin-bootstrap.json` fresh (under 7 days)?
- Are there storefront cookies in `storefront-profile/`?

**Why disk-only?** Because we want to check before opening any browser. If we opened a browser to check, we'd already be doing the login.

---

## `src/core/network/network-observer.ts`

**Job:** Capture API responses in the background while the page loads. No race conditions.

```typescript
export function observeNetwork<K extends string>(
  page: Page,
  patterns: PatternRegistry<K>,
): { buckets: Captured<K>; stop: () => Promise<Captured<K>> }
```

`PatternRegistry` is just a map from a name to URL patterns:
```typescript
{ m_op2: [/\/ka\/api\/v1\/m\/op2/] }
```

Every time a response arrives whose URL matches the pattern, it's added to `buckets.m_op2`. The caller polls the bucket in a `while` loop.

`stop()` removes the listener and gives you the final state of all buckets.

**Used by:**
- `GkAdminAuthManager` — captures Shopify Search GraphQL to check if Kwikpass is installed
- `KwikAdsPlatformsPage` — captures m/op2 to read toggle state
- `StorefrontPage` — captures sp/op1 and e/op5 to detect pixel firing (uses `request` not `response`)

---

## `src/core/utils/concurrency.ts`

**Job:** Run multiple async tasks in parallel but with a limit on how many run at once.

```typescript
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<PromiseSettledResult<R>[]>
```

**Example:** If you have 7 stores to bootstrap but set `limit = 3`, only 3 run at the same time. When one finishes, the next one starts. It's like a checkout queue with 3 open registers.

**Why `PromiseSettledResult`?** Because we don't want one store's failure to crash all the others. Each store gets its own result: either `{ status: 'fulfilled', value: ... }` or `{ status: 'rejected', reason: ... }`. The caller handles them individually.

**Used by:** `GkAdminAuthManager.bootstrapStores()` — the first store runs serially (to absorb the cold-start Google SSO), then remaining stores run in parallel with `limit = 3`.

---

## `src/core/api-client/BaseApiClient.ts`

**Job:** Talk to the KwikAds API. Handle login, retries, and data extraction.

### Types defined here:

```typescript
export type Metric = 'cpm' | 'ctr' | 'roas' | 'spend';

export interface DateRange {
  startDate: string;   // e.g. "2026-03-05"
  endDate: string;     // e.g. "2026-03-11"
}

export interface BenchmarkRequest {
  periodOne: DateRange;   // "before" period
  periodTwo: DateRange;   // "after" period
  merchantIds: string[];
  metrics: Metric[];
}
```

### Login:

```typescript
private async login(): Promise<void> {
  const res = await this.http.post('/api/v1/auth', {
    email: envConfig.kwikadsUsername,
    password: envConfig.kwikadsPassword,
  });
  this.authToken = res.data.data.token;
}
```

After login, the token is stored in `this.authToken`. The interceptor automatically adds it to every subsequent request.

### Retry logic:

```typescript
private async withRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = err.response?.status;
    if ((!status || status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * attempt));  // wait 1s, then 2s
      return this.withRetry(fn, attempt + 1);
    }
    throw err;
  }
}
```

- 500+ error (server problem) → wait and retry (up to 3 times)
- 400-499 error (our problem) → fail immediately, don't retry

---

## `src/core/gk-admin-auth/GkAdminAuthManager.ts`

**Job:** For each Shopify store, open Shopify admin, search for Kwikpass, click it to open the popup, and wait for the popup to land on the GK admin dashboard.

### The flow for one store:

```
1. goto https://admin.shopify.com/store/<handle>

2. Press Ctrl+K → Shopify topbar search dialog opens

3. Type "kwikpass" → Shopify fires a GraphQL request:
   GET /api/operations/<hash>/Search?query=kwikpass&types=["APP","APP_INSTALLATION"]

4. observeNetwork captures the GraphQL response
   hasAppInstallation() walks the JSON tree:
     - looks for __typename = "AppInstallation" AND "kwikpass" anywhere in the body
     - returns true if installed, false if only APP (meaning: in store, not installed)

5. If installed → click the kwikpass option → popup opens
   If not installed → throw KwikpassNotInstalledError → status = 'kwikpass-missing'

6. awaitGkAdminLanding(popup) polls every 2 seconds for up to 5 minutes:
   - tryClickGoogleAccount() ← auto-SSO if Google shows account chooser
   - check URL: is it on gokwik.* AND not /login or /signin?
   - yes → return the page (auth complete)
```

### Parallelism:

```
stores[0] → serial (absorbs cold-start SSO)
stores[1..N] → parallel with concurrency limit 3
               (session cookies are in the shared profile, no SSO needed)
```

**Why the first store is serial:** If Google shows the account chooser, someone might need to handle it manually. We can't have 7 windows open all waiting for the same human to click. So the first one runs alone, the SSO happens, cookies are cached, and then all remaining stores can run in parallel because Google won't ask again.

---

## `src/core/kwikads-platforms/KwikAdsPlatformsPage.ts`

**Job:** Read and write the event-tracking toggle in the KwikAds dashboard.

### Reading the toggle (`readPlatformState`):

```typescript
const { buckets, stop } = observeNetwork(page, { m_op2: [/\/m\/op2/] });
await page.goto(PLATFORMS_URL);
// ... wait for m_op2 to fire ...
const captured = await stop();

const platform = extractToggleRow(captured.m_op2[0].body, adAccountId);
// platform.id = "59"
// platform.isEventTrackingEnabled = true / false
```

It also captures the **URL** of the m/op2 response to derive `apiBase`:

```typescript
const apiBase = responseUrl.replace(/\/m\/op2.*$/, '');
// "https://api-gw-v4.dev.gokwik.in/qa/ka/api/v1/m/op2"
// → "https://api-gw-v4.dev.gokwik.in/qa/ka/api/v1"
```

This way, the PATCH URL for m/op6 is constructed from a live intercepted URL, not a hardcoded string. It works for QA and production automatically.

### Writing the toggle (`togglePlatform`):

```typescript
async togglePlatform(
  id: string,
  isActive: boolean,
  apiBase: string,
  merchantId: string,   // gokwik internal ID — required as a header
): Promise<boolean>
```

```typescript
await this.page.evaluate(
  async (args) => {
    const r = await fetch(args.patchUrl, {
      method: 'PATCH',
      credentials: 'include',   // ← sends the browser's own session cookies
      headers: {
        'Content-Type':   'application/json',
        'gk-merchant-id': args.mid,  // ← required by the API (discovered from 400 error body)
      },
      body: JSON.stringify({ isActive: args.active }),
    });
    if (!r.ok) throw new Error(`PATCH → HTTP ${r.status}`);
    return await r.json();
  },
  { patchUrl: url, active: isActive, mid: merchantId },
);
```

**Why `page.evaluate`?** Because we need the browser's session cookies sent with the request. The browser is already authenticated — `credentials: 'include'` tells `fetch` to attach all cookies automatically. We don't need to extract a Bearer token; the browser handles auth transparently.

**How we discovered the `gk-merchant-id` header:** The first PATCH attempt returned HTTP 400 with body `{ "error": "gk-merchant-id must be a string, gk-merchant-id should not be empty" }`. The error message itself told us exactly what was missing.

---

## `src/core/storefront/StorefrontPage.ts`

**Job:** Visit a Shopify store's public homepage and product page, capture all tracking events fired.

### Two tracked endpoints:

| Endpoint | Pattern | What it means |
|----------|---------|---------------|
| `sp/op1` | `api-gw-v4.dev.gokwik.io/.../sp/op1` | Page view telemetry |
| `e/op5` | `api-gw-v4.dev.gokwik.io/.../e/op5` | Meta CAPI event |

Both fire as a pair on every page navigation when Kwikpass is working.

### Capturing events:

```typescript
// Listen for REQUESTS (not responses) — we want to know when the pixel fires
page.on('request', (req) => {
  if (SP_OP1.test(req.url())) { /* capture */ }
  if (E_OP5.test(req.url()))  { /* capture */ }
});
```

We capture requests (not responses) because we want to detect when the pixel sends data, not when the server replies.

### Product page navigation:

```typescript
// Shopify Dawn theme uses a position:absolute overlay link
// that Playwright considers "hidden" even though it IS the click target.
// Solution: extract the href and navigate directly.
const href = await link.getAttribute('href');
await this.page.goto(href, { waitUntil: 'domcontentloaded' });
```

**Why not just click it?** The Shopify Dawn theme uses a CSS trick where the product card link has `position: absolute; inset: 0` — it covers the entire card but has zero "own" dimensions. Playwright's click action checks for visibility and rejects it. We extract the URL and navigate directly, which is functionally identical and more reliable.

---

## `src/validator/verdict-assembler.ts`

**Job:** Given the three collected signals (kwikpass state, storefront state, platform onboarding state), decide the verdict for one store.

```typescript
export function assembleVerdict(input: VerdictInput): VerdictResult
```

This is a **pure function** — it takes inputs, returns an output, touches no files, no browsers, no network. This means it can be unit-tested without Playwright.

### The decision tree:

```
storefront = events-fired?
  YES → PASS
  (events firing is direct proof kwikpass is installed and working)

kwikpass = not-installed?
  YES → FAIL_KWIKPASS_NOT_INSTALLED

kwikpass = unknown?
  YES → INCONCLUSIVE
  (run gkadmin:login to get the bootstrap report)

kwikpass = installed, onboarding = not-onboarded?
  YES → FAIL_KWIKADS_NOT_ONBOARDED

kwikpass = installed, onboarding = onboarded?
  YES → FAIL_INTEGRATION_BROKEN
  (Kwikpass is installed, KwikAds is configured, but events aren't firing)

kwikpass = installed, onboarding = unknown?
  YES → ANOMALY
```

**Why storefront is checked FIRST:** Real-world case discovered — a store had `kwikpass: unknown` (bootstrap report not yet run) but events were firing. The old code marked it INCONCLUSIVE. The correct verdict is PASS — firing events is direct proof. "Unknown" just means we haven't checked through the slow admin path yet.

### Unit tests:

```
8 tests covering all 6 verdicts:
  ✓ PASS — events fired
  ✓ PASS — storefront fired even when kwikpass bootstrap report missing
  ✓ FAIL_KWIKPASS_NOT_INSTALLED
  ✓ FAIL_KWIKADS_NOT_ONBOARDED
  ✓ FAIL_INTEGRATION_BROKEN
  ✓ ANOMALY
  ✓ INCONCLUSIVE
  ✓ INCONCLUSIVE — explicit silent storefront
```

Run them with: `npx jest src/validator/verdict-assembler.test.ts`

---

## `src/core/meta-scraper/MetaDataScraper.ts`

**Job:** Read numbers from the totals row in Meta Ads Manager.

### The hardest technical problem in the project

Meta Ads Manager uses **React virtualisation** for its table. This means:
- Only the columns currently in the viewport are in the DOM
- As you scroll right, columns appear and disappear
- There are TWO scroll containers — the header row and the data rows
- React only keeps them in sync if you scroll using `page.mouse.wheel()`, NOT `scrollLeft` from JavaScript

If you use `element.scrollLeft = 600` from inside `page.evaluate()`, only one container moves. All the numbers you read after that will be from the wrong columns.

### The scroll loop:

```typescript
for each metric to find:
    1. Find the header cell with matching text
    2. Get its X position on screen (left, right)
    3. Scan all leaf text nodes in the data area
    4. For each text node:
         - Get its bounding box (width, height, left, right)
         - If width/height is zero → check parent's bounds instead
           (Shopify/React sometimes renders zero-dim leaf nodes inside real containers)
         - Does center-X of this text fall between header's left and right?
         - Yes → this is our value
    5. If not found → page.mouse.wheel(0, 600) to scroll right, repeat
```

**The parent-bounds fallback** is a fix added after discovering that React renders some text nodes with zero dimensions — their parent `div` has the real position. Without this fallback, every metric was reported as "missed" and the scraper picked up wrong values.

**Dash cells** (the `—` that Meta shows when data doesn't apply, e.g., ROAS for mixed-objective campaigns) are detected in two rendering paths:
- Direct text node `—` → caught by textContent check
- CSS `::before`/`::after` pseudo-element → caught by `innerText` fallback

---

# PART 7 — How We Reduced Complexity

This section explains the key engineering decisions that made the framework simpler and more reliable.

## Decision 1: Persistent profiles replace state.json

**Old:** save cookies to a `.json` file → load into blank browser → Meta triggers 2FA
**New:** `launchPersistentContext('meta-profile/')` → real device fingerprint → sessions last weeks

**Complexity saved:** Removed `SESSION_MAX_AGE_MS`, `hasValidSession()`, `saveSession()`, `loadSession()` — all that code is now gone. The browser just works.

## Decision 2: observeNetwork replaces waitForResponse

**Old:** `await page.waitForResponse('/m/op2')` after `goto()` → race condition if response fires during load
**New:** arm observer BEFORE `goto()`, poll live buckets → zero race condition

**Complexity saved:** No more `{ timeout: 30000 }` hacks, no more retry loops around `waitForResponse`. The pattern is always: arm → act → poll → stop.

## Decision 3: Pure verdict assembler

**Old (hypothetical):** verdict logic scattered through the spec, mixed with browser interaction code
**New:** `assembleVerdict()` is a standalone pure function — no Playwright imports, no async, no side effects

**Complexity saved:** Can be unit-tested in milliseconds without a browser. 8 test cases catch every edge case. The function is 30 lines; the spec just calls it.

## Decision 4: apiBase derived from live URL

**Old (hypothetical):** hardcode `KWIK_AI_BASE_URL` for the PATCH endpoint
**New:** capture the m/op2 response URL, strip the path suffix → `apiBase` is always correct

```typescript
const apiBase = responseUrl.replace(/\/m\/op2.*$/, '');
```

**Complexity saved:** No env var to manage, works for QA and production automatically, no config change needed when the team switches environments.

## Decision 5: page.evaluate fetch for toggle write

**Old (hypothetical):** extract a Bearer token from localStorage → store it → pass to axios → manage expiry
**New:** `page.evaluate` with `credentials: 'include'` → browser sends its own session cookies

**Complexity saved:** Zero token management. If the session is authenticated in the browser (which it is, because we use the persistent profile), every `fetch` call inside `page.evaluate` is automatically authenticated.

## Decision 6: runWithConcurrency for parallel bootstrap

**Old (hypothetical):** bootstrap all 7 stores serially → 7 × 25 seconds = ~3 minutes
**New:** first store serial (absorb SSO), remaining 6 in parallel with limit 3 → ~50 seconds

**Complexity saved:** The concurrency utility is 30 lines. It handles failure isolation (one store failing doesn't abort the rest) and returns settled results in input order.

## Decision 7: SingletonLock cleanup

**Problem:** Chrome's persistent profile creates a `SingletonLock` file. If a previous test run crashed, the file remains. The next run fails immediately with "profile already in use."

**Fix:** one line in `beforeAll`:
```typescript
try { fs.unlinkSync(path.join(profileDir, 'SingletonLock')); } catch { /* fine */ }
```

**Complexity saved:** Prevents confusing "profile in use" failures that look like auth problems but are just stale lock files.

## Decision 8: Storefront navigate vs click

**Problem:** Shopify Dawn theme's product link is `position: absolute; inset: 0` inside `overflow: hidden` parent. Playwright considers it "not visible" and refuses to click even with `force: true`.

**Fix:** extract `href` from the element, do `page.goto(href)` directly.

**Complexity saved:** No special CSS handling, no scroll-into-view loops, no `dispatchEvent` hacks. Navigation is navigation — just do it directly.

---

# PART 8 — How To Run Everything

## First-time setup

```bash
npm install                    # download libraries
npx playwright install         # download Chrome
```

## `.env` file (create at project root)

```env
API_BASE_URL=https://gkx.gokwik.co
KWIKADS_USERNAME=your-email@gokwik.co
KWIKADS_PASSWORD=your-password

META_EMAIL=your-facebook-email
META_PASSWORD=your-facebook-password

KWIK_AI_BASE_URL=https://api-gw-v4.dev.gokwik.io
KWIK_AI_DASHBOARD_URL=https://qa-mdashboard.dev.gokwik.in/kwikads/agency

GOKWIK_SSO_EMAIL=som.shekhar@gokwik.co
```

## Session setup (run when sessions expire)

```bash
npm run login:all              # smart — only refreshes expired sessions
npm run login:force            # force-refresh all sessions

# Or individually:
npm run gokwik:login           # GK dashboard session
npm run shopify:login          # Shopify Partner session
npm run gkadmin:login          # GK Admin bootstrap (needs shopify session)
npm run storefront:login       # store password cookies (per store)
npm run meta:login             # Meta Ads Manager (may need 2FA)
```

## Running tests

```bash
# All tests
npm test

# Individual specs
npx playwright test src/data-validation/specs/kwikads-toggle.spec.ts
npx playwright test src/data-validation/specs/kwikads-storefront-events.spec.ts
npx playwright test src/data-validation/specs/kwikads-admin-override.spec.ts
npx playwright test src/data-validation/specs/kwikads-validator.spec.ts
npx playwright test src/data-validation/specs/meta-vs-dashboard.spec.ts

# IMPORTANT: toggle + admin-override share gokwik-profile/
# Run them with --workers=1 to avoid profile conflicts
npx playwright test kwikads-toggle kwikads-admin-override --workers=1

# With visible browser (for debugging)
npm run test:headed

# View HTML report
npm run report
```

## What each spec tests

```
┌────────────────────────────────┬─────────────────────────────────────────────────────┐
│ Spec                           │ What it checks                                      │
├────────────────────────────────┼─────────────────────────────────────────────────────┤
│ meta-vs-dashboard              │ KwikAds API numbers match Meta Ads Manager          │
│ kwikads-toggle                 │ Event-tracking toggle is ON for each merchant        │
│ kwikads-storefront-events      │ Kwikpass pixel fires on homepage + PDP nav           │
│ kwikads-admin-override         │ Toggle can be written + restored via PATCH m/op6    │
│ kwikads-validator              │ Per-store 3-step health check → 6-state verdict     │
└────────────────────────────────┴─────────────────────────────────────────────────────┘
```

## Test output format

All specs print results in a table. The admin override spec's table shows every step:

```
╔══════════════════════════════════════════════════════════════════════╗
║  ADMIN TOGGLE OVERRIDE  |  qa.gokwik (prnab-test)  |  id=59        ║
╠══════════════════════════════════════════════════════════════════════╣
║  Step      State        Before    After                             ║
║  ──────────────────────────────────────────────────────────────     ║
║  READ      TOGGLE_ON    true      —                                 ║
║  PATCH     —            true      false                             ║
║  RE-READ   TOGGLE_OFF   true      false                             ║
║  RESTORE   TOGGLE_ON    true      true                              ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

# PART 9 — Known Bugs (data pipeline, not scraping errors)

These are real discrepancies between KwikAds API data and Meta. The scraper is correct — these are backend pipeline issues.

| Merchant | Metric | KwikAds | Meta | Difference | Root Cause |
|----------|--------|---------|------|-----------|------------|
| Macrame Cords Pari | Spend | ₹14,700 | ₹16,393 | ~11% | Unknown data pipeline bug |
| Macrame Cords Pari | CPM | ₹119 | ₹131 | ~10% | Derived from spend — same root |
| Macrame Cords Pari | ROAS | ~5.3x | `—` (mixed objectives) | -100% | Meta can't aggregate ROAS for mixed campaigns |
| Raho Saada | CTR | ~3% lower | — | ~19% | KwikAds uses link clicks; Meta's "CTR (all)" includes all clicks |
| Raho Saada | ROAS | ~3.8x | `—` | -100% | Same mixed-objectives issue as above |

**What "mixed objectives" means:** If a merchant runs one campaign with "Traffic" objective and another with "Sales" objective, Meta cannot calculate a single ROAS across both because the metrics are incompatible. Meta shows `—` in the ROAS column. KwikAds computes an average anyway, which is mathematically wrong.

---

# PART 10 — Quick Reference

## File ownership

| File | Owner | What it does |
|------|-------|-------------|
| `env.config.ts` | @SDET | All secrets in one place |
| `logger.ts` | @BE | Winston console + file logging |
| `BaseApiClient.ts` | @BE | KwikAds API calls + retry |
| `KwikAiApiClient.ts` | @BE | Kwik AI chat API |
| `GoogleSSOHelper.ts` | @BE | Auto-click Google account tile |
| `SessionChecker.ts` | @BE | Disk-only session health check |
| `network-observer.ts` | @BE | Race-free response capture |
| `concurrency.ts` | @BE | Bounded parallel execution |
| `DataComparator.ts` | @BE | KwikAds vs Meta diff calculator |
| `verdict-assembler.ts` | @BE | Pure 6-state verdict function |
| `MetaSessionStore.ts` | @FE | meta-profile/ path management |
| `MetaAuthManager.ts` | @FE | Launch meta-profile/ context |
| `MetaAdsNavigator.ts` | @FE | Drive Meta Ads Manager UI |
| `MetaDataScraper.ts` | @FE | Read totals row from virtual table |
| `StorefrontPage.ts` | @FE | Visit store, capture pixel events |
| `KwikAdsPlatformsPage.ts` | @FE | Read + write event-tracking toggle |
| `GkAdminAuthManager.ts` | @FE | Shopify admin → Kwikpass popup → GK login |
| `GokwikAuthManager.ts` | @FE | Launch gokwik-profile/ context |
| `ShopifyPartnerAuthManager.ts` | @FE | Launch shopify-partner-profile/ context |
| `BenchmarkService.ts` | @BE | Orchestrate full Meta vs API flow |
| `login-all.ts` | @SDET | Global session orchestrator |
| `verdict-assembler.test.ts` | @SDET | 8 unit tests for verdict logic |
| `merchants.ts` | @SDET | Merchant registry with tags |
| `shopifyStores.json` | @FE | Scraped store list |

## API endpoints

| Endpoint | Method | What it returns |
|----------|--------|-----------------|
| `/ka/api/v1/bm/op1` | POST | Benchmark metrics: before/after per metric per account |
| `/ka/api/v1/m/op2` | GET | Platform toggle row: id, adAccountId, isActive |
| `/ka/api/v1/m/op6/<id>` | PATCH | Update toggle — requires `gk-merchant-id` header |
| `/qa/ka/api/mam/op4` | POST | Kwik AI chat response |
| `/qa/v3/api/dashboard/user/details` | GET | Auth check: returns user if session valid |

## Storefront pixel endpoints

| Endpoint | Fires when | Key field |
|----------|-----------|-----------|
| `api-gw-v4.dev.gokwik.io/.../sp/op1` | Every page nav | `label`: `page_viewed`, `product_viewed` |
| `api-gw-v4.dev.gokwik.io/.../e/op5` | Every page nav | `events[0].event_name`: `PageView`, `ViewContent` |
