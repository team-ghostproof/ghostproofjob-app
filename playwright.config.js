// GhostProofJob — Playwright config.
// Serves the single-file app locally and runs browser-level smoke/regression tests.
// Runs in GitHub Actions (free) on every push. See tests/smoke.spec.js.
const { defineConfig, devices } = require('@playwright/test');

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
    // Smoke/regression runs on both device profiles. Screenshots run ONCE, in the
    // dedicated 'visual' project — so no test.skip project-detection is needed.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /screenshots\.spec\.js/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /screenshots\.spec\.js/ },
    { name: 'visual', use: { ...devices['Desktop Chrome'] }, testMatch: /screenshots\.spec\.js/ },
  ],
});
