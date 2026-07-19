const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — AUTHED-RECRUITER quadrant (R1). Runs in the 'recruiter'
   project, restoring the session saved by recruiter.setup.js. Keep these
   SHELL-level; feature specs land per sprint.

   v130 SKIP GUARD: skip when recruiter.setup did NOT establish a real session —
   read at RUNTIME (in beforeEach, after the setup dependency has run) from the
   saved auth file, NOT from the env var. The old top-level env check evaluated
   at COLLECTION time and, once the secret was wired into CI, let these run
   against an EMPTY session when the login failed → red suite. Tying the skip to
   the actual saved session (empty = skip) is the correct, robust condition.
   ─────────────────────────────────────────────────────────────────────────── */

const AUTH_FILE = path.join(__dirname, '..', 'playwright', '.auth', 'recruiter.json');
function hasRecruiterSession() {
  try {
    const s = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return !!(s && ((s.origins && s.origins.length) || (s.cookies && s.cookies.length)));
  } catch (e) { return false; }
}

test.beforeEach(async ({ page }) => {
  test.skip(!hasRecruiterSession(), 'no recruiter session established (password unset or login failed) — recruiter quadrant skipped');
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});

test('recruiter session restores and the Employer view is reachable', async ({ page }) => {
  await page.waitForFunction(() => !!window._recruiter, null, { timeout: 20000 });
  await page.evaluate(() => window.openEmployer());
  await expect(page.locator('#view-employer')).toHaveClass(/active/);
});
