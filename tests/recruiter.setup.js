const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — RECRUITER auth setup (R1). Mirrors auth.setup.js but signs in
   a test RECRUITER through the new employer login route, and saves the session
   (incl. IndexedDB, where Firebase Auth persists) to playwright/.auth/recruiter.json.

   Credentials from env (NEVER hardcode — public repo):
     RECRUITER_TEST_EMAIL     (a corporate-domain email on a real test recruiter)
     GPJ_RECRUITER_TEST_PASSWORD  (required; set locally or as a GitHub secret)

   Without the password this writes an EMPTY state and passes, so the recruiter
   specs self-skip — forks/PRs without the secret stay green.
   ─────────────────────────────────────────────────────────────────────────── */

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'recruiter.json');
const EMAIL = process.env.RECRUITER_TEST_EMAIL || 'recruiter@ghostproofjob.com';
const PASSWORD = process.env.GPJ_RECRUITER_TEST_PASSWORD || '';

test('authenticate test recruiter and save storage state', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (!PASSWORD) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    console.log('[recruiter.setup] GPJ_RECRUITER_TEST_PASSWORD not set — empty state; recruiter tests self-skip.');
    return;
  }
  await page.addInitScript(() => { window._gpjReloaded = true; });   // neutralize SW auto-reload (see auth.setup.js)
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.fb && typeof window.fb.signIn === 'function' && typeof window.openRecruiterAuth === 'function', null, { timeout: 30000 });

  // open the employer login route
  await page.evaluate(() => { window.openRecruiterAuth(); if (window._recruiterAuthMode === 'signup') window.toggleRecruiterAuthMode(); });
  await page.waitForSelector('#recruiter-auth-modal.open', { timeout: 10000 });
  await page.fill('#rec-email', EMAIL);
  await page.fill('#rec-pass', PASSWORD);
  await page.click('#rec-primary-btn');

  // recruiter session established (window._recruiter set by recruiterLogin)
  await page.waitForFunction(() => !!window._recruiter, null, { timeout: 20000 })
    .catch(() => { throw new Error('[recruiter.setup] login did not establish a recruiter session for ' + EMAIL + ' — check the account is an employer + GPJ_RECRUITER_TEST_PASSWORD.'); });
  await page.waitForTimeout(1200);

  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
  console.log('[recruiter.setup] signed in test recruiter ' + EMAIL + ' — storage state saved.');
});
