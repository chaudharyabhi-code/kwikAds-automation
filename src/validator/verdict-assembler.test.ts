// Owner: @SDET | Scope: KwikAds validator — verdict-assembler unit tests (7 cases)

import { test, expect } from '@playwright/test';
import { assembleVerdict, type VerdictInput } from './verdict-assembler';

function input(overrides: Partial<VerdictInput>): VerdictInput {
  return {
    kwikpass:   'installed',
    storefront: 'silent',
    onboarding: 'unknown',
    ...overrides,
  };
}

test.describe('assembleVerdict — 6-state truth table', () => {

  test('PASS — kwikpass installed, events fired', () => {
    const result = assembleVerdict(input({ storefront: 'events-fired', onboarding: 'unknown' }));
    expect(result.verdict).toBe('PASS');
  });

  test('FAIL_KWIKPASS_NOT_INSTALLED — kwikpass not-installed', () => {
    const result = assembleVerdict(input({ kwikpass: 'not-installed' }));
    expect(result.verdict).toBe('FAIL_KWIKPASS_NOT_INSTALLED');
  });

  test('FAIL_KWIKADS_NOT_ONBOARDED — installed, silent, not-onboarded', () => {
    const result = assembleVerdict(input({ onboarding: 'not-onboarded' }));
    expect(result.verdict).toBe('FAIL_KWIKADS_NOT_ONBOARDED');
  });

  test('FAIL_INTEGRATION_BROKEN — installed, silent, onboarded', () => {
    const result = assembleVerdict(input({ onboarding: 'onboarded' }));
    expect(result.verdict).toBe('FAIL_INTEGRATION_BROKEN');
  });

  test('ANOMALY — installed, silent, onboarding unknown', () => {
    const result = assembleVerdict(input({ onboarding: 'unknown' }));
    expect(result.verdict).toBe('ANOMALY');
  });

  test('INCONCLUSIVE — kwikpass state unknown, storefront silent', () => {
    const result = assembleVerdict(input({ kwikpass: 'unknown', storefront: 'silent' }));
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  test('PASS — storefront fired even when kwikpass bootstrap report missing', () => {
    // Real-world case (2026-05-06): som-qa-store had events-fired but no gkadmin:login entry.
    // Events firing is direct proof — must return PASS regardless of kwikpass state.
    const result = assembleVerdict(input({ kwikpass: 'unknown', storefront: 'events-fired' }));
    expect(result.verdict).toBe('PASS');
  });

  test('result carries input and rationale string', () => {
    const inp = input({ storefront: 'events-fired' });
    const result = assembleVerdict(inp);
    expect(result.input).toStrictEqual(inp);
    expect(typeof result.rationale).toBe('string');
    expect(result.rationale.length).toBeGreaterThan(0);
  });

});
