# Spec Notes — Questions, Doubts & Known Issues

This file tracks open questions, known limitations, and findings per spec file.
Updated as we explore and test each spec.

---

## kwikads-toggle.spec.ts

**File:** `src/tests/kwikads-toggle.spec.ts`

### What it does
Opens the GK Dashboard → `/kwikads/platforms` → intercepts the `m/op2` API response →
reads `isActive` field for the merchant → asserts it is `true`.

One test is generated per merchant tagged `@kwikads-toggle` in `src/testdata/merchants.ts`.

### What "PASS" means
Event tracking toggle is ON for that merchant. Meta pixel events are actively flowing.

### What "FAIL" means
Toggle is OFF. KwikAds has stopped sending events to Meta for that merchant.
Ad campaign optimisation is broken.

---

### ✅ Works
- `qa.gokwik (prnab-test)` — passes consistently
- Session reuse via `gokwik-profile/` works without re-login

### ❌ Known Issues

**1. Adding new merchants breaks the test**

When a new merchant is added to `@kwikads-toggle` in merchants.ts, the test fails with:
```
Error: m/op2 returned no row matching adAccountId=<id>.
The dashboard session may be scoped to a different merchant.
```

**Root cause:**
The `gokwik-profile/` session is logged in as one specific GK user account.
That account's dashboard is scoped to ONE merchant.
When the test tries to check a second merchant, the `m/op2` API still returns
the first merchant's data — not the new one.

**What is missing:**
The test has no merchant-switching logic. There is no code to:
- Open a merchant search/selector on the platforms page
- Switch the dashboard context to a different merchant
- Wait for `m/op2` to reload with the new merchant's data

**Fix needed (not yet implemented):**
Add a merchant selector step in `KwikAdsPlatformsPage.readPlatformState()` before
intercepting `m/op2`. Something like:
```
search for merchant by name/ID on the dashboard
→ select it
→ wait for m/op2 to reload
→ then read isActive
```

**2. `som-qa-store` is NOT a valid toggle merchant**

`som-qa-store` has `adAccountId: ''` (empty) — it has no Meta Ad Account.
Adding `@kwikads-toggle` to it causes an immediate error.
Only merchants with a real `adAccountId: 'act_...'` should have this tag.

**Rule:** A merchant needs ALL THREE to be tagged `@kwikads-toggle`:
- Has a real Meta Ad Account ID (`adAccountId: 'act_...'`)
- KwikAds is integrated for them on the GK Dashboard
- GK dashboard session can reach their platforms page

---

### Open Questions
- [ ] How does the GK dashboard switch between merchants? Is there a search bar / dropdown?
- [ ] Does the `gokwik-profile/` session have access to ALL merchants or just one?
- [ ] Should this test run per-merchant with separate sessions, or can one session switch merchants?

---

## kwikads-admin-override.spec.ts

**File:** `src/tests/kwikads-admin-override.spec.ts`

### What it does
Reads the current toggle state → flips it via `PATCH /m/op6/<id>` → reloads and
verifies the change landed → restores original state in a `finally` block.

> Non-destructive: always restores. Safe to run anytime.

### Open Questions / Doubts
- [ ] To be explored

---

## kwikads-storefront-events.spec.ts

**File:** `src/tests/kwikads-storefront-events.spec.ts`

### What it does
Opens the Shopify storefront for each merchant → navigates Homepage → clicks first product (PDP) →
captures `sp/op1` and `e/op5` pixel events fired during each action →
asserts at least one event was captured per action.

### Open Questions / Doubts
- [ ] To be explored

---

## kwikads-validator.spec.ts

**File:** `src/tests/kwikads-validator.spec.ts`

### What it does
3-step combined check per store:
1. Read Kwikpass install state from `reports/gkadmin-bootstrap.json` (disk)
2. Drive storefront — check if `sp/op1` + `e/op5` events fire
3. If events are silent + Kwikpass is installed → check platform toggle on GK Dashboard

Returns one of 6 verdicts combining all three states.

### Open Questions / Doubts
- [ ] To be explored

---

## meta-vs-dashboard.spec.ts

**File:** `src/tests/meta-vs-dashboard.spec.ts`

### What it does
Fetches benchmark metrics from KwikAds API → scrapes the same metrics from Meta Ads Manager →
compares them — flags mismatches beyond 5%.

> Currently commented out. Requires Meta session + headed browser (Meta blocks headless).

### Known Data Bugs (pipeline issues, not test bugs)
| Merchant | Metric | Issue |
|---|---|---|
| Macrame Cords Pari | Spend | ~11% off |
| Macrame Cords Pari | ROAS | Meta shows `—` (mixed objectives) |
| Raho Saada | CTR | ~19-20% off (all-clicks vs link-clicks formula) |

### Open Questions / Doubts
- [ ] To be explored
