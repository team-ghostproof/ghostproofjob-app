const { test, expect } = require('@playwright/test');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — AUTHENTICATED smoke (F-TEST signed-in harness).

   Runs in the 'authed' project, which restores the storage state saved by
   tests/auth.setup.js (Firebase session lives in IndexedDB). Self-skips when
   GPJ_TEST_PASSWORD isn't configured, so unconfigured environments stay green.

   Keep these tests SHELL-level (session restores, app functional while
   authed). Feature-level authed tests belong next to the feature's quadrant
   matrix per the [STATE-COVERAGE] rule in CLAUDE.md §3.
   ─────────────────────────────────────────────────────────────────────────── */

test.skip(!(process.env.TEST_USER_PASSWORD || process.env.GPJ_TEST_PASSWORD), 'TEST_USER_PASSWORD not set — authenticated quadrant skipped');

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});

test('signed-in session restores from storage state', async ({ page }) => {
  await page.waitForFunction(() => window.fb && window.fb.current && !!window.fb.current(), null, { timeout: 20000 });
  const email = await page.evaluate(() => (window.fb.current() && window.fb.current().email) || '');
  expect(email.toLowerCase()).toBe((process.env.TEST_USER_EMAIL || process.env.GPJ_TEST_EMAIL || 'asosa@ghostproofjob.com').toLowerCase());
});

test('shell stays functional while authenticated', async ({ page }) => {
  await page.waitForFunction(() => window.fb && window.fb.current && !!window.fb.current(), null, { timeout: 20000 });
  const err = await page.evaluate(() => {
    try {
      if (window.switchView) { window.switchView('browse'); window.switchView('resume'); window.switchView('swipe'); }
      return '';
    } catch (e) { return String(e); }
  });
  expect(err).toBe('');
  // structural integrity holds in the signed-in DOM too
  const dupes = await page.evaluate(() => {
    const seen = {}, out = [];
    document.querySelectorAll('[id]').forEach((el) => { seen[el.id] = (seen[el.id] || 0) + 1; });
    for (const k in seen) if (seen[k] > 1) out.push(k + '×' + seen[k]);
    return out;
  });
  expect(dupes, 'duplicate ids: ' + dupes.join(', ')).toEqual([]);
});

test('[STATE-COVERAGE] Q2 authed: long descriptions render uncut while signed in', async ({ page }) => {
  await page.waitForFunction(() => window.fb && window.fb.current && !!window.fb.current(), null, { timeout: 20000 });
  const ok = await page.evaluate(() => {
    const long = 'word '.repeat(700).trim();
    const j = mapFirestoreJob({ title: 'T', company: 'Co', direct_apply_url: 'https://x.example/a', description: long });
    return j.desc.length > 3400 && !j.desc.includes('…');
  });
  expect(ok).toBe(true);
});
