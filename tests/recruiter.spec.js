const { test, expect } = require('@playwright/test');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — AUTHED-RECRUITER quadrant (R1). Runs in the 'recruiter'
   project, restoring the session saved by recruiter.setup.js. Self-skips when
   GPJ_RECRUITER_TEST_PASSWORD isn't configured, so unconfigured environments
   stay green. Keep these SHELL-level; feature specs land per sprint.
   ─────────────────────────────────────────────────────────────────────────── */

test.skip(!process.env.GPJ_RECRUITER_TEST_PASSWORD, 'GPJ_RECRUITER_TEST_PASSWORD not set — recruiter quadrant skipped');

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});

test('recruiter session restores and the Employer view is reachable', async ({ page }) => {
  await page.waitForFunction(() => !!window._recruiter, null, { timeout: 20000 });
  await page.evaluate(() => window.openEmployer());
  await expect(page.locator('#view-employer')).toHaveClass(/active/);
});
