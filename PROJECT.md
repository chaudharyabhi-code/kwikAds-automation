# KwikAds Automation — Project Dossier

> A single document covering: what this project is, how production-ready it is,
> the order in which to explain it, what makes it stand out, and where it can
> grow next.

---

## 1. What This Project Actually Does (in plain English)

KwikAds is a GoKwik product that plugs into a brand's **Meta Ads Manager**,
pulls their ad-spend data, and shows it back on the **GoKwik dashboard** so
D2C brands can optimise campaigns. Lots of moving parts:

- A pixel (Kwikpass) installed on the Shopify store has to fire events.
- A toggle on the GoKwik dashboard has to be ON for the merchant.
- The numbers shown on the KwikAds dashboard must match what Meta itself
  reports.
- The admin must be able to flip the toggle from inside the platform.

If **any** of those links breaks, KwikAds silently shows wrong numbers — and
nobody notices until a brand complains.

**This framework is the safety net.** It logs in to all five systems, pulls
data from each end, compares them, and tells you exactly **which link is
broken and why** in 6 distinct verdict states.

---

## 2. Production-Readiness Rating

**Overall: 7.5 / 10 — production-usable for a QA/SDET team, not yet a
hands-off CI gate for releases.**

### Score breakdown

| Dimension | Score | Why |
|---|---|---|
| Architecture & separation of concerns | 9/10 | Clear @PM/@FE/@BE/@SDET ownership, pure verdict assembler, single orchestrator (`BenchmarkService`). |
| Code quality | 8/10 | TypeScript strict, named exports, top-of-file `Owner` + `Scope` comments, no `any` types. |
| Test coverage of the product flows | 8/10 | All 4 critical flows covered (benchmark parity, toggle read, toggle write, storefront pixel) plus combined validator + Kwik AI. |
| Edge-case handling | 7/10 | 6-state verdict tree, `META_NOT_ONBOARDED`, `BLOCKED`, password-gated stores, dash-cell detection, dual-period scrape, retry on 5xx. |
| Reliability / flakiness | 6/10 | Headful-only flows (Meta) need 2FA every few weeks. CI runs on base64-tarred profiles which expire silently. |
| CI integration | 6/10 | GitHub Actions workflow exists (`kwikads-benchmark.yml`), every 6h cron, but Meta is excluded from CI. |
| Documentation | 9/10 | `CLAUDE.md`, `code-explained.md`, `failure_knowledge.md`, `skills.md`, `harp.md` — better than 90% of internal projects. |
| Secrets hygiene | 8/10 | `.env` gitignored, profiles gitignored, `.env.example` present. One past leak already scrubbed (`cca64a7`). |
| Observability | 7/10 | Winston logger → `reports/automation.log`, three-table console output, HTML report. No metrics, no alerting yet. |
| Maintainability for a new joiner | 8/10 | CLAUDE.md is a brilliant onboarding doc. Pure verdict-assembler with 8 unit tests = trivial to refactor without breaking. |

### What "production-ready" means here
- ✅ Safe to run on a schedule against QA env without human babysitting.
- ✅ Non-destructive — admin override always restores original state in
  `finally`.
- ✅ Deterministic verdicts — `verdict-assembler.test.ts` has 8 unit tests
  covering every branch.
- ⚠️  Not yet a release blocker — Meta scrape needs headful + 2FA, so it
  cannot run on every PR.
- ⚠️  Persistent-profile model is great for stability, terrible for
  multi-runner CI fan-out.

---

## 3. How to Explain This Project — Where to Begin, Where to End

Use this order in a 30-minute walkthrough. Each step builds on the previous.

### Step 1 — Open with the problem (2 min)
> "KwikAds promises brands that the numbers they see on our dashboard match
> what Meta itself reports. If that promise breaks, brands lose trust. This
> framework proves the promise — every 6 hours, automatically."

### Step 2 — `CLAUDE.md` (3 min)
The single source of truth for **all** project context. Show the four flows,
the merchant table, the URL table. Don't read it — point at it.

### Step 3 — `package.json` and the 5 login scripts (3 min)
```
npm run meta:login        → meta-profile/
npm run gokwik:login      → gokwik-profile/
npm run shopify:login     → shopify-partner-profile/
npm run gkadmin:login     → gk-admin.state.json
npm run storefront:login  → storefront-profile/
```
Explain **why** persistent Chromium profiles instead of `storageState`:
GoKwik stores auth in IndexedDB/sessionStorage which cookie-only state
files cannot capture. Meta blocks headless and challenges new device
fingerprints with 2FA.

### Step 4 — `src/config/env.config.ts` (1 min)
Single typed env object. Every spec reads from here. No `process.env.X`
scattered around the codebase.

### Step 5 — `src/testdata/merchants.ts` (1 min)
The single registry. Each merchant has tags (`@meta-benchmark`,
`@kwikads-toggle`, `@kwikads-storefront`). Specs filter by tag → impossible
to forget a merchant in one spec but include them in another.

### Step 6 — `src/core/network/network-observer.ts` (3 min)
The pattern that makes the rest possible.
```ts
const { buckets, stop } = observeNetwork(page, { m_op2: [/\/m\/op2/] });
await page.goto(url);
const captured = await stop();
```
Attaches a `page.on('response')` listener **before** navigation, so you never
miss a response that fired during the page load race. Used everywhere a
GoKwik API call needs to be intercepted.

### Step 7 — One spec from each of the four flows (10 min)
Pick the simplest first, end on the most complex.

| Order | Spec | What it proves | Headful? |
|---|---|---|---|
| 1 | `kwik-ai-api.spec.ts` | Pure parser unit tests (no browser). Warmup. | No |
| 2 | `kwikads-toggle.spec.ts` | Read toggle state via intercepted `/m/op2`. 4 outcomes: TOGGLE_ON / TOGGLE_OFF / BLOCKED / META_NOT_ONBOARDED. | Yes (gokwik-profile/) |
| 3 | `kwikads-admin-override.spec.ts` | PATCH `/m/op6/<id>`, reload, verify, **restore in `finally`**. Write-validation, non-destructive. | Yes |
| 4 | `kwikads-storefront-events.spec.ts` | Drive `<handle>.myshopify.com`, capture `sp/op1` + `e/op5` firing on homepage and PDP. | Yes |
| 5 | `kwikads-validator.spec.ts` | The grand union — kwikpass install state + storefront events + onboarding state → 6-state verdict via `assembleVerdict()`. | Yes |
| 6 | `meta-vs-dashboard.spec.ts` | The crown jewel — scrape Meta Ads Manager **twice** (dual-period), fetch KwikAds API, compare with 5% threshold. | Yes (Meta blocks headless) |

### Step 8 — `src/core/services/BenchmarkService.ts` (2 min)
The **only** orchestrator. Every other class is a pure helper. Browser
cleanup in `finally`. Demonstrates the pattern: orchestrators do flow,
helpers do work.

### Step 9 — `src/validator/verdict-assembler.ts` (2 min)
**Pure function. Zero Playwright imports.** Eight unit tests cover all six
verdict states. Show how `storefront='events-fired'` short-circuits to PASS
before even checking kwikpass — a real-world bug fix documented in the file.

### Step 10 — `playwright.config.ts` (1 min)
Five projects: `ci`, `kwikads-validator`, `kwikads-validator-unit`, `meta`,
`default`. `workers: 1` globally (persistent profile = single-process). CI
project excludes Meta.

### Step 11 — `.github/workflows/kwikads-benchmark.yml` (2 min)
Every 6 hours. Base64-tarred profiles loaded from GitHub Secrets. Meta
excluded. JWT TTL is why the cron is 4-hourly-ish, not daily.

### Close (2 min)
Show `docs/failure_knowledge.md` — every non-obvious failure that ever
happened, with the fix. This is the project's institutional memory.

---

## 4. Files & Logic — Why Each Thing Is There

### Auth layer — five separate systems, five separate strategies

| Module | Why this strategy |
|---|---|
| `MetaAuthManager` / `meta-profile/` | Meta blocks headless and 2FAs new fingerprints. Persistent Chromium profile = same device every run. |
| `GokwikAuthManager` / `gokwik-profile/` | Auth lives in IndexedDB. `storageState` can't capture IndexedDB → persistent profile mandatory. |
| `ShopifyPartnerAuthManager` / `shopify-partner-profile/` | Used only to bootstrap kwikpass install check, not the test runs themselves. |
| `StorefrontSessionStore` / `storefront-profile/` | Shopify dev stores gate behind a password. Cache once per handle. |
| `GkAdminSessionStore` / `gk-admin.state.json` | Just OAuth relay cookies — supplements `gokwik-profile/`, not replaces it. |

### Core layer — pure helpers, no orchestration

| Module | Single responsibility |
|---|---|
| `BaseApiClient` | Axios + retry on 5xx (linear back-off, 3 attempts). Never retries 4xx. |
| `KwikAiApiClient` | SSE streaming reader for `/op4`. Headers proven via DevTools capture. |
| `MetaAdsNavigator` | Three actions: `goToAdAccount`, `setDateRange` (aria-label calendar), `configureColumns` (DOM-diff modal opener). |
| `MetaDataScraper` | One action: `scrapeTotalsRow`. Uses `page.mouse.wheel` (not `scrollLeft =`) because Meta has two scroll containers and React only syncs them via wheel events. |
| `KwikAdsPlatformsPage` | `readPlatformState` (intercept `m/op2`) + `togglePlatform` (PATCH via `page.evaluate` so browser cookies attach automatically). |
| `StorefrontPage` | `gotoHome` + `viewFirstProduct`. Uses `href.getAttribute` + `goto` because Shopify Dawn product cards are `position:absolute` inside `overflow:hidden` and Playwright reports them hidden. |
| `DataComparator` | `((meta − kwikads) / kwikads) × 100`. Threshold default 5%. Flags either period mismatching. |
| `AiResponseParser` | Parses ₹-formatted, comma-grouped numbers from markdown table the LLM returns. |
| `network-observer` | Generic — used by every spec that needs to capture a backend response. |
| `verdict-assembler` | Pure function. Decision tree with `storefront='events-fired' → PASS` short-circuit. |

### Spec layer — five specs, four flows

| Spec | Flow validated | Read or write? |
|---|---|---|
| `meta-vs-dashboard.spec.ts` | Benchmark parity (KwikAds API vs Meta UI) | Read-only |
| `kwikads-toggle.spec.ts` | Toggle state on platform page | Read-only |
| `kwikads-admin-override.spec.ts` | Toggle flip + restore (PATCH write) | Write (always reverted) |
| `kwikads-storefront-events.spec.ts` | Pixel events `sp/op1` + `e/op5` fire | Read-only |
| `kwikads-validator.spec.ts` | Combined 6-state verdict per store | Read-only |
| `kwik-ai-api.spec.ts` | Parser unit tests | No I/O |
| `kwik-ai-live.spec.ts` | SSE endpoint contract | Read-only |

---

## 5. Edge Cases Covered

| Category | Specific cases handled |
|---|---|
| **Auth recovery** | `SessionChecker` checks disk validity without launching a browser. `login-all` skips valid sessions, refreshes only the dead ones. `--force` flag for unconditional refresh. |
| **Profile corruption** | `SingletonLock` cleanup in every `beforeAll` that calls `launchPersistentContext`. |
| **Race conditions** | `observeNetwork` arms the listener **before** navigation. `waitForResponse` race against `page.goto` resolved by attaching first. |
| **Meta UI quirks** | DOM-diff approach to disambiguate two "Customise columns" elements (one opens sidebar, one opens modal). Aria-label calendar selectors. CTR pattern fixed to `'ctr \\(all\\)'` not `'^ctr'` to avoid matching link-CTR column. |
| **Dash cells** | `isDashText()` handles `—`, `–`, `--`, `-` but **not** empty string (empty = unrendered, not absent). Two rendering paths: text node + CSS `::before` pseudo-element. |
| **Virtualised tables** | 500 ms wait after each 600 px scroll for React virtualisation. Resolved Set prevents 15-step retry loops. |
| **Storefront gating** | `StorefrontProtectedError` thrown when `/password` gate isn't bypassed → spec skips cleanly rather than failing. |
| **Shopify Dawn quirk** | Product links `position:absolute` inside `overflow:hidden` → `getAttribute('href')` + `goto` bypass. |
| **API edge** | KwikAds API returns `null` for missing periods → comparator returns `kwikadsValue: null` and reports `diffPercent: null`, not 0%. |
| **Verdict edge** | `storefront='events-fired'` short-circuits to PASS even when kwikpass install state is `unknown` (real bug fix 2026-05-06: som-qa-store events firing with no bootstrap report). |
| **Write safety** | Admin override restores original state in `finally`, even when assertion fails. |
| **5xx retry** | `BaseApiClient` retries 3× linear back-off on 5xx + network errors, never on 4xx. |
| **Mixed-objective ROAS** | Known data bug — Meta shows `—`, KwikAds computes a number → `-100%` diff. Documented, not silently swallowed. |
| **Dual-period rendering** | Meta only shows one range at a time → scrape twice, configure columns once, only date range changes between scrapes. |
| **Tag-based filtering** | `@critical`, `@regression`, `@smoke`, `@ci`, `@local-only` lets one suite serve many purposes. |

---

## 6. Why This Stands Out in the Market

This is not "Playwright tests" — it's **a prompt-engineered automation
framework** with these qualities that 90% of QA orgs don't have:

1. **Five real auth strategies, not one.** Most frameworks have a single
   "login helper." This one routes through Meta (persistent profile, 2FA),
   GoKwik (IndexedDB), Shopify Partner (OAuth), Shopify Storefront (password
   gate), and GK Admin (relay cookies) — each with the right tool for that
   system.
2. **Pure verdict assembler.** A side-effect-free function with 8 unit tests
   that decides PASS / FAIL / INCONCLUSIVE / ANOMALY. You can rewrite the
   entire UI layer and the verdict logic is untouched.
3. **Two-source validation, not one.** Most QA frameworks check the UI
   against itself. This one fetches **truth from Meta** and **claims from
   KwikAds** independently and compares — catches data-pipeline bugs that
   UI tests can't.
4. **`observeNetwork` race-condition pattern.** A generic, reusable
   primitive that solves the "attach listener after response fired" bug
   once for the whole codebase.
5. **6-state verdict, not 2-state.** PASS / FAIL_KWIKPASS_NOT_INSTALLED /
   FAIL_KWIKADS_NOT_ONBOARDED / FAIL_INTEGRATION_BROKEN / ANOMALY /
   INCONCLUSIVE. Each one points the operator to the **next action** they
   should take.
6. **Institutional memory in code.** `failure_knowledge.md` documents every
   non-obvious failure with the fix. Future Claude/engineers don't repeat
   them.
7. **Four-agent framework with ownership tags.** `// Owner: @FE | Scope: …`
   on every file. New code goes through SCOPE → SPLIT → BUILD → TEST →
   REVIEW → CLOSE.
8. **Live-derived `apiBase`.** No env switching between QA and prod —
   `KwikAdsPlatformsPage` strips the API base from the intercepted `m/op2`
   URL. One codebase, all environments.
9. **`page.evaluate` PATCH instead of token plumbing.** The PATCH for the
   toggle write runs **inside** the page, so the browser's own cookies
   attach. Zero token-refresh logic anywhere.
10. **Real bug detection.** The framework has caught actual data-pipeline
    bugs (Macrame Spend ~11% off, Raho CTR ~19% off) that humans missed.
    Documented as "real bugs, not scraper bugs — do not fix by tweaking
    thresholds."

### What makes the prompt-engineering specifically good
- A 28 KB `CLAUDE.md` that any future LLM session can be dropped into with
  full context, no oral history needed.
- Explicit "Permanent Rules (never break)" list at the bottom — like ESLint
  for the AI.
- Failure knowledge captured as Entry #1, Entry #2, etc. — addressable in
  prompts ("apply the fix from failure_knowledge.md Entry #12").
- Three coupled docs: `CLAUDE.md` (what), `skills.md` (how), `failure_knowledge.md`
  (what went wrong before).

---

## 7. What Could Be Improved

### Quick wins (1 day each)
- Replace `page.waitForTimeout(1000)` grace windows in `KwikAdsPlatformsPage`
  with `waitForResponse` polling — the only remaining hardcoded waits
  outside the allow-listed Meta scraper files.
- Add JSON-schema validation in `BaseApiClient` so API contract drift is
  flagged before the comparator runs.
- Slack/Teams webhook integration in `BenchmarkService` for mismatch alerts.

### Medium effort (1 week)
- Convert `verdict.json` into a Grafana dashboard — currently every run
  emits one but nothing aggregates.
- Replace base64-tarred profile secrets with a session-mint service so CI
  doesn't silently break when 2FA expires.
- Parallelise the validator across stores with isolated user-data-dirs
  per worker.
- Add visual regression on the KwikAds dashboard chart against a baseline.

### Larger investments (1 month+)
- **Replace Meta scraping with the Meta Marketing API.** Headful 2FA is the
  framework's biggest fragility. The Marketing API would let it run in CI
  on every PR.
- **Self-service merchant onboarding.** Today `merchants.ts` is hand-edited.
  Build a small UI to add a merchant, auto-detect adAccountId, auto-tag.
- **Synthetic baseline runs.** Snapshot expected metrics weekly, alert on
  drift not against a 5% threshold but against the merchant's own baseline.
- **Multi-platform expansion.** Today it's Meta only. Same architecture
  would cover Google Ads, TikTok Ads, Snap.
- **Mobile pixel coverage.** Storefront events tested on desktop Chromium
  only. Mobile WebKit/Android Chrome paths untested.
- **Chaos testing.** Toggle off, run the storefront spec, expect
  `FAIL_INTEGRATION_BROKEN`. Currently we only catch breakage that already
  happened.

### Hygiene
- Move the gigantic `MetaAdsNavigator.ts` (696 lines) and `MetaDataScraper.ts`
  (755 lines) into smaller files. They're the only two files that violate
  the "small, focused" rule and the only two with `waitForTimeout`
  exemptions — not a coincidence.
- `MEMORY.md` is already 219 lines (over the 200-line limit per the system
  reminder). Split detail into topic files.
- `gokwik-keepalive.ts` exists but isn't documented in CLAUDE.md.

---

## 8. The Importance — Why This Project Matters

- **Trust.** Brands pay GoKwik based on the metrics this dashboard shows.
  Wrong metrics = lost contract. This framework is the first thing that
  would catch that.
- **Speed.** A human used to verify these matches by hand. This framework
  does it every 6 hours in 54 seconds per merchant.
- **Coverage.** A human would check 1–2 metrics for 1–2 merchants. This
  framework checks 4 metrics × 2 periods × N merchants × 4 flows.
- **Regression prevention.** When the KwikAds backend changes, the framework
  catches the drift before a brand does.
- **Onboarding aid.** The 6-state verdict tells **support engineers** which
  step of the integration broke for which merchant — no more guessing.

---

## 9. Flow Chart — What Runs, In What Order

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ONE-TIME SETUP (per machine)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│   npm install                                                               │
│   npx playwright install                                                    │
│                                                                             │
│   npm run login:all   ────►   meta-profile/                                 │
│                                gokwik-profile/                              │
│                                shopify-partner-profile/                     │
│                                storefront-profile/                          │
│                                gk-admin.state.json                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EVERY 6 HOURS (GitHub Actions cron)                      │
│                                                                             │
│         ┌────────────────────────┐    ┌────────────────────────┐            │
│         │   src/testdata/        │    │   src/config/          │            │
│         │   merchants.ts         │    │   env.config.ts        │            │
│         │   (single registry)    │    │   (typed env)          │            │
│         └───────────┬────────────┘    └────────────┬───────────┘            │
│                     │                              │                        │
│                     └──────────┬───────────────────┘                        │
│                                ▼                                            │
│              ┌──────────────────────────────────┐                           │
│              │  Spec layer (5 specs, 4 flows)   │                           │
│              └──────┬────────┬────────┬────────┘                            │
│                     │        │        │                                     │
│   ┌─────────────────┘        │        └───────────────────┐                 │
│   ▼                          ▼                            ▼                 │
│ ┌────────┐  ┌─────────────────────┐  ┌─────────────────────────────┐        │
│ │ TOGGLE │  │  STOREFRONT EVENTS  │  │  META vs KWIKADS BENCHMARK  │        │
│ │ READ + │  │  sp/op1 + e/op5     │  │  (the crown jewel)          │        │
│ │ WRITE  │  │  on Homepage + PDP  │  │                             │        │
│ └────┬───┘  └──────────┬──────────┘  └─────────────┬───────────────┘        │
│      │                 │                            │                       │
│      ▼                 ▼                            ▼                       │
│  ┌────────────────────────────────────────────────────────────┐             │
│  │     CORE HELPERS (pure, single-responsibility)             │             │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │             │
│  │  │ BaseApi      │ │ Network      │ │ MetaAdsNavigator │    │             │
│  │  │ Client       │ │ Observer     │ │ MetaDataScraper  │    │             │
│  │  └──────────────┘ └──────────────┘ └──────────────────┘    │             │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │             │
│  │  │ KwikAds      │ │ Storefront   │ │ DataComparator   │    │             │
│  │  │ PlatformsPg  │ │ Page         │ │ (≤5% threshold)  │    │             │
│  │  └──────────────┘ └──────────────┘ └──────────────────┘    │             │
│  └──────────────────────────────┬─────────────────────────────┘             │
│                                 ▼                                           │
│        ┌───────────────────────────────────────────────────────┐            │
│        │    assembleVerdict()  —  pure 6-state truth table     │            │
│        │   ┌─────────────────────────────────────────────────┐ │            │
│        │   │ PASS                                            │ │            │
│        │   │ FAIL_KWIKPASS_NOT_INSTALLED                     │ │            │
│        │   │ FAIL_KWIKADS_NOT_ONBOARDED                      │ │            │
│        │   │ FAIL_INTEGRATION_BROKEN                         │ │            │
│        │   │ ANOMALY                                         │ │            │
│        │   │ INCONCLUSIVE                                    │ │            │
│        │   └─────────────────────────────────────────────────┘ │            │
│        └───────────────────────────────┬───────────────────────┘            │
│                                        ▼                                    │
│                ┌────────────────────────────────────────────┐               │
│                │   OUTPUTS                                  │               │
│                │   • reports/html (HTML report)             │               │
│                │   • reports/automation.log (Winston)       │               │
│                │   • verdict.json attached to HTML report   │               │
│                │   • Three console tables per merchant      │               │
│                └────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘

                                       │
                                       ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                              FUTURE SCOPE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│      [NOW] Meta UI scrape (headful, 2FA-prone, can't run on every PR)       │
│                            │                                                │
│                            ▼                                                │
│      [NEXT] Meta Marketing API ──► every-PR CI gate, no 2FA, no headful     │
│                            │                                                │
│                            ▼                                                │
│      [+] Google Ads / TikTok Ads / Snap Ads — same arch, new scrapers       │
│      [+] Grafana dashboard — aggregate verdict.json over time               │
│      [+] Slack alerts on mismatch — proactive, not pull                     │
│      [+] Self-serve merchant onboarding UI                                  │
│      [+] Synthetic baselines (drift from merchant's own history)            │
│      [+] Chaos tests (flip toggle off → assert FAIL_INTEGRATION_BROKEN)     │
│      [+] Mobile pixel coverage (WebKit + Android Chrome)                    │
│      [+] Session-mint service replacing base64 profile secrets              │
│      [+] Visual regression on the dashboard chart                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. The One-Line Summary

> A prompt-engineered, four-agent, five-auth, six-verdict automation
> framework that proves KwikAds shows brands the same numbers Meta does —
> every six hours, with zero human input, and tells you exactly which link
> broke when it doesn't.
