const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — AUTH SETUP (F-TEST signed-in harness, [STATE-COVERAGE] rule).

   Signs in ONCE with the test account through the app's real Firebase path
   (window.fb.signIn — the same call the auth modal makes) and saves the
   browser storage state, INCLUDING IndexedDB, to playwright/.auth/user.json.
   Firebase Auth persists sessions in IndexedDB (not localStorage), so the
   indexedDB:true flag (Playwright ≥1.51) is what makes restore actually work.

   Credentials come from env — NEVER hardcode them (this repo is public):
     GPJ_TEST_EMAIL     (defaults to the test account)
     GPJ_TEST_PASSWORD  (required to authenticate; set it locally or as a
                         GitHub Actions secret)

   Without GPJ_TEST_PASSWORD this writes an EMPTY storage state and passes,
   so the suite stays green — the authed project then self-skips. That keeps
   forks/PRs (which never receive secrets) from failing CI.
   ─────────────────────────────────────────────────────────────────────────── */

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const EMAIL = process.env.GPJ_TEST_EMAIL || 'asosa@ghostproofjob.com';
const PASSWORD = process.env.GPJ_TEST_PASSWORD || '';

test('authenticate test account and save storage state', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (!PASSWORD) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    console.log('[auth.setup] GPJ_TEST_PASSWORD not set — wrote empty state; authed tests will self-skip.');
    return;
  }

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  // wait for the Firebase module script to expose fb (it degrades to null on error)
  await page.waitForFunction(() => window.fb && typeof window.fb.signIn === 'function', null, { timeout: 20000 });

  const err = await page.evaluate(async ({ email, password }) => {
    try { await window.fb.signIn(email, password); return ''; }
    catch (e) { return (e && (e.code || e.message)) || 'sign-in failed'; }
  }, { email: EMAIL, password: PASSWORD });
  if (err) throw new Error('[auth.setup] Firebase sign-in failed for ' + EMAIL + ': ' + err + ' — check the GPJ_TEST_PASSWORD secret.');

  await page.waitForFunction(() => window.fb && window.fb.current && !!window.fb.current(), null, { timeout: 20000 });
  // small settle so onAuthStateChanged listeners finish persisting the session
  await page.waitForTimeout(1500);

  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
  console.log('[auth.setup] signed in as ' + EMAIL + ' — storage state (incl. IndexedDB) saved.');
});
