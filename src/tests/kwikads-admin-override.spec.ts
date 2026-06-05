// Owner: @SDET | Scope: KwikAds /kwikads/platforms — admin toggle write validation
//
// Per merchant: read current toggle state, flip it via PATCH m/op6/<id>,
// reload and re-read to confirm the change landed, then restore original state.
//
// Auth: gokwik-profile/ (same persistent profile as kwikads-toggle.spec.ts).
// Serial mode required — single persistent context, one process.
//
// Safe to run in any environment: the finally-block restore always runs,
// even when the assertion fails, so the toggle is never left in a wrong state.

import fs   from 'fs';
import path from 'path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { KWIKADS_TOGGLE_MERCHANTS } from '../testdata/merchants';
import { KwikAdsPlatformsPage }     from '../pages/KwikAdsPlatformsPage';
import { GokwikSessionStore }       from '../auth/GokwikSessionStore';

const TABLE_W = 92;

test.describe('KwikAds — Admin Toggle Override', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: BrowserContext;

  test.beforeAll(async () => {
    if (!GokwikSessionStore.hasProfile()) {
      throw new Error(
        `gokwik-profile/ not found at ${GokwikSessionStore.getProfileDir()}. ` +
        'Run: npm run gokwik:login',
      );
    }
    // Chrome leaves a SingletonLock when a previous run exits abnormally.
    // Remove it so launchPersistentContext doesn't fail with "profile in use".
    try { fs.unlinkSync(path.join(GokwikSessionStore.getProfileDir(), 'SingletonLock')); } catch { /* not present */ }
    ctx = await chromium.launchPersistentContext(
      GokwikSessionStore.getProfileDir(),
      { headless: false },
    );
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => { /* ignore */ });
  });

  for (const merchant of KWIKADS_TOGGLE_MERCHANTS) {
    test(`@smoke @kwikads-admin @ci [${merchant.name}] toggle flips and restores`, async () => {
      test.setTimeout(90_000);

      const page = ctx.pages()[0] ?? await ctx.newPage();

      try {
        const platforms = new KwikAdsPlatformsPage(page);

        // ── Step 1: Read current state ────────────────────────────────────
        const before = await platforms.readPlatformState(merchant.adAccountId);

        if (before.state === 'BLOCKED' || before.state === 'META_NOT_ONBOARDED') {
          printRow('⊘ SKIP', merchant.name, before.state, '—', '—');
          test.skip(true, `${merchant.name}: ${before.state} — toggle not accessible`);
          return;
        }

        const platform = before.platform!;
        const originalActive  = platform.isEventTrackingEnabled;
        const targetActive    = !originalActive;

        printHeader(merchant.name, merchant.adAccountId, platform.id);
        printRow('READ', merchant.name, before.state, String(originalActive), '—');

        // ── Step 2: Flip the toggle ───────────────────────────────────────
        const patchedActive = await platforms.togglePlatform(
          platform.id,
          targetActive,
          before.apiBase,
          merchant.merchantId,
        );
        printRow('PATCH', merchant.name, '—', String(originalActive), String(patchedActive));

        // ── Step 3: Reload and re-read (authoritative confirmation) ───────
        const after = await platforms.readPlatformState(merchant.adAccountId);
        const observedActive = after.platform?.isEventTrackingEnabled ?? patchedActive;
        printRow('RE-READ', merchant.name, after.state, String(originalActive), String(observedActive));

        expect(
          observedActive,
          `Toggle should now be ${targetActive} for ${merchant.name}`,
        ).toBe(targetActive);

        // ── Step 4: Restore original state ───────────────────────────────
        await platforms.togglePlatform(platform.id, originalActive, before.apiBase, merchant.merchantId);
        const restored = await platforms.readPlatformState(merchant.adAccountId);
        const restoredActive = restored.platform?.isEventTrackingEnabled ?? originalActive;
        printRow('RESTORE', merchant.name, restored.state, String(originalActive), String(restoredActive));

        expect(
          restoredActive,
          `Toggle should be restored to ${originalActive} for ${merchant.name}`,
        ).toBe(originalActive);

        printFooter(TABLE_W);
      } finally {
        await page.close().catch(() => { /* ignore */ });
      }
    });
  }
});

// ── Print helpers ─────────────────────────────────────────────────────────────

function printHeader(name: string, adAccountId: string, id: string): void {
  const line = '═'.repeat(TABLE_W);
  console.log(`\n╔${line}╗`);
  console.log(`║  ADMIN TOGGLE OVERRIDE  |  ${name}  |  id=${id}  |  ${adAccountId}`.padEnd(TABLE_W + 1) + '║');
  console.log(`╠${line}╣`);
  console.log(
    `║  ${'Step'.padEnd(8)}  ${'State'.padEnd(22)}  ${'Before'.padEnd(8)}  ${'After'.padEnd(8)}  ║`,
  );
  console.log(`║  ${'─'.repeat(TABLE_W - 4)}  ║`);
}

function printRow(step: string, _name: string, state: string, before: string, after: string): void {
  console.log(
    `║  ${step.padEnd(8)}  ${state.padEnd(22)}  ${before.padEnd(8)}  ${after.padEnd(8)}  ║`,
  );
}

function printFooter(w: number): void {
  console.log(`╚${'═'.repeat(w)}╝\n`);
}
