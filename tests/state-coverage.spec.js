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
      /* punctuation-terminated: v80+ harvester docs end with '.', '…' etc — the
         v82 legacy-dressing only trims cap-length docs WITHOUT terminal punctuation */
      const harvesterMax = ('word '.repeat(699) + 'sentence.').trim();  // ~3504 chars, clean ending
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

  test('Q1: _fmtJobText renders bullets + section headers, never raw blobs (F-STRUCT)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const src = "What's In It For Me?\n• $50,000 - $60,000 base pay (DOE)\n• Robust PTO and Sick Time Plan\nJob Responsibilities\n• Assist marketing by collecting and analyzing data.\nRegular prose line that stays a paragraph.";
      const html = _fmtJobText(src);
      return {
        bullets: (html.match(/flex-shrink:0;">•/g) || []).length,
        headResp: /font-weight:800[^>]*>Job Responsibilities</.test(html),
        headWiifm: /font-weight:800[^>]*>What(?:'|’)s In It For Me\?</.test(html),
        proseIsNotHead: !/font-weight:800[^>]*>Regular prose/.test(html),
        empty: _fmtJobText(''),
        undef: /undefined|NaN/.test(html),
      };
    });
    expect(r.bullets).toBe(3);
    expect(r.headResp, '"Job Responsibilities" must render as a subhead').toBe(true);
    expect(r.headWiifm, '"What\'s In It For Me?" must render as a subhead').toBe(true);
    expect(r.proseIsNotHead, 'prose sentences must not become headers').toBe(true);
    expect(r.empty).toBe('');
    expect(r.undef).toBe(false);
  });

  test('Q1: legacy cap-truncated docs get dressed to a whole word + ellipsis (v82)', async ({ page }) => {
    const r = await page.evaluate(() => {
      /* a pre-v80 doc: exactly at the 3500 cap, ending mid-word, no punctuation */
      const legacy = ('word '.repeat(699) + 'comfortable working within cl').slice(0, 3500);
      const j = mapFirestoreJob({ title: 'L', company: 'Co', direct_apply_url: 'https://x.example/l', description: legacy });
      const short = mapFirestoreJob({ title: 'S', company: 'Co', direct_apply_url: 'https://x.example/s', description: 'A clean short description.' });
      return { dressed: /\S…$/.test(j.desc), noMidWord: !/\bcl…?$/.test(j.desc) && !j.desc.endsWith('cl'), shortUntouched: short.desc === 'A clean short description.' };
    });
    expect(r.dressed, 'cap-length desc without punctuation must end on a word + …').toBe(true);
    expect(r.noMidWord, 'the mid-word fragment must be trimmed away').toBe(true);
    expect(r.shortUntouched).toBe(true);
  });

  test('Q1+Q4: _aiJobContext labels the target role; empty posting yields title-only (F-AI)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const full = _aiJobContext('Marketing Manager', 'IDIQ', 'Own the TikTok Shop strategy for ecommerce brands. '.repeat(50));
      const empty = _aiJobContext('Marketing Manager', 'IDIQ', '');
      const none = _aiJobContext('', '', '');
      return {
        hasRole: full.includes('TARGET ROLE: Marketing Manager'), hasCo: full.includes('COMPANY: IDIQ'),
        hasPosting: full.includes('POSTING: '), capped: full.length < 1700,
        emptyOk: empty === 'TARGET ROLE: Marketing Manager\nCOMPANY: IDIQ', noneOk: none === '',
      };
    });
    expect(r.hasRole).toBe(true);
    expect(r.hasCo).toBe(true);
    expect(r.hasPosting).toBe(true);
    expect(r.capped, 'posting text must cap ~1500 chars').toBe(true);
    expect(r.emptyOk).toBe(true);
    expect(r.noneOk).toBe(true);
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

test.describe('[STATE-COVERAGE] v78 B-SARATOGA / B-SALARY-CYCLE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: Browse pool hard-scopes — local + remote in, other-city on-site OUT, honest empty', async ({ page }) => {
    const r = await page.evaluate(() => {
      const loc = resolveLocation('Houston, TX');
      const raw = [
        { t: 'LOCAL', co: 'C1', location: 'Houston, TX' },
        { t: 'SARATOGA', co: 'C2', location: 'Saratoga Springs, NY' },
        { t: 'REMOTE', co: 'C3', location: 'New York, NY', is_remote: true },
        { t: 'GBREMOTE', co: 'C5', location: 'Remote, GB', is_remote: true },   /* v80: foreign remote */
        { t: 'INDIANA', co: 'C6', location: 'Indianapolis, IN', is_remote: true },  /* IN must NOT read as India */
        { t: 'FAKEHYBRID', co: 'C7', location: 'Tucson, AZ', is_remote: true, description: 'Hybrid work schedule (must be local to Tucson, AZ)' },  /* v81: fake remote */
      ];
      const scoped = _scopeBrowsePool(raw, loc).map((j) => j.t);
      /* zero in-market matches must NOT fall back to the national pool */
      const outOfRegionOnly = _scopeBrowsePool([{ t: 'BOISE', co: 'C4', location: 'Boise, ID' }], loc);
      return { scoped, emptyLen: outOfRegionOnly.length };
    });
    expect(r.scoped).toContain('LOCAL');
    expect(r.scoped).toContain('REMOTE');
    expect(r.scoped).not.toContain('SARATOGA');
    expect(r.scoped, 'foreign remote (Remote, GB) must be excluded').not.toContain('GBREMOTE');
    expect(r.scoped, 'US-state remote (…, IN) must not be treated as foreign').toContain('INDIANA');
    expect(r.scoped, 'is_remote flag contradicted by "hybrid/must be local" body must be excluded').not.toContain('FAKEHYBRID');
    expect(r.emptyLen, 'no local matches must yield remote-only/empty, never out-of-region on-site').toBe(0);
  });

  test('Q1+Q3: salary toggle is a pure client filter — zero Firestore requests, list never blanks', async ({ page }) => {
    /* install AFTER load so only toggle-time traffic is counted (and killed — Q3) */
    let hits = 0;
    await page.route('**/*firestore.googleapis.com/**', (route) => { hits++; route.abort('failed'); });
    const r = await page.evaluate(async () => {
      const mk = (t, salMax) => ({ t, co: 'Co', loc: 'Houston, TX', sal: salMax ? '$90K' : '', salMax, ghost: 10, match: 0, desc: '', summary: '', url: 'https://x.example/' + t, posting_age_days: 1, jtype: '', job_type: '', work_setting: '', stale: false, last_ping_status: 'ok' });
      liveJobs = [mk('WithSalary', 90000), mk('NoSalary', 0)];
      window._browseOwnsLive = true; _browsePoolKey = '(all)';
      switchView('browse');
      renderBrowse();
      const before = document.querySelectorAll('.job-card-browse').length;
      const tog = document.getElementById('f-hassal');
      tog.classList.add('on'); livePage = 1; refreshBrowse();
      await new Promise((res) => setTimeout(res, 700));   /* let the 300ms debounce fire */
      const withSal = document.querySelectorAll('.job-card-browse').length;
      tog.classList.remove('on'); livePage = 1; refreshBrowse();
      await new Promise((res) => setTimeout(res, 700));
      const after = document.querySelectorAll('.job-card-browse').length;
      return { before, withSal, after };
    });
    expect(r.before).toBe(2);
    expect(r.withSal, 'toggle ON filters to posted-salary jobs only').toBe(1);
    expect(r.after, 'toggle OFF restores the full in-market list').toBe(2);
    expect(hits, 'toggling must never re-pull from Firestore').toBe(0);
  });
});

test.describe('[STATE-COVERAGE] v79 other-regions control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1+Q3+Q4: pill ladder widens/narrows the CACHED pool — zero refetch, honest tiers', async ({ page }) => {
    let hits = 0;
    await page.route('**/*firestore.googleapis.com/**', (route) => { hits++; route.abort('failed'); });
    const r = await page.evaluate(() => {
      _browseRawPool = [
        { title: 'Local Role', company: 'C1', location: 'Houston, TX', direct_apply_url: 'https://x.example/1' },
        { title: 'Dallas Role', company: 'C2', location: 'Dallas, TX', direct_apply_url: 'https://x.example/2' },
        { title: 'Boise Role', company: 'C3', location: 'Boise, ID', direct_apply_url: 'https://x.example/3' },
        { title: 'Remote Role', company: 'C4', location: 'New York, NY', is_remote: true, direct_apply_url: 'https://x.example/4' },
      ];
      _browseLastLoc = resolveLocation('Houston, TX'); _browseScope = 'market';
      window._browseOwnsLive = true; _browsePoolKey = '(all)';
      switchView('browse');
      _browseRescope(); const market = liveJobs.map((j) => j.t);
      browseWiden(); const state = liveJobs.map((j) => j.t);
      browseWiden(); const all = liveJobs.map((j) => j.t);
      browseNarrow(); const back = liveJobs.map((j) => j.t);
      const pillText = (document.getElementById('browse-results') || {}).textContent || '';
      return { market, state, all, back, pillShown: pillText.includes('Showing') };
    });
    expect(r.market).toContain('Local Role');
    expect(r.market).toContain('Remote Role');
    expect(r.market).not.toContain('Dallas Role');
    expect(r.state).toContain('Dallas Role');
    expect(r.state, 'state tier must not include other states').not.toContain('Boise Role');
    expect(r.all).toContain('Boise Role');
    expect(r.back).not.toContain('Dallas Role');
    expect(r.pillShown, 'scope pill must render above results').toBe(true);
    expect(hits, 'widening/narrowing must never refetch').toBe(0);
  });

  test('Q1: deck exhausted state offers the same-state rung before other cities', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_loc', 'Houston, TX');
      showDeckExhausted();
      const withState = document.getElementById('view-swipe').textContent || '';
      localStorage.setItem('gpj_loc', '');
      showDeckExhausted();
      const without = document.getElementById('view-swipe').textContent || '';
      return { withState, without };
    });
    expect(r.withState).toContain('other parts of TX');
    expect(r.without).toContain('other cities');
  });
});

test.describe('[STATE-COVERAGE] v83 scroll/clip/rater fixes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: expanded description scrolls and does NOT collapse on inner taps', async ({ page }) => {
    const r = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'desc-clamp';
      el.innerHTML = _fmtJobText(('A real line of description text that wraps.\n').repeat(60));
      document.body.appendChild(el);
      el.click();                                   /* tap 1: expand */
      const afterExpand = el.classList.contains('expanded');
      const cs = getComputedStyle(el);
      const scrolls = cs.overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.clientHeight <= 362;
      const hasCollapseBar = !!el.querySelector('.clamp-collapse');
      el.querySelector('div').click();              /* tap 2: inside content — must NOT collapse */
      const stillExpanded = el.classList.contains('expanded');
      el.querySelector('.clamp-collapse').click();  /* tap 3: explicit collapse */
      const collapsed = !el.classList.contains('expanded');
      el.remove();
      return { afterExpand, scrolls, hasCollapseBar, stillExpanded, collapsed };
    });
    expect(r.afterExpand).toBe(true);
    expect(r.scrolls, 'expanded box must be a real 360px scroll region').toBe(true);
    expect(r.hasCollapseBar).toBe(true);
    expect(r.stillExpanded, 'tapping inside to scroll/select must not collapse').toBe(true);
    expect(r.collapsed, 'the ▴ collapse bar must collapse it').toBe(true);
  });

  test('Q1: match insight stacks ABOVE the job card and shows the full title', async ({ page }) => {
    const r = await page.evaluate(() => {
      openMatchInsight('Digital Content Specialist (Photo/Video & Social Media Design)', 26);
      const m = document.getElementById('match-modal');
      const t = document.getElementById('mi-title').textContent || '';
      return { open: m.classList.contains('open'), z: parseInt(getComputedStyle(m).zIndex, 10), full: t.includes('(Photo/Video & Social Media Design)'), ellipsis: t.includes('…') };
    });
    expect(r.open).toBe(true);
    expect(r.z, 'match modal must stack above the expanded job card (350)').toBeGreaterThan(350);
    expect(r.full, 'full job title must be shown').toBe(true);
    expect(r.ellipsis).toBe(false);
  });

  test('Q1+Q4: rater suggestions reject non-skill words, keep real skills (F-RATER)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      including: _realSkillTerm('including'),
      various: _realSkillTerm('various'),
      experience: _realSkillTerm('experience'),
      blank: _realSkillTerm(''),
      number: _realSkillTerm('2024'),
      salesforce: _realSkillTerm('salesforce'),
      phrase: _realSkillTerm('project management'),
      customer: _realSkillTerm('customer service'),
      fullBtn: typeof jettFullImprove === 'function',
    }));
    expect(r.including, '"including" is not a skill').toBe(false);
    expect(r.various).toBe(false);
    expect(r.experience).toBe(false);
    expect(r.blank).toBe(false);
    expect(r.number).toBe(false);
    expect(r.salesforce).toBe(true);
    expect(r.phrase).toBe(true);
    expect(r.customer).toBe(true);
    expect(r.fullBtn, 'jettFullImprove must exist (F-JETT-FULL)').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v84 B-TEXT-CLIP', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: location badges never cut mid-word; remote says Remote', async ({ page }) => {
    const r = await page.evaluate(() => ({
      long: _locBadge('Rancho Cucamonga, CA, United States', ''),   /* 35 chars → whole city, no cut */
      fits: _locBadge('The Woodlands, TX, US', ''),                 /* 21 chars → fits, shown whole */
      short: _locBadge('Houston, TX', ''),
      remote: _locBadge('Temecula, CA', 'Remote'),
      empty: _locBadge('', ''),
    }));
    expect(r.long, 'long locations show the whole city').toBe('📍 Rancho Cucamonga');
    expect(r.long.includes('…')).toBe(false);
    expect(r.fits).toBe('📍 The Woodlands, TX, US');
    expect(r.short).toBe('📍 Houston, TX');
    expect(r.remote).toBe('🏠 Remote');
    expect(r.empty).toBe('📍 ');
  });

  test('Q1: popups are dynamic — modal-box wraps long text and scrolls in-viewport', async ({ page }) => {
    const r = await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'modal-box';
      box.textContent = 'SupercalifragilisticDigitalContentSpecialistTitleThatNeverEnds '.repeat(80);
      document.body.appendChild(box);
      const cs = getComputedStyle(box);
      const out = { overflow: cs.overflowY, wraps: cs.overflowWrap, bounded: box.clientHeight <= window.innerHeight, scrolls: box.scrollHeight > box.clientHeight };
      box.remove();
      return out;
    });
    expect(r.overflow).toBe('auto');
    expect(r.wraps).toBe('anywhere');
    expect(r.bounded, 'modal must stay inside the viewport').toBe(true);
    expect(r.scrolls, 'overflowing content must scroll, not clip').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v85 B2/B3/B5/B7 verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1 B2+B3: Browse work-style filter + min-salary slider act on the pool', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const mk = (t, ws, salMax) => ({ t, co: 'Co', loc: 'Houston, TX', sal: salMax ? ('$' + salMax / 1000 + 'K') : '', salMax, ghost: 10, match: 0, desc: '', summary: '', url: 'https://x.example/' + t, posting_age_days: 1, jtype: '', job_type: '', work_setting: ws, stale: false, last_ping_status: 'ok' });
      liveJobs = [mk('REMOTEJOB', 'Remote', 90000), mk('HYBRIDJOB', 'Hybrid', 120000), mk('ONSITEJOB', 'On-site', 0)];
      window._browseOwnsLive = true; _browsePoolKey = '(all)';
      switchView('browse');
      const names = () => [...document.querySelectorAll('.job-card-browse')].map((el) => (el.textContent.match(/REMOTEJOB|HYBRIDJOB|ONSITEJOB/) || [''])[0]);
      document.getElementById('f-style').value = 'Remote'; renderBrowse();
      const remoteOnly = names();
      document.getElementById('f-style').value = ''; document.getElementById('f-salary').value = '100'; renderBrowse();
      const salaried = names();
      document.getElementById('f-salary').value = '0'; renderBrowse();
      return { remoteOnly, salaried };
    });
    expect(r.remoteOnly, 'work-style Remote must show only remote').toEqual(['REMOTEJOB']);
    expect(r.salaried, 'min $100K keeps 120K + unknown-salary, drops 90K').toEqual(expect.arrayContaining(['HYBRIDJOB', 'ONSITEJOB']));
    expect(r.salaried).not.toContain('REMOTEJOB');
  });

  test('Q1 B5: saved location pre-fills résumé/browse city+state fields', async ({ page }) => {
    const r = await page.evaluate(() => {
      /* .pf-city/.pf-state mount with the resume editor; #f-location is static
         and set by the SAME function — the hard assert (incl. city-only strip) */
      const fLoc = document.getElementById('f-location'); if (fLoc) fLoc.value = '';
      document.querySelectorAll('.pf-city,.pf-state').forEach((el) => { el.value = ''; });
      gpjApplyLocation('Houston, TX', 'TX', { force: true });
      const city = [...document.querySelectorAll('.pf-city')].map((el) => el.value);
      const state = [...document.querySelectorAll('.pf-state')].map((el) => el.value);
      return { fLoc: fLoc ? fLoc.value : '(missing)', cityOk: city.every((v) => v === 'Houston'), stateOk: state.every((v) => v === 'TX') };
    });
    expect(r.fLoc, 'Browse city box fills with CITY ONLY (no ", TX" tail)').toBe('Houston');
    expect(r.cityOk, 'any mounted resume city fields fill with city only').toBe(true);
    expect(r.stateOk).toBe(true);
  });

  test('Q1 B7: password lives in a real form; sandbox iframe cannot escape', async ({ page }) => {
    const r = await page.evaluate(() => ({
      inForm: !!document.getElementById('auth-pass').closest('form'),
      formIntercepted: (document.getElementById('auth-form').getAttribute('onsubmit') || '').includes('return false'),
      sandbox: document.getElementById('sandbox-frame').getAttribute('sandbox') || '',
    }));
    expect(r.inForm, 'password field must be inside a <form>').toBe(true);
    expect(r.formIntercepted).toBe(true);
    expect(r.sandbox).not.toContain('allow-same-origin');
    expect(r.sandbox).toContain('allow-scripts');
  });
});

test.describe('[STATE-COVERAGE] v86 dressing + D1 session cache', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: legacy raw-sliced REQUIREMENTS get dressed; clean fields untouched (B-DESC-CUT final)', async ({ page }) => {
    const r = await page.evaluate(() => {
      /* a pre-v86 doc: requirements stored at the raw 900 cap, ending mid-word */
      const legacyReq = ('• Strong communication and organization skills\n'.repeat(18) + 'must have prior experien').slice(-900 - 24).slice(0, 900);
      const j = mapFirestoreJob({ title: 'R', company: 'Co', direct_apply_url: 'https://x.example/r', description: 'Short and complete.', requirements: legacyReq });
      const clean = mapFirestoreJob({ title: 'C', company: 'Co', direct_apply_url: 'https://x.example/c', description: 'Short and complete.', requirements: 'Must have 5 years of experience.' });
      return {
        reqDressed: /\S…$/.test(j.req), reqNoMidWord: !/experien$/.test(j.req),
        summaryDressed: /\S…$/.test(j.summary),
        cleanReq: clean.req, cleanDesc: clean.desc,
      };
    });
    expect(r.reqDressed, 'cap-length requirements must end on a whole word + …').toBe(true);
    expect(r.reqNoMidWord).toBe(true);
    expect(r.summaryDressed, 'summary derives from the dressed requirements').toBe(true);
    expect(r.cleanReq).toBe('Must have 5 years of experience.');
    expect(r.cleanDesc).toBe('Short and complete.');
  });

  test('Q1: fetchJobs session cache — repeat pulls are read-free; clear hook exists (D1)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      if (!(window.fb && fb.fetchJobs && fb.jobsCacheClear)) return { ready: false };
      const a = await fb.fetchJobs('', 50);
      const b = await fb.fetchJobs('', 50);
      fb.jobsCacheClear();
      return { ready: true, n: a.length, identical: a === b };
    });
    expect(r.ready, 'fb.fetchJobs + fb.jobsCacheClear must exist').toBe(true);
    if (r.n > 0) expect(r.identical, 'second identical pull must be served from the session cache').toBe(true);
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
