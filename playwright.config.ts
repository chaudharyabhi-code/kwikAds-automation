import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load .env into process.env BEFORE any spec is collected so specs can
// read KWIKADS_STOREFRONT_PASSWORD, KWIK_AI_BASE_URL, etc. directly.
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Show all logs in console during test runs (info + warn + error).
// Full log also written to reports/automation.log (file transport is unaffected).
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'info';

export default defineConfig({
  testDir: './src',
  timeout:  90_000,
  retries:  1,
  // workers:1 — all browser specs use persistent Chromium profiles which require
  // single-process access (Chrome SingletonLock). Override per-run with --workers=N.
  workers:  1,
  reporter: [['html', { outputFolder: 'reports/html', open: 'never' }], ['list']],

  projects: [
    // ── CI pipeline ──────────────────────────────────────────────────────────
    // Excludes meta-vs-dashboard (headful+2FA, not CI-safe).
    // Only runs tests tagged @ci.
    // Usage: npx playwright test --project=ci
    {
      name:       'ci',
      testMatch:  ['**/*.spec.ts'],
      testIgnore: ['**/meta-vs-dashboard.spec.ts'],
      grep:       /@ci/,
    },

    // ── Local: combined 3-step KwikAds validator ─────────────────────────────
    // Runs the full kwikpass → storefront → onboarding verdict flow.
    // Usage: npx playwright test --project=kwikads-validator
    {
      name:      'kwikads-validator',
      testMatch: ['**/kwikads-validator.spec.ts'],
    },

    // ── Local: pure unit tests (no browser, no network) ─────────────────────
    // Usage: npx playwright test --project=kwikads-validator-unit
    {
      name:      'kwikads-validator-unit',
      testMatch: ['**/verdict-assembler.test.ts'],
    },

    // ── Local: Meta vs KwikAds benchmark (headed, requires human 2FA) ────────
    // Never runs in CI — Meta blocks headless and requires Google 2FA.
    // Usage: npx playwright test --project=meta
    {
      name:      'meta',
      testMatch: ['**/meta-vs-dashboard.spec.ts'],
      grep:      /@local-only/,
    },

    // ── Local: default catch-all (everything except validator + unit) ─────────
    // Usage: npx playwright test  (no --project flag)
    {
      name:      'default',
      testMatch: ['**/*.spec.ts'],
      testIgnore: [
        '**/kwikads-validator.spec.ts',
        '**/verdict-assembler.test.ts',
      ],
    },
  ],
});
