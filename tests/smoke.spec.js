const { test, expect } = require('@playwright/test');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — SMOKE / REGRESSION GUARD (browser-level).

   Standard (per project rule): every fix/feature is INSERT-ONLY and must not
   break an existing feature, flow, or the UI. These tests are the automated
   backstop for that promise. They run in CI (free) on every push.

   They intentionally do NOT require Firebase auth or live job data — they load
   the deployed shell and assert the things a regression would break:
     1) the app renders (no white screen / fatal parse error),
     2) every core function the UI calls via onclick still EXISTS as a global
        (catches a push that removes/renames a function — the #1 regression),
     3) the nav works and switching views doesn't throw,
     4) no duplicate DOM ids (structural integrity of the single-file build),
     5) the Browse + Swipe surfaces mount.

   If a test is flaky on the first CI run (e.g. timing), bump the waitForTimeout
   rather than deleting the assertion.
   ─────────────────────────────────────────────────────────────────────────── */

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  // Let inline scripts run. Firebase may error without prod config/domain — that
  // is expected in CI and the app is built to degrade, so we don't fail on it.
  await page.waitForTimeout(2000);
});

test('shell renders — no white screen', async ({ page }) => {
  await expect(page.locator('body')).toContainText('GhostProofJob');
});

test('core functions still exist (regression guard)', async ({ page }) => {
  const required = [
    'switchView', 'renderBrowse', 'ensureBrowsePool', 'refreshBrowse',
    'advanceQueue', 'reloadDeckFromQueue', 'recordSwipe', 'seenJobKeys', 'jobKey',
    'reportExpired', 'applyMatch2Job', 'searchAllJobsForKeyword', 'adminResetMyCards',
    'mapFirestoreJob', 'computeMatch', 'applyTabDone', 'sandboxDone',
    // batch fixes (cover letter, saved jobs/cos, notifications, phone toggle)
    'buildLetterText', 'tailorCoverLetter', 'openSavedJobCard', 'openSavedJobs',
    'openSavedCompanies', 'openBrowseExpanded', 'notifOn', 'maybeAlertNewMatches',
    'togglePhoneOnResume',
  ];
  const missing = await page.evaluate(
    (names) => names.filter((n) => typeof window[n] !== 'function'),
    required
  );
  expect(missing, 'missing core functions: ' + missing.join(', ')).toEqual([]);
});

test('nav tabs present and switching does not throw', async ({ page }) => {
  for (const v of ['browse', 'resume', 'swipe']) {
    await expect(page.locator(`.nav-tab[data-view="${v}"]`)).toHaveCount(1);
  }
  const err = await page.evaluate(() => {
    try {
      if (window.switchView) { window.switchView('browse'); window.switchView('resume'); window.switchView('swipe'); }
      return '';
    } catch (e) { return String(e); }
  });
  expect(err).toBe('');
});

test('no duplicate DOM ids', async ({ page }) => {
  const dupes = await page.evaluate(() => {
    const seen = {}, out = [];
    document.querySelectorAll('[id]').forEach((el) => { seen[el.id] = (seen[el.id] || 0) + 1; });
    for (const k in seen) if (seen[k] > 1) out.push(k + '×' + seen[k]);
    return out;
  });
  expect(dupes, 'duplicate ids: ' + dupes.join(', ')).toEqual([]);
});

test('Browse filter controls mount', async ({ page }) => {
  await page.evaluate(() => window.switchView && window.switchView('browse'));
  for (const id of ['f-keyword', 'f-industry', 'f-style', 'f-type', 'f-lvl', 'f-livesort', 'f-salary', 'f-dist']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
});

test('Swipe deck shells mount', async ({ page }) => {
  for (const id of ['job-card-0', 'job-card-1', 'job-card-2']) {
    await expect(page.locator('#' + id)).toHaveCount(1);
  }
});
