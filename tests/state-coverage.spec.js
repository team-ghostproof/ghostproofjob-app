const { test, expect } = require('@playwright/test');
const { mockNetworkFailure, mockEmptyData, FIRESTORE_URLS, WORKER_URLS } = require('./utils');

/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — [STATE-COVERAGE] matrix tests (CLAUDE.md §3 rule 9).

   Executable form of the v76/v77 4-quadrant matrix for the shipped fixes
   (B-DESC-CUT, B-OPENCARD, B-BENEFITS frontend rendering):

     Q1 Guest        — these run signed-out in the chromium/mobile projects.
     Q2 Authed       — mirrored in tests/authed.spec.js (authed project).
     Q3 Failed net   — mockNetworkFailure on Firestore + Worker.
     Q4 Empty data   — pool-seeding via page.evaluate (Firestore is WebChannel,
                       so '[]' bodies don't reach the app the way REST would;
                       seeding the pool IS the high-fidelity empty simulation)
                       + mockEmptyData for the REST-shaped Worker.

   All tests seed synthetic jobs client-side — no live Firestore dependency,
   so they are deterministic in CI.
   ─────────────────────────────────────────────────────────────────────────── */

test.describe('[STATE-COVERAGE] Q1 guest', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('B-DESC-CUT: harvester-sized descriptions are never cut; oversized cut on word boundary', async ({ page }) => {
    const r = await page.evaluate(() => {
      const harvesterMax = 'word '.repeat(700).trim();       // 3499 chars — max the harvester stores
      const j = mapFirestoreJob({ title: 'T', company: 'Co', direct_apply_url: 'https://x.example/a', description: harvesterMax });
      const oversized = 'word '.repeat(1200).trim();          // ~6000 chars — legacy/ATS payload
      const j2 = mapFirestoreJob({ title: 'T2', company: 'Co', direct_apply_url: 'https://x.example/b', description: oversized });
      return {
        fullLen: j.desc.length,
        fullEllipsis: j.desc.includes('…'),
        summaryLen: j.summary.length,
        overEndsOnWord: /\S…$/.test(j2.desc),
      };
    });
    expect(r.fullEllipsis, 'harvester-sized desc must never be cut client-side').toBe(false);
    expect(r.fullLen).toBeGreaterThan(3400);
    expect(r.summaryLen).toBeGreaterThan(3400);
    expect(r.overEndsOnWord, 'oversized desc must end on a word boundary + ellipsis').toBe(true);
  });

  test('B-DESC-CUT: expanded job card renders the summary past the old 2400 slice', async ({ page }) => {
    const r = await page.evaluate(() => {
      const long = 'lorem ipsum dolor sit amet consetetur '.repeat(90).trim();  // ~3400 chars
      const html = buildBrowseExpanded({ t: 'X', co: 'Co', loc: 'Houston, TX', url: '', desc: long, summary: long, sal: '', ghost: 10, match: 0, posting_age_days: 1 }, 0);
      const div = document.createElement('div'); div.innerHTML = html;
      const text = div.textContent || '';
      return { showsTail: text.includes(long.slice(2500, 2560)), hasUndefined: /undefined|NaN/.test(html) };
    });
    expect(r.showsTail, 'text beyond the old 2400 hard-slice must be visible').toBe(true);
    expect(r.hasUndefined).toBe(false);
  });

  test('B-OPENCARD: Open Full Job Card opens the job card OVER the company modal', async ({ page }) => {
    const r = await page.evaluate(() => {
      document.getElementById('cm-name').textContent = 'TestCo';
      document.getElementById('company-modal').classList.add('open');
      cmJobsCache = [{ t: 'State Matrix Role', url: 'https://x.example/j', loc: 'Houston, TX', desc: 'A role about testing.', req: 'Run the tests', benefits: 'Free tests', ats: '' }];
      openRoleFullCard(0);
      const m = document.getElementById('browse-expand-modal');
      return {
        open: !!(m && m.classList.contains('open')),
        z: m ? parseInt(m.style.zIndex, 10) : 0,
        body: (document.getElementById('browse-expand-body') || {}).textContent || '',
        companyStillOpen: document.getElementById('company-modal').classList.contains('open'),
      };
    });
    expect(r.open, 'job card modal must open').toBe(true);
    expect(r.z, 'job card must stack above the company modal (345)').toBeGreaterThan(345);
    expect(r.body).toContain('State Matrix Role');
    expect(r.companyStillOpen, 'closing the job card must return to the company card').toBe(true);
  });

  test('Q4-shape: missing desc/req/benefits render fallbacks, never "undefined"', async ({ page }) => {
    const r = await page.evaluate(() => {
      const j = mapFirestoreJob({ title: 'NoData', company: 'Co', direct_apply_url: 'https://x.example/n' });
      const html = buildBrowseExpanded({ t: j.t, co: j.co, loc: '', url: '', desc: '', summary: '', sal: '', ghost: 10, match: 0, posting_age_days: null }, 0);
      return { benefits: j.benefits, desc: j.desc, hasUndefined: /undefined|NaN/.test(html) };
    });
    expect(r.benefits).toBe('');
    expect(r.desc).toBe('');
    expect(r.hasUndefined).toBe(false);
  });
});

test.describe('[STATE-COVERAGE] Q3 failed network', () => {
  test('shell survives a Firestore + Worker outage', async ({ page }) => {
    await mockNetworkFailure(page, FIRESTORE_URLS);
    await mockNetworkFailure(page, WORKER_URLS);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(page.locator('body')).toContainText('GhostProofJob');
    const err = await page.evaluate(() => {
      try { switchView('browse'); switchView('swipe'); return ''; } catch (e) { return String(e); }
    });
    expect(err).toBe('');
  });
});

test.describe('[STATE-COVERAGE] Q4 empty data', () => {
  test('empty pools render honest empty states without crashing', async ({ page }) => {
    await mockEmptyData(page, WORKER_URLS);           // REST-shaped endpoint gets '[]'
    await mockNetworkFailure(page, FIRESTORE_URLS);   // WebChannel: outage = empty pool
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const err = await page.evaluate(() => {
      try {
        liveJobs = []; jobsQueue = [];
        renderBrowse();
        if (typeof applySwipeFilters === 'function') applySwipeFilters();
        return '';
      } catch (e) { return String(e); }
    });
    expect(err).toBe('');
    const rows = await page.evaluate(() => document.querySelectorAll('.job-card-browse').length);
    expect(rows, 'no fake/demo rows may appear in an empty live view').toBe(0);
  });
});
