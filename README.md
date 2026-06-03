# KwikAds Automation Framework

> Automated data integrity validation between Meta Ads Manager and the KwikAds benchmark dashboard.

---

## What This Does

KwikAds is a GoKwik product that connects D2C brand ad accounts on Meta (Facebook) to a centralised performance dashboard. Merchants rely on the KwikAds dashboard to make campaign budget and strategy decisions. If the numbers on the dashboard differ significantly from what Meta actually reports, merchants are making decisions based on wrong data.

This framework detects that problem automatically. It:

1. **Fetches** benchmark metrics (Spend, CPM, CTR, ROAS) from the KwikAds API for a given merchant and two date periods
2. **Scrapes** the same metrics directly from Meta Ads Manager using browser automation
3. **Compares** both sets of numbers and flags any metric that differs by more than 5%

The result is a structured pass/fail report per ad account, per metric, per period — delivered as a Playwright test result with a formatted terminal table.

---

## Known Bug Being Tracked

| Metric | KwikAds Shows | Meta Shows | Difference |
|--------|--------------|------------|------------|
| Spend  | ₹14,700      | ₹16,393.05 | **+11.5%** |
| CPM    | ₹119.02      | ₹131.45    | **+10.4%** |
| CTR    | 3.69%        | 3.79%      | +2.7% (within tolerance) |

Merchant: **Macrame Cords Pari** (`act_1247455895764678`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Test Framework | Playwright |
| HTTP Client | Axios (with retry) |
| Logger | Winston |
| Runtime | Node.js |

---

## Prerequisites

- Node.js 18+
- npm
- Playwright browsers (`npx playwright install`)
- Access to a Meta Ads account with the test ad accounts
- GoKwik VPN (for QA API access)

---

## Setup

**1. Install dependencies**
```bash
npm install
npx playwright install chromium
```

**2. Configure environment**

Create a `.env` file in the project root (never commit this):
```
API_BASE_URL=https://gkx.gokwik.co
KWIKADS_USERNAME=your-email@gokwik.co
KWIKADS_PASSWORD=your-password
META_EMAIL=your-meta-email@example.com
META_PASSWORD=your-meta-password
```

**3. Log into Meta (one-time)**
```bash
npm run meta:login
```
A Chrome window opens. Your email and password are filled automatically. Complete the 2FA prompt, and once Ads Manager loads, the session is saved automatically. This session lasts ~20 hours — you do not need to repeat it for every test run.

---

## Running Tests

```bash
# Run all tests
npm test

# Run with visible browser (useful for debugging)
npm run test:headed

# Run a single spec file
npx playwright test src/data-validation/specs/meta-vs-dashboard.spec.ts

# Open the HTML test report after a run
npm run report
```

---

## How It Works — Step by Step

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BenchmarkService.run()                           │
│                                                                         │
│  ┌──────────────┐     POST /ka/api/v1/bm/op1      ┌─────────────────┐  │
│  │  Test Spec   │ ──────────────────────────────► │  KwikAds API    │  │
│  │              │ ◄────────────────────────────── │  (gkx.gokwik.co)│  │
│  └──────┬───────┘   { before, after } per metric  └─────────────────┘  │
│         │                                                               │
│         │  ┌─────────────────────────────────────────────────────┐     │
│         │  │              Meta Ads Manager (Browser)             │     │
│         ├─►│                                                     │     │
│         │  │  1. goToAdAccount(act_XXXX)                        │     │
│         │  │  2. configureColumns()  ← tick CPM/CTR/ROAS/Spend  │     │
│         │  │  3. setDateRange(periodOne) → scrapeTotalsRow()     │     │
│         │  │  4. setDateRange(periodTwo) → scrapeTotalsRow()     │     │
│         │  └──────────────────────────┬──────────────────────────┘     │
│         │                             │ MetaMetrics × 2 periods        │
│         │                             ▼                                 │
│         │  ┌──────────────────────────────────────────────────────┐    │
│         └─►│               DataComparator.compare()               │    │
│            │                                                      │    │
│            │  Per metric × per period:                            │    │
│            │  diffPercent = ((meta - kwikads) / kwikads) × 100   │    │
│            │  isMismatch  = |diffPercent| > threshold (5%)        │    │
│            └──────────────────────────┬───────────────────────────┘    │
│                                       │ ComparisonReport               │
└───────────────────────────────────────┼────────────────────────────────┘
                                        ▼
                              expect(hasMismatch).toBe(false)
```

---

## Architecture

```
src/
├── config/
│   └── env.config.ts               ← all credentials + URLs in one typed object
│
├── core/
│   ├── api-client/
│   │   └── BaseApiClient.ts        ← Axios wrapper, retry on 5xx, typed request/response
│   │
│   ├── meta-scraper/
│   │   ├── MetaSessionStore.ts     ← save/load/expire meta.state.json
│   │   ├── MetaAuthManager.ts      ← getAuthenticatedContext(): session or interactive 2FA
│   │   ├── MetaAdsNavigator.ts     ← navigate ad account, set date, configure columns
│   │   └── MetaDataScraper.ts      ← scrape totals row → { spend, cpm, ctr, roas }
│   │
│   ├── data-engine/
│   │   └── DataComparator.ts       ← compare(periodOne, periodTwo, apiAccount) → report
│   │
│   ├── services/
│   │   └── BenchmarkService.ts     ← orchestrator: API + scrape × 2 + compare
│   │
│   └── utils/
│       └── logger.ts               ← Winston: console + reports/automation.log
│
├── data-validation/
│   └── specs/
│       └── meta-vs-dashboard.spec.ts  ← Playwright test, one case per merchant
│
└── scripts/
    └── meta-login.ts               ← one-time interactive login script
```

---

## Test Output

When a mismatch is detected, the terminal prints a structured table:

```
──────────────────────────────────────────────────────────────────────────────────────────
  FAIL — Macrame Cords Pari: mismatch in [SPEND(before/after), CPM(before/after)] (threshold: 5%)
──────────────────────────────────────────────────────────────────────────────────────────
  Metric   Period   Meta           KwikAds        Diff %     Status
  ────────────────────────────────────────────────────────────────────────────────────────
  SPEND    BEFORE   15800.00       14200          11.27%     ✗ FAIL
  SPEND    AFTER    16393.05       14700          11.52%     ✗ FAIL
  CPM      BEFORE   128.00         115.50         10.82%     ✗ FAIL
  CPM      AFTER    131.45         119.02         10.44%     ✗ FAIL
  CTR      BEFORE   3.65           3.60           1.39%      ✓ PASS
  CTR      AFTER    3.79           3.69           2.71%      ✓ PASS
  ROAS     BEFORE   1.15           1.13           1.77%      ✓ PASS
  ROAS     AFTER    1.20           1.18           1.69%      ✓ PASS
──────────────────────────────────────────────────────────────────────────────────────────
```

Logs are also saved to `reports/automation.log` for every run.

---

## Test Merchants

| Merchant | ID | Ad Account |
|---|---|---|
| Macrame Cords Pari | `19g6im7uxama1` | `act_1247455895764678` |
| New Ads Test | `19fan7mwgshu` | `act_3781545225208934` |

To add a new merchant, add one entry to the `MERCHANTS` array in `meta-vs-dashboard.spec.ts`.

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| Headful browser for Meta login | Meta actively blocks headless browser logins |
| Session file with 20h expiry | Avoids repeated 2FA while handling natural session expiration |
| Scrape totals row, not individual campaigns | Totals row = account-level aggregate, same as what KwikAds displays |
| Dual-period scraping (Before + After) | Validates both periods shown on the dashboard, not just the current one |
| 5% mismatch threshold | Eliminates noise from rounding and attribution lag while catching real bugs |
| Retry on 5xx only | 4xx errors (bad auth, bad request) won't resolve with a retry — fail fast |
| `try/finally` for browser cleanup | Guarantees Chrome closes even if a step throws mid-run |

---

## Gitignored Files

```
.env               ← credentials
*.state.json       ← saved Meta browser sessions
reports/           ← test results and logs
test-results/      ← Playwright artifacts
playwright-report/ ← HTML report
dist/              ← compiled output
```
