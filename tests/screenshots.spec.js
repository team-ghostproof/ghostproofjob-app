const { test } = require('@playwright/test');
const fs = require('fs');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — VISUAL CAPTURE (the Batch-4 desktop-layout aid).

   This suite does NOT assert — it just produces screenshots so desktop layout
   work (modal centering, footer alignment, startup scroll, Browse-card vs
   filter-box width, LinkedIn-button width) can be tuned against a REAL render
   instead of guessing at CSS. Output lands in ./screenshots and is uploaded as
   a CI artifact on every run.

   The app enters desktop mode at >=1024px (matchMedia), so we set a wide
   viewport BEFORE navigating to get the genuine desktop layout. No Firebase
   auth/data is needed — the shells, nav, and modals all render signed-out.

   Run just this suite:  npm run screenshots
   ─────────────────────────────────────────────────────────────────────────── */

const OUT = 'screenshots';

test.describe('visual capture', () => {
  // Run once (via the chromium project), not duplicated across device projects.
  test.skip(({}, testInfo) => testInfo.project.name !== 'chromium', 'screenshots run once');

  test.beforeAll(() => { try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {} });

  async function load(page, w, h) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500); // let inline scripts + the Firebase SDK settle
    await page.evaluate(() => {
      // hide first-run overlays so they don't cover the captured view
      try { const t = document.getElementById('tutorial'); if (t) t.style.display = 'none'; } catch (e) {}
      try { document.querySelectorAll('.modal-scrim.open').forEach((m) => m.classList.remove('open')); } catch (e) {}
    });
  }

  const views = ['swipe', 'browse', 'resume'];

  test('desktop — each view (1280×900)', async ({ page }) => {
    await load(page, 1280, 900);
    for (const v of views) {
      await page.evaluate((vv) => window.switchView && window.switchView(vv), v);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/desktop-${v}.png`, fullPage: true });
    }
  });

  test('desktop — modal centering (saved jobs + saved companies)', async ({ page }) => {
    await load(page, 1280, 900);
    await page.evaluate(() => window.openSavedJobs && window.openSavedJobs());
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/desktop-modal-saved-jobs.png` });
    await page.evaluate(() => {
      document.querySelectorAll('.modal-scrim.open').forEach((m) => m.classList.remove('open'));
      window.openSavedCompanies && window.openSavedCompanies();
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/desktop-modal-saved-companies.png` });
  });

  test('desktop — resume tab (LinkedIn import + phone toggle width)', async ({ page }) => {
    await load(page, 1280, 900);
    await page.evaluate(() => window.switchView && window.switchView('resume'));
    await page.waitForTimeout(700);
    // expand the LinkedIn import so its button width is visible against the fields
    await page.evaluate(() => { const b = document.getElementById('li-body'); if (b) b.style.display = ''; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/desktop-resume-contact.png`, fullPage: true });
  });

  test('mobile — each view (390×844)', async ({ page }) => {
    await load(page, 390, 844);
    for (const v of views) {
      await page.evaluate((vv) => window.switchView && window.switchView(vv), v);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/mobile-${v}.png`, fullPage: true });
    }
  });
});
