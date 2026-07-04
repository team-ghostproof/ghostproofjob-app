// GhostProofJob — Playwright config.
// Serves the single-file app locally and runs browser-level smoke/regression tests.
// Runs in GitHub Actions (free) on every push. See tests/smoke.spec.js.
const { defineConfig, devices } = require('@playwright/test');

/* Load ./.env (gitignored; see .env.example) so TEST_USER_EMAIL/PASSWORD work
   locally without exporting them — dependency-free parser, real env wins. */
try {
  const fs = require('fs'), path = require('path');
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (e) { /* .env is optional */ }

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.GPJ_BASE_URL || 'http://localhost:8000',
    headless: true,
    screenshot: 'only-on-failure',
  },
  // Serve the repo root so /index.html (the deployed file) loads exactly as in prod.
  // 'python' (not 'python3') resolves on Windows dev machines AND on ubuntu CI
  // runners, where it aliases python3.
  webServer: {
    command: 'python -m http.server 8000',
    url: 'http://localhost:8000/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    // AUTH SETUP (F-TEST): signs in the test account once (creds from env; see
    // tests/auth.setup.js) and saves storage state incl. IndexedDB, where
    // Firebase Auth keeps its session.
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    // Smoke/regression runs on both device profiles SIGNED OUT — that IS the
    // Guest quadrant of the [STATE-COVERAGE] matrix. Screenshots run ONCE, in
    // the dedicated 'visual' project — so no test.skip project-detection is needed.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /screenshots\.spec\.js|authed\.spec\.js|auth\.setup\.js/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /screenshots\.spec\.js|authed\.spec\.js|auth\.setup\.js/ },
    // AUTHED (Quadrant 2): restores the saved session; self-skips without creds.
    { name: 'authed', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' }, dependencies: ['setup'], testMatch: /authed\.spec\.js/ },
    { name: 'visual', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots\.spec\.js/ },
  ],
});
