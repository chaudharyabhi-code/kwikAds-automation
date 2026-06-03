// Owner: @BE | Scope: KwikAds validator — 6-state verdict assembler (pure function, no Playwright deps)

/**
 * Possible outcomes for one merchant validation run.
 *
 * Decision tree (in order):
 *   1. storefront fired                          → PASS
 *      (events firing is direct proof — kwikpass install verification is secondary)
 *   2. kwikpass NOT installed                    → FAIL_KWIKPASS_NOT_INSTALLED
 *   3. kwikpass state unknown                    → INCONCLUSIVE
 *      (storefront silent + can't verify kwikpass — run gkadmin:login)
 *   4. kwikpass installed, silent,
 *      platform NOT onboarded                   → FAIL_KWIKADS_NOT_ONBOARDED
 *   5. kwikpass installed, silent,
 *      platform onboarded                        → FAIL_INTEGRATION_BROKEN
 *   6. kwikpass installed, silent,
 *      platform state unknown                    → ANOMALY
 */
export type Verdict =
  | 'PASS'
  | 'FAIL_KWIKPASS_NOT_INSTALLED'
  | 'FAIL_KWIKADS_NOT_ONBOARDED'
  | 'FAIL_INTEGRATION_BROKEN'
  | 'ANOMALY'
  | 'INCONCLUSIVE';

export type KwikpassState  = 'installed' | 'not-installed' | 'unknown';
export type StorefrontState = 'events-fired' | 'silent';
export type OnboardingState = 'onboarded' | 'not-onboarded' | 'unknown';

export interface VerdictInput {
  kwikpass:   KwikpassState;
  storefront: StorefrontState;
  /**
   * Only consulted when kwikpass=installed AND storefront=silent.
   * Supply 'unknown' when the platform check was skipped or errored.
   */
  onboarding: OnboardingState;
}

export interface VerdictResult {
  verdict:   Verdict;
  input:     VerdictInput;
  rationale: string;
}

/**
 * Pure, deterministic verdict function. No side effects, no Playwright imports.
 *
 * Implements the 6-state truth table from the harp.md plan verbatim.
 */
export function assembleVerdict(input: VerdictInput): VerdictResult {
  const { kwikpass, storefront, onboarding } = input;

  // Row 1 — storefront events fired → integration is working.
  // This is the highest-priority signal: firing events proves kwikpass is installed
  // and the pipeline is live, regardless of whether we have a bootstrap report.
  // Checking this BEFORE kwikpass state prevents a false INCONCLUSIVE when
  // gkadmin:login hasn't been run for a store but events are already firing
  // (confirmed real-world failure 2026-05-06: som-qa-store, events-fired, kwikpass=unknown).
  if (storefront === 'events-fired') {
    return {
      verdict:   'PASS',
      input,
      rationale: 'Storefront pixel events fired — integration is working.',
    };
  }

  // From here storefront === 'silent'

  // Row 2 — kwikpass definitely not installed
  if (kwikpass === 'not-installed') {
    return {
      verdict:   'FAIL_KWIKPASS_NOT_INSTALLED',
      input,
      rationale: 'Kwikpass app is not installed on the Shopify store.',
    };
  }

  // Row 3 — kwikpass state unknown and storefront silent → can't determine root cause
  if (kwikpass === 'unknown') {
    return {
      verdict:   'INCONCLUSIVE',
      input,
      rationale: 'Storefront silent and Kwikpass install state is unknown — run `npm run gkadmin:login` for this store first.',
    };
  }

  // From here kwikpass === 'installed' and storefront === 'silent'

  // storefront === 'silent' — differentiate by onboarding state
  if (onboarding === 'not-onboarded') {
    return {
      verdict:   'FAIL_KWIKADS_NOT_ONBOARDED',
      input,
      rationale: 'Kwikpass installed but storefront silent. KwikAds platform not onboarded (Get Started CTA visible).',
    };
  }

  if (onboarding === 'onboarded') {
    return {
      verdict:   'FAIL_INTEGRATION_BROKEN',
      input,
      rationale: 'Kwikpass installed and KwikAds onboarded, but storefront fired no events. Integration pipeline broken.',
    };
  }

  // onboarding === 'unknown'
  return {
    verdict:   'ANOMALY',
    input,
    rationale: 'Kwikpass installed, storefront silent, platform onboarding state could not be determined.',
  };
}
