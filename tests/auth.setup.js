const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — AUTH SETUP (F-TEST signed-in harness, [STATE-COVERAGE] rule).

   Drives the app's REAL login UI: opens the auth modal in login mode, fills
   #auth-email / #auth-pass, clicks the sign-in button (#auth-primary-btn →
   authPrimary → fb.signIn), then waits for the Firebase Auth session to settle
   in IndexedDB before saving the storage state (incl. IndexedDB — Firebase
   does NOT persist sessions in localStorage) to playwright/.auth/user.json.
   Requires Playwright ≥1.51 for storageState({ indexedDB: true }).

   Credentials come from env — NEVER hardcode them (this repo is public):
     TEST_USER_EMAIL     (defaults to the test account)
     TEST_USER_PASSWORD  (required to authenticate — set locally or as a
                          GitHub Actions secret; see .env.example)
   (GPJ_TEST_EMAIL / GPJ_TEST_PASSWORD are honored as fallbacks.)

   Without a password this writes an EMPTY storage state and passes, so the
   suite stays green — the authed project then self-skips. That keeps
   forks/PRs (which never receive secrets) from failing CI.
   ─────────────────────────────────────────────────────────────────────────── */

const AUTH_DIR = path.join(__dirname, '..', 'playwright', '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const EMAIL = process.env.TEST_USER_EMAIL || process.env.GPJ_TEST_EMAIL || 'asosa@ghostproofjob.com';
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.GPJ_TEST_PASSWORD || '';

test('authenticate test account and save storage state', async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (!PASSWORD) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    console.log('[auth.setup] TEST_USER_PASSWORD not set — wrote empty state; authed tests will self-skip.');
    return;
  }

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  // wait for the Firebase module script to expose fb and the login UI to exist
  await page.waitForFunction(() => window.fb && typeof window.fb.signIn === 'function' && typeof window.showAuthModal === 'function', null, { timeout: 20000 });

  // open the auth modal in LOGIN mode and sign in through the real form
  await page.evaluate(() => window.showAuthModal('login'));
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-pass', PASSWORD);
  await page.click('#auth-primary-btn');

  // 1) Firebase reports a current user…
  await page.waitForFunction(() => window.fb && window.fb.current && !!window.fb.current(), null, { timeout: 20000 })
    .catch(() => { throw new Error('[auth.setup] sign-in did not produce a Firebase user for ' + EMAIL + ' — check TEST_USER_PASSWORD.'); });

  // 2) …and the session has actually SETTLED into IndexedDB (what storageState saves)
  await page.waitForFunction(async () => {
    try {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === 'firebaseLocalStorageDb')) return false;
      return await new Promise((res) => {
        const rq = indexedDB.open('firebaseLocalStorageDb');
        rq.onsuccess = () => {
          try {
            const db = rq.result;
            const count = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').count();
            count.onsuccess = () => { res(count.result > 0); db.close(); };
            count.onerror = () => { res(false); db.close(); };
          } catch (e) { res(false); }
        };
        rq.onerror = () => res(false);
      });
    } catch (e) { return false; }
  }, null, { timeout: 20000 });

  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
  console.log('[auth.setup] signed in as ' + EMAIL + ' via the login UI — storage state (incl. IndexedDB) saved.');
});
