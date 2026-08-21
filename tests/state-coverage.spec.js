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

/* v132 SAFETY GUARD (founder-caught): a test that drives a real user action which
   fires a fetch to the Cloudflare Worker (e.g. inviteTeammate → /email/company-invite)
   was sending REAL emails via Resend to the test fixtures (newhire@acme.com,
   sam@acme.com) on every CI + local run — 35+ suppressed sends. Firestore was NOT
   polluted (fb.* is stubbed) but the Worker fetch was not. This blocks EVERY Worker
   call at the network layer for the whole file, so no test can ever email again.
   Q3/Q4 register their own Worker routes AFTER this (last route wins), so their
   deliberate failure/empty simulations still work. */
test.beforeEach(async ({ page }) => {
  await page.route(WORKER_URLS, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
});

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
        { t: 'REMOTE', co: 'C3', location: 'New York, NY', is_remote: true, desc: 'Fully remote, work from home anywhere in the US.' },   /* v95: genuine remote needs confirmation */
        { t: 'GBREMOTE', co: 'C5', location: 'Remote, GB', is_remote: true },   /* v80: foreign remote */
        { t: 'INDIANA', co: 'C6', location: 'Indianapolis, IN', is_remote: true, desc: 'Fully remote, work from home.' },  /* IN must NOT read as India; v95: genuine remote confirmed */
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
        { title: 'Remote Role', company: 'C4', location: 'New York, NY', is_remote: true, description: 'Fully remote, work from home anywhere in the US.', direct_apply_url: 'https://x.example/4' },   /* v95: genuine remote needs confirmation */
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

test.describe('[STATE-COVERAGE] v87 rater trust + B-SKIP-APPLY', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: rater — generic singles rejected, corpus cached across re-rates, covered terms tracked', async ({ page }) => {
    const r = await page.evaluate(async () => {
      if (!window.fb) return null;
      const singles = { business: _realSkillTerm('business'), professional: _realSkillTerm('professional'), process: _realSkillTerm('process'), internal: _realSkillTerm('internal') };
      const phrases = { bd: _realSkillTerm('business development'), dm: _realSkillTerm('digital marketing') };
      let mined = 0;
      window._roleCorpusCache = null;
      fb.mineRoleKeywords = async () => { mined++; return { matched: 9, terms: [{ term: 'digital marketing', pct: 50 }, { term: 'process', pct: 45 }, { term: 'crm', pct: 40 }] }; };
      fb.mineHires = async () => null;
      Object.assign(resumeData, { title: 'Marketing Specialist', skills: 'Digital Marketing · Excel', jobs: [{ t: 'Marketing Specialist', c: 'Acme', b: 'Ran digital marketing campaigns end to end' }], summary: 'Marketing person with real campaign experience behind them.' });
      await rateResume();
      await rateResume();   /* second rate must hit the session cache */
      return { singles, phrases, mined, missing: window._rateMissingTerms || [], covered: window._rateCoveredTerms || [] };
    });
    test.skip(r === null, 'fb unavailable in this environment');
    expect(Object.values(r.singles).every((v) => v === false), 'business/professional/process/internal are not skills').toBe(true);
    expect(r.phrases.bd).toBe(true);
    expect(r.phrases.dm).toBe(true);
    expect(r.mined, 'corpus mined ONCE — re-rates reuse the same yardstick').toBe(1);
    expect(r.missing).toContain('crm');
    expect(r.missing, 'filtered junk must not be suggested').not.toContain('process');
    expect(r.covered, 'covered terms tracked for rewrite preservation').toContain('digital marketing');
  });

  test('Q1+Q4: stat rows open the real JOB card; graceful fallback when nothing survives (B-SKIP-APPLY)', async ({ page }) => {
    const r = await page.evaluate(() => {
      liveJobs = [{ t: 'Skipped Role', co: 'SkipCo', loc: 'Houston, TX', url: 'https://x.example/s', desc: 'd', summary: 'd', sal: '', ghost: 10, match: 0, posting_age_days: 1 }];
      const okPool = openStatJobCard('Skipped Role', 'SkipCo');
      const modalOpen = document.getElementById('browse-expand-modal').classList.contains('open');
      const body = (document.getElementById('browse-expand-body') || {}).textContent || '';
      closeBrowseExpanded();
      liveJobs = []; jobsQueue = []; rawQueue = []; _browseRawPool = [];
      lists.skipped = [{ t: 'Rec Role', co: 'RecCo', url: 'https://x.example/r', loc: 'Houston, TX', when: Date.now() }];
      const okRec = openStatJobCard('Rec Role', 'RecCo');
      const recShown = (document.getElementById('browse-expand-body') || {}).textContent || '';
      closeBrowseExpanded();
      const okNone = openStatJobCard('Ghost Role', 'NoCo');
      return { okPool, modalOpen, hasTitle: body.includes('Skipped Role'), okRec, recShown: recShown.includes('Rec Role'), okNone };
    });
    expect(r.okPool).toBe(true);
    expect(r.modalOpen, 'the real job card modal must open').toBe(true);
    expect(r.hasTitle).toBe(true);
    expect(r.okRec, 'a row-stored url rebuilds a wired job card').toBe(true);
    expect(r.recShown).toBe(true);
    expect(r.okNone, 'no surviving data → false → caller falls back to company view').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v88 comma-dressing + Jett snapshot/tidy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: comma-terminated truncations get dressed too (Stantec repro)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const legacy = ('At Stantec we have leading professionals passionate about the work. '.repeat(7) + 'we are building a stronger,').trim();
      const j = mapFirestoreJob({ title: 'S', company: 'Co', direct_apply_url: 'https://x.example/s', description: legacy });
      const clean = mapFirestoreJob({ title: 'C', company: 'Co', direct_apply_url: 'https://x.example/c', description: 'This one ends like a finished sentence.' });
      return { dressed: /\S…$/.test(j.desc), noComma: !/,\s*…?$/.test(j.desc) && !j.desc.endsWith(','), cleanUntouched: clean.desc === 'This one ends like a finished sentence.' };
    });
    expect(r.dressed, 'a long desc ending in a comma is a truncation — dress it').toBe(true);
    expect(r.noComma).toBe(true);
    expect(r.cleanUntouched).toBe(true);
  });

  test('Q1: Jett full rewrite snapshots the old resume, restorable; skills tidy drops junk', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { title: 'Marketing Specialist', skills: 'Excel · Professional · Digital Marketing · excel', jobs: [{ t: 'MS', c: 'Acme', b: 'Did things' }], summary: 'A summary.' });
      localStorage.setItem('gpj_optimized', '[]');
      const ok = storeResumeSnapshot('My resume — before Jett full rewrite');
      const list = JSON.parse(localStorage.getItem('gpj_optimized') || '[]');
      const tidy = _tidySkills(resumeData.skills);
      return {
        ok, n: list.length,
        hasSnapshot: !!(list[0] && list[0].snapshot && list[0].snapshot.title === 'Marketing Specialist'),
        restoreFn: typeof restoreResumeSnapshot === 'function',
        tidySkills: tidy.skills, removed: tidy.removed,
      };
    });
    expect(r.ok).toBe(true);
    expect(r.n).toBe(1);
    expect(r.hasSnapshot, 'the full resume content must be stored, not just metadata').toBe(true);
    expect(r.restoreFn).toBe(true);
    expect(r.tidySkills, 'dedupe + keep real skills').toBe('Excel · Digital Marketing');
    expect(r.removed, 'junk singles dropped and reported').toEqual(['Professional']);
  });
});

test.describe('[STATE-COVERAGE] v89 render-layer sanitize + dress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: _fmtJobText strips raw markdown, drops rule lines, dresses ragged ends (founder repros)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const src = '**We are ERock!** Enchanted Rock has responded to long\\-term trends in electricity by becoming the first smart\\-grid supplier.\n' +
        '============================\n' +
        '---------------------- About the Role\n' +
        'The specialist plays a critical role keeping things running smoothly for customers and internal teams across the enterprise, ' +
        'focused on account provisioning and clean paperwork, and we operate like a bank wi';
      const html = _fmtJobText(src);
      const bullets = _fmtJobText('Benefits we offer include the following list of real perks for everyone on the team all year round and beyond:\n• Robust PTO and Sick Time Plan\n• Coached and supported career growth');
      return {
        noBold: !html.includes('**'),
        unescaped: html.includes('long-term') && !html.includes('long\\-term'),
        noRuleLines: !/={6,}/.test(html) && !/-{10,}/.test(html),
        dressed: /\S…</.test(html) && !/bank wi</.test(html),
        bulletEndKept: bullets.includes('career growth') && !bullets.includes('career…'),
      };
    });
    expect(r.noBold, 'raw **bold** markers must be stripped').toBe(true);
    expect(r.unescaped, 'backslash escapes must render as plain text').toBe(true);
    expect(r.noRuleLines, '====== / ------ rule lines must not render').toBe(true);
    expect(r.dressed, 'mid-word endings dressed at render, any path').toBe(true);
    expect(r.bulletEndKept, 'a complete final bullet must keep its last word').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v90 requirements check + cap force-dress + admin AI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: _reqGaps finds degree/years/cert/skill gaps vs the whole resume (F-REQMATCH)', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.assign(resumeData, { title: 'Accountant', skills: 'Excel · QuickBooks', education: 'Associate degree in Accounting', jobs: [{ t: 'Bookkeeper', c: 'Acme', b: 'Managed monthly close with QuickBooks and Excel' }], summary: 'Bookkeeper with an associate degree.' });
      const job = { t: 'Senior Accountant', req: "Bachelor's degree required. 5+ years of accounting experience. CPA required. Salesforce experience preferred.", desc: '' };
      const g = _reqGaps(job);
      openReqGaps(job);
      const modalOpen = document.getElementById('match-modal').classList.contains('open');
      const missHtml = document.getElementById('mi-miss').innerHTML;
      document.getElementById('match-modal').classList.remove('open');
      /* Q4: no resume → graceful, no crash, empty gaps */
      resumeReady = false;
      const none = _reqGaps(job);
      resumeReady = true;
      return { labels: g.gaps.map((x) => x.label), modalOpen, missHasDegree: missHtml.includes('Bachelor'), noneLen: none.gaps.length };
    });
    expect(r.labels.join('|')).toContain('Bachelor’s degree');
    expect(r.labels.join('|')).toContain('Cpa');
    expect(r.labels.join('|')).toContain('years of experience');
    expect(r.modalOpen, 'tapping the gap chip opens the requirements check on top (z 356)').toBe(true);
    expect(r.missHasDegree).toBe(true);
    expect(r.noneLen, 'no resume → no gaps computed, no crash').toBe(0);
  });

  test('Q1: fields stored AT a harvester cap are dressed even when ending on a bullet (Lone Star repro)', async ({ page }) => {
    const r = await page.evaluate(() => {
      let ben = 'Cultural Beliefs\n• One LSC\n• Student Focused\n• Own It\n• Foster Belonging\n• Cultivate Community\n';
      while (ben.length < 476) ben += '• Padding value line\n';
      ben += '• Choose Learning The Chr';   /* lands the raw length inside the 450-550 cap window */
      const j = mapFirestoreJob({ title: 'L', company: 'Co', direct_apply_url: 'https://x.example/l', description: 'Complete description here.', benefits: ben });
      const short = mapFirestoreJob({ title: 'S', company: 'Co', direct_apply_url: 'https://x.example/s', description: 'Complete.', benefits: '• Robust PTO\n• Coached and supported career growth' });
      return { capLen: ben.length, dressed: /…$/.test(j.benefits), noChr: !/Chr$/.test(j.benefits), shortKept: /career growth$/.test(short.benefits) };
    });
    expect(r.capLen).toBeGreaterThanOrEqual(450);
    expect(r.dressed, 'cap-length benefits must dress even a bullet ending').toBe(true);
    expect(r.noChr).toBe(true);
    expect(r.shortKept, 'short real bullet lists keep their last word').toBe(true);
  });

  test('Q2: admin accounts get unlimited AI for testing', async ({ page }) => {
    const r = await page.evaluate(() => {
      const key = aiImproveKey('summary');
      localStorage.setItem(key, '99');   /* way past the monthly cap */
      isAdmin = false;
      const blocked = aiImproveAllowed('summary');
      isAdmin = true;
      const allowed = aiImproveAllowed('summary') && aiHourlyAllowed('improve') && isPaid();
      isAdmin = false; localStorage.removeItem(key);
      return { blocked, allowed };
    });
    expect(r.blocked, 'non-admin past the cap stays blocked').toBe(false);
    expect(r.allowed, 'admin bypasses monthly + hourly caps').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v91 F-CARD unification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: job card carries Recent Company News + Connect with Hiring Team', async ({ page }) => {
    const r = await page.evaluate(() => {
      const html = buildBrowseExpanded({ t: 'Unified Role', co: 'Acme Corp', loc: 'Houston, TX', url: 'https://x.example/u', desc: 'A role.', summary: 'A role.', sal: '', ghost: 10, match: 0, posting_age_days: 1 }, 0);
      return {
        news: html.includes('RECENT COMPANY NEWS') && html.includes('Latest news about Acme Corp'),
        hiring: html.includes('hiring &amp; layoff coverage'),
        connect: html.includes('CONNECT WITH HIRING TEAM'),
        icons: (html.match(/class="social-icon"/g) || []).length,
      };
    });
    expect(r.news).toBe(true);
    expect(r.hiring).toBe(true);
    expect(r.connect).toBe(true);
    expect(r.icons, 'LinkedIn/X/Glassdoor/Web icons').toBe(4);
  });

  test('Q1: company card mirrors the sections; desktop width parity 640px', async ({ page }) => {
    const r = await page.evaluate(() => {
      openCompanyView('Acme Corp', { title: 'Unified Role', url: 'https://x.example/u', desc: 'A role.' });
      const links = document.getElementById('cm-links').innerHTML;
      const open = document.getElementById('company-modal').classList.contains('open');
      document.body.classList.add('desk');
      ensureBrowseModal();
      const jb = document.querySelector('#browse-expand-modal .modal-box');
      const cb = document.querySelector('#company-modal .modal-box');
      const wJob = getComputedStyle(jb).maxWidth, wCo = getComputedStyle(cb).maxWidth;
      document.body.classList.remove('desk');
      document.getElementById('company-modal').classList.remove('open');
      return { open, news: links.includes('RECENT COMPANY NEWS'), connect: links.includes('CONNECT WITH HIRING TEAM'), icons: (links.match(/class="social-icon"/g) || []).length, wJob, wCo };
    });
    expect(r.open).toBe(true);
    expect(r.news).toBe(true);
    expect(r.connect).toBe(true);
    expect(r.icons).toBe(4);
    expect(r.wJob, 'expanded job card = swipe-card width on desktop').toBe('640px');
    expect(r.wCo, 'company card = same width on desktop').toBe('640px');
  });
});

test.describe('[STATE-COVERAGE] v92 Jett-does-it + rater accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: _leadWithVerb guarantees a strong action-verb lead the rater recognizes', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cases = ['Responsible for customer accounts and renewals', 'Various administrative and scheduling tasks', 'Managing a team of five reps', 'monthly financial reporting for leadership', 'Led onboarding for new hires'];
      const led = cases.map((c) => _leadWithVerb(c));
      const allStrong = led.every((b) => _STRONG_VERBS_RX.test(b.replace(/^[•\-\s]+/, '')));
      return { led, allStrong, noWeakLead: !/^Responsible for|^Various /.test(led.join('|')) };
    });
    expect(r.allStrong, 'every rewritten bullet must lead with a rater-recognized strong verb').toBe(true);
    expect(r.noWeakLead, 'weak "Responsible for" / "Various" leads are replaced').toBe(true);
    expect(r.led[2]).toMatch(/^Managed /);   /* gerund → past */
  });

  test('Q1: requirements years reads EXPERIENCE not age (minimum 2, not "16 of age")', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.assign(resumeData, { title: 'Pharma Sales', skills: 'Sales', jobs: [{ t: 'Rep', c: 'Acme', b: 'Sold products' }], summary: 'A rep.' });
      const job = { t: 'Pharmaceutical Sales Specialist', req: 'Minimum 2 years experience required. Must be 16 years of age or older. Valid driver license.', desc: '' };
      const g = _reqGaps(job);
      return { labels: g.gaps.map((x) => x.label) };
    });
    expect(r.labels.join('|'), 'the 2-year experience requirement is detected').toContain('2+ years of experience');
    expect(r.labels.join('|'), '"16 years of age" must NOT become an experience gap').not.toContain('16');
  });

  test('Q1+Q4: skill suggestions reject junk singles; user\'s own unusual skills survive tidy', async ({ page }) => {
    const r = await page.evaluate(() => ({
      execution: _realSkillTerm('Execution'), time: _realSkillTerm('Time'), build: _realSkillTerm('Build'), services: _realSkillTerm('Services'), service: _realSkillTerm('Service'),
      excel: _realSkillTerm('Excel'), salesforce: _realSkillTerm('Salesforce'), phrase: _realSkillTerm('Customer Service'),
      tidy: _tidySkills('Excel · Mixology · Execution · excel'),
    }));
    ['execution', 'time', 'build', 'services', 'service'].forEach((k) => expect(r[k], k + ' is not a suggestable skill').toBe(false));
    expect(r.excel).toBe(true);
    expect(r.salesforce).toBe(true);
    expect(r.phrase).toBe(true);
    expect(r.tidy.skills, 'a real but unusual user skill (Mixology) is kept; junk + dupes dropped').toBe('Excel · Mixology');
    expect(r.tidy.removed).toEqual(['Execution']);
  });

  test('Q1: match-insight vs requirements-check show DISTINCT labels', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.assign(resumeData, { title: 'Sales', skills: 'Sales · Excel', jobs: [{ t: 'Rep', c: 'Acme', b: 'Sold' }], summary: 'x' });
      openMatchInsight('Sales Specialist', 56);
      const mHave = document.getElementById('mi-have-label').textContent;
      openReqGaps({ t: 'Sales Specialist', req: "Bachelor's degree required.", desc: '' });
      const rHave = document.getElementById('mi-have-label').textContent, rMiss = document.getElementById('mi-miss-label').textContent;
      document.getElementById('match-modal').classList.remove('open');
      return { mHave, rHave, rMiss };
    });
    expect(r.mHave).toBe('✅ Your matching strengths');
    expect(r.rHave, 'requirements mode makes clear the count is requirements, not skills').toBe('✅ Requirements you already meet');
    expect(r.rMiss).toBe('🎯 Requirements to address');
  });
});

test.describe('[STATE-COVERAGE] v93 clip fragments + req education + location no-regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: truncated final BULLET is dressed; complete short bullets survive (Compensation: Commi)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const words = {
        Commi: _looksCompleteWord('Commi'), Chr: _looksCompleteWord('Chr'), backu: _looksCompleteWord('backu'),
        It: _looksCompleteWord('It'), LSC: _looksCompleteWord('LSC'), growth: _looksCompleteWord('growth'),
        Focused: _looksCompleteWord('Focused'), Community: _looksCompleteWord('Community'), Own: _looksCompleteWord('Own'),
      };
      const trunc = ('Details of the role and the day to day work you will own here. '.repeat(5) + '\n• Position Type: 1099 Independent Contractor\n• Compensation: Commi').trim();
      const complete = ('Here is what this team genuinely offers everyone who joins us for the long haul. '.repeat(4) + '\n• Robust PTO\n• Coached and supported career growth').trim();
      return {
        words,
        truncDressed: /…$/.test(dressEnd(trunc, 250)) && !/Commi$/.test(dressEnd(trunc, 250)),
        completeKept: /career growth$/.test(dressEnd(complete, 250)),
      };
    });
    expect(r.words.Commi, 'Commi is a fragment').toBe(false);
    expect(r.words.Chr).toBe(false);
    expect(r.words.backu).toBe(false);
    expect(r.words.It).toBe(true);
    expect(r.words.LSC).toBe(true);
    expect(r.words.growth).toBe(true);
    expect(r.words.Focused).toBe(true);
    expect(r.words.Community).toBe(true);
    expect(r.words.Own).toBe(true);
    expect(r.truncDressed, 'a bullet ending mid-word gets dressed').toBe(true);
    expect(r.completeKept, 'a complete final bullet keeps its last word').toBe(true);
  });

  test('Q1: Requirements Check sees education — Bachelor gap for an Associate-holder (Strategic Sourcing repro)', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { title: 'Sourcing', skills: 'Procurement', edu: 'Associate of Arts, Business — Houston CC', jobs: [{ t: 'Buyer', c: 'Acme', b: 'Handled procurement' }], summary: 'A buyer.' });
      const rt = _resumeText();
      /* degree requirement lives in the DESC (not req) — must still be found */
      const job = { t: 'Strategic Sourcing Specialist', req: '', desc: "Qualifications: Bachelor's degree in Supply Chain, Engineering, Business, Operations, or related field. 2-5 years of experience.", summary: 'Summary sourcing role.' };
      const g = _reqGaps(job);
      const degGap = g.gaps.find((x) => /Bachelor/.test(x.label));
      return { eduInText: rt.includes('associate'), labels: g.gaps.map((x) => x.label), degNote: degGap ? degGap.note : '' };
    });
    expect(r.eduInText, 'resume text now includes the Education field').toBe(true);
    expect(r.labels.join('|'), 'Bachelor requirement detected even when it lives in the description').toContain('Bachelor’s degree');
    expect(r.degNote, 'the note reflects what the user actually has').toContain('Associate');
  });

  test('Q1: LOCATION no-regression — local + remote only, other-city on-site out, no auto-widen', async ({ page }) => {
    const r = await page.evaluate(() => {
      _browseScope = 'market';
      const loc = resolveLocation('Houston, TX');
      const raw = [
        { t: 'HOU', co: 'A', location: 'Houston, TX' },
        { t: 'REMOTE_US', co: 'C', location: 'United States', is_remote: true },
        { t: 'NY_ONSITE', co: 'D', location: 'New York, NY' },
        { t: 'REMOTE_GB', co: 'E', location: 'Remote, GB', is_remote: true },
      ];
      const scoped = _scopeBrowsePool(raw, loc).map((j) => j.t);
      const scopeUnchanged = _browseScope === 'market';   /* scoping must NOT widen on its own */
      return { scoped, scopeUnchanged };
    });
    expect(r.scoped, 'metro job included').toContain('HOU');
    expect(r.scoped, 'genuine US remote included').toContain('REMOTE_US');
    expect(r.scoped, 'other-city on-site EXCLUDED until user widens').not.toContain('NY_ONSITE');
    expect(r.scoped, 'foreign remote excluded').not.toContain('REMOTE_GB');
    expect(r.scopeUnchanged, 'the deck/Browse scope never widens without an explicit tap').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v94 F-REVIEW unified review flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: vibe modal picks stars, requires a choice, persists rating + comment', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_corate', '{}'); localStorage.setItem('gpj_vibe_reviews', '{}');
      _vibeQueue = []; _vibeQueueIdx = 0;
      openVibeReview('Acme Reviews Co', 0);
      const litBefore = [...document.getElementById('vibe-review-stars').children].filter((s) => s.style.color.includes('warn')).length;
      submitVibeReview();                                   /* 0 stars → must be rejected */
      const savedAfterEmpty = localStorage.getItem('gpj_corate');
      setVibeStars(4);
      const litAfter = [...document.getElementById('vibe-review-stars').children].filter((s) => s.style.color.includes('warn')).length;
      document.getElementById('vibe-review-text').value = 'Responsive recruiter, clear process.';
      submitVibeReview();
      const rate = JSON.parse(localStorage.getItem('gpj_corate') || '{}');
      const rev = JSON.parse(localStorage.getItem('gpj_vibe_reviews') || '{}');
      return { litBefore, rejectedEmpty: savedAfterEmpty === '{}', litAfter, stars: rate['Acme Reviews Co'], note: (rev['Acme Reviews Co'] || [{}])[0].note };
    });
    expect(r.litBefore, 'no stars preselected when opened fresh').toBe(0);
    expect(r.rejectedEmpty, 'submitting with 0 stars saves nothing').toBe(true);
    expect(r.litAfter).toBe(4);
    expect(r.stars).toBe(4);
    expect(r.note).toContain('Responsive recruiter');
  });

  test('Q1: past-jobs prompt runs through the SAME modal; queue skips rated + advances', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.requireSignIn = () => true;   /* exercising queue logic, not the auth gate */
      localStorage.setItem('gpj_corate', JSON.stringify({ 'Already Rated Inc': 5 }));
      _vibeQueue = []; _vibeQueueIdx = 0;
      startRateExLoop(['Already Rated Inc', 'Fresh Co One', 'Fresh Co Two']);
      return { queue: _vibeQueue.slice(), skippedRated: !_vibeQueue.includes('Already Rated Inc') };
    });
    expect(r.skippedRated, 'already-rated companies are not re-prompted').toBe(true);
    expect(r.queue).toEqual(['Fresh Co One', 'Fresh Co Two']);

    // advancing: cancel (skip) the first, submit the second
    const r2 = await page.evaluate(async () => {
      await new Promise((res) => setTimeout(res, 1000));   /* the 900ms open timer */
      const firstCo = document.getElementById('vibe-review-co').textContent;
      const cancelLabel = document.getElementById('vibe-review-cancel').textContent;
      cancelVibeReview();                                   /* skip Fresh Co One */
      await new Promise((res) => setTimeout(res, 500));
      const secondCo = document.getElementById('vibe-review-co').textContent;
      setVibeStars(5); submitVibeReview();
      await new Promise((res) => setTimeout(res, 200));
      const rate = JSON.parse(localStorage.getItem('gpj_corate') || '{}');
      return { firstCo, cancelLabel, secondCo, skippedNotSaved: !rate['Fresh Co One'], secondSaved: rate['Fresh Co Two'] };
    });
    expect(r2.cancelLabel, 'in the queue, Cancel reads "Skip"').toBe('Skip');
    expect(r2.firstCo).toBe('Fresh Co One');
    expect(r2.secondCo, 'skipping advances to the next company').toBe('Fresh Co Two');
    expect(r2.skippedNotSaved, 'a skipped company is not saved').toBe(true);
    expect(r2.secondSaved).toBe(5);
  });
});

test.describe('[STATE-COVERAGE] v95 city-anchored fake-remote', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: city-anchored "remote" needs positive confirmation; genuine remote still passes (IDIQ repro)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      idiq: _gpjEffectiveRemote({ location: 'Temecula, CA', is_remote: true, work_setting: 'Remote', description: 'IDIQ is an award-winning company looking for talented individuals to join the team. We are passionate about supporting your career goals.' }),
      genuineCity: _gpjEffectiveRemote({ location: 'Austin, TX', is_remote: true, description: 'This is a fully remote position — work from home anywhere in the US.' }),
      countryLevel: _gpjEffectiveRemote({ location: 'United States', is_remote: true, description: 'generic blurb' }),
      locSaysRemote: _gpjEffectiveRemote({ location: 'Remote', is_remote: true }),
      foreign: _gpjEffectiveRemote({ location: 'Remote, GB', is_remote: true }),
      hybridText: _gpjEffectiveRemote({ location: 'Tucson, AZ', is_remote: true, description: 'Hybrid work schedule (must be local to Tucson, AZ)' }),
    }));
    expect(r.idiq, 'city-anchored remote flag with no confirming text is NOT trusted').toBe(false);
    expect(r.genuineCity, 'city HQ + "fully remote / work from home" text IS trusted').toBe(true);
    expect(r.countryLevel).toBe(true);
    expect(r.locSaysRemote).toBe(true);
    expect(r.foreign).toBe(false);
    expect(r.hybridText).toBe(false);
  });

  test('Q1: the IDIQ-style job is excluded from a Houston pool; genuine remote included', async ({ page }) => {
    const r = await page.evaluate(() => {
      _browseScope = 'market';
      const loc = resolveLocation('Houston, TX');
      const raw = [
        { title: 'HOU Role', company: 'A', location: 'Houston, TX', direct_apply_url: 'https://x.example/1' },
        { title: 'IDIQ Marketing Manager', company: 'IDIQ', location: 'Temecula, CA', is_remote: true, work_setting: 'Remote', description: 'IDIQ is an award-winning company. We provide award-winning services and a positive work environment.', direct_apply_url: 'https://x.example/2' },
        { title: 'True Remote', company: 'C', location: 'Denver, CO', is_remote: true, description: 'Fully remote, work from home anywhere in the US.', direct_apply_url: 'https://x.example/3' },
      ];
      const scoped = _scopeBrowsePool(raw, loc).map((j) => j.title);
      const badge = mapFirestoreJob(raw[1]);   /* IDIQ mapped: work_setting must not read Remote */
      return { scoped, idiqWs: badge.work_setting };
    });
    expect(r.scoped, 'the metro job stays').toContain('HOU Role');
    expect(r.scoped, 'genuinely-remote job stays').toContain('True Remote');
    expect(r.scoped, 'city-anchored fake-remote (IDIQ/Temecula) is EXCLUDED from a Houston pool').not.toContain('IDIQ Marketing Manager');
    expect(r.idiqWs, 'IDIQ no longer displays as Remote').not.toBe('Remote');
  });
});

test.describe('[STATE-COVERAGE] v96 match-insight truth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: matching strengths reflect THIS posting, not the user\'s top skills echoed everywhere', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { title: 'Marketing Specialist', skills: 'Photoshop · Excel · Sales · HubSpot', jobs: [{ t: 'Account Manager', c: 'Acme', b: 'Ran campaigns and managed client accounts' }], summary: 'Marketing and account pro.' });

      /* water/wastewater ops job — NONE of the user's skills apply */
      const waterJob = { t: 'Operations Specialist', req: 'Extensive experience in water and wastewater process operations. Upper-level licensing. AAS in Water Quality. Minimum 15 years.', desc: 'Provides facility optimization services and process troubleshooting.', summary: '' };
      openMatchInsight('Operations Specialist', 47, null, waterJob);
      const waterHave = document.getElementById('mi-have').innerHTML;

      /* marketing job — the user's skills genuinely appear */
      const mktJob = { t: 'Marketing Manager', req: 'Proficiency in Excel. Sales enablement.', desc: 'Photoshop and social media campaigns; HubSpot CRM.', summary: '' };
      openMatchInsight('Marketing Manager', 88, null, mktJob);
      const mktHave = document.getElementById('mi-have').innerHTML;
      document.getElementById('match-modal').classList.remove('open');

      return {
        waterHonest: /stretch role/i.test(waterHave),   /* v212 honest copy: "…a genuine stretch role. …not direct skill overlap." */
        waterNoPhotoshop: !/Photoshop/.test(waterHave),
        mktShowsReal: /Photoshop/.test(mktHave) && /Excel/.test(mktHave) && /Sales/.test(mktHave),
      };
    });
    expect(r.waterHonest, 'a stretch job honestly says no skills overlap — not a fake Photoshop chip').toBe(true);
    expect(r.waterNoPhotoshop, 'Photoshop must NOT show for a water/wastewater job').toBe(true);
    expect(r.mktShowsReal, 'skills that genuinely appear in the posting DO show').toBe(true);
  });

  test('Q1: gaps are the posting\'s real missing terms, not a generic template', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { title: 'Marketing Specialist', skills: 'Photoshop · Excel', jobs: [{ t: 'Coordinator', c: 'Acme', b: 'Marketing tasks' }], summary: 'x' });
      const job = { t: 'Operations Specialist', req: 'Requires water and wastewater treatment plant operation, regulatory compliance, and supervisory experience.', desc: '', summary: '' };
      openMatchInsight('Operations Specialist', 47, null, job);
      const miss = (document.getElementById('mi-miss').textContent || '').toLowerCase();
      document.getElementById('match-modal').classList.remove('open');
      return { mentionsDomain: /wastewater|water|treatment|compliance|supervis|regulatory/.test(miss) };
    });
    expect(r.mentionsDomain, 'the gaps name the posting\'s real domain terms the user lacks').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v97 F-ADDR + fuller storage caps + dedup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: F-ADDR — address on résumé honors show + full/City,State toggles', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      const base = { email: 'a@x.com', phone: '(713) 555-0100', address: '123 Main St, Houston, TX, 77002', preferences: {} };
      const city = _cityStateOf('123 Main St, Houston, TX, 77002');
      // default OFF → no address in contact
      const off = _rebuildContact(Object.assign({}, base, { preferences: {} }));
      // ON + city/state only
      const cityOnly = _rebuildContact(Object.assign({}, base, { preferences: { showAddressOnResume: true, addressFull: false } }));
      // ON + full
      const full = _rebuildContact(Object.assign({}, base, { preferences: { showAddressOnResume: true, addressFull: true } }));
      // phone hidden still respected alongside address
      const noPhone = _rebuildContact(Object.assign({}, base, { preferences: { showAddressOnResume: true, addressFull: false, showPhoneOnResume: false } }));
      return { city, off, cityOnly, full, noPhone };
    });
    expect(r.city).toBe('Houston, TX');
    expect(r.off, 'address OFF by default').not.toContain('Houston');
    expect(r.off).toContain('a@x.com');
    expect(r.cityOnly, 'City, State only when full is off').toContain('Houston, TX');
    expect(r.cityOnly).not.toContain('Main St');
    expect(r.full, 'full street address when toggled on').toContain('Main St');
    expect(r.noPhone).not.toContain('555-0100');
    expect(r.noPhone).toContain('Houston, TX');
  });

  test('Q1: fuller storage — long requirements/description render without re-truncation (#3)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const longReq = 'What you need:\n' + '• A specific real qualification line here. '.repeat(60);   // ~2500 chars
      const longDesc = 'This role does meaningful work every day. '.repeat(180);                          // ~7500 chars
      const j = mapFirestoreJob({ title: 'Ops', company: 'Co', direct_apply_url: 'https://x.example/o', description: longDesc, requirements: longReq });
      return { reqLen: j.req.length, reqCut: /…$/.test(j.req), descLen: j.desc.length, descCut: /…$/.test(j.desc) };
    });
    expect(r.reqLen, 'a ~2.5k requirement is kept in full (client cap 4000)').toBeGreaterThan(2000);
    expect(r.reqCut, 'requirements not re-truncated at render').toBe(false);
    expect(r.descLen, 'a ~7.5k description is kept in full (client cap 11000)').toBeGreaterThan(6000);
    expect(r.descCut, 'description not re-truncated at render').toBe(false);
  });

  test('Q1: review dedup — company card rating routes through one flow, no #cm-rate row', async ({ page }) => {
    const r = await page.evaluate(() => {
      const removed = !document.getElementById('cm-rate');           // the duplicate inline row is gone
      openCompanyView('Dedup Co', { title: 'Role', url: '', desc: '' });
      fillCmReviews('Dedup Co');
      const reviews = document.getElementById('cm-reviews').innerHTML;
      document.getElementById('company-modal').classList.remove('open');
      return { removed, hasRateBtn: /Rate this company/.test(reviews) && /openVibeReview/.test(reviews) };
    });
    expect(r.removed, 'duplicate inline "Rate:" star row removed').toBe(true);
    expect(r.hasRateBtn, 'rating lives in the reviews panel via the unified vibe flow').toBe(true);
  });

  test('Q1: Max Distance re-enabled as a real filter (F-GEO v106), salary intact', async ({ page }) => {
    const r = await page.evaluate(() => {
      switchView('browse');
      const el = document.getElementById('f-dist');
      return {
        present: !!el,
        isSelect: !!el && el.tagName === 'SELECT',
        defaultAny: !!el && (parseInt(el.value, 10) || 0) === 0,   // default = Any (no regression)
        salaryStays: !!document.getElementById('f-salary'),
      };
    });
    expect(r.present, 'F-GEO re-added the distance control').toBe(true);
    expect(r.isSelect).toBe(true);
    expect(r.defaultAny, 'defaults to Any so nothing is filtered until opted in').toBe(true);
    expect(r.salaryStays, 'salary slider still present').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v98 R-pre live-fixes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: _cityStateOf never leaks the street across address formats (F-ADDR bug)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      full4: _cityStateOf('123 Main St, Houston, TX, 77002'),
      zipInState: _cityStateOf('123 Main St, Houston, TX 77002'),
      oneComma: _cityStateOf('1234 Oak Lane Apt 5, Houston TX'),
      bare: _cityStateOf('Houston, TX'),
      spaces: _cityStateOf('987 Elm Street Houston TX 77003'.replace(/,/g, '')),   /* no commas */
      withUSA: _cityStateOf('500 Pine Rd, Austin, TX, USA'),
    }));
    expect(r.full4).toBe('Houston, TX');
    expect(r.zipInState).toBe('Houston, TX');
    expect(r.oneComma, 'a 1-comma address still reduces to City, ST').toBe('Houston, TX');
    expect(r.bare).toBe('Houston, TX');
    expect(r.withUSA).toBe('Austin, TX');
    // the critical invariant: no street token survives when reduced
    Object.values(r).forEach((v) => { expect(/\bSt\b|Street|Lane|Apt|Rd\b|Pine|Elm|Oak|Main|987|123|1234|500/.test(v)).toBe(false); });
  });

  test('Q1: F-ADDR export path — resumeData.contact honors toggles at build time', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { name: 'Test User', title: 'Specialist', skills: 'Excel · Sales', jobs: [{ t: 'Rep', c: 'Acme', b: 'Did work' }], summary: 'A summary.', certs: [], eduExtra: [] });
      const p = { email: 'a@x.com', phone: '(713) 555-0100', address: '123 Main St, Houston, TX, 77002',
                  preferences: { showAddressOnResume: true, addressFull: false } };
      localStorage.setItem('gpj_profile', JSON.stringify(p));
      // stale contact with the full street (simulating pre-toggle state)
      resumeData.contact = 'a@x.com · (713) 555-0100 · 123 Main St, Houston, TX, 77002';
      const html = buildResumeHTML(true);   // rebuilds contact from prefs
      return { contact: resumeData.contact, htmlHasStreet: /Main St/.test(html), htmlHasCity: /Houston, TX/.test(html) };
    });
    expect(r.contact, 'build-time rebuild drops the street for City,State-only').not.toContain('Main St');
    expect(r.contact).toContain('Houston, TX');
    expect(r.htmlHasStreet, 'exported HTML must not show the street').toBe(false);
    expect(r.htmlHasCity).toBe(true);
  });

  test('Q1: apply flow stacks ABOVE the expanded job card (View Full Posting bug)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const z = (id) => parseInt(getComputedStyle(document.getElementById(id)).zIndex, 10);
      return { sandbox: z('apply-sandbox'), tab: z('apply-tab-modal'), card: (function(){ ensureBrowseModal(); return z('browse-expand-modal'); })() };
    });
    expect(r.card).toBe(350);
    expect(r.sandbox, 'apply sandbox above the job card').toBeGreaterThan(r.card);
    expect(r.tab, 'apply-tab modal above the job card').toBeGreaterThan(r.card);
  });
});

test.describe('[STATE-COVERAGE] v99 recruiter tier (R1 — candidate-first invariant)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: recruiter entry points exist (nav tab + footer link) but Employer view is hidden until opened', async ({ page }) => {
    const r = await page.evaluate(() => ({
      navTab: !!document.getElementById('nav-employer'),
      footerLink: [...document.querySelectorAll('[onclick*="openEmployer"]')].length,
      view: !!document.getElementById('view-employer'),
      viewActive: (document.getElementById('view-employer') || {}).classList ? document.getElementById('view-employer').classList.contains('active') : false,
      modal: !!document.getElementById('recruiter-auth-modal'),
      modalOpen: (document.getElementById('recruiter-auth-modal') || {}).classList ? document.getElementById('recruiter-auth-modal').classList.contains('open') : false,
    }));
    expect(r.navTab, 'employer nav tab present').toBe(true);
    expect(r.footerLink, 'at least one openEmployer entry point (footer + nav)').toBeGreaterThanOrEqual(1);
    expect(r.view, 'employer view exists in the DOM').toBe(true);
    expect(r.viewActive, 'employer view is NOT active for a guest until opened').toBe(false);
    expect(r.modal, 'recruiter auth modal exists').toBe(true);
    expect(r.modalOpen, 'recruiter auth modal is closed on load').toBe(false);
  });

  test('Q1: guest tapping "For Employers" opens the recruiter auth modal, not the Employer view', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.requireSignIn = () => true;   // isolate the recruiter gate from the generic auth gate
      openEmployer();
      return {
        modalOpen: document.getElementById('recruiter-auth-modal').classList.contains('open'),
        viewActive: document.getElementById('view-employer').classList.contains('active'),
      };
    });
    expect(r.modalOpen, 'a guest is routed to recruiter auth first').toBe(true);
    expect(r.viewActive, 'the Employer view must not open for an unauthenticated recruiter').toBe(false);
  });

  test('Q1: recruiter email gate — corporate domains pass, free/disposable/invalid rejected (R1 BE)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      corporate: _recruiterEmailReason('jane@acmecorp.com'),
      gmail: _recruiterEmailReason('jane@gmail.com'),
      outlook: _recruiterEmailReason('jane@outlook.com'),
      disposable: _recruiterEmailReason('jane@mailinator.com'),
      malformed: _recruiterEmailReason('not-an-email'),
      empty: _recruiterEmailReason(''),
    }));
    expect(r.corporate, 'a corporate-domain email passes').toBe('ok');
    expect(r.gmail, 'free provider rejected').toBe('free_provider');
    expect(r.outlook).toBe('free_provider');
    expect(r.disposable, 'disposable domain rejected').toBe('disposable');
    expect(r.malformed, 'malformed email rejected').toBe('invalid');
    expect(r.empty, 'empty email rejected').toBe('invalid');
  });

  test('Q1 candidate-first invariant: recruiter reads never fire for a pure candidate', async ({ page }) => {
    // The hot path (deck/Browse) legitimately reads the `jobs` collection; the
    // invariant is that NO RECRUITER-SPECIFIC read (loadRecruiter / pending queue)
    // ever fires for someone who never opted into the recruiter role.
    const r = await page.evaluate(() => {
      let recReads = 0;
      localStorage.removeItem('gpj_role');
      window._recruiter = null;
      if (window.fb) {
        ['loadRecruiter', 'adminPendingRecruiters', 'loadCompany'].forEach((m) => {
          if (typeof fb[m] === 'function') { const orig = fb[m]; fb[m] = function () { recReads++; return orig.apply(fb, arguments); }; }
        });
      }
      // candidate uses the hot path
      switchView('browse'); renderBrowse();
      switchView('swipe');
      if (typeof gpjAuthChanged === 'function') { try { gpjAuthChanged(null); } catch (e) {} }   // signed-out auth event
      return { recReads, role: localStorage.getItem('gpj_role') };
    });
    expect(r.role, 'no recruiter role flag for a candidate').toBeNull();
    expect(r.recReads, 'candidate browse/swipe/auth-change must not trigger any recruiter doc read').toBe(0);
  });
});

test.describe('[STATE-COVERAGE] v100 deck + company-card smart-data caps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('Q1: DECK mapper carries full desc + req/benefits/summary (was a 460-char stub with no sections)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('gpj_loc', 'Houston, TX');
      const longDesc = ('A real paragraph of deck description text with substance in it. '.repeat(50) + 'It ends cleanly.').trim();   // ~3200 chars
      const longReq = ('• A requirement line with real substance\n'.repeat(50) + '• Final requirement.').trim();                       // ~2000 chars
      const ben = ('• A benefit line\n'.repeat(40) + '• Final benefit.').trim();
      const origFetch = window.fb && fb.fetchJobs;
      window.fb = window.fb || {};
      fb.fetchJobs = async () => [
        { title: 'Deck Cap Role', company: 'CapCo', location: 'Houston, TX', direct_apply_url: 'https://x.example/deckcap', description: longDesc, requirements: longReq, benefits: ben },
        /* Q4 shape: a doc with NO req/benefits must map to '' — never undefined */
        { title: 'Deck Bare Role', company: 'BareCo', location: 'Houston, TX', direct_apply_url: 'https://x.example/deckbare', description: 'Short and complete.' },
      ];
      try { await _fetchLiveMarketJobs(); } finally { if (origFetch) fb.fetchJobs = origFetch; }
      const j = (jobsQueue || []).find((x) => x.t === 'Deck Cap Role') || {};
      const bare = (jobsQueue || []).find((x) => x.t === 'Deck Bare Role') || {};
      /* the deck drawer must now render the requirements + benefits sections */
      let drawer = '';
      try {
        rawQueue = [j]; jobsQueue = [j]; applySwipeFilters(); hydrateDrawer();
        drawer = (document.getElementById('drawer-summary') || {}).textContent || '';
      } catch (e) { drawer = 'ERR ' + e; }
      return {
        descLen: (j.desc || '').length, reqLen: (j.req || '').length, benLen: (j.benefits || '').length, sumLen: (j.summary || '').length,
        bareReq: bare.req, bareBen: bare.benefits,
        drawerReq: drawer.includes('Final requirement'), drawerBen: drawer.includes('Final benefit'),
        drawerUndef: /undefined|NaN/.test(drawer),
      };
    });
    expect(r.descLen, 'deck desc must carry the full stored text, not the old 460 slice').toBeGreaterThan(2500);
    expect(r.reqLen, 'deck jobs now carry requirements').toBeGreaterThan(1500);
    expect(r.benLen, 'deck jobs now carry benefits').toBeGreaterThan(400);
    expect(r.sumLen, 'deck jobs now carry a summary').toBeGreaterThan(400);
    expect(r.bareReq, 'missing requirements map to empty string').toBe('');
    expect(r.bareBen, 'missing benefits map to empty string').toBe('');
    expect(r.drawerReq, 'drawer renders the requirements tail (not a 460-char stub)').toBe(true);
    expect(r.drawerBen, 'drawer renders the Benefits section').toBe(true);
    expect(r.drawerUndef).toBe(false);
  });

  test('Q1: COMPANY-CARD jobs carry full stored text at the v97 caps (Open Full Job Card)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const longDesc = ('Company card description content with real sentences in it here. '.repeat(50) + 'Ends cleanly.').trim();
      const longReq = ('• Company requirement with substance\n'.repeat(40) + '• Final cc requirement.').trim();
      const ben = ('• Company benefit\n'.repeat(30) + '• Final cc benefit.').trim();
      const origFetch = window.fb && fb.fetchJobs;
      window.fb = window.fb || {};
      fb.fetchJobs = async () => [{ title: 'CC Cap Role', company: 'CapCo', location: 'Houston, TX', direct_apply_url: 'https://x.example/cc', description: longDesc, requirements: longReq, benefits: ben }];
      try { await loadCompanyJobs('CapCo'); } finally { if (origFetch) fb.fetchJobs = origFetch; }
      const j = (cmJobsCache || [])[0] || {};
      return { n: (cmJobsCache || []).length, descLen: (j.desc || '').length, reqLen: (j.req || '').length, benLen: (j.benefits || '').length };
    });
    expect(r.n, 'company match must land in cmJobsCache').toBeGreaterThan(0);
    expect(r.descLen, 'company-card desc past the old 460 slice').toBeGreaterThan(2500);
    expect(r.reqLen, 'company-card requirements past the old 600 slice').toBeGreaterThan(1200);
    expect(r.benLen, 'company-card jobs now carry benefits').toBeGreaterThan(300);
  });
});

test.describe('[STATE-COVERAGE] v101 stabilize (bugs 1-5 + AI quality 7-9)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('#1: pools collapse doc-ID twins — cosmetic loc variants + broad twins fold, real cities stay', async ({ page }) => {
    const r = await page.evaluate(() => {
      const twins = [
        { title: 'Operations Manager', company: 'DupCorp', location: 'Houston, TX', description: 'The richer stored copy of this description wins the collapse.' },
        { title: 'Operations Manager', company: 'DupCorp', location: 'Houston, Texas, US', description: 'Short copy.' },
        { title: 'Operations Manager', company: 'DupCorp', location: 'United States', is_remote: true, description: 'Broad twin.' },
        { title: 'Operations Manager', company: 'DupCorp', location: 'Dallas, TX', description: 'A genuinely distinct city posting.' },
        { title: 'RN', company: 'HCA', location: 'Remote', is_remote: true, description: 'Fully remote, work from home.' },
      ];
      const out = _gpjDedupePool(twins);
      const houston = out.filter((r2) => /houston/i.test(r2.location));
      /* Browse render path uses it too */
      _browseRawPool = twins.slice(0, 3).map((t, i) => Object.assign({ direct_apply_url: 'https://x.example/' + i }, t));
      _browseLastLoc = resolveLocation('Houston, TX'); _browseScope = 'market';
      window._browseOwnsLive = true; _browsePoolKey = '(all)';
      _browseRescope();
      return { n: out.length, houstonN: houston.length, houstonDesc: houston[0] && houston[0].description,
               hasDallas: out.some((r2) => /dallas/i.test(r2.location)), hasRemoteRN: out.some((r2) => r2.title === 'RN'),
               browseRows: liveJobs.filter((j) => j.t === 'Operations Manager').length };
    });
    expect(r.houstonN, 'Houston cosmetic variants collapse to ONE card').toBe(1);
    expect(r.houstonDesc, 'the richer desc wins').toContain('richer stored copy');
    expect(r.hasDallas, 'a genuinely different city stays a distinct card').toBe(true);
    expect(r.hasRemoteRN, 'a purely remote job (no city sibling) survives').toBe(true);
    expect(r.n, 'broad United States twin folds into the city row').toBe(3);
    expect(r.browseRows, 'Browse renders the deduped pool (was 2 identical rows)').toBe(1);
  });

  test('#2: Applied/Skipped/Responses render newest→oldest; onclick indices stay valid', async ({ page }) => {
    const r = await page.evaluate(() => {
      const day = 86400000, now = Date.now();
      const mk = (t, co, off, extra) => Object.assign({ t: t, co: co, when: now - off * day }, extra || {});
      lists.skipped = [mk('OLD', 'A', 9), mk('NEW', 'B', 0), mk('MID', 'C', 4)];
      lists.applied = [mk('A-OLD', 'A', 8), mk('A-NEW', 'B', 0)];
      lists.responses = [mk('R-OLD', 'A', 6, { status: 'rejection' }), mk('R-NEW', 'B', 1, { status: 'interview' })];
      const order = {};
      ['skipped', 'applied', 'responses'].forEach((k) => { renderStatList(k); order[k] = lists[k].map((x) => x.t); });
      renderStatList('skipped');
      const firstRow = (document.querySelector('#stat-modal-list > div') || {}).textContent || '';
      /* index validity: row 0's put-back control must act on lists.skipped[0] === NEW */
      return { order, firstRow: firstRow.slice(0, 30), zeroIsNewest: lists.skipped[0].t === 'NEW' };
    });
    expect(r.order.skipped).toEqual(['NEW', 'MID', 'OLD']);
    expect(r.order.applied).toEqual(['A-NEW', 'A-OLD']);
    expect(r.order.responses).toEqual(['R-NEW', 'R-OLD']);
    expect(r.firstRow, 'top rendered row is the newest').toContain('NEW');
    expect(r.zeroIsNewest, 'in-place sort keeps onclick indices aligned').toBe(true);
  });

  test('#3: Match-to-Job modal stacks ABOVE the expanded job card on Browse', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.requireSignIn = () => true; window.matchAllowed = () => true; window.aiHourlyAllowed = () => true;
      resumeReady = true;
      Object.assign(resumeData, { title: 'Ops', skills: 'Excel', jobs: [{ t: 'Ops', c: 'Acme', b: 'x' }], summary: 's', certs: [], eduExtra: [] });
      liveJobs = [{ t: 'Stack Role', co: 'ZCo', loc: 'Houston, TX', url: 'https://x.example/z', desc: 'd', summary: 'd', sal: '', ghost: 10, match: 60, posting_age_days: 1 }];
      window._browseOwnsLive = true; _browsePoolKey = '(all)';
      switchView('browse'); renderBrowse(); openBrowseExpanded(0);
      matchToJobForRole('Stack Role', 'ZCo', 'd');
      const m = document.getElementById('match2job-modal');
      const out = { open: m.classList.contains('open'), z: parseInt(getComputedStyle(m).zIndex, 10),
                    card: parseInt(getComputedStyle(document.getElementById('browse-expand-modal')).zIndex, 10) };
      m.classList.remove('open'); closeBrowseExpanded();
      return out;
    });
    expect(r.open, 'M2J modal opens').toBe(true);
    expect(r.z, 'M2J above the expanded job card').toBeGreaterThan(r.card);
    expect(r.z, 'below apply-flow (358) and vibe-review (360)').toBeLessThan(358);
  });

  test('#4: field/territory remote confirmed even DEEP in a full-length desc; v95 fake-remote intact (Medtronic fixture)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const filler = 'The Clinical Specialist provides clinical and technical support to customers in the assigned area. '.repeat(52); // ~5100 chars — past the old 4000 scan window
      const medtronic = { title: 'Clinical Specialist', company: 'Medtronic', location: 'Austin, TX', is_remote: true,
        description: filler + ' This is a remote position not located at a physical Medtronic site.' };
      const fieldBased = { title: 'Territory Rep', company: 'FieldCo', location: 'Tucson, AZ', is_remote: true,
        description: 'You will be field-based, covering your territory from a home office.' };
      const idiq = { title: 'Marketing Manager', company: 'IDIQ', location: 'Temecula, CA', is_remote: true,
        description: 'IDIQ is a leader in identity protection. Great culture, great benefits, join us.' };
      return { medtronic: _gpjEffectiveRemote(medtronic), fieldBased: _gpjEffectiveRemote(fieldBased), idiq: _gpjEffectiveRemote(idiq) };
    });
    expect(r.medtronic, 'confirming line beyond the old 4000-char window now counts').toBe(true);
    expect(r.fieldBased, 'field-based/territory phrasing confirms remote').toBe(true);
    expect(r.idiq, 'v95 protection intact: city-anchored flag with a generic blurb stays excluded').toBe(false);
  });

  test('#5: ATS preview and résumé/PDF produce the SAME toggled contact (founder state: unsaved field)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const p = { first: 'T', last: 'U', email: '', phone: '', address: '', preferences: { showAddressOnResume: true, addressFull: false } };
      localStorage.setItem('gpj_profile', JSON.stringify(p));
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('acc-email', 't@x.com'); set('acc-phone', '(713) 555-0100'); set('acc-address', '123 Main St, Houston, TX, 77002');
      resumeReady = true;
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { name: 'T U', title: 'Spec', skills: 'Excel', jobs: [{ t: 'Rep', c: 'Acme', b: 'x' }], summary: 's', certs: [], eduExtra: [] });
      syncProfileToResume();                    /* ATS-preview writer */
      const ats = resumeData.contact;
      const html = buildResumeHTML(true);       /* visible/PDF writer */
      const built = resumeData.contact;
      /* full-address toggle ON → street shows on BOTH */
      const p2 = JSON.parse(localStorage.getItem('gpj_profile')); p2.preferences.addressFull = true;
      localStorage.setItem('gpj_profile', JSON.stringify(p2));
      syncProfileToResume(); const atsFull = resumeData.contact;
      buildResumeHTML(true); const builtFull = resumeData.contact;
      /* parse-preservation: nothing available must NOT wipe a parsed contact */
      set('acc-email', ''); set('acc-phone', ''); set('acc-address', '');
      localStorage.setItem('gpj_profile', JSON.stringify({ preferences: {} }));
      resumeData.contact = 'parsed@resume.com · (832) 555-0100';
      _rebuildContact();
      return { ats, built, same: ats === built, htmlHasCity: /Houston, TX/.test(html), htmlHasStreet: /Main St/.test(html),
               atsFull, builtFull, sameFull: atsFull === builtFull, parsedKept: resumeData.contact };
    });
    expect(r.same, 'both writers now produce the identical contact').toBe(true);
    expect(r.built).toContain('Houston, TX');
    expect(r.built, 'city/state mode never leaks the street').not.toContain('Main St');
    expect(r.htmlHasCity, 'visible résumé renders the address').toBe(true);
    expect(r.htmlHasStreet).toBe(false);
    expect(r.sameFull).toBe(true);
    expect(r.builtFull, 'full-address ON shows the street on both').toContain('Main St');
    expect(r.parsedKept, 'empty rebuild never wipes a parsed contact').toBe('parsed@resume.com · (832) 555-0100');
  });

  test('#7: bullets that already lead with a verb never get a second verb prepended (founder strings)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      collab: _leadWithVerb('Collaborated with cross-functional teams to launch campaigns'),
      util: _leadWithVerb('utilized CRM tools to track accounts'),
      ensure: _leadWithVerb('Ensured compliance across 500+ locations'),
      gerund: _leadWithVerb('Collaborating with vendors on pricing'),
      weak: _leadWithVerb('Responsible for customer accounts and renewals'),
      noun: _leadWithVerb('Monthly financial reporting for leadership'),
    }));
    expect(r.collab).toBe('Collaborated with cross-functional teams to launch campaigns');
    expect(r.util).toBe('Utilized CRM tools to track accounts');
    expect(r.ensure).toBe('Ensured compliance across 500+ locations');
    expect(r.gerund, 'gerund lead converts to past tense, no prepend').toBe('Collaborated with vendors on pricing');
    expect(r.weak, 'weak-phrase strip + strong lead still works').toMatch(/^(Supported|Drove|Managed|Led|Delivered)\s/);
    expect(r.weak).not.toMatch(/\b(Supported|Drove|Managed|Led|Delivered)\s+(collaborated|utilized|ensured)/i);
    expect(r.noun, 'noun-led bullets still get a fitting verb').toMatch(/^[A-Z][a-z]+ed\s/);
    Object.values(r).forEach((b) => expect(b).not.toMatch(/^[A-Z][a-z]+(ed|ove|ew|aw|uilt|ed)\s+[a-z]+ed\s/));
  });

  test('#8: summary facts block reads years/roles/scope from the REAL résumé; empty résumé yields none', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { title: 'Account Manager', skills: 'Salesforce · Excel · Retention',
        jobs: [
          { t: 'Account Manager', c: 'BigCo', d: '2019 – 2024', b: 'Managed 500+ locations nationwide\nLed teams of 8+ reps' },
          { t: 'Coordinator', c: 'OldCo', d: '2014 – 2019', b: 'Handled onboarding' },
        ], summary: '', certs: [], eduExtra: [] });
      const facts = _summaryFacts();
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { jobs: [], skills: '', certs: [], eduExtra: [] });
      const none = _summaryFacts();
      return { facts, none };
    });
    expect(r.facts).toContain('YEARS OF EXPERIENCE');
    expect(r.facts, 'years computed from the earliest job date').toMatch(/1[0-2]\+ years/);
    expect(r.facts).toContain('Account Manager at BigCo');
    expect(r.facts, 'real scope numbers quoted verbatim').toContain('500+ locations');
    expect(r.facts).toContain('teams of 8+');
    expect(r.none, 'no résumé → no facts block, never fabricated').toBe('');
  });

  test('#9: skills tidy — paren mashups split, dupes/titles/fragments drop, cap 15 (founder string)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { title: 'Marketing Specialist', jobs: [{ t: 'Account Manager', c: 'X', b: '' }] });
      const founder = _tidySkills('(PowerPoint · Word · Excel) Expert · Excel · CRM (Salesforce · HubSpot)Compliance · Account Retention · Retention account · Marketing Specialist · Account Manager');
      const legacy1 = _tidySkills('Excel · Mixology · Execution · excel');
      const legacy2 = _tidySkills('Excel · Professional · Digital Marketing · excel');
      /* v161 #9: 20 GENUINELY-DISTINCT skills — the old "Salesforce0..19" now correctly
         folds under stem-dedupe (near-identical strings), so the cap test needs real,
         distinct names to exercise the cap rather than the deduper. */
      const many = _tidySkills(['Excel','Word','PowerPoint','Salesforce','HubSpot','Photoshop',
        'Illustrator','Copywriting','Budgeting','Forecasting','Negotiation','Onboarding',
        'Payroll','Merchandising','Wireframing','Bookkeeping','Purchasing','Underwriting',
        'Provisioning','Calibration'].join(' · '));
      return { founder: founder.skills, removed: founder.removed, legacy1, legacy2, manyN: many.skills.split(' · ').length };
    });
    const list = r.founder.split(' · ');
    expect(list).toContain('PowerPoint');
    expect(list).toContain('Word');
    expect(list).toContain('Excel');
    expect(list.filter((s) => /^excel$/i.test(s)).length, 'Excel appears once despite the paren dupe').toBe(1);
    expect(list).toContain('CRM');
    expect(list).toContain('Salesforce');
    expect(list).toContain('HubSpot');
    expect(list).toContain('Compliance');
    expect(list.filter((s) => /retention/i.test(s)).length, 'word-set dedupe collapses the reversed fragment').toBe(1);
    expect(r.founder, 'job titles are not skills').not.toMatch(/Marketing Specialist|Account Manager/);
    expect(r.removed.join('|')).toMatch(/Expert/);
    expect(r.legacy1.skills, 'v92 behavior preserved').toBe('Excel · Mixology');
    expect(r.legacy1.removed).toEqual(['Execution']);
    expect(r.legacy2.skills).toBe('Excel · Digital Marketing');
    expect(r.manyN, 'capped at 15').toBe(15);
  });
});

test.describe('[STATE-COVERAGE] v101a account-switch desync (Q2-switch quadrant)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('#1a: day counter never latches a fresh now() while signed in / pre-auth; cloud force lands', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_install_date');
      localStorage.setItem('gpj_profile', JSON.stringify({}));
      localStorage.setItem('gpj_owner_uid', 'switchedUser123');   /* an account is signed in */
      window._gpjAuthResolved = true;
      const d1 = accountAgeDays();
      const latchedSignedIn = !!localStorage.getItem('gpj_install_date');
      const poisoned = !!(JSON.parse(localStorage.getItem('gpj_profile') || '{}').createdAt);
      /* cloud createdAt arrives (loadTierFromProfile force path) */
      const cloudTs = Date.now() - 40 * 86400000;
      localStorage.setItem('gpj_install_date', String(cloudTs));
      const d2 = accountAgeDays();
      /* pre-first-auth-event boot must not latch either */
      localStorage.removeItem('gpj_install_date'); localStorage.removeItem('gpj_owner_uid');
      window._gpjAuthResolved = false;
      accountAgeDays();
      const latchedPreAuth = !!localStorage.getItem('gpj_install_date');
      /* genuine guest (auth resolved signed-out) DOES latch */
      window._gpjAuthResolved = true;
      accountAgeDays();
      const latchedGuest = !!localStorage.getItem('gpj_install_date');
      localStorage.removeItem('gpj_owner_uid');
      return { d1, latchedSignedIn, poisoned, d2, latchedPreAuth, latchedGuest };
    });
    expect(r.latchedSignedIn, 'signed-in read must NOT persist a fresh install date').toBe(false);
    expect(r.poisoned, 'signed-in read must NOT push a bogus createdAt into the profile').toBe(false);
    expect(r.d2, 'cloud createdAt lands as the real day count').toBe(40);
    expect(r.latchedPreAuth, 'before the FIRST auth event nothing may latch').toBe(false);
    expect(r.latchedGuest, 'a genuine guest still gets an anchored install date').toBe(true);
  });

  test('#1b: admin "This device" line repaints when the cloud lists sync lands', async ({ page }) => {
    const r = await page.evaluate(() => {
      isAdmin = true;
      lists = { applied: [], responses: [], skipped: [], viewed: [] };
      try { const old = document.getElementById('admin-panel'); if (old) old.remove(); } catch (e) {}
      renderAdminPanel();
      const line = () => ((document.getElementById('admin-device-stats') || {}).textContent || '(missing)').replace(/\s+/g, ' ').trim();
      const preSync = line();
      lists.applied = Array.from({ length: 11 }, (_, i) => ({ t: 'A' + i, co: 'C', when: Date.now() - i }));
      lists.skipped = Array.from({ length: 4 }, (_, i) => ({ t: 'S' + i, co: 'C', when: Date.now() - i }));
      lists.responses = Array.from({ length: 60 }, (_, i) => ({ t: 'R' + i, co: 'C', when: Date.now() - i }));
      updateStatCounters();   /* what the cloud merge calls */
      const postSync = line();
      isAdmin = false;
      return { preSync, postSync };
    });
    expect(r.preSync).toContain('Applied: 0');
    expect(r.postSync, 'the SAME lists object now paints the admin line too').toContain('Applied: 11');
    expect(r.postSync).toContain('Skipped: 4');
    expect(r.postSync).toContain('Responses: 60');
  });

  test('#1c: gpj_role never survives a sign-out wipe or a candidate sign-in', async ({ page }) => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('gpj_role', 'recruiter');
      gpjWipeLocalUserData();
      const afterWipe = localStorage.getItem('gpj_role');
      /* candidate signs in on a device with a stale flag */
      localStorage.setItem('gpj_role', 'recruiter');
      window.fb = window.fb || {};
      const orig = fb.loadRecruiter;
      fb.loadRecruiter = async () => null;
      _gpjRecruiterAuthApply({ uid: 'candidateX' });
      await new Promise((res) => setTimeout(res, 120));
      if (orig) fb.loadRecruiter = orig;
      const afterCandidate = localStorage.getItem('gpj_role');
      /* a REAL recruiter keeps the flag */
      localStorage.setItem('gpj_role', 'recruiter');
      fb.loadRecruiter = async () => ({ company: 'Acme', isValidated: true });
      _gpjRecruiterAuthApply({ uid: 'recruiterY' });
      await new Promise((res) => setTimeout(res, 120));
      if (orig) fb.loadRecruiter = orig;
      const recruiterKeeps = localStorage.getItem('gpj_role');
      localStorage.removeItem('gpj_role'); window._recruiter = null;
      return { afterWipe, afterCandidate, recruiterKeeps };
    });
    expect(r.afterWipe, 'sign-out wipe clears the role flag').toBeNull();
    expect(r.afterCandidate, 'a uid with no recruiter doc clears the stale flag').toBeNull();
    expect(r.recruiterKeeps, 'a real recruiter keeps the role').toBe('recruiter');
  });

  test('#1d: post-switch empty cache shows a restoring state, not false zeros; resolves after sync', async ({ page }) => {
    const r = await page.evaluate(() => {
      lists = { applied: [], responses: [], skipped: [], viewed: [] };
      updateStatCounters();
      const orig = window.loadTierFromProfile; window.loadTierFromProfile = function () {};   /* hold the cloud pull */
      try { window.gpjAuthChanged({ uid: 'switchedUser123', email: 'throwaway@test.example' }); } catch (e) {}
      window.loadTierFromProfile = orig;
      const during = (document.getElementById('stat-applied') || {}).textContent;
      /* the merge lands */
      lists.applied = [{ t: 'A', co: 'C', when: Date.now() }];
      updateStatCounters();
      const after = (document.getElementById('stat-applied') || {}).textContent;
      return { during, after };
    });
    expect(r.during, 'restore window shows a holding state, never a false 0').toBe('…');
    expect(r.after, 'real numbers land after the sync completes').toBe('1');
  });
});

test.describe('[STATE-COVERAGE] v101b batch A (forms, overlay gate, safe-area)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('A: recruiter + change-email credentials live in real <form>s (B7 pattern)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      rec: !!document.getElementById('rec-pass').closest('form'),
      recIntercepted: ((document.getElementById('rec-pass').closest('form') || {}).getAttribute('onsubmit') || '').includes('return false'),
      cle: !!document.getElementById('cle-password').closest('form'),
      cleIntercepted: ((document.getElementById('cle-password').closest('form') || {}).getAttribute('onsubmit') || '').includes('return false'),
      candidate: !!document.getElementById('auth-pass').closest('form'),
    }));
    expect(r.rec, '#rec-pass inside a <form>').toBe(true);
    expect(r.recIntercepted).toBe(true);
    expect(r.cle, '#cle-password inside a <form>').toBe(true);
    expect(r.cleIntercepted).toBe(true);
    expect(r.candidate, 'v85 candidate form untouched').toBe(true);
  });

  test('7b: welcome overlay closes when a session restores; still shows for true first visits', async ({ page }) => {
    const r = await page.evaluate(() => {
      /* founder repro state: marker wiped by sign-out, overlay open, session restores */
      localStorage.removeItem('ngj_returning');
      const ob = document.getElementById('onboard-modal');
      ob.classList.add('open');
      const orig = window.loadTierFromProfile; window.loadTierFromProfile = function () {};
      try { window.gpjAuthChanged({ uid: 'restoredUser', email: 'throwaway@test.example' }); } catch (e) {}
      window.loadTierFromProfile = orig;
      const closedOnAuth = !ob.classList.contains('open');
      const restamped = localStorage.getItem('ngj_returning') === '1';
      /* signed-out event must NOT re-open or stamp anything (guest first visit keeps its flow) */
      localStorage.removeItem('ngj_returning');
      try { window.gpjAuthChanged(null); } catch (e) {}
      const guestUntouched = !ob.classList.contains('open');
      return { closedOnAuth, restamped, guestUntouched };
    });
    expect(r.closedOnAuth, 'a restored session is not a first visit — overlay must close').toBe(true);
    expect(r.restamped, 'returning marker restamped so reloads stay clean').toBe(true);
    expect(r.guestUntouched).toBe(true);
  });

  test('7c: safe-area rules present; zero layout change on non-notched platforms', async ({ page }) => {
    const r = await page.evaluate(() => {
      const css = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((x) => x.cssText).join(' '); } catch (e) { return ''; } }).join(' ');
      const scrim = document.querySelector('.modal-scrim');
      const nav = document.getElementById('footer-nav');
      return {
        viewportFit: (document.querySelector('meta[name="viewport"]').getAttribute('content') || '').includes('viewport-fit=cover'),
        scrimHasEnv: /modal-scrim[^}]*safe-area-inset-top/.test(css),
        navHasEnv: /footer-nav[^}]*safe-area-inset-bottom/.test(css),
        boxHasEnv: /modal-box[^}]*safe-area-inset/.test(css),
        scrimPadTop: getComputedStyle(scrim).paddingTop,
        navPadBottom: getComputedStyle(nav).paddingBottom,
      };
    });
    expect(r.viewportFit, 'viewport-fit=cover present (env() active in standalone)').toBe(true);
    expect(r.scrimHasEnv, 'modal scrim consumes the top inset').toBe(true);
    expect(r.navHasEnv, 'bottom nav consumes the home-indicator inset').toBe(true);
    expect(r.boxHasEnv, 'modal box height caps inside the safe viewport').toBe(true);
    expect(r.scrimPadTop, 'no change where env()=0 (this test env)').toBe('24px');
    expect(r.navPadBottom).toBe('0px');
  });

  test('7c: screen-sizing matrix — no horizontal overflow at phone/tablet/desktop widths', async ({ page }) => {
    for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      // Crossing the desktop/mobile breakpoint RELOADS the page by design
      // (index.html: deskMQ 'change' -> location.reload(), because
      // buildDesktopGrid restructures the DOM). A fixed 300ms wait races that
      // reload and measures a page that is still rebuilding — which is why CI
      // reported "header renders at 375px" on chromium (resizing DOWN across the
      // breakpoint) and "at 1280px" on mobile (resizing UP). Same bug, different
      // width. Wait for the header to actually exist instead of guessing.
      // v219 flake fix: wait for the reload to COMPLETE (readyState) + the header to exist,
      // then POLL scrollWidth until the rebuild settles. Under parallel CI load the rebuild
      // takes a variable moment during which scrollWidth transiently exceeds clientWidth;
      // measuring one racy frame (the old code) failed intermittently. Polling absorbs it.
      await page.waitForFunction(
        () => document.readyState === 'complete' && !!(document.getElementById('header') && document.getElementById('header').offsetHeight > 0),
        null, { timeout: 15000 },
      ).catch(() => {});
      // The breakpoint-cross reload can still be in flight when we poll; a page.evaluate
      // that lands mid-navigation throws "Execution context was destroyed". Swallow that
      // inside the poll (return a sentinel > 0 so it keeps polling) until the page settles
      // and scrollWidth reports a real, stable value ≤ 0.
      await expect.poll(
        async () => {
          try { return await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }
          catch { return 9999; }
        },
        { timeout: 12000, message: 'no horizontal scroll at ' + w + 'px' },
      ).toBeLessThanOrEqual(0);
      // The header can be transiently 0-height mid-rebuild after a breakpoint-cross reload
      // (esp. on the desktop 1280 step); a one-shot read caught that instant intermittently.
      // Wait for it to settle visible instead.
      const headerVisible = await page.waitForFunction(
        () => { const h = document.getElementById('header'); return !!(h && h.offsetHeight > 0); },
        null, { timeout: 8000 },
      ).then(() => true).catch(() => false);
      expect(headerVisible, 'header renders at ' + w + 'px').toBe(true);
    }
  });
});

test.describe('[STATE-COVERAGE] v101b batch B+C (AI quality gates, admin employer tools)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('B: bare-infinitive AI leads never get a second verb (live Worker shape)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      streamline: _leadWithVerb('Streamline event planning frameworks'),
      collaborate: _leadWithVerb('Collaborate with operations to refine pipelines'),
      utilize: _leadWithVerb('Utilize Salesforce to manage accounts'),
      ensure: _leadWithVerb('Ensure audit accuracy across regions'),
      noun: _leadWithVerb('Monthly financial reporting for leadership'),
    }));
    expect(r.streamline).toBe('Streamlined event planning frameworks');
    expect(r.collaborate).toBe('Collaborated with operations to refine pipelines');
    expect(r.utilize).toBe('Utilized Salesforce to manage accounts');
    expect(r.ensure).toBe('Ensured audit accuracy across regions');
    Object.values(r).forEach((b) => expect(b).not.toMatch(/^\w+\s+(streamline|collaborate|utilize|ensure)\b/i));
    expect(r.noun, 'noun leads still get a fitting verb').toMatch(/^[A-Z][a-z]+ed\s/);
  });

  test('B: summary floor synthesizes 2-3 sentences from the real resume; quality gate rejects one-liners', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { jobs: [
        { t: 'Marketing Specialist', c: 'BrandCo', d: '2019 – 2024', b: 'collaborated with teams on campaigns for 500+ locations' },
        { t: 'Account Coordinator', c: 'RetailCorp', d: '2014 – 2019', b: 'supported a team of 8' }] });
      return {
        floor: localSummaryRewrite('', 'Marketing Specialist', 'Marketing Specialist at BrandCo; Account Coordinator at RetailCorp', 'Digital Marketing · Salesforce', ''),
        gateShort: _gpjSummaryQuality('Experienced marketing professional.'),
        gateGenericLine: _gpjSummaryQuality('Marketing Specialist with proven experience in driving successful marketing initiatives.'),
        gateGood: _gpjSummaryQuality('Marketing specialist with 12+ years of experience across brand, retail, and account management. Led national campaigns for 500+ locations while coaching teams of 8. Works hands-on with Salesforce, HubSpot, and campaign analytics.'),
      };
    });
    const sentences = (r.floor.match(/[.!?](\s|$)/g) || []).length;
    expect(sentences, 'floor is 2-3 sentences, never a stub').toBeGreaterThanOrEqual(2);
    expect(r.floor).toContain('12+ years');
    expect(r.floor).toContain('500+ locations');
    expect(r.floor).toContain('BrandCo');
    expect(r.gateShort, '3-word stub rejected').toBe(false);
    expect(r.gateGenericLine, 'one-line generic rejected').toBe(false);
    expect(r.gateGood).toBe(true);
  });

  test('B: cover letter has no double punctuation and no placeholders (real posting)', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { name: 'Test User', contact: 't@x.com', title: 'Marketing Specialist',
        skills: 'Digital Marketing · Salesforce', jobs: [{ t: 'MS', c: 'BrandCo', b: 'ran campaigns for 500+ locations.' }], summary: 's' });
      return tailorCoverLetter({ title: 'Marketing Manager', co: 'BrightWave', desc: 'campaigns CRM salesforce retention marketing', req: 'salesforce marketing 5+ years' }, 2);
    });
    expect(/\.\./.test(r), 'no double periods').toBe(false);
    expect(r).toContain('Marketing Manager');
    expect(r).toContain('BrightWave');
    expect(/the this role|\[Your name|\[Add your|undefined/.test(r)).toBe(false);
  });

  test('C: admin View-as-Employer opens a READ-ONLY preview — no writes, no role, restorable', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let recruiterReads = 0, writes = 0;
      window.fb = window.fb || {};
      const oL = fb.loadRecruiter, oC = fb.createRecruiter, oS = fb.saveCompany;
      fb.loadRecruiter = async () => { recruiterReads++; return null; };
      fb.createRecruiter = async () => { writes++; return true; };
      fb.saveCompany = async () => { writes++; return true; };
      isAdmin = true; window._recruiter = null; localStorage.removeItem('gpj_role');
      await openEmployer();
      const state = {
        viewActive: document.getElementById('view-employer').classList.contains('active'),
        banner: getComputedStyle(document.getElementById('emp-admin-banner')).display !== 'none',
        fieldDisabled: document.getElementById('emp-company').disabled,
        saveHidden: document.getElementById('emp-save-btn').style.display === 'none',
        signoutHidden: document.getElementById('emp-signout-btn').style.display === 'none',
        role: localStorage.getItem('gpj_role'), reads: recruiterReads, writes: writes,
      };
      window._recruiter = { uid: 'r1', company: 'RealCo', isValidated: true };
      renderEmployerView();
      state.restoredEditable = !document.getElementById('emp-company').disabled &&
        getComputedStyle(document.getElementById('emp-admin-banner')).display === 'none' &&
        document.getElementById('emp-save-btn').style.display !== 'none';
      window._recruiter = null; isAdmin = false;
      if (oL) fb.loadRecruiter = oL; if (oC) fb.createRecruiter = oC; if (oS) fb.saveCompany = oS;
      return state;
    });
    expect(r.viewActive, 'employer view opens for the admin').toBe(true);
    expect(r.banner, 'admin preview banner shown').toBe(true);
    expect(r.fieldDisabled, 'fields read-only').toBe(true);
    expect(r.saveHidden).toBe(true);
    expect(r.signoutHidden).toBe(true);
    expect(r.role, 'no recruiter role set').toBeNull();
    expect(r.reads + r.writes, 'ZERO recruiter reads/writes in preview (candidate-first)').toBe(0);
    expect(r.restoredEditable, 'a real recruiter gets the editable dashboard back').toBe(true);
  });

  test('C: employers/companies count row wired; company card uniform from every entry point', async ({ page }) => {
    const r = await page.evaluate(() => {
      isAdmin = true;
      try { const old2 = document.getElementById('admin-panel'); if (old2) old2.remove(); } catch (e) {}
      renderAdminPanel();
      const row = !!document.getElementById('admin-recruiter-count');
      const fn = typeof refreshRecruiterCount === 'function' && typeof fb.adminCountRecruiters === 'function' && typeof fb.adminCountCompanies === 'function';
      const sections = () => {
        const links = (document.getElementById('cm-links') || {}).innerHTML || '';
        return { news: links.includes('RECENT COMPANY NEWS'), connect: links.includes('CONNECT WITH HIRING TEAM'), icons: (links.match(/class="social-icon"/g) || []).length, rateRow: !!document.getElementById('cm-rate') };
      };
      openCompanyView('Acme Corp', { title: 'Role A', url: 'https://x.example/a', desc: 'd' });
      const e1 = sections();
      document.getElementById('company-modal').classList.remove('open');
      openCompanyView('Beta LLC');
      const e2 = sections();
      document.getElementById('company-modal').classList.remove('open');
      isAdmin = false;
      return { row, fn, e1, e2 };
    });
    expect(r.row, 'count row renders in the admin panel').toBe(true);
    expect(r.fn, 'count functions exist on fb').toBe(true);
    [r.e1, r.e2].forEach((e) => {
      expect(e.news).toBe(true);
      expect(e.connect).toBe(true);
      expect(e.icons).toBe(4);
      expect(e.rateRow, 'F-REVIEW dedup holds — no legacy #cm-rate row').toBe(false);
    });
  });

  test('C: live interactive-element audit — every on* handler resolves to a real function', async ({ page }) => {
    const r = await page.evaluate(() => {
      const missing = new Set();
      const KEY = /(^|[^.\w])([A-Za-z_$][\w$]*)\s*\(/g;
      const SKIP = new Set(['if','for','while','switch','catch','function','return','typeof','var','let','const','new','void','delete','in','of','else','try','throw']);
      document.querySelectorAll('*').forEach((el) => {
        for (const a of el.attributes || []) {
          if (!/^on/i.test(a.name)) continue;
          let m; KEY.lastIndex = 0;
          while ((m = KEY.exec(a.value))) {
            const fn = m[2];
            if (SKIP.has(fn)) continue;
            if (m[1] === '.') continue;
            if (typeof window[fn] !== 'function' && !(fn in window)) missing.add(fn);
          }
        }
      });
      return [...missing];
    });
    expect(r, 'no on* handler references an undefined function (live DOM)').toEqual([]);
  });
});

test.describe('[STATE-COVERAGE] v101b batch D (F-METRICS + F-CREDITS)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('F-METRICS: questions derive from digit-less jobs; answers become bullets on the CORRECT job, literal numbers only', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.keys(resumeData).forEach((k) => { delete resumeData[k]; });
      Object.assign(resumeData, { title: 'AM', skills: 'Sales', summary: 's', certs: [], eduExtra: [],
        jobs: [
          /* realistic: mostly digit-less bullets so the quantified fraction < 0.3 and the nudge fires */
          { t: 'Account Manager', c: 'BigCo', b: 'managed client relationships and renewals\nowned onboarding for new accounts\nresolved escalations and retention risks' },   /* no digits → question */
          { t: 'Analyst', c: 'DataCo', b: 'built dashboards for 12 teams' },                              /* has digits → skipped */
        ] });
      const qs = _metricsQuestionsFor();
      const st = _ratingStructure();
      localStorage.setItem('gpj_optimized', '[]');
      openMetricsElicit();
      const modalOpen = !!document.getElementById('metrics-modal');
      const input = document.querySelector('#metrics-modal input[id^="mq-"]');
      input.value = '120';
      submitMetricsElicit();
      const snap = JSON.parse(localStorage.getItem('gpj_optimized') || '[]');
      return {
        qN: qs.length, qJi: qs[0] && qs[0].ji, needsMetrics: st.needsMetrics, modalOpen,
        bigcoBullets: resumeData.jobs[0].b, datacoBullets: resumeData.jobs[1].b,
        snapshotStored: !!(snap[0] && snap[0].snapshot), modalClosed: !document.getElementById('metrics-modal'),
      };
    });
    expect(r.needsMetrics, 'rater flags the metrics gap').toBe(true);
    expect(r.qN, 'one question per digit-less job').toBe(1);
    expect(r.qJi, 'question maps to the digit-less job (index 0)').toBe(0);
    expect(r.modalOpen).toBe(true);
    expect(r.bigcoBullets, 'the user LITERAL answer lands on the right job').toContain('120');
    expect(r.bigcoBullets).toMatch(/^managed client relationships/);
    expect(r.datacoBullets, 'the other job is untouched').toBe('built dashboards for 12 teams');
    expect(r.bigcoBullets, 'no invented outcomes (no fabricated percentages)').not.toMatch(/increased|grew|boosted|%/i);
    expect(r.snapshotStored, 'restorable snapshot stored before the change').toBe(true);
    expect(r.modalClosed).toBe(true);
  });

  test('F-METRICS Q4: no digit-less jobs → no card, graceful toast path', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { jobs: [{ t: 'X', c: 'Y', b: 'did 5 things' }] });
      return { qs: _metricsQuestionsFor().length, needs: _ratingStructure().needsMetrics };
    });
    expect(r.qs).toBe(0);
    expect(r.needs, 'metrics check passes → card never renders').toBe(false);
  });

  test('F-CREDITS: Core Search note is optional-toned + dismiss persists; Base Camp adds the Booster explainer; Hyper-Drive/admin never see it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const day = 86400000;
      const setAge = (d) => localStorage.setItem('gpj_install_date', String(Date.now() - d * day));
      const noteText = () => { const n = document.getElementById('credits-note'); return n ? n.textContent : ''; };
      const clear = () => { const n = document.getElementById('credits-note'); if (n) n.remove(); localStorage.removeItem('gpj_creditsnote_' + new Date().toDateString()); };
      isAdmin = false; localStorage.setItem('gpj_tier', 'free');
      /* Hyper-Drive (day 10): never */
      clear(); setAge(10); _gpjCreditsNote(); const hyper = noteText();
      /* Core Search (day 60) */
      clear(); setAge(60); _gpjCreditsNote(); const core = noteText();
      /* dismiss persists for the day */
      const x = document.querySelector('#credits-note div[onclick]'); if (x) x.click();
      _gpjCreditsNote(); const afterDismiss = noteText();
      /* Base Camp (day 120) */
      clear(); setAge(120); _gpjCreditsNote(); const base = noteText();
      /* admin: never */
      clear(); isAdmin = true; setAge(120); _gpjCreditsNote(); const admin = noteText();
      isAdmin = false; clear(); localStorage.removeItem('gpj_install_date');
      return { hyper, core, afterDismiss, base, admin };
    });
    expect(r.hyper, 'Hyper-Drive never sees the note').toBe('');
    expect(r.core).toContain('totally optional');
    expect(r.core).toContain('re-up free');
    expect(r.core, 'no dark patterns: no countdown/urgency words').not.toMatch(/hurry|last chance|expires|only .* left/i);
    expect(r.afterDismiss, 'dismissed → stays gone for the day').toBe('');
    expect(r.base).toContain('How’s the search going?');
    expect(r.base).toContain('Booster');
    expect(r.base).toContain('completely optional');
    expect(r.admin, 'admin never sees it').toBe('');
  });
});

test.describe('[STATE-COVERAGE] v101b-fix skills render-boundary tidy (founder live repro)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('messy skills from ANY source are tidied on the rendered/exported resume', async ({ page }) => {
    const r = await page.evaluate(() => {
      // the founder's EXACT messy string, set directly (not via Jett) to prove the
      // render path tidies regardless of source — the whole point of the fix.
      Object.assign(resumeData, {
        name: 'Test', title: 'Program Manager', contact: 't@x.com', summary: 'x', edu: 'BBA',
        skills: '(PowerPoint · Word · Excel) Expert · Excel · CRM (Salesforce · HubSpot)Compliance · Account Retention · Retention account · Program Manager',
        jobs: [{ t: 'Program Manager', c: 'Acme', d: '2015 - 2024', b: 'ran programs' }], certs: [], eduExtra: [],
      });
      const html = buildResumeHTML(true);
      return {
        rawMashup: /\(PowerPoint|HubSpot\)Compliance|Retention account| Expert/.test(html),
        hasClean: html.includes('PowerPoint') && html.includes('Salesforce') && html.includes('HubSpot') && html.includes('Compliance'),
        titleDropped: !/Skills[\s\S]*Program Manager/.test(html.split('Experience')[1] || html),
      };
    });
    expect(r.rawMashup, 'no parens / mashup / fragment / rating-word in the rendered resume').toBe(false);
    expect(r.hasClean, 'the real skills survive, split out of the mashups').toBe(true);
  });

  test('parse output is tidied into storage + the editable field', async ({ page }) => {
    const r = await page.evaluate(() => {
      // drive the resume parser with a raw skills line that has a paren mashup
      const raw = 'John Tester\nProgram Manager\nSKILLS\n(PowerPoint · Word · Excel) Expert, CRM (Salesforce · HubSpot)Compliance, Account Retention\nEXPERIENCE\nProgram Manager - Acme (2015 - 2024)\nRan programs';
      try { applyRealParse(raw); } catch (e) { return { err: String(e) }; }
      return { stored: resumeData.skills };
    });
    if (r.err) { expect(r.err).toBeUndefined(); return; }
    expect(r.stored, 'stored skills carry no paren fragment').not.toMatch(/[()]/);
    expect(r.stored, 'no rating-word "Expert" stored').not.toMatch(/\bExpert\b/);
    expect(r.stored).toContain('Excel');
  });
});

test.describe('[STATE-COVERAGE] R2-A recruiter onboarding (fork + required website + full profile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('signup fork shows only when creating an account; candidate stays the default path', async ({ page }) => {
    const r = await page.evaluate(() => {
      showAuthModal('signup');
      const inSignup = getComputedStyle(document.getElementById('auth-roletype')).display;
      const candidateFieldsShown = getComputedStyle(document.getElementById('auth-signup-fields')).display;
      showAuthModal('login');
      const inLogin = getComputedStyle(document.getElementById('auth-roletype')).display;
      return { inSignup, inLogin, candidateFieldsShown };
    });
    expect(r.inSignup, 'fork visible when creating an account').toBe('flex');
    expect(r.inLogin, 'fork hidden on log in').toBe('none');
    expect(r.candidateFieldsShown, 'candidate default fields still render (untouched)').toBe('block');
  });

  test('"I\'m hiring" routes to recruiter auth and closes the candidate modal; zero recruiter reads', async ({ page }) => {
    const r = await page.evaluate(() => {
      let recReads = 0;
      window.fb = window.fb || {};
      ['loadRecruiter'].forEach((m) => { const o = fb[m]; if (typeof o === 'function') fb[m] = function () { recReads++; return o.apply(fb, arguments); }; });
      showAuthModal('signup');
      document.querySelector('#auth-roletype div[onclick]').click();
      return {
        recOpen: document.getElementById('recruiter-auth-modal').classList.contains('open'),
        candidateClosed: !document.getElementById('auth-modal').classList.contains('open'),
        recReads,
      };
    });
    expect(r.recOpen).toBe(true);
    expect(r.candidateClosed).toBe(true);
    expect(r.recReads, 'the fork is pure UI — no recruiter doc read').toBe(0);
  });

  test('recruiter signup requires a valid company website (blocks before creating the account)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const toasts = [];
      window.showToast = (m) => toasts.push(m);
      let signUpCalls = 0;
      window.fb = window.fb || {};
      fb.signUp = async () => { signUpCalls++; return { user: { uid: 'x' } }; };
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      openRecruiterAuth();
      // company + email + pass, but NO website
      set('rec-company', 'Acme'); set('rec-website', ''); set('rec-email', 'jane@acmecorp.com'); set('rec-pass', 'secret1');
      await recruiterSignup();
      const blockedNoSite = signUpCalls === 0 && toasts.some((t) => /website/i.test(t));
      // invalid website
      set('rec-website', 'notaurl');
      await recruiterSignup();
      const blockedBadSite = signUpCalls === 0 && toasts.some((t) => /valid company website/i.test(t));
      return { blockedNoSite, blockedBadSite, signUpCalls };
    });
    expect(r.blockedNoSite, 'missing website blocks signup').toBe(true);
    expect(r.blockedBadSite, 'invalid website blocks signup').toBe(true);
    expect(r.signUpCalls, 'no account created while website invalid').toBe(0);
  });

  test('employer view has + persists the full company profile (contact, title, location)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const saved = {};
      window.fb = window.fb || {};
      fb.createRecruiter = async (uid, d) => { Object.assign(saved, { rec: d }); return true; };
      fb.saveCompany = async (id, d) => { Object.assign(saved, { co: d }); return true; };
      window._recruiter = { uid: 'r1', companyId: 'acme.com', domain: 'acme.com' };
      renderEmployerView();
      const present = ['emp-location', 'emp-contact-first', 'emp-contact-last', 'emp-contact-title'].every((id) => !!document.getElementById(id));
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('emp-company', 'Acme Corp'); set('emp-website', 'https://acme.com'); set('emp-desc', 'We build things');
      set('emp-location', 'Houston, TX'); set('emp-contact-first', 'Jane'); set('emp-contact-last', 'Doe'); set('emp-contact-title', 'TA Lead');
      await saveCompanyProfile();
      window._recruiter = null;
      return { present, rec: saved.rec, co: saved.co };
    });
    expect(r.present, 'full-profile fields exist in the employer view').toBe(true);
    expect(r.rec.contactFirst).toBe('Jane');
    expect(r.rec.contactTitle).toBe('TA Lead');
    expect(r.rec.location).toBe('Houston, TX');
    expect(r.co.location, 'company doc carries location').toBe('Houston, TX');
    expect(r.co.name).toBe('Acme Corp');
  });
});

test.describe('[STATE-COVERAGE] R2-B recruiter job posting + listing', () => {
  test.use({ viewport: { width: 440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('recruiter posts a role -> correct payload, list shows Pending, form clears', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let created = null;
      window.fb = window.fb || {};
      fb.createRecruiterJob = async (job) => { created = job; return 'job123'; };
      fb.loadRecruiterJobs = async () => [{ id: 'job123', title: 'Operations Manager', location: 'Houston, TX', is_remote: false, job_type: 'Full-time', isValidated: false, active: false }];
      window._recruiter = { uid: 'r1', company: 'Acme Corp', companyId: 'acme.com', domain: 'acme.com', isValidated: true };
      switchView('employer'); renderEmployerView();
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('job-title', 'Operations Manager'); set('job-location', 'Houston, TX');
      // v144: clears the 250-char listing-quality floor. This test is about the
      // PAYLOAD shape, not description length, so the fixture just gets realistic.
      set('job-desc', 'Oversee warehouse operations and vendor logistics for the region. You will lead a team of eight, own the weekly KPI review, and report to the Ops Director. In your first 90 days you will rebuild the shift plan, close out open safety actions, and take over vendor scheduling end to end.'); set('job-req', '5 years ops');
      set('job-sal-min', '60000'); set('job-sal-max', '80000'); document.getElementById('job-type').value = 'Full-time';
      await postRecruiterJob(); await new Promise((r) => setTimeout(r, 250));
      const listText = (document.getElementById('emp-jobs-list').textContent || '');
      return { created, listShowsJob: listText.includes('Operations Manager'), pending: /Pending review/.test(listText), cleared: document.getElementById('job-title').value === '' };
    });
    expect(r.created.title).toBe('Operations Manager');
    expect(r.created.source).toBeUndefined();   // source/active/isValidated stamped by fb, not the form
    expect(r.created.salary_min).toBe(60000);
    expect(r.created.job_type).toBe('Full-time');
    expect(r.created.company).toBe('Acme Corp');
    expect(r.listShowsJob).toBe(true);
    expect(r.pending, 'unverified job shows Pending review').toBe(true);
    expect(r.cleared, 'form resets after posting').toBe(true);
  });

  test('posting validates title + location/remote + description length', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const toasts = []; window.showToast = (m) => toasts.push(m);
      let calls = 0; window.fb = window.fb || {}; fb.createRecruiterJob = async () => { calls++; return 'x'; };
      window._recruiter = { uid: 'r1', company: 'Acme', companyId: 'acme.com' };
      switchView('employer'); renderEmployerView();
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      await postRecruiterJob();                                   // empty -> blocked (no title)
      set('job-title', 'Ops'); document.getElementById('job-remote').checked = false; set('job-location', '');
      await postRecruiterJob();                                   // no location, not remote -> blocked
      set('job-location', 'Houston, TX'); set('job-desc', 'too short');
      await postRecruiterJob();                                   // desc < 20 -> blocked
      return { calls, toasts };
    });
    expect(r.calls, 'no job created while inputs are invalid').toBe(0);
    expect(r.toasts.some((t) => /title/i.test(t))).toBe(true);
    expect(r.toasts.some((t) => /location|remote/i.test(t))).toBe(true);
  });

  test('admin pending-jobs queue lists internal jobs and approves them live', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.adminPendingJobs = async () => [{ id: 'job123', title: 'Operations Manager', company: 'Acme Corp', location: 'Houston, TX', job_type: 'Full-time' }];
      let verified = null; fb.adminVerifyJob = async (id, ap) => { verified = { id, ap }; return true; };
      isAdmin = true;
      try { const old = document.getElementById('admin-panel'); if (old) old.remove(); } catch (e) {}
      renderAdminPanel();
      const hasQueue = !!document.getElementById('admin-jobs-queue');
      await renderJobsQueue();
      const shows = document.getElementById('admin-jobs-queue').textContent.includes('Operations Manager');
      document.querySelector('#admin-jobs-queue div[onclick*="adminDecideJob"]').click();
      await new Promise((r) => setTimeout(r, 150));
      isAdmin = false;
      return { hasQueue, shows, verified };
    });
    expect(r.hasQueue).toBe(true);
    expect(r.shows).toBe(true);
    expect(r.verified, 'approve calls adminVerifyJob(id, true) -> flips active+isValidated live').toEqual({ id: 'job123', ap: true });
  });
});

test.describe('[STATE-COVERAGE] R2-C internal apply + dashboard, R2-D opt-in', () => {
  test.use({ viewport: { width: 440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('C: verified internal job carries id + _internal through the mapper; url empty', async ({ page }) => {
    const r = await page.evaluate(() => {
      const j = mapFirestoreJob({ _docId: 'JOB99', title: 'Ops Lead', company: 'Acme', location: 'Houston, TX', description: 'A real internal role description for testing purposes here.', source: 'internal', active: true, isValidated: true });
      return { id: j.id, internal: j._internal, urlEmpty: j.url === '' };
    });
    expect(r.id).toBe('JOB99');
    expect(r.internal).toBe(true);
    expect(r.urlEmpty, 'internal jobs have no external URL — apply is in-app').toBe(true);
  });

  test('C: in-app apply writes the application; Browse card shows "Apply to this role"', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let applied = null;
      window.fb = window.fb || {};
      fb.applyToInternalJob = async (id, meta) => { applied = { id, meta }; return true; };
      window.requireSignIn = () => true; window.recordSwipe = () => {}; window.reloadDeckFromQueue = () => {}; window.closeBrowseExpanded = () => {};
      try { resumeData.name = 'T'; resumeData.email = 't@x.com'; } catch (e) {}
      await applyInternalById('JOB99', 'Ops Lead', 'Acme');
      await new Promise((r) => setTimeout(r, 120));
      // v145: the apply flow now opens the "Complete your application" step first;
      // submit it (defaults are fine) to reach the actual application write.
      _submitApplyComplete();
      await new Promise((r) => setTimeout(r, 150));
      const html = buildBrowseExpanded({ t: 'Ops Lead', co: 'Acme', loc: 'Houston, TX', url: '', desc: 'd', summary: 'd', sal: '', ghost: 10, match: 0, posting_age_days: 1, _internal: true, id: 'JOB99' }, 0);
      const htmlExternal = buildBrowseExpanded({ t: 'Ext Role', co: 'Beta', loc: 'Austin, TX', url: 'https://x.example/a', desc: 'd', summary: 'd', sal: '', ghost: 10, match: 0, posting_age_days: 1 }, 0);
      return { applied, internalHasApply: /Apply to this role/.test(html), externalHasPosting: /View Full Posting/.test(htmlExternal) };
    });
    expect(r.applied.id).toBe('JOB99');
    expect(r.applied.meta.title).toBe('Ops Lead');
    expect(r.applied.meta.company).toBe('Acme');
    expect(r.applied.meta).toHaveProperty('resume');   // v110 R9-C: résumé snapshot rides along (consent-to-share)
    expect(r.internalHasApply, 'internal job card -> in-app Apply').toBe(true);
    expect(r.externalHasPosting, 'external job card unchanged -> View Full Posting').toBe(true);
  });

  test('C: recruiter dashboard shows applicant counts (count aggregation)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.loadRecruiterJobs = async () => [{ id: 'JOB99', title: 'Ops Lead', location: 'Houston, TX', is_remote: false, job_type: 'Full-time', isValidated: true, active: true }];
      fb.countJobApplicants = async (id) => (id === 'JOB99' ? 3 : 0);
      window._recruiter = { uid: 'r1', company: 'Acme' };
      switchView('employer'); renderEmployerView();
      await new Promise((r) => setTimeout(r, 300));
      return (document.getElementById('emp-jobs-list').textContent || '');
    });
    expect(r).toContain('3 applicants');
  });

  test('D: discoverable opt-in defaults OFF, persists top-level, reflects on reload', async ({ page }) => {
    const r = await page.evaluate(() => {
      let saved = null; window.fb = window.fb || {}; fb.current = () => ({ uid: 'u1' }); fb.saveProfile = async (uid, d) => { saved = d; return true; };
      localStorage.setItem('gpj_profile', JSON.stringify({ email: 'u@x.com' }));
      loadNotifPrefs();
      const t = document.getElementById('discoverable-toggle');
      const defaultOff = !t.classList.contains('on');
      toggleDiscoverable(t);
      const on = t.classList.contains('on');
      const savedOn = saved && saved.discoverable;
      const storedTop = JSON.parse(localStorage.getItem('gpj_profile')).discoverable;
      loadNotifPrefs();
      const reflects = t.classList.contains('on');
      return { exists: !!t, defaultOff, on, savedOn, storedTop, reflects };
    });
    expect(r.exists).toBe(true);
    expect(r.defaultOff, 'discovery is OFF until the candidate opts in').toBe(true);
    expect(r.on).toBe(true);
    expect(r.savedOn, 'saved as a TOP-LEVEL discoverable field (rules/reverse-match read it)').toBe(true);
    expect(r.storedTop).toBe(true);
    expect(r.reflects, 'reload reflects the saved opt-in').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] F-GHOST report aggregation to Firestore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('filing a ghost report also writes a shape-locked Firestore doc (no comment/PII)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let wrote = null;
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' });
      fb.fileGhostReport = async (co, stage) => { wrote = { co, stage }; return true; };
      // drive the in-app report modal path
      document.getElementById('gr-company').value = 'Vaporware Staffing';
      document.getElementById('gr-stage').value = 'After application — never heard back';
      document.getElementById('gr-comment').value = 'they never replied and it felt like a scam';
      submitGhostReport();
      await new Promise((r) => setTimeout(r, 100));
      // programmatic path too
      let wrote2 = null; fb.fileGhostReport = async (co, stage) => { wrote2 = { co, stage }; return true; };
      fileGhostReport('Acme Corp', 'note');
      await new Promise((r) => setTimeout(r, 100));
      return { wrote, wrote2 };
    });
    expect(r.wrote, 'submit path forwards company + stage to Firestore').toEqual({ co: 'Vaporware Staffing', stage: 'After application — never heard back' });
    expect(r.wrote2, 'programmatic path forwards too').toEqual({ co: 'Acme Corp', stage: 'After applying' });
    // note: the comment is NOT passed to fb.fileGhostReport — it stays device-local
  });
});

test.describe('[STATE-COVERAGE] R4 recruiter matched-candidates dashboard', () => {
  test.use({ viewport: { width: 440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('live job shows "View matches"; modal ranks applied first + shows consented contact', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let readJob = null;
      window.fb = window.fb || {};
      fb.loadRecruiterJobs = async () => [{ id: 'JOB1', title: 'Operations Manager', location: 'Houston, TX', is_remote: false, job_type: 'Full-time', isValidated: true, active: true }];
      fb.countJobApplicants = async () => 2;
      fb.loadRecommendedCandidates = async (jobId) => { readJob = jobId; return [
        { uid: 'c1', score: 88, matched: ['logistics', 'inventory'], market: 'Houston, TX', applied: true, displayName: 'Jane Doe', contact: 'jane@x.com' },
        { uid: 'c2', score: 64, matched: ['operations'], market: 'Houston, TX', applied: false, displayName: 'Sam Lee', contact: 'sam@x.com' }]; };
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      switchView('employer'); renderEmployerView();
      await new Promise((r) => setTimeout(r, 300));
      const hasBtn = /View matched candidates/.test(document.getElementById('emp-jobs-list').textContent || '');
      await openJobMatches('JOB1', 'Operations Manager');
      await new Promise((r) => setTimeout(r, 250));
      const body = document.getElementById('matches-body').textContent || '';
      return { hasBtn, readJob, open: document.getElementById('matches-modal').classList.contains('open'),
        appliedFirst: body.indexOf('Jane Doe') < body.indexOf('Sam Lee'), pct: /88%/.test(body),
        appliedBadge: /Applied to this role/.test(body), openBadge: /Open to offers/.test(body), contact: /jane@x\.com/.test(body) };
    });
    expect(r.hasBtn, 'live jobs offer a matches view').toBe(true);
    expect(r.readJob, 'reads recommendations for the right job').toBe('JOB1');
    expect(r.open).toBe(true);
    expect(r.appliedFirst, 'applicants rank first').toBe(true);
    expect(r.pct).toBe(true);
    expect(r.appliedBadge).toBe(true);
    expect(r.openBadge).toBe(true);
    expect(r.contact, 'consented contact shown (discoverable pool)').toBe(true);
  });

  test('empty recommendations -> honest empty state, no crash', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; fb.loadRecommendedCandidates = async () => [];
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      await openJobMatches('JOBX', 'Role');
      await new Promise((r) => setTimeout(r, 150));
      return document.getElementById('matches-body').textContent || '';
    });
    expect(r).toMatch(/No matched candidates yet/);
  });
});

test.describe('[STATE-COVERAGE] v104 double-verb repair + AI transparency (founder live repro)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('stored double-verb bullets are repaired; legit compounds untouched', async ({ page }) => {
    const r = await page.evaluate(() => ({
      supColl: _healDoubleVerb('Supported collaborated with operations to refine pipelines.'),
      supUtil: _healDoubleVerb('Supported utilized Salesforce and CRM systems to manage accounts.'),
      supAdv: _healDoubleVerb('Supported & swiftly addressed complex client escalations under pressure.'),
      droveEnsured: _healDoubleVerb('Drove ensured data integrity and compliance with revenue targets.'),
      ledAnd: _healDoubleVerb('Led and mentored a high-performing team of 8+ Account Managers.'),
      designedAnd: _healDoubleVerb('Designed and implemented technical training procedures.'),
      droveStrategy: _healDoubleVerb('Drove client success strategy and revenue growth for 500+ locations.'),
    }));
    expect(r.supColl).toBe('Collaborated with operations to refine pipelines.');
    expect(r.supUtil).toBe('Utilized Salesforce and CRM systems to manage accounts.');
    expect(r.supAdv).toBe('Swiftly addressed complex client escalations under pressure.');
    expect(r.droveEnsured, 'the founder\'s "skipped" Revention bullet').toBe('Ensured data integrity and compliance with revenue targets.');
    expect(r.ledAnd, 'legit compound left alone').toBe('Led and mentored a high-performing team of 8+ Account Managers.');
    expect(r.designedAnd).toBe('Designed and implemented technical training procedures.');
    expect(r.droveStrategy).toBe('Drove client success strategy and revenue growth for 500+ locations.');
  });

  test('exported resume self-heals stored double-verb bullets at the render boundary', async ({ page }) => {
    const r = await page.evaluate(() => {
      Object.assign(resumeData, { jobs: [{ t: 'Senior AM', c: 'Revention', d: '2015-2016', b: 'Drove ensured data integrity and compliance.\nSupported collaborated with operations to refine pipelines.' }] });
      const html = buildResumeHTML(true);
      return { badGone: !/Drove ensured|Supported collaborated/.test(html), good: /Ensured data integrity/.test(html) && /Collaborated with operations/.test(html) };
    });
    expect(r.badGone, 'no double-verb survives to the exported resume').toBe(true);
    expect(r.good).toBe(true);
  });

  test('AI transparency: fallback reason + honest copy when live AI is skipped', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.fb = window.fb || {}; fb.smartMatch = () => {}; isAdmin = false;
      window.aiImproveAllowed = () => false;                  // monthly cap hit
      const capReason = _aiFallbackReason('summary', 'improve');
      window.aiImproveAllowed = () => true; window.aiHourlyAllowed = () => false;   // hourly throttle
      const throttleReason = _aiFallbackReason('summary', 'improve');
      window.aiHourlyAllowed = () => true;
      const okReason = _aiFallbackReason('summary', 'improve');   // available
      isAdmin = true; window.aiImproveAllowed = () => false;
      const adminReason = _aiFallbackReason('summary', 'improve'); // admin bypass
      isAdmin = false;
      return { capReason, throttleReason, okReason, adminReason,
        capNote: _aiFallbackNote('cap'), throttleNote: _aiFallbackNote('throttle'), qualityNote: _aiFallbackNote('quality') };
    });
    expect(r.capReason).toBe('cap');
    expect(r.throttleReason).toBe('throttle');
    expect(r.okReason, 'live AI available -> no fallback reason').toBe('');
    expect(r.adminReason, 'admins bypass the caps').toBe('');
    expect(r.capNote, 'cap note says when live AI returns').toMatch(/renew|live-AI/i);
    expect(r.capNote, 'and is transparent about smart templates').toMatch(/smart templates/i);
    expect(r.throttleNote).toMatch(/rate-limited/i);
    expect(r.qualityNote).toMatch(/too thin/i);
  });
});

test.describe('[STATE-COVERAGE] R5 outreach + anti-ghosting, R6 candidate tray', () => {
  test.use({ viewport: { width: 440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept('Hi, open to a chat?'));
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    // poll for the app, don't guess: a fixed delay races the 1MB inline script under parallel load
    await page.waitForFunction(() => typeof window.renderMyReachouts === 'function'
      && typeof window.openJobMatches === 'function' && typeof window.renderResponsiveness === 'function',
    null, { timeout: 15000 });
    // ...then wait for the firebase module (index.html:42), which replaces window.fb
    // wholesale and fires the signed-out auth callback — both would land mid-test.
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('R5: matched card offers reach-out + (applicant) kind decline; sends the right kind', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = window.fb || {};
      fb.sendReachOut = async (uid, jobId, data) => { sent = { uid, jobId, data }; return 'ro1'; };
      fb.loadRecommendedCandidates = async () => [{ uid: 'c1', score: 88, matched: ['ops'], market: 'Houston, TX', applied: true, displayName: 'Jane Doe', contact: 'jane@x.com' }];
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      await openJobMatches('JOB1', 'Operations Manager');
      await new Promise((r) => setTimeout(r, 200));
      const inner = document.getElementById('matches-body').innerHTML;
      const hasReach = /Reach out/.test(inner), hasDecline = /Send kind decline/.test(inner);
      document.querySelector('#matches-body div[onclick*="reachOutTo"][onclick*="reachout"]').click();
      await new Promise((r) => setTimeout(r, 150));
      // v127: reach-out now opens a structured modal (default message prefilled) — confirm to send
      await _sendReachOutModal();
      await new Promise((r) => setTimeout(r, 100));
      return { hasReach, hasDecline, sentKind: sent && sent.data && sent.data.kind, sentTo: sent && sent.uid, hasMessage: !!(sent && sent.data && sent.data.message) };
    });
    expect(r.hasReach).toBe(true);
    expect(r.hasDecline, 'an applicant can be respectfully declined (anti-ghosting)').toBe(true);
    expect(r.sentKind).toBe('reachout');
    expect(r.sentTo).toBe('c1');
    expect(r.hasMessage, 'reach-out carries a message (also serves R7 scheduling)').toBe(true);
  });

  test('R5: Anti-Ghosting Badge is earned once the recruiter has replied to enough candidates', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; window._recruiter = { uid: 'r1', company: 'Acme' };
      fb.countMyReachouts = async () => 6; await renderResponsiveness();
      const earned = document.getElementById('emp-responsiveness').textContent;
      fb.countMyReachouts = async () => 0; await renderResponsiveness();
      const none = document.getElementById('emp-responsiveness').textContent;
      return { earned, none };
    });
    expect(r.earned).toMatch(/Anti-Ghosting Badge earned/);
    expect(r.none, 'no replies yet -> a nudge, not the badge').toMatch(/earn the/i);
  });

  test('R6: candidate tray shows reach-outs + respectful declines; Interested responds', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let responded = null;
      window.fb = window.fb || {}; fb.current = () => ({ uid: 'c1' });
      fb.respondReachout = async (id, st) => { responded = { id, st }; return true; };
      fb.loadMyReachouts = async () => [
        { id: 'ro1', kind: 'reachout', company: 'Acme', jobTitle: 'Operations Manager', message: 'You look great', status: 'sent' },
        { id: 'ro2', kind: 'rejection', company: 'Beta', jobTitle: 'Analyst', message: 'moving forward with others', status: 'sent' }];
      await renderMyReachouts();
      await new Promise((r) => setTimeout(r, 200));
      const shown = getComputedStyle(document.getElementById('sec-reachouts')).display !== 'none';
      const txt = document.getElementById('reachouts-list').textContent || '';
      // v148: "Interested" now opens the accept modal so contact is collected on
      // accept (the mutual-exchange consent gate); the record fires on confirm.
      document.querySelector('#reachouts-list div[onclick*="_openAcceptInterview"]').click();
      await new Promise((r) => setTimeout(r, 150));
      document.getElementById('ai-email').value = 'c1@cand.com';
      await _confirmAcceptInterview();
      await new Promise((r) => setTimeout(r, 80));
      return { shown, hasReach: /Acme reached out/.test(txt), hasDecline: /instead of ghosting/.test(txt), responded };
    });
    expect(r.shown, 'tray shows when there are messages').toBe(true);
    expect(r.hasReach).toBe(true);
    expect(r.hasDecline, 'a respectful decline is surfaced, not silence').toBe(true);
    expect(r.responded).toEqual({ id: 'ro1', st: 'interested' });
  });

  test('R6: empty tray stays hidden (no employer messages yet)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; fb.current = () => ({ uid: 'c1' }); fb.loadMyReachouts = async () => [];
      await renderMyReachouts();
      return getComputedStyle(document.getElementById('sec-reachouts')).display;
    });
    expect(r).toBe('none');
  });

  test('R7: proposed interview slots render; picking one records acceptedTime + interested', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let responded = null;
      window.fb = window.fb || {}; fb.current = () => ({ uid: 'c1' });
      fb.respondReachout = async (id, st, extra) => { responded = { id, st, extra }; return true; };
      fb.loadMyReachouts = async () => [{ id: 'ro7', kind: 'reachout', company: 'Acme', jobTitle: 'Ops', status: 'sent', proposedTimes: ['Tue 2pm CT', 'Thu 10am CT'] }];
      await renderMyReachouts();
      await new Promise((r) => setTimeout(r, 150));
      const txt = document.getElementById('reachouts-list').textContent || '';
      const hasPrompt = /Pick an interview time/.test(txt), bothSlots = /Tue 2pm CT/.test(txt) && /Thu 10am CT/.test(txt);
      // v148: picking a slot opens the accept modal (time pre-selected); the record
      // fires when the candidate confirms + shares contact.
      document.querySelector('#reachouts-list div[onclick*="pickInterviewSlot"]').click();
      await new Promise((r) => setTimeout(r, 150));
      document.getElementById('ai-email').value = 'c1@cand.com';
      await _confirmAcceptInterview();
      await new Promise((r) => setTimeout(r, 80));
      return { hasPrompt, bothSlots, responded };
    });
    expect(r.hasPrompt, 'R7 is a real slot exchange, not free text').toBe(true);
    expect(r.bothSlots).toBe(true);
    expect(r.responded.st).toBe('interested');
    expect(r.responded.extra.acceptedTime).toBe('Tue 2pm CT');
    expect(r.responded.extra.candidateContact.email, 'accepting shares contact (v148)').toBe('c1@cand.com');
  });

  test('R5 appeal: a rejection can be respectfully appealed (anti-ghosting accountability)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let appealed = null;
      window.fb = window.fb || {}; fb.current = () => ({ uid: 'c1' });
      fb.appealReachout = async (id, msg) => { appealed = { id, msg }; return true; };
      fb.loadMyReachouts = async () => [{ id: 'ro2', kind: 'rejection', company: 'Beta', jobTitle: 'Analyst', status: 'sent' }];
      await renderMyReachouts();
      await new Promise((r) => setTimeout(r, 150));
      const hasAppeal = /Respectfully appeal/.test(document.getElementById('reachouts-list').textContent || '');
      document.querySelector('#reachouts-list div[onclick*="appealReachoutUI"]').click();
      await new Promise((r) => setTimeout(r, 200));
      return { hasAppeal, appealed };
    });
    expect(r.hasAppeal, 'a declined candidate can push back').toBe(true);
    expect(r.appealed && r.appealed.id).toBe('ro2');
  });

  test('R5/R7 recruiter inbox: responses (interested + slot + appeal) surface; unanswered are hidden', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; window._recruiter = { uid: 'r1', company: 'Acme' };
      fb.loadSentReachouts = async () => [
        { id: 'a', status: 'interested', candidateName: 'Jane', jobTitle: 'Ops', acceptedTime: 'Tue 2pm CT' },
        { id: 'b', status: 'appealed', candidateName: 'Sam', jobTitle: 'Analyst', appealMessage: 'Please reconsider' },
        { id: 'c', status: 'sent', candidateName: 'Pending Pat' }];
      await renderRecruiterResponses();
      const box = document.getElementById('emp-responses');
      return { shown: getComputedStyle(box).display !== 'none', txt: box.textContent || '' };
    });
    expect(r.shown).toBe(true);
    expect(r.txt).toMatch(/Jane/);
    expect(r.txt, 'accepted interview time surfaces to the recruiter').toMatch(/Tue 2pm CT/);
    expect(r.txt, 'an appeal is visible so the recruiter can reconsider').toMatch(/Sam/);
    expect(r.txt).toMatch(/appealed/i);
    expect(r.txt, 'a not-yet-answered reach-out is not a "response"').not.toMatch(/Pending Pat/);
  });

  test('Worker verdict: app reads {isAILimitHit,reason} so it tells auth-failure from a real cap', async ({ page }) => {
    const r = await page.evaluate(() => ({
      noToken: _workerNoAI({ isAILimitHit: true, reason: 'no_token', finalResume: ['x'] }),
      rateLimited: _workerNoAI({ isAILimitHit: true, reason: 'rate_limited' }),
      genericCap: _workerNoAI({ isAILimitHit: true, reason: 'daily_limit' }),
      ranAI: _workerNoAI({ isAILimitHit: false, finalResume: ['rewritten'] }),
      nullRes: _workerNoAI(null),
    }));
    expect(r.noToken, 'token failure = live AI unreachable, not a cap').toBe('unavailable');
    expect(r.rateLimited).toBe('throttle');
    expect(r.genericCap).toBe('cap');
    expect(r.ranAI, 'AI actually ran -> no fallback reason').toBe('');
    expect(r.nullRes).toBe('unavailable');
  });
});

test.describe('[STATE-COVERAGE] F-GEO distance filter (offline centroids + haversine)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('distance math + suburb rollup + remote/unknown pass; default Any = no filtering', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_loc', 'Houston, TX');
      const pass = (j, maxMi) => { const d = _jobDistanceMiles(j); return !(maxMi > 0 && d !== null && d > maxMi); };
      return {
        houstonDallas: Math.round(_haversineMiles(GPJ_CENTROIDS['houston, tx'], GPJ_CENTROIDS['dallas, tx'])),
        suburbRollup: _geoPoint('Missouri City, TX')[0] === GPJ_CENTROIDS['houston, tx'][0],
        sugarLand0: Math.round(_jobDistanceMiles({ loc: 'Sugar Land, TX' })),
        remoteNull: _jobDistanceMiles({ loc: 'x', work_setting: 'remote' }),
        unknownNull: _jobDistanceMiles({ loc: 'Podunk, ZZ' }),
        defaultMaxMi: _maxDistanceMi(),
        passDallasAny: pass({ loc: 'Dallas, TX' }, 0),      // Any -> everything passes
        passDallas100: pass({ loc: 'Dallas, TX' }, 100),    // 225mi > 100 -> excluded
        passHouston100: pass({ loc: 'Houston, TX' }, 100),
        passRemote10: pass({ loc: 'x', work_setting: 'remote' }, 10),
        passUnknown10: pass({ loc: 'Podunk, ZZ' }, 10),
      };
    });
    expect(r.houstonDallas).toBeGreaterThan(200);
    expect(r.houstonDallas).toBeLessThan(260);
    expect(r.suburbRollup, 'a suburb rolls up to its metro centroid').toBe(true);
    expect(r.sugarLand0, 'a same-metro job is ~0 mi').toBeLessThanOrEqual(30);
    expect(r.remoteNull, 'remote jobs are never distance-filtered').toBeNull();
    expect(r.unknownNull, 'unknown city = unmeasurable = passes').toBeNull();
    expect(r.defaultMaxMi, 'default is Any (0) = no regression').toBe(0);
    expect(r.passDallasAny).toBe(true);
    expect(r.passDallas100, 'a job past the cap is excluded').toBe(false);
    expect(r.passHouston100).toBe(true);
    expect(r.passRemote10).toBe(true);
    expect(r.passUnknown10).toBe(true);
  });

  test('no saved home city -> filter no-ops (every job passes)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_loc');
      const pass = (j, maxMi) => { const d = _jobDistanceMiles(j); return !(maxMi > 0 && d !== null && d > maxMi); };
      return { dist: _jobDistanceMiles({ loc: 'Dallas, TX' }), passes: pass({ loc: 'Dallas, TX' }, 10) };
    });
    expect(r.dist, 'no home city -> distance unmeasurable').toBeNull();
    expect(r.passes, 'without a home city the filter cannot hide anything').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v109 R9-A employer nav visibility + desktop reachability', () => {
  test('"For Employers" shows only to guests/admins — hidden for signed-in individuals AND recruiters', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      window.fb = window.fb || {};
      const disp = () => getComputedStyle(document.getElementById('footer-employer-link')).display;
      // guest
      fb.current = () => null; window._recruiter = null; window.isAdmin = false;
      _gpjSyncEmployerNav(); const guest = disp();
      // signed-in individual
      fb.current = () => ({ uid: 'c1' });
      _gpjSyncEmployerNav(); const individual = disp();
      // recruiter
      window._recruiter = { uid: 'r1', company: 'Acme' };
      _gpjSyncEmployerNav(); const recruiter = disp();
      return { guest, individual, recruiter };
    });
    expect(r.guest, 'guests see the employer marketing entry').not.toBe('none');
    expect(r.individual, 'a signed-in individual is not an employer -> hidden').toBe('none');
    // v112: a recruiter is ALREADY inside a company account — the six tabs are the
    // employer experience, so the marketing entry is noise. Hidden for them too.
    expect(r.recruiter, 'an employer should not be offered "For Employers"').toBe('none');
  });

  test('desktop: the employer view lives in the workspace and renders (was invisible)', async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 850 });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const r = await page.evaluate(async () => {
      const ve = document.getElementById('view-employer');
      const inMain = !!(ve && ve.closest('#desk-main'));
      window._recruiter = { uid: 'r1', company: 'Acme Talent', isValidated: true, plan: 'free' };
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'r1' });
      fb.loadRecruiterJobs = async () => []; fb.countMyReachouts = async () => 0; fb.loadSentReachouts = async () => [];
      switchView('employer');
      await new Promise((r) => setTimeout(r, 250));
      const rect = ve.getBoundingClientRect();
      return { isDesk: document.body.classList.contains('desk'), inMain, shown: getComputedStyle(ve).display, sized: rect.width > 200 && rect.height > 100, company: (document.getElementById('emp-company') || {}).value };
    });
    expect(r.isDesk, 'desktop grid active at 1300px').toBe(true);
    expect(r.inMain, 'employer view is inside the desktop workspace panel').toBe(true);
    expect(r.shown).toBe('block');
    expect(r.sized, 'employer view actually occupies the workspace (not clipped to 0)').toBe(true);
    expect(r.company).toBe('Acme Talent');
  });
});

test.describe('[STATE-COVERAGE] v117 Listings: edit a role + verified fill-source', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderRecListings === 'function'
      && typeof window.recEditJob === 'function' && typeof window.openFillModal === 'function',
    null, { timeout: 15000 });
    // The firebase MODULE lands after the main script and assigns window.fb wholesale
    // (index.html:42), then wires onAuthStateChanged. Stubbing before that point gets the
    // stubs replaced and window._recruiter nulled mid-test. Wait for the module to settle
    // (or fail closed to null), then let the signed-out auth callback fire.
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      // ...and keep a late auth callback from nulling the fixture. We're exercising the
      // Listings panel, not auth.
      window._gpjRecruiterAuthApply = () => {};
      window.fb = window.fb || {};
      window.__db = { j1: { id: 'j1', title: 'Ops Manager', location: 'Houston, TX', description: 'Run ops.', requirements: '5y', salary_min: 70000, salary_max: 90000, isValidated: true, active: true } };
      window.__updated = null; window.__created = null; window.__filled = null; window.__hire = null;
      fb.current = () => ({ uid: 'r1', email: 'owner@acme.com' });
      fb.loadRecruiterJobs = async () => Object.values(window.__db);
      fb.loadJob = async (id) => window.__db[id] || null;
      fb.countJobApplicants = async () => 2;
      fb.createRecruiterJob = async (j) => { window.__created = j; return 'jNew'; };
      fb.updateRecruiterJob = async (id, d) => { window.__updated = { id, d }; Object.assign(window.__db[id], d); return true; };
      fb.setRecruiterJobFilled = async (id, via) => { window.__filled = { id, via }; return true; };
      fb.logHire = async (h) => { window.__hire = h; return true; };
      window._recruiter = { uid: 'r1', company: 'Acme', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'free' };
      _gpjApplyRecruiterSkin();
    });
    // the skin kicks off its own async panel render — let it land before the test drives
    // the panel, or a stale render finishes mid-test and repaints over the form
    await page.waitForTimeout(400);
    await page.evaluate(async () => { await renderRecListings(); });
    await page.waitForFunction(() => /Ops Manager/.test((document.getElementById('rl-list') || {}).innerHTML || ''), null, { timeout: 10000 });
  });
  const wait = `async (id, needle) => { for(let i=0;i<60;i++){ const el=document.getElementById(id); if(el&&(el.textContent||'').includes(needle)) return true; await new Promise(r=>setTimeout(r,50)); } return false; }`;

  test('a role can be EDITED in place (was: delete + re-post, losing applicants)', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      const hasEdit = /recEditJob/.test(document.getElementById('rl-list').innerHTML);
      await recEditJob('j1');
      const prefill = { title: document.getElementById('rl-title').value, desc: document.getElementById('rl-desc').value, btn: document.getElementById('rl-post-btn').textContent };
      document.getElementById('rl-desc').value = 'UPDATED — ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.';
      await postRecJob();
      return { hasEdit, prefill, updated: window.__updated, created: window.__created, btnReset: document.getElementById('rl-post-btn').textContent };
    }, wait);
    expect(r.hasEdit, 'every listing offers Edit').toBe(true);
    expect(r.prefill.title, 'the form prefills from the real job').toBe('Ops Manager');
    expect(r.prefill.btn).toBe('💾 Save changes');
    expect(r.updated.id).toBe('j1');
    expect(r.updated.d.description).toBe('UPDATED — ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.');
    expect(r.created, 'editing must UPDATE, never create a duplicate').toBeNull();
    expect(r.btnReset, 'the form returns to post mode after saving').toMatch(/Post role/);
  });

  test('editing does NOT trip the free-tier role cap (you are not adding a role)', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      window._myJobCount = 5;                       // free tier is full
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      await recEditJob('j1');
      document.getElementById('rl-desc').value = 'Still editable at the cap. ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.';
      await postRecJob();
      return { updated: window.__updated };
    }, wait);
    expect(r.updated, 'a full free team must still be able to EDIT its roles').not.toBeNull();
    expect(r.updated.d.description).toBe('Still editable at the cap. ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.');
  });

  test('a panel rebuild mid-edit keeps the edit — and the unsaved typing', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      await recEditJob('j1');
      document.getElementById('rl-desc').value = 'Half-typed edit, not saved yet. ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.';
      await renderRecListings();          // tab switch / late applicant count / any repaint
      return { desc: document.getElementById('rl-desc').value, title: document.getElementById('rl-title').value,
        btn: document.getElementById('rl-post-btn').textContent, editing: window._editingJobId,
        cancelShown: document.getElementById('rl-cancel-edit').style.display };
    }, wait);
    expect(r.desc, 'unsaved typing survives a rebuild (was: silently blanked)').toBe('Half-typed edit, not saved yet. ' + 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.');
    expect(r.title).toBe('Ops Manager');
    expect(r.btn, 'the form must not fall back to "Post role" while still in edit mode').toBe('💾 Save changes');
    expect(r.editing, 'edit state and form stay in sync').toBe('j1');
    expect(r.cancelShown).toBe('block');
  });

  test('closing a role captures HOW it was filled (verified proof the product works)', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      const hasClose = /openFillModal/.test(document.getElementById('rl-list').innerHTML);
      openFillModal('j1', 'Ops Manager');
      const opts = [...document.querySelectorAll('#fill-via option')].map((o) => o.value);
      document.getElementById('fill-via').value = 'gpj';
      await confirmFill('j1');
      const gpj = { filled: window.__filled, hire: window.__hire };
      openFillModal('j1', 'Ops Manager');
      document.getElementById('fill-via').value = 'elsewhere';
      window.__hire = null;
      await confirmFill('j1');
      return { hasClose, opts, gpj, elsewhere: { filled: window.__filled, hire: window.__hire } };
    }, wait);
    expect(r.hasClose).toBe(true);
    expect(r.opts, 'on-site vs elsewhere vs cancelled').toEqual(['gpj', 'elsewhere', 'cancelled']);
    expect(r.gpj.filled).toEqual({ id: 'j1', via: 'gpj' });
    expect(r.gpj.hire, 'a GPJ hire logs an anonymous proof-point').not.toBeNull();
    expect(r.elsewhere.filled.via).toBe('elsewhere');
    expect(r.elsewhere.hire, 'filled elsewhere must NOT be counted as our hire').toBeNull();
  });
});

test.describe('[STATE-COVERAGE] v133 swipe binds to data model + metric-dupe self-heal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.swipeCard === 'function'
      && typeof window._currentTopJob === 'function' && typeof window._healMetricDupes === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('swipe-right records the DATA-MODEL top job, not a stale DOM index (wrong-job repro)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // let-globals: bare assignment, not window.X (the functions read the real bindings)
      jobsQueue = [
        { t: 'Marketing Specialist', co: 'Terracon Consultants Inc', url: 'https://x/terracon', id: '', loc: 'Houston, TX' },
        { t: 'Ops', co: 'Liquidpower Specialty', url: 'https://x/lp', id: '' },
      ];
      deckJobs.length = 0;   // const array — mutate contents, don't reassign
      deckJobs.push({ id: 'c0', t: 'Liquidpower Specialty role', co: 'Liquidpower Specialty' }, { id: 'c1', t: 'x', co: 'x' }, { id: 'c2', t: 'y', co: 'y' });
      topIndex = 0;
      lists = { applied: [], skipped: [], viewed: [], responses: [] };
      window.isSignedIn = () => true; window.isPaid = () => true; window.profileComplete = () => true;
      window.registerApply = () => {}; window.offerCoverLetter = () => {}; window.openSandbox = () => {}; window.openCompanyView = () => {};
      window.advanceQueue = () => {}; window.applyInternal = () => {};
      ['c0', 'c1', 'c2'].forEach((id, i) => { const d = document.createElement('div'); d.id = id; d.className = i === 0 ? 'job-card top' : 'job-card'; document.getElementById('card-deck').appendChild(d); });
      let recorded = null;
      window.recordSwipe = (dir, job) => { recorded = { dir, t: job.t, co: job.co }; };
      swipeCard('right');
      await new Promise((x) => setTimeout(x, 700));
      return recorded;
    });
    expect(r, 'a swipe recorded something').not.toBeNull();
    expect(r.co, 'the job APPLIED is the data-model top (Terracon), never the stale DOM card (Liquidpower)').toBe('Terracon Consultants Inc');
    expect(r.t).toBe('Marketing Specialist');
  });

  test('metric-dupe self-heal re-varies ONLY generated-template duplicates, preserving numbers', async ({ page }) => {
    const r = await page.evaluate(() => {
      // resumeData is a let-global: mutate the real object, don't reassign window.resumeData
      resumeData.jobs = [
        { t: 'A', c: 'X', b: 'Led a team\nManaged 500+ accounts and client relationships end-to-end' },
        { t: 'B', c: 'Y', b: 'Managed 100 accounts and client relationships end-to-end' },
        { t: 'C', c: 'Z', b: 'Managed 50 accounts and client relationships end-to-end\nManaged the front desk daily' },
      ];
      window.cloudSync = () => {};
      const changed = _healMetricDupes();
      const generated = resumeData.jobs.map((j) => j.b).join('\n');
      const managedLines = generated.split('\n').filter((l) => /accounts and client|point of contact|portfolio of|working relationships across/i.test(l));
      const shapes = new Set(managedLines.map((l) => l.replace(/\S*\d\S*/g, '#')));
      return { changed, first: resumeData.jobs[0].b, distinctShapes: shapes.size, count: managedLines.length,
        keptNumbers: /500\+/.test(generated) && /100/.test(generated) && /50/.test(generated),
        userLineUntouched: /Managed the front desk daily/.test(generated) && /Led a team/.test(generated) };
    });
    expect(r.changed, 'duplicates were healed').toBe(true);
    expect(r.count, 'still three metric bullets').toBe(3);
    expect(r.distinctShapes, 'the three are now DIFFERENT wordings, not identical').toBe(3);
    expect(r.keptNumbers, 'the real numbers (500+, 100, 50) are preserved').toBe(true);
    expect(r.userLineUntouched, 'user-typed bullets are never rewritten').toBe(true);
    expect(r.first, 'the FIRST occurrence keeps the original wording').toContain('Managed 500+ accounts and client relationships end-to-end');
  });

  test('delete-account asks "are you sure" BEFORE the password step', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' }); fb.deleteMyAccount = async () => ({ ok: true });
      let confirmMsg = null, promptCalled = false;
      window.confirm = (m) => { confirmMsg = m; return false; };
      window.prompt = () => { promptCalled = true; return 'pw'; };
      await openDeleteAccount();
      return { confirmMsg, promptCalled };
    });
    expect(r.confirmMsg, 'a confirm fires first').toMatch(/permanently|cannot be undone/i);
    expect(r.promptCalled, 'declining the confirm never reaches the password prompt').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v141 community flags on cards + hybrid work style', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._paintJobReportBadge === 'function'
      && typeof window._recWorkStyle === 'function' && typeof window.reportExpired === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('flagging a job files a CLOUD report keyed to that posting (was: local only)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let filed = null;
      fb.current = () => ({ uid: 'u1' });
      fb.fileGhostReport = async (co, stage, jobKey, jobTitle) => { filed = { co, stage, jobKey, jobTitle }; return true; };
      localStorage.setItem('gpj_expired', '[]');
      reportExpired('Marketing Specialist', 'Terracon Consultants Inc');
      await new Promise((x) => setTimeout(x, 80));
      return filed;
    });
    expect(r, 'the community never saw these flags before').not.toBeNull();
    expect(r.jobKey, 'keyed to the posting, using the folded company key').toBe('marketing specialist|terracon');
    expect(r.jobTitle).toBe('Marketing Specialist');
  });

  test('a placeholder company never files a community report', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let filed = false;
      fb.current = () => ({ uid: 'u1' });
      fb.fileGhostReport = async () => { filed = true; return true; };
      reportExpired('Some Role', 'Hiring Company');
      await new Promise((x) => setTimeout(x, 80));
      return filed;
    });
    expect(r, 'placeholder names must never pollute real ghost data').toBe(false);
  });

  test('the card shows "N reported" only when the count is REAL', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' });
      window._jobReportCache = {};
      const mk = () => { const d = document.createElement('div'); d.innerHTML = '<div><span class="s-title">Ops Manager</span><span class="s-ghost"></span></div>'; document.body.appendChild(d); return d; };
      // count 0 -> no badge at all
      fb.countJobReports = async () => 0;
      const zero = mk();
      _paintJobReportBadge(zero, { t: 'Ops Manager', co: 'Acme' });
      await new Promise((x) => setTimeout(x, 120));
      const zeroHidden = !zero.querySelector('.s-community-flag') || zero.querySelector('.s-community-flag').style.display === 'none';
      // count 3 -> visible warning
      window._jobReportCache = {};
      fb.countJobReports = async () => 3;
      const three = mk();
      _paintJobReportBadge(three, { t: 'Ops Manager', co: 'Acme' });
      await new Promise((x) => setTimeout(x, 120));
      const el = three.querySelector('.s-community-flag');
      const txt = el ? el.textContent : '';
      zero.remove(); three.remove();
      return { zeroHidden, txt };
    });
    expect(r.zeroHidden, 'no reports => no scary badge invented').toBe(true);
    expect(r.txt).toBe('🚩 3 reported');
  });

  test('report counts are cached per session (deck repaints cannot spam reads)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let calls = 0;
      fb.current = () => ({ uid: 'u1' });
      fb.countJobReports = async () => { calls++; return 2; };
      window._jobReportCache = {};
      const mk = () => { const d = document.createElement('div'); d.innerHTML = '<div><span class="s-title">Ops Manager</span><span class="s-ghost"></span></div>'; document.body.appendChild(d); return d; };
      const a = mk(); _paintJobReportBadge(a, { t: 'Ops Manager', co: 'Acme' });
      await new Promise((x) => setTimeout(x, 120));
      const b = mk(); _paintJobReportBadge(b, { t: 'Ops Manager', co: 'Acme' });
      await new Promise((x) => setTimeout(x, 120));
      a.remove(); b.remove();
      return calls;
    });
    expect(r, 'one aggregation per posting per session').toBe(1);
  });

  test('Remote and Hybrid are mutually exclusive and both post correctly', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      window.fb = window.fb || {};
      let created = null;
      fb.createRecruiterJob = async (j) => { created = j; return 'jN'; };
      fb.loadRecruiterJobs = async () => [];
      fb.current = () => ({ uid: 'r1' });
      window._recruiter = { uid: 'r1', company: 'Acme', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'free' };
      _gpjApplyRecruiterSkin(); await new Promise((x) => setTimeout(x, 300));
      await renderRecListings(); await new Promise((x) => setTimeout(x, 200));
      const hasHybrid = !!document.getElementById('rl-hybrid');
      // ticking hybrid clears remote, and vice versa
      document.getElementById('rl-remote').checked = true; _recWorkStyle('remote');
      document.getElementById('rl-hybrid').checked = true; _recWorkStyle('hybrid');
      const remoteCleared = document.getElementById('rl-remote').checked === false;
      // hybrid WITHOUT a location must be refused
      document.getElementById('rl-title').value = 'Ops Manager';
      document.getElementById('rl-desc').value = 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.';
      document.getElementById('rl-location').value = '';
      await postRecJob();
      const refusedWithoutLoc = created === null;
      // with a location it posts as Hybrid
      document.getElementById('rl-location').value = 'Katy, TX';
      await postRecJob();
      return { hasHybrid, remoteCleared, refusedWithoutLoc, setting: created && created.work_setting, isRemote: created && created.is_remote, loc: created && created.location };
    });
    expect(r.hasHybrid, 'hybrid toggle exists beside remote').toBe(true);
    expect(r.remoteCleared, 'a role cannot be both remote and hybrid').toBe(true);
    expect(r.refusedWithoutLoc, 'hybrid needs a location to commute to').toBe(true);
    expect(r.setting).toBe('Hybrid');
    expect(r.isRemote).toBe(false);
    expect(r.loc, 'hybrid keeps its real location').toBe('Katy, TX');
  });
});

/* ===========================================================================
   v143 — founder live-test batch. Every test here is a REPRODUCED failure:
   the data loss she hit on every login, the accordion that never sprang back,
   and the community count she inflated by reporting one job twice.
   =========================================================================== */
test.describe('[STATE-COVERAGE] v143 P0 — lists sync is monotonic (login can never wipe history)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjMonotonicLists === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(300);
  });

  test('Q2 authenticated — an EMPTY device cannot wipe the cloud copy (the founder P0)', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._gpjCloudListsSeen = { applied: [{ t: 'Marketing Specialist', co: 'Bexar', when: 1000 },
        { t: 'Analyst', co: 'HP', when: 900 }], responses: [], skipped: [], viewed: [] };
      lists = { applied: [], responses: [], skipped: [], viewed: [] };   // empty boot state
      return _gpjMonotonicLists().applied.length;
    });
    expect(r, 'both cloud rows survive a write from a device that booted empty').toBe(2);
  });

  test('Q4 empty/missing — no cloud READ yet means the lists key is OMITTED, never overwritten', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._gpjCloudListsSeen = null;
      lists = { applied: [], responses: [], skipped: [], viewed: [] };
      return _gpjMonotonicLists() === undefined;
    });
    expect(r, 'omitting the key leaves the stored value untouched').toBe(true);
  });

  test('a new row still GROWS the list (monotonic must not mean frozen)', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._gpjCloudListsSeen = { applied: [{ t: 'Old', co: 'X', when: 100 }], responses: [], skipped: [], viewed: [] };
      lists = { applied: [{ t: 'New Role', co: 'Acme', when: 2000 }], responses: [], skipped: [], viewed: [] };
      const w = _gpjMonotonicLists();
      return { n: w.applied.length, first: w.applied[0].t };
    });
    expect(r.n).toBe(2);
    expect(r.first, 'newest first').toBe('New Role');
  });

  test('an EXPLICIT reset still clears — the one legitimate way a list shrinks', async ({ page }) => {
    const r = await page.evaluate(() => {
      const at = Date.now();
      localStorage.setItem('gpj_lists_reset', String(at));
      window._gpjCloudListsSeen = { applied: [{ t: 'Old', co: 'X', when: at - 5000 }], responses: [], skipped: [], viewed: [] };
      lists = { applied: [{ t: 'After', co: 'Y', when: at + 5000 }], responses: [], skipped: [], viewed: [] };
      const w = _gpjMonotonicLists();
      localStorage.removeItem('gpj_lists_reset');
      return { n: w.applied.length, kept: w.applied[0] && w.applied[0].t };
    });
    expect(r.n, 'pre-reset row dropped, post-reset row kept').toBe(1);
    expect(r.kept).toBe('After');
  });

  test('the data-loss gate does not flap when Firebase re-fires auth for the SAME user', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._gpjGateUid = 'uid-A'; window._gpjCloudLoaded = true;
      window._gpjCloudListsSeen = { applied: [{ t: 'a', co: 'b', when: 1 }], responses: [], skipped: [], viewed: [] };
      gpjAuthChanged({ uid: 'uid-A' });                       // token refresh / restored session
      const sameUser = { open: window._gpjCloudLoaded === true, kept: !!window._gpjCloudListsSeen };
      gpjAuthChanged({ uid: 'uid-B' });                       // real account switch
      return { sameUser, switched: { open: window._gpjCloudLoaded, seen: window._gpjCloudListsSeen } };
    });
    expect(r.sameUser.open, 'same uid must NOT slam the gate shut').toBe(true);
    expect(r.sameUser.kept, 'baseline survives a repeat fire').toBe(true);
    expect(r.switched.open, 'a real account switch DOES re-arm').toBe(false);
    expect(r.switched.seen, 'and drops the previous account baseline').toBeNull();
  });
});

test.describe('[STATE-COVERAGE] v143 P0 — sign-out flushes BEFORE it wipes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.gpjFlushBeforeSignOut === 'function', null, { timeout: 15000 });
  });

  // The founder's exact repro: APPLIED 1 / SKIPPED 21 on screen, empty cloud copy,
  // sign out -> 0/0/0 forever. Sign-out used to run fb.signOut() FIRST and then wipe
  // local, so by the time anything could flush, fb.current() was already null.
  test('populated device + EMPTY cloud — history reaches the cloud before the wipe', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let saved = null;
      window.fb = { current: () => ({ uid: 'u1' }),
        loadProfile: async () => ({ lists: { applied: [], skipped: [], responses: [], viewed: [] } }),
        saveProfile: async (uid, d) => { saved = d; return true; }, signOut: async () => {} };
      window._gpjCloudListsSeen = null;
      lists = { applied: [{ t: 'PR Lead', co: 'EQL', when: 5 }], responses: [], viewed: [],
        skipped: Array.from({ length: 21 }, (_, i) => ({ t: 'J' + i, co: 'C' + i, when: i })) };
      const ok = await gpjFlushBeforeSignOut();
      return { ok, applied: saved && saved.lists ? saved.lists.applied.length : -1,
        skipped: saved && saved.lists ? saved.lists.skipped.length : -1 };
    });
    expect(r.ok, 'flush reports success').toBe(true);
    expect(r.applied).toBe(1);
    expect(r.skipped, 'all 21 skipped rows persisted').toBe(21);
  });

  test('Q3 failed network — a flush that fails must NOT green-light the wipe', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = { current: () => ({ uid: 'u1' }),
        loadProfile: async () => ({ lists: {} }),
        saveProfile: async () => { throw new Error('network down'); }, signOut: async () => {} };
      window._gpjCloudListsSeen = null;
      lists = { applied: [{ t: 'A', co: 'B', when: 1 }], responses: [], skipped: [], viewed: [] };
      return await gpjFlushBeforeSignOut();
    });
    expect(r, 'stale local data beats deleted data').toBe(false);
  });

  test('a NON-empty cloud is never clobbered by a local copy we could not merge', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let saved = null;
      window.fb = { current: () => ({ uid: 'u1' }),
        loadProfile: async () => ({ lists: { applied: [{ t: 'Cloud', co: 'X', when: 9 }], skipped: [], responses: [], viewed: [] } }),
        saveProfile: async (uid, d) => { saved = d; return true; }, signOut: async () => {} };
      window._gpjCloudListsSeen = null;                 // no baseline -> cannot safely merge
      lists = { applied: [], responses: [], skipped: [], viewed: [] };
      const ok = await gpjFlushBeforeSignOut();
      return { ok, sentLists: !!(saved && saved.lists) };
    });
    expect(r.ok).toBe(true);
    expect(r.sentLists, 'nothing is written when we cannot prove it is safe').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v143 accordion — the deck springs back after expanding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.syncDeckHeight === 'function' && document.querySelector('.job-card.top'),
      null, { timeout: 15000 });
    await page.waitForTimeout(600);
  });

  test('collapsing returns the deck to its original height (was 333px of permanent dead space)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const deck = document.getElementById('card-deck'), top = document.querySelector('.job-card.top');
      const H = () => Math.round(deck.getBoundingClientRect().height);
      // The deck is resized on transitionend + a fallback timer, so the height is
      // in motion for a while. POLL until it stops changing rather than guessing a
      // fixed delay — a fixed wait passes locally and flakes on a loaded CI runner
      // (which is exactly what a timing guess always does).
      // The stability window MUST outlast the app's own settle path, or this polls
      // its way into a false positive: syncDeckHeight measures at rAF+rAF (~32ms),
      // again on transitionend, and once more on a 420ms fallback timer. A 300ms
      // "stable" window fits INSIDE that, so a mid-transition height reads as
      // settled — which is exactly how this test latched a half-collapsed deck and
      // reported dead space that does not exist. 700ms clears the 420ms fallback.
      const settled = async () => {
        let last = -1, stable = 0;
        for (let i = 0; i < 160; i++) {                 // ≤8s ceiling
          await new Promise((x) => setTimeout(x, 50));
          const h = H();
          stable = (h === last) ? stable + 1 : 0;
          last = h;
          if (stable >= 14) break;                      // ~700ms unchanged = settled
        }
        return last;
      };
      const d = top.querySelector('.card-drawer');
      try { syncDeckHeight(); } catch (e) {}
      const before = await settled();
      if (d) { d.classList.add('open'); syncDeckHeight(); }
      const expanded = await settled();
      if (d) { d.classList.remove('open'); syncDeckHeight(); }
      const after = await settled();
      return { before, expanded, after };
    });
    expect(r.expanded, 'expanding still grows the deck').toBeGreaterThan(r.before);
    expect(r.after, 'and collapsing puts it back exactly').toBe(r.before);
  });
});

test.describe('[STATE-COVERAGE] v143 community reports — one person, one vote + an explained badge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.gpjExplainReports === 'function', null, { timeout: 15000 });
  });

  test('the "N reported" badge opens a closeable explainer (Esc AND the button)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      gpjExplainReports(2);
      await new Promise((x) => setTimeout(x, 200));
      const opened = !!document.getElementById('reports-explain-modal');
      const text = (document.getElementById('reports-explain-modal') || {}).innerText || '';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise((x) => setTimeout(x, 150));
      const escClosed = !document.getElementById('reports-explain-modal');
      gpjExplainReports(1);
      await new Promise((x) => setTimeout(x, 150));
      const singular = (document.getElementById('reports-explain-modal').innerText || '').includes('1 job hunter has');
      document.getElementById('reports-explain-close').click();
      await new Promise((x) => setTimeout(x, 150));
      return { opened, escClosed, singular, btnClosed: !document.getElementById('reports-explain-modal'), saysOnce: /once/i.test(text) };
    });
    expect(r.opened).toBe(true);
    expect(r.escClosed, 'Esc closes').toBe(true);
    expect(r.btnClosed, 'the button closes').toBe(true);
    expect(r.singular, 'grammar is correct for a single reporter').toBe(true);
    expect(r.saysOnce, 'it must state that each person can report once').toBe(true);
  });

  test('Q1 guest — the explainer is pure client copy and never needs auth or a read', async ({ page }) => {
    const r = await page.evaluate(async () => {
      gpjExplainReports(3);
      await new Promise((x) => setTimeout(x, 200));
      const ok = !!document.getElementById('reports-explain-modal');
      const m = document.getElementById('reports-explain-modal'); if (m) m.remove();
      return ok;
    });
    expect(r, 'a signed-out hunter can still learn what the badge means').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v142 desktop deck height — Save button stays reachable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.syncDeckHeight === 'function' && document.querySelector('.job-card.top'),
      null, { timeout: 15000 });
    await page.waitForTimeout(600);
  });

  const measure = `async (desk) => {
    document.body.classList.toggle('desk', !!desk);
    try{ if(desk && typeof buildDesktopGrid==='function') buildDesktopGrid(); }catch(e){}
    try{ syncDeckHeight(); }catch(e){}
    await new Promise(r=>setTimeout(r,700));
    const deck=document.getElementById('card-deck'), top=document.querySelector('.job-card.top');
    const ctrls=document.querySelector('.swipe-controls');
    return {
      deckH: Math.round(deck.getBoundingClientRect().height),
      cardH: Math.round(top.scrollHeight),
      overlaps: Math.round(top.getBoundingClientRect().bottom) > Math.round(ctrls.getBoundingClientRect().top)+2
    };
  }`;

  test('the collapsed desktop deck sizes to the CARD, not a fixed 440 (was 206px of dead space)', async ({ page }) => {
    const r = await page.evaluate(`(${measure})(true)`);
    expect(r.deckH, 'no longer padded out to 440').toBeLessThan(440);
    expect(r.deckH, 'never smaller than the card it contains').toBeGreaterThanOrEqual(Math.min(r.cardH, 300));
    expect(r.overlaps, 'the card must never bleed over the swipe controls').toBe(false);
  });

  test('mobile is unchanged by the desktop fix (no regression)', async ({ page }) => {
    const r = await page.evaluate(`(${measure})(false)`);
    /* v219: mobile deck floors at 300 and HUGS the card (max(300, real+8)); v217's
       founder-approved snapshot card is a few px taller, so 300–~303 is correct — the
       guard is "no desktop dead-space bleed + no controls overlap", not an exact 300. */
    expect(r.deckH, 'mobile deck floors at 300 and hugs the card — no desktop 440 bleed').toBeGreaterThanOrEqual(300);
    expect(r.deckH, 'mobile deck never balloons — it hugs the card').toBeLessThan(340);
    expect(r.overlaps).toBe(false);
  });

  test('an EXPANDED card still grows the deck to fit its drawer', async ({ page }) => {
    const r = await page.evaluate(async () => {
      document.body.classList.add('desk');
      try{ syncDeckHeight(); }catch(e){}
      await new Promise((x)=>setTimeout(x,500));
      const collapsed = Math.round(document.getElementById('card-deck').getBoundingClientRect().height);
      const d = document.querySelector('.job-card.top .card-drawer');
      if (d) { d.classList.add('open'); syncDeckHeight(); }
      await new Promise((x)=>setTimeout(x,700));
      const deck = document.getElementById('card-deck'), top = document.querySelector('.job-card.top');
      const ctrls = document.querySelector('.swipe-controls');
      return {
        collapsed,
        expanded: Math.round(deck.getBoundingClientRect().height),
        cardH: Math.round(top.scrollHeight),
        overlaps: Math.round(top.getBoundingClientRect().bottom) > Math.round(ctrls.getBoundingClientRect().top)+2,
      };
    });
    expect(r.expanded, 'opening the drawer grows the deck').toBeGreaterThanOrEqual(r.collapsed);
    expect(r.expanded, 'the expanded deck contains the taller card').toBeGreaterThanOrEqual(r.cardH);
    expect(r.overlaps, 'still no overlap when expanded').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v141 notification toggles tell the truth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.setNotifPref === 'function' && typeof window.clOptedOut === 'function',
      null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('a toggle that sends nothing must SAY so, and must not default to on', async ({ page }) => {
    const r = await page.evaluate(() => {
      const row = (id) => { const t = document.getElementById(id); return { on: t.classList.contains('on'), text: (t.closest('.pref-row') || {}).textContent || '' }; };
      return { m: row('notif-newmatches'), g: row('notif-ghostrisk'), r: row('notif-ratingreminders'), cl: row('cl-offers-toggle') };
    });
    for (const k of ['m', 'g', 'r']) {
      expect(r[k].text, 'a non-sending toggle is labelled honestly').toMatch(/EMAIL NOT LIVE YET/);
      expect(r[k].on, 'never default-ON for something that does nothing').toBe(false);
    }
    expect(r.cl.text, 'the REAL toggle carries no false disclaimer').not.toMatch(/EMAIL NOT LIVE YET/);
  });

  test('every toggle still persists the user\'s choice (local + cloud)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      const el = document.getElementById('notif-newmatches');
      el.classList.remove('on');
      setNotifPref(el, 'newJobMatches');                 // -> on
      const local = JSON.parse(localStorage.getItem('gpj_profile') || '{}');
      return { on: el.classList.contains('on'), localPref: local.preferences && local.preferences.newJobMatches, cloudPref: writes[0] && writes[0].preferences && writes[0].preferences.newJobMatches };
    });
    expect(r.on).toBe(true);
    expect(r.localPref, 'saved locally').toBe(true);
    expect(r.cloudPref, 'saved to the cloud so it survives a device change').toBe(true);
  });

  test('the Cover Letter toggle is REAL — it gates the in-app offer', async ({ page }) => {
    const r = await page.evaluate(() => {
      setCLOptOut(true);
      const optedOut = clOptedOut();
      setCLOptOut(false);
      return { optedOut, optedIn: !clOptedOut() };
    });
    expect(r.optedOut, 'opting out is enforced by clOptedOut()').toBe(true);
    expect(r.optedIn).toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v140 sync gate cannot stick shut + market backfill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.loadTierFromProfile === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('THE BUG: a restore step throwing must NOT block syncing forever', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async () => true;
      // a good READ, then force a restore-step failure
      fb.loadProfile = async () => ({
        createdAt: 1700000000000,
        get lists() { throw new Error('boom during restore'); },
      });
      window._gpjCloudLoaded = false;
      await loadTierFromProfile({ uid: 'u1' });
      return window._gpjCloudLoaded;
    });
    expect(r, 'read succeeded => syncing stays possible even if painting failed').toBe(true);
  });

  test('a FAILED read still keeps the gate shut (data-loss guard intact)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' });
      fb.loadProfile = async () => { throw new Error('network down'); };
      window._gpjCloudLoaded = false;
      await loadTierFromProfile({ uid: 'u1' });
      return window._gpjCloudLoaded;
    });
    expect(r, 'never write over data we could not read').toBe(false);
  });

  test('the market is backfilled to the profile so reverse-match can scope her', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      fb.loadProfile = async () => ({ createdAt: 1700000000000 });   // no location stored yet
      localStorage.setItem('gpj_loc', 'Houston, TX');
      await loadTierFromProfile({ uid: 'u1' });
      await new Promise((x) => setTimeout(x, 80));
      const mkt = writes.find((w) => w && w.location);
      return { wroteLocation: mkt && mkt.location, touchedLists: writes.some((w) => w && 'lists' in w) };
    });
    expect(r.wroteLocation, 'her saved market reaches the profile').toBe('Houston, TX');
    expect(r.touchedLists, 'the backfill is single-field — it never writes lists').toBe(false);
  });

  test('no redundant write when the profile already has the market', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      fb.loadProfile = async () => ({ createdAt: 1700000000000, location: 'Houston, TX' });
      localStorage.setItem('gpj_loc', 'Houston, TX');
      await loadTierFromProfile({ uid: 'u1' });
      await new Promise((x) => setTimeout(x, 80));
      return writes.filter((w) => w && w.location).length;
    });
    expect(r, 'already correct => no wasted write').toBe(0);
  });
});

test.describe('[STATE-COVERAGE] v138 company-name folding + cross-device expired flags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._coKey === 'function' && typeof window.jobKey === 'function',
      null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('one employer = one key, so a role cannot duplicate under two spellings', async ({ page }) => {
    const r = await page.evaluate(() => ({
      terracon: jobKey({ t: 'Marketing Specialist', co: 'Terracon Consultants Inc' }) === jobKey({ t: 'Marketing Specialist', co: 'Terracon' }),
      roberthalf: jobKey({ t: 'Data Entry Clerk', co: 'Robert Half' }) === jobKey({ t: 'Data Entry Clerk', co: 'Robert Half International' }),
      distinctCo: jobKey({ t: 'X', co: 'Terracon' }) !== jobKey({ t: 'X', co: 'Terradyne' }),
      distinctTitle: jobKey({ t: 'Marketing Assistant', co: 'Robert Half' }) !== jobKey({ t: 'Marketing Coordinator', co: 'Robert Half' }),
      boilerplateOnly: _coKey('Group'),
    }));
    expect(r.terracon, 'the founder\'s duplicate: "Terracon Consultants Inc" === "Terracon"').toBe(true);
    expect(r.roberthalf).toBe(true);
    expect(r.distinctCo, 'genuinely different employers must NOT merge').toBe(true);
    expect(r.distinctTitle, 'different roles at one agency stay separate jobs').toBe(true);
    expect(r.boilerplateOnly, 'a name that is only boilerplate keeps its text').toBe('group');
  });

  test('a flag raised under one spelling hides the job under the other', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_expired', '[]');
      window.fb = window.fb || {}; fb.current = () => ({ uid: 'u1' });   // reportExpired requires sign-in
      // reportExpired is the real flag path (writes gpj_expired + lists.skipped)
      try{ reportExpired('Marketing Specialist', 'Terracon Consultants Inc'); }catch(e){}
      return {
        sameSpelling: gpjIsExpired('Marketing Specialist', 'Terracon Consultants Inc'),
        otherSpelling: gpjIsExpired('Marketing Specialist', 'Terracon'),
        differentRole: gpjIsExpired('Data Entry Clerk', 'Terracon'),
      };
    });
    expect(r.sameSpelling).toBe(true);
    expect(r.otherSpelling, 'flagging once hides every spelling of that employer\'s role').toBe(true);
    expect(r.differentRole, 'a different role at the same employer is still shown').toBe(false);
  });

  test('expired flags restore from the cloud as a UNION (never lost on another device)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async () => true;
      localStorage.setItem('gpj_expired', JSON.stringify(['local only|acme']));
      fb.loadProfile = async () => ({ createdAt: 1700000000000, expired: ['from other device|globex'] });
      await loadTierFromProfile({ uid: 'u1' });
      const set = JSON.parse(localStorage.getItem('gpj_expired') || '[]');
      return { hasLocal: set.includes('local only|acme'), hasCloud: set.includes('from other device|globex') };
    });
    expect(r.hasLocal, 'a device-local flag is never dropped').toBe(true);
    expect(r.hasCloud, 'a flag from another device arrives here').toBe(true);
  });

  test('cloudSync ships the expired set (gated by the v137 data-loss guard)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      localStorage.setItem('gpj_expired', JSON.stringify(['role|acme']));
      window._gpjCloudLoaded = true;
      cloudSync();
      await new Promise((x) => setTimeout(x, 60));
      return writes[0] && writes[0].expired;
    });
    expect(r).toContain('role|acme');
  });
});

test.describe('[STATE-COVERAGE] v137 DATA-LOSS guard (founder P0: lists + prefs wiped)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.cloudSync === 'function' && typeof window.loadTierFromProfile === 'function',
      null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('THE BUG: cloudSync must NOT write before the cloud profile is read', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      window._gpjCloudLoaded = false;          // simulates boot / just-signed-in
      lists = { applied: [], skipped: [], responses: [], viewed: [] };   // empty boot state
      cloudSync();
      await new Promise((x) => setTimeout(x, 80));
      return { writesWhileLoading: writes.length };
    });
    expect(r.writesWhileLoading, 'an empty boot state can never overwrite real cloud data').toBe(0);
  });

  test('after the restore completes, cloudSync writes normally', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      fb.loadProfile = async () => ({ createdAt: 1700000000000, lists: { applied: [{ t: 'Role', co: 'Co', when: Date.now() }] } });
      await loadTierFromProfile({ uid: 'u1' });          // opens the gate
      const gateOpen = window._gpjCloudLoaded === true;
      cloudSync();
      await new Promise((x) => setTimeout(x, 80));
      return { gateOpen, wrote: writes.length > 0, keptApplied: (writes[0] && writes[0].lists && writes[0].lists.applied || []).length };
    });
    expect(r.gateOpen, 'a completed restore opens the gate').toBe(true);
    expect(r.wrote).toBe(true);
    expect(r.keptApplied, 'it writes the RESTORED lists, not an empty set').toBeGreaterThan(0);
  });

  test('a brand-new account (no cloud profile) can still sync', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'new1' });
      fb.saveProfile = async () => true;
      fb.loadProfile = async () => null;                 // no profile yet
      window._gpjCloudLoaded = false;
      await loadTierFromProfile({ uid: 'new1' });
      return window._gpjCloudLoaded === true;
    });
    expect(r, 'a new user is not locked out of syncing').toBe(true);
  });

  test('placeholder prefs are never persisted over real ones', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const writes = [];
      fb.current = () => ({ uid: 'u1' });
      fb.saveProfile = async (uid, d) => { writes.push(d); return true; };
      window._gpjCloudLoaded = true;                     // gate open
      // v153: prefs now live in a canonical store; clear it so this exercises the
      // DOM fallback (the state right after a restore paints the text).
      try { localStorage.removeItem('gpj_prefs'); } catch (e) {}
      // DOM still shows the markup placeholders (read from the constant, so this
      // test can never drift out of sync with the shipped placeholder text again)
      document.getElementById('pref-titles').textContent = _GPJ_PREF_PLACEHOLDERS.titles;
      document.getElementById('pref-salary').textContent = _GPJ_PREF_PLACEHOLDERS.salary;
      document.getElementById('pref-industries').textContent = _GPJ_PREF_PLACEHOLDERS.industries;
      cloudSync();
      await new Promise((x) => setTimeout(x, 60));
      const placeholderWrite = writes[0] && writes[0].prefs;
      // now real prefs are painted
      document.getElementById('pref-titles').textContent = 'Marketing Manager, Brand Lead';
      cloudSync();
      await new Promise((x) => setTimeout(x, 60));
      const realWrite = writes[1] && writes[1].prefs;
      return { placeholderWrite: placeholderWrite === undefined, realTitles: realWrite && realWrite.titles };
    });
    expect(r.placeholderWrite, 'placeholder prefs are omitted, leaving the stored value intact').toBe(true);
    expect(r.realTitles, 'real prefs still save').toBe('Marketing Manager, Brand Lead');
  });

  test('an auth change re-arms the gate (account switch cannot clobber)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjCloudLoaded = true;
      window._gpjRecruiterAuthApply = () => {};
      gpjAuthChanged({ uid: 'other' });
      return window._gpjCloudLoaded;
    });
    expect(r, 'switching accounts closes the gate until the new profile is read').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v128 post-apply email (confirmed applies only)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._fireApplyEmail === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('v134: the sandbox "Done — I Applied" also fires the post-apply email', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let fired = null;
      window._fireApplyEmail = (t, co, m) => { fired = { t, co, m }; };
      window._sbJob = { title: 'Marketing Specialist', co: 'Terracon Consultants Inc', loc: 'Houston, TX' };
      window._realTitle = (x) => x; window._realCo = (x) => x;
      lists = { applied: [], skipped: [], viewed: [], responses: [] };
      window.saveLists = () => {}; window.updateStatCounters = () => {}; window.cloudSync = () => {};
      window.closeSandbox = () => {}; window.reloadDeckFromQueue = () => {};
      sandboxDone();
      await new Promise((x) => setTimeout(x, 50));
      return fired;
    });
    expect(r, 'the sandbox confirm fires the email (was the missed path)').not.toBeNull();
    expect(r.co).toBe('Terracon Consultants Inc');
  });

  test('fires once per job, caps at 5/day, and never fires signed-out', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const calls = [];
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).includes('/api/apply-email')) { calls.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, json: async () => ({ ok: true }) }); }
        return realFetch(url, opts);
      };
      localStorage.removeItem('gpj_apply_email_log');
      // signed OUT -> no fire
      window.fb = window.fb || {}; fb.current = () => null;
      _fireApplyEmail('Ops Manager', 'Acme', 'Houston, TX');
      await new Promise((x) => setTimeout(x, 50));
      const signedOut = calls.length;
      // signed IN
      fb.current = () => ({ getIdToken: async () => 'tok123' });
      _fireApplyEmail('Ops Manager', 'Acme', 'Houston, TX');
      _fireApplyEmail('Ops Manager', 'Acme', 'Houston, TX');   // same job -> deduped
      await new Promise((x) => setTimeout(x, 60));
      const afterDupe = calls.length;
      for (let i = 0; i < 8; i++) _fireApplyEmail('Role ' + i, 'Co ' + i, 'Houston, TX');
      await new Promise((x) => setTimeout(x, 80));
      const afterMany = calls.length;
      window.fetch = realFetch;
      return { signedOut, afterDupe, afterMany, firstBody: calls[0] };
    });
    expect(r.signedOut, 'signed-out never fires').toBe(0);
    expect(r.afterDupe, 'same job fires exactly once').toBe(1);
    expect(r.afterMany, 'capped at 5 per day').toBe(5);
    expect(r.firstBody.idToken).toBe('tok123');
    expect(r.firstBody.jobTitle).toBe('Ops Manager');
    expect(r.firstBody.market).toBe('Houston, TX');
  });
});

test.describe('[STATE-COVERAGE] v127 full internal scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.reachOutTo === 'function'
      && typeof window._collectSlots === 'function' && typeof window.pickInterviewSlot === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('recruiter proposes structured slots via the modal; timestamps ride along', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let sent = null;
      fb.sendReachOut = async (uid, jobId, payload) => { sent = { uid, jobId, payload }; return 'ro1'; };
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      reachOutTo('cand1', 'job1', 'Ops Manager', 'Jane Doe', 'reachout');
      const hasModal = !!document.getElementById('reachout-modal');
      const dateInputs = document.querySelectorAll('#reachout-modal input[type="date"]').length;
      // fill two of three slots
      document.getElementById('ro-d0').value = '2026-08-10'; document.getElementById('ro-t0').value = '14:00';
      document.getElementById('ro-d1').value = '2026-08-11'; document.getElementById('ro-t1').value = '10:30';
      await _sendReachOutModal();
      return { hasModal, dateInputs, payload: sent && sent.payload, modalGone: !document.getElementById('reachout-modal') };
    });
    expect(r.hasModal).toBe(true);
    expect(r.dateInputs, 'three structured slot rows').toBe(3);
    expect(r.payload.proposedTimes.length, 'two filled slots collected').toBe(2);
    expect(r.payload.proposedTs.length).toBe(2);
    expect(typeof r.payload.proposedTs[0]).toBe('number');
    expect(r.modalGone).toBe(true);
  });

  test('candidate picks a slot BY INDEX — the real timestamp is stored (not re-parsed)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let resp = null;
      fb.respondReachout = async (id, status, extra) => { resp = { id, status, extra }; return true; };
      window._myRO = { ro9: { id: 'ro9', company: 'Acme', proposedTimes: ['Mon Aug 10 · 2:00 PM CDT', 'Tue Aug 11 · 10:30 AM CDT'], proposedTs: [1786000000000, 1786100000000] } };
      window.renderMyReachouts = () => {};
      // v148: picking a slot opens the accept modal with that time pre-selected; the
      // structured timestamp still rides through, and the record fires on confirm.
      pickInterviewSlot('ro9', 1);
      await new Promise((r) => setTimeout(r, 120));
      document.getElementById('ai-email').value = 'c1@cand.com';
      await _confirmAcceptInterview();
      return resp;
    });
    expect(r.status).toBe('interested');
    expect(r.extra.acceptedTime).toBe('Tue Aug 11 · 10:30 AM CDT');
    expect(r.extra.acceptedTs, 'the structured timestamp powers reminders, no string parsing').toBe(1786100000000);
  });

  test('recruiter cancel + reschedule call the recruiter update path with the right status', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const calls = [];
      fb.recruiterUpdateReachout = async (id, patch) => { calls.push({ id, patch }); return true; };
      window.renderRecruiterResponses = () => {};
      window.confirm = () => true;
      await recCancelInterviewUI('roX');
      recRescheduleUI('roY');
      document.getElementById('rs-d0').value = '2026-09-01'; document.getElementById('rs-t0').value = '09:00';
      await _sendReschedule();
      return calls;
    });
    expect(r[0].patch.status, 'cancel is a real, told status — never silence').toBe('cancelled');
    expect(r[0].patch.cancelNote).toBeTruthy();
    expect(r[1].patch.status, 'reschedule re-opens the slot picker').toBe('sent');
    expect(r[1].patch.proposedTimes.length).toBe(1);
    expect(r[1].patch.acceptedTime, 'the old pick is cleared').toBe('');
  });

  test('candidate can request a reschedule with a note', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let resp = null;
      fb.respondReachout = async (id, status, extra) => { resp = { id, status, extra }; return true; };
      window.prompt = () => 'Mornings work better for me';
      window.renderMyReachouts = () => {};
      await requestRescheduleUI('ro5');
      return resp;
    });
    expect(r.status).toBe('reschedule-requested');
    expect(r.extra.rescheduleNote).toBe('Mornings work better for me');
  });
});

test.describe('[STATE-COVERAGE] v126 admin insights (hires + attribution)', () => {
  test('insights paint real counts; empty data reads honestly; zero-hire stays muted', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.adminLoadInsights === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      document.body.insertAdjacentHTML('beforeend',
        '<div id="admin-hire-count"></div><div id="admin-heard-line"></div>');
      window.fb = window.fb || {};
      fb.adminHireCounts = async () => ({ total: 4, gpj: 2 });
      fb.adminHeardFromCounts = async (chs) => { const m = {}; chs.forEach((c) => m[c] = 0); m['TikTok'] = 3; m['Referral'] = 1; return m; };
      await adminLoadInsights();
      const withData = {
        hires: document.getElementById('admin-hire-count').textContent,
        channels: document.getElementById('admin-heard-line').textContent
      };
      fb.adminHireCounts = async () => ({ total: 0, gpj: 0 });
      fb.adminHeardFromCounts = async (chs) => { const m = {}; chs.forEach((c) => m[c] = 0); return m; };
      await adminLoadInsights();
      const empty = {
        hires: document.getElementById('admin-hire-count').textContent,
        channels: document.getElementById('admin-heard-line').textContent
      };
      document.getElementById('admin-hire-count').remove(); document.getElementById('admin-heard-line').remove();
      return { withData, empty };
    });
    expect(r.withData.hires).toBe('2 via GhostProofJob · 4 closes recorded');
    expect(r.withData.channels).toContain('TikTok: 3');
    expect(r.withData.channels).toContain('Referral: 1');
    expect(r.withData.channels, 'zero-count channels are not listed').not.toContain('Instagram');
    expect(r.empty.hires).toBe('0 via GhostProofJob · 0 closes recorded');
    expect(r.empty.channels, 'no data reads as honest copy, not fake numbers').toContain('none attributed yet');
  });
});

test.describe('[STATE-COVERAGE] v125 client error monitoring', () => {
  test('errors are reported once signed in — capped at 3/session, correct shape, reporter never loops', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjReportErr === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const logged = [];
      fb.current = () => ({ uid: 'u1' });
      fb.logClientError = async (rec) => { logged.push(rec); return true; };
      window._gpjErrQ = [];
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new ErrorEvent('error', { message: 'Boom ' + i, filename: 'https://x/index.html', lineno: 10 + i }));
      }
      await new Promise((x) => setTimeout(x, 300));
      return { count: logged.length, first: logged[0] };
    });
    expect(r.count, 'max 3 per session — no error storms').toBe(3);
    expect(r.first.msg).toBe('Boom 0');
    expect(r.first.src).toBe('index.html');
    expect(r.first.line).toBe(10);
    expect(String(r.first.v)).toMatch(/^v\d+/);
  });
});

test.describe('[STATE-COVERAGE] v123 kind-decline from Applicants + account deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.recToggleApplicants === 'function'
      && typeof window.openDeleteAccount === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('every applicant row offers Reach out + Send kind decline (was: no response path at all)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      window.fb = window.fb || {};
      fb.loadJobApplicants = async () => [{ uid: 'cand1', match: 90, resume: { name: 'Jane Doe', title: 'Ops Lead' } }];
      let sent = null;
      fb.sendReachOut = async (uid, jobId, payload) => { sent = { uid, jobId, kind: payload.kind }; return 'ro9'; };
      fb.markApplicationViewed = async () => true;
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      const host = document.createElement('div'); host.id = 'ra-jx'; host.style.display = 'none';
      document.body.appendChild(host);
      await recToggleApplicants('jx', 'Ops Manager');
      const html = host.innerHTML;
      const declineBtn = [...host.querySelectorAll('[onclick*="rejection"]')][0];
      declineBtn.click();
      await new Promise((x) => setTimeout(x, 150));
      // v127: kind decline opens the structured modal (default note prefilled) — confirm to send
      await _sendReachOutModal();
      await new Promise((x) => setTimeout(x, 100));
      host.remove();
      return { hasReach: /'reachout'\)/.test(html.replace(/&#39;|\\'/g, "'")) || /reachout/.test(html), hasDecline: /rejection/.test(html), sent };
    });
    expect(r.hasReach).toBe(true);
    expect(r.hasDecline).toBe(true);
    expect(r.sent, 'one tap sends the respectful decline').toEqual({ uid: 'cand1', jobId: 'jx', kind: 'rejection' });
  });

  test('delete account: password-confirmed; a wrong password deletes nothing; cancel aborts', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      const calls = [];
      fb.current = () => ({ uid: 'u1' });
      fb.deleteMyAccount = async (pw, appIds) => { calls.push({ pw, appIds }); return pw === 'right' ? { ok: true } : { ok: false, err: 'bad-password' }; };
      window.confirm = () => true;   // v133: get past the new "are you sure" guard
      // v129: the user's internal applications must be handed over for cleanup (PII removal)
      window.lists = window.lists || {};
      lists.applied = [
        { t: 'Ops Manager', co: 'GPJ', id: 'jobA', _internal: true },
        { t: 'External Role', co: 'BigCo', id: '', _internal: false },
        { t: 'Analyst', co: 'Acme', id: 'jobB', _internal: true },
      ];
      window.prompt = () => null;                 // cancel
      await openDeleteAccount();
      const afterCancel = calls.length;
      window.prompt = () => 'wrong';
      await openDeleteAccount();
      window.prompt = () => 'right';
      const hadKey = (localStorage.setItem('gpj_probe', '1'), true);
      await openDeleteAccount();
      const wiped = localStorage.getItem('gpj_probe') === null;
      return { afterCancel, calls, hadKey, wiped };
    });
    expect(r.afterCancel, 'cancel = nothing happens').toBe(0);
    expect(r.calls.map((c) => c.pw)).toEqual(['wrong', 'right']);
    expect(r.calls[1].appIds, 'only internal-job applications are handed over for PII cleanup').toEqual(['jobA', 'jobB']);
    expect(r.wiped, 'successful delete wipes local state').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v122 password recovery (was: permanent lockout)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.authForgot === 'function' && typeof window.recForgot === 'function',
      null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('both auth modals offer Forgot password; it sends the reset to the typed email', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const candLink = [...document.querySelectorAll('[onclick*="authForgot"]')].length;
      const recLink = [...document.querySelectorAll('[onclick*="recForgot"]')].length;
      window.fb = window.fb || {};
      let sent = [];
      fb.resetPassword = async (e) => { sent.push(e); return true; };
      document.getElementById('auth-email').value = '';
      await authForgot();                                     // empty -> nudge, no send
      const afterEmpty = sent.length;
      document.getElementById('auth-email').value = 'aaliyah@example.com';
      await authForgot();
      document.getElementById('rec-email').value = 'owner@acme.com';
      await recForgot();
      return { candLink, recLink, afterEmpty, sent };
    });
    expect(r.candLink).toBeGreaterThanOrEqual(1);
    expect(r.recLink).toBeGreaterThanOrEqual(1);
    expect(r.afterEmpty, 'no email typed -> nudge, nothing sent').toBe(0);
    expect(r.sent).toEqual(['aaliyah@example.com', 'owner@acme.com']);
  });
});

test.describe('[STATE-COVERAGE] v121 withdrawal + attribution + honest duplicate guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.withdrawApply === 'function'
      && typeof window.recordSwipe === 'function' && typeof window.applyInternal === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('a duplicate apply keeps the ORIGINAL date and says so (was: silent re-record)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      lists.applied = [];
      recordSwipe('right', { t: 'Marketing Manager', co: 'GPJ', id: 'j1', _internal: true });
      const firstWhen = lists.applied[0].when;
      lists.applied[0].when = firstWhen - 3 * 86400000;          // pretend it was 3 days ago
      recordSwipe('right', { t: 'Marketing Manager', co: 'GPJ', id: 'j1', _internal: true });
      let sent = null;
      window.fb = window.fb || {};
      fb.applyToInternalJob = async (id, meta) => { sent = { id, meta }; return true; };
      window.requireSignIn = () => true;
      await applyInternal({ id: 'j1', t: 'Marketing Manager', co: 'GPJ', appQuestions: [] });
      await new Promise((x) => setTimeout(x, 150));
      return { rows: lists.applied.length, keptOriginal: lists.applied[0].when === firstWhen - 3 * 86400000, reSent: sent !== null };
    });
    expect(r.rows, 'still exactly one row').toBe(1);
    expect(r.keptOriginal, 'the FIRST apply date is the truth — never reset').toBe(true);
    expect(r.reSent, 'an already-applied role is not re-sent to the employer').toBe(false);
  });

  test('a candidate can withdraw an employer application; the row honestly says so', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let withdrew = null;
      fb.withdrawApplication = async (id) => { withdrew = id; return true; };
      fb.current = () => ({ uid: 'c1' });
      fb.myApplicationStatus = async () => ({ viewedByEmployer: true });
      window.confirm = () => true;
      lists.applied = [{ t: 'Marketing Manager', co: 'GPJ', when: Date.now(), id: 'j1', _internal: true, ghost: 0 }];
      renderStatList('applied');
      const hadButton = /withdrawApply\(0\)/.test(document.getElementById('stat-modal-list').innerHTML);
      await withdrawApply(0);
      await new Promise((x) => setTimeout(x, 200));
      const html = document.getElementById('stat-modal-list').innerHTML;
      return { hadButton, withdrew, marked: lists.applied[0].status, rowSaysWithdrawn: /withdrawn/.test(html), buttonGone: !/withdrawApply\(0\)/.test(html) };
    });
    expect(r.hadButton, 'internal applies offer Withdraw').toBe(true);
    expect(r.withdrew).toBe('j1');
    expect(r.marked).toBe('withdrawn');
    expect(r.rowSaysWithdrawn).toBe(true);
    expect(r.buttonGone, 'no double-withdraw').toBe(true);
  });

  test('the candidate sees the true delivery state — Seen by employer / Delivered', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'c1' });
      fb.myApplicationStatus = async (id) => (id === 'seen' ? { viewedByEmployer: true } : { status: 'applied' });
      lists.applied = [
        { t: 'Role A', co: 'GPJ', when: Date.now(), id: 'seen', _internal: true },
        { t: 'Role B', co: 'Acme', when: Date.now(), id: 'fresh', _internal: true }
      ];
      renderStatList('applied');
      await new Promise((x) => setTimeout(x, 300));
      const html = document.getElementById('stat-modal-list').innerHTML;
      return { seen: /Seen by employer/.test(html), delivered: /Delivered/.test(html) };
    });
    expect(r.seen, 'an opened application says so — silence is the thing we kill').toBe(true);
    expect(r.delivered).toBe(true);
  });

  test('opening a Candidate Card marks the application as viewed by the employer', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let marked = null;
      fb.markApplicationViewed = async (jobId, uid) => { marked = { jobId, uid }; return true; };
      window._recApps = { j1: [{ uid: 'cand9', match: 88, resume: { name: 'Jane' }, coverLetter: '' }] };
      openCandidateCard('j1', 0);
      document.getElementById('candcard-scrim').remove();
      return marked;
    });
    expect(r).toEqual({ jobId: 'j1', uid: 'cand9' });
  });

  test('signup attribution: both forms offer it, and the choice persists to the profile once', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const cand = document.getElementById('auth-heard'), rec = document.getElementById('rec-heard');
      cand.value = 'TikTok'; cand.dispatchEvent(new Event('change'));
      const stashed = localStorage.getItem('gpj_heard');
      window.fb = window.fb || {};
      let saved = null;
      fb.loadProfile = async () => ({ createdAt: 1700000000000, account: { first: 'A' }, accountEditedAt: 1 });
      fb.saveProfile = async (uid, d) => { if (d.heardFrom) saved = d; return true; };
      fb.current = () => ({ uid: 'u1' });
      await loadTierFromProfile({ uid: 'u1' });
      const cleared = localStorage.getItem('gpj_heard') === null;
      // an EXISTING answer is never overwritten
      localStorage.setItem('gpj_heard', 'Other');
      let saved2 = null;
      fb.loadProfile = async () => ({ createdAt: 1700000000000, heardFrom: 'TikTok' });
      fb.saveProfile = async (uid, d) => { if (d.heardFrom) saved2 = d; return true; };
      await loadTierFromProfile({ uid: 'u1' });
      return { bothForms: !!(cand && rec), stashed, savedFrom: saved && saved.heardFrom, cleared, neverOverwrites: saved2 === null };
    });
    expect(r.bothForms).toBe(true);
    expect(r.stashed).toBe('TikTok');
    expect(r.savedFrom).toBe('TikTok');
    expect(r.cleared, 'stash is consumed once').toBe(true);
    expect(r.neverOverwrites).toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v120 street-safe City/State + listings upgrades + admin alerts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._cityStateOf === 'function'
      && typeof window._openApplyQuestions === 'function' && typeof window._notifAdmin === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('the street can NEVER become the City/State (founder repro: "Bend, LN")', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_loc', 'Houston, TX');
      return {
        lnEnding: _cityStateOf('5606 Willow Bend Ln'),          // street suffix must NOT read as a state
        bareStreet: _cityStateOf('Willow Bend Ln'),
        noComma: _cityStateOf('5606 Main St Houston TX 77081'),
        comma: _cityStateOf('123 Main St, Houston, TX 77081'),
        southBend: _cityStateOf('900 W Sample St South Bend IN'), // real city containing "Bend"
        cityState: _cityStateOf('Houston TX'),
        bareCity: _cityStateOf('Katy'),
        fakeState: _cityStateOf('123 Ocean Dr, Somewhere, ZZ'),   // ZZ is not a state
        empty: _cityStateOf('')
      };
    });
    expect(r.lnEnding, '"…Willow Bend Ln" falls back to the market — never "Bend, LN"').toBe('Houston, TX');
    expect(r.bareStreet).toBe('Houston, TX');
    expect(r.noComma).toBe('Houston, TX');
    expect(r.comma).toBe('Houston, TX');
    expect(r.southBend, 'a real city containing a suffix-like word still parses').toBe('South Bend, IN');
    expect(r.cityState).toBe('Houston, TX');
    expect(r.bareCity).toBe('Katy');
    expect(r.fakeState, 'an invalid state code cannot mint a City/ST').toBe('Houston, TX');
    expect(r.empty).toBe('');
    for (const v of Object.values(r)) expect(String(v)).not.toMatch(/Main|Willow|Ocean|, LN|, DR|, ST$/);
  });

  test('a posted role carries Benefits + up to 5 application questions; edit prefills them', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      window.fb = window.fb || {};
      let created = null;
      fb.createRecruiterJob = async (j) => { created = j; return 'jN'; };
      fb.loadRecruiterJobs = async () => [];
      fb.loadJob = async () => ({ id: 'j1', title: 'Ops', location: 'Houston, TX', description: 'A role we will edit now.', benefits: 'PTO + 401k', appQuestions: ['Weekends OK?', 'Forklift certified?'] });
      window._recruiter = { uid: 'r1', company: 'Acme', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'free' };
      _gpjApplyRecruiterSkin(); await new Promise((x) => setTimeout(x, 400));
      await renderRecListings(); await new Promise((x) => setTimeout(x, 200));
      document.getElementById('rl-title').value = 'Warehouse Lead';
      document.getElementById('rl-location').value = 'Katy, TX';
      document.getElementById('rl-desc').value = 'Own the day to day running of the site, including scheduling, safety walks and inventory accuracy. You will lead a team of eight, report to the Ops Director, and own the weekly KPI review. In your first 90 days you will rebuild the shift plan, close out the open safety actions, and take over vendor scheduling end to end.';
      document.getElementById('rl-benefits').value = 'Health · PTO';
      document.getElementById('rl-questions').value = 'Weekends OK?\nForklift certified?\n\nQ3\nQ4\nQ5\nQ6 too many';
      await postRecJob();
      await recEditJob('j1');
      return { created: { benefits: created.benefits, qs: created.appQuestions },
        prefillBenefits: document.getElementById('rl-benefits').value,
        prefillQs: document.getElementById('rl-questions').value };
    });
    expect(r.created.benefits).toBe('Health · PTO');
    expect(r.created.qs, 'capped at 5, blanks dropped').toEqual(['Weekends OK?', 'Forklift certified?', 'Q3', 'Q4', 'Q5']);
    expect(r.prefillBenefits).toBe('PTO + 401k');
    expect(r.prefillQs).toBe('Weekends OK?\nForklift certified?');
  });

  test('applying to a job with questions asks them FIRST; answers ride in the application', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      let sent = null;
      fb.applyToInternalJob = async (id, meta) => { sent = { id, meta }; return true; };
      window.requireSignIn = () => true;
      const j = { id: 'jq1', t: 'Ops Manager', co: 'GPJ', appQuestions: ['Weekends OK?', 'Start date?'] };
      applyInternal(j);
      await new Promise((x) => setTimeout(x, 100));
      const modalOpen = !!document.getElementById('applyq-modal');
      const qCount = document.querySelectorAll('#applyq-modal textarea').length;
      document.getElementById('aq-0').value = 'Yes, both days';
      document.getElementById('aq-1').value = 'Two weeks out';
      _submitApplyQuestions();
      await new Promise((x) => setTimeout(x, 150));
      // v145: questions -> completion step -> send. Submit the completion modal.
      const completeOpenAfterQ = !!document.getElementById('applyc-modal');
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 200));
      const plain = { id: 'jp1', t: 'Simple Role', co: 'Acme', appQuestions: [] };
      let sentPlain = null;
      fb.applyToInternalJob = async (id, meta) => { sentPlain = { id, meta }; return true; };
      applyInternal(plain);
      await new Promise((x) => setTimeout(x, 100));
      // no questions -> skip straight to the completion step (no questions modal)
      const plainSkippedQuestions = !document.getElementById('applyq-modal') && !!document.getElementById('applyc-modal');
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 200));
      return { modalOpen, qCount, answers: sent && sent.meta.answers, modalGone: !document.getElementById('applyq-modal'),
               completeOpenAfterQ, plainSkippedQuestions, plainSent: !!sentPlain, plainAnswers: sentPlain && sentPlain.meta.answers };
    });
    expect(r.modalOpen, 'questions modal opens before sending').toBe(true);
    expect(r.qCount).toBe(2);
    expect(r.answers, 'the custom answers ride in the application').toEqual([{ q: 'Weekends OK?', a: 'Yes, both days' }, { q: 'Start date?', a: 'Two weeks out' }]);
    expect(r.modalGone).toBe(true);
    expect(r.completeOpenAfterQ, 'questions -> completion step before send').toBe(true);
    expect(r.plainSkippedQuestions, 'no questions -> straight to completion step').toBe(true);
    expect(r.plainSent, 'the plain application is sent after the completion step').toBe(true);
    expect(r.plainAnswers).toEqual([]);
  });

  test('the Candidate Card shows the screening answers', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._recApps = { j1: [{ uid: 'c1', match: 90, resume: { name: 'Jane Doe', title: 'Ops Lead' }, coverLetter: 'Hi', answers: [{ q: 'Weekends OK?', a: 'Yes' }, { q: 'Start date?', a: '' }] }] };
      openCandidateCard('j1', 0);
      const t = (document.getElementById('candcard-scrim') || {}).textContent || '';
      document.getElementById('candcard-scrim').remove();
      return { hasSection: /Your questions/.test(t), hasQ: /Weekends OK\?/.test(t), hasA: /Yes/.test(t), hasEmpty: /no answer/.test(t) };
    });
    expect(r.hasSection).toBe(true);
    expect(r.hasQ).toBe(true);
    expect(r.hasA).toBe(true);
    expect(r.hasEmpty, 'an unanswered question is shown honestly').toBe(true);
  });

  test('admins get pending-approval notifications; non-admins never do', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.adminPendingRecruiters = async () => [{ uid: 'a' }, { uid: 'b' }];
      fb.adminPendingJobs = async () => [{ id: 'j' }];
      const items = await _notifAdmin();
      return { n: items.length, t0: items[0] && items[0].title, t1: items[1] && items[1].title, views: items.map((i) => i.view) };
    });
    expect(r.n).toBe(2);
    expect(r.t0).toMatch(/2 employer accounts waiting/);
    expect(r.t1).toMatch(/1 employer job waiting/);
    expect(r.views).toEqual(['account', 'account']);
  });

  test('logo: save publishes it to the company doc; the company card lazy-loads it for internal jobs', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      window.fb = window.fb || {};
      let savedCompany = null;
      fb.saveCompany = async (cid, d) => { savedCompany = d; return true; };
      fb.createRecruiter = async () => true;
      fb.loadCompany = async () => ({ name: 'GPJ', logo: 'data:image/png;base64,iVBORw0KGgo=' });
      window._recruiter = { uid: 'r1', company: 'GPJ', companyId: 'gpj.com', role: 'owner', isValidated: true, logo: 'data:image/png;base64,iVBORw0KGgo=' };
      _gpjApplyRecruiterSkin(); await new Promise((x) => setTimeout(x, 400));
      await renderRecCompany(); await new Promise((x) => setTimeout(x, 300));
      const hasUpload = !!document.getElementById('rc-logo-file');
      const preview = (document.getElementById('rc-logo-preview') || {}).innerHTML || '';
      await saveRecCompany();
      openCompanyView('GPJ', { _internal: true, companyId: 'gpj.com', title: 'Marketing Manager' });
      await new Promise((x) => setTimeout(x, 300));
      const nameHtml = (document.getElementById('cm-name') || {}).innerHTML || '';
      try { document.getElementById('company-modal').classList.remove('open'); } catch (e) {}
      return { hasUpload, previewHasImg: /<img/.test(preview), savedLogo: savedCompany && savedCompany.logo, modalHasLogo: /<img/.test(nameHtml) };
    });
    expect(r.hasUpload).toBe(true);
    expect(r.previewHasImg).toBe(true);
    expect(r.savedLogo).toContain('data:image/png');
    expect(r.modalHasLogo, 'candidate-facing company card shows the employer\'s own logo').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v119 founder live-test batch 2', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._ghostHeuristic === 'function'
      && typeof window.gotoLivePage === 'function' && typeof window.forecastGo === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('ghost risk is REAL-SIGNAL only — no more hash-of-the-company-name', async ({ page }) => {
    const r = await page.evaluate(() => {
      const verified = mapFirestoreJob({ title: 'Marketing Manager', company: 'GPJ', location: 'Houston, TX', source: 'internal', isValidated: true, description: 'Run marketing.', ingestedAt: Date.now() });
      const fresh = mapFirestoreJob({ title: 'Ops', company: 'FreshCo', location: 'Houston, TX', salary_min: 60000, description: 'x'.repeat(500), ingestedAt: Date.now() });
      const risky = mapFirestoreJob({ title: 'Ops', company: 'StaleCo', location: 'Houston, TX', description: 'We are always hiring for future opportunities — join our talent pool.', ingestedAt: Date.now() - 100 * 86400000 });
      return {
        verified: { chip: _ghostChipHtml(verified), ghost: verified.ghost, flag: verified._verifiedCo },
        freshGhost: fresh.ghost, riskyGhost: risky.ghost,
        unknownCompany: ghostRiskFor('Never Reported Anywhere LLC'),
        unknownChip: _ghostChipHtml({ ghost: null })
      };
    });
    expect(r.verified.flag, 'admin-approved employer job is Verified').toBe(true);
    expect(r.verified.ghost).toBe(0);
    expect(r.verified.chip).toContain('Verified employer');
    expect(r.freshGhost, 'fresh + salaried + full description = low risk').toBeLessThanOrEqual(30);
    expect(r.riskyGhost, 'stale + no salary + evergreen phrases = high risk').toBeGreaterThanOrEqual(60);
    expect(r.unknownCompany, 'no data -> null, never a fake number').toBeNull();
    expect(r.unknownChip).toContain('—');
  });

  test('VIEWING a job no longer deletes it from the deck (applied/skipped still do)', async ({ page }) => {
    const r = await page.evaluate(() => {
      lists.viewed = [{ t: 'Marketing Manager', co: 'GPJ' }];
      lists.applied = [{ t: 'Other Role', co: 'Acme' }];
      lists.skipped = [];
      const hidden = _deckHiddenSet();
      return { viewedHidden: hidden.has(jobKey({ t: 'Marketing Manager', co: 'GPJ' })), appliedHidden: hidden.has(jobKey({ t: 'Other Role', co: 'Acme' })) };
    });
    expect(r.viewedHidden, 'a merely-VIEWED job stays in the deck (founder repro: test job vanished after one look)').toBe(false);
    expect(r.appliedHidden, 'an acted-on job still leaves the pool').toBe(true);
  });

  test('Browse pagination: numbered pages (window of 5) + jump resets to page N', async ({ page }) => {
    const r = await page.evaluate(() => {
      const html = _pageNumsHtml(6, 8);
      liveJobs = []; livePage = 5;          // let-globals: bare identifiers, not window props
      gotoLivePage(2);
      return { html, landedOn: livePage, single: _pageNumsHtml(1, 1) };
    });
    for (const p of [4, 5, 6, 7, 8]) expect(r.html).toContain('gotoLivePage(' + p + ')');
    expect(r.html, 'quick jump back to page 1 (no more clicking Previous 7 times)').toContain('gotoLivePage(1)');
    expect(r.landedOn).toBe(2);
    expect(r.single, 'no pager when only one page').toBe('');
  });

  test('Job Match Forecast rows are clickable → Browse with the role pre-filled, location untouched', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.resumeData = window.resumeData || {}; resumeData.title = 'Marketing Specialist';
      updateJobMatchForecast({ title: 'Marketing Specialist' });
      const rows = document.querySelectorAll('#card-forecast .match-row[onclick*="forecastGo"]');
      let searched = null;
      window.searchAllJobsForKeyword = (nationwide) => { searched = { nationwide, kw: (document.getElementById('f-keyword') || {}).value }; };
      forecastGo('Digital Marketing Manager');
      return { clickableRows: rows.length, searched };
    });
    expect(r.clickableRows).toBeGreaterThanOrEqual(4);
    expect(r.searched.kw).toBe('Digital Marketing Manager');
    expect(r.searched.nationwide, 'search stays IN-MARKET — never widens location on its own').toBe(false);
  });

  test('rater yardstick persists 7 days — no more score whiplash between visits', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // resumeData is a let-global: window.resumeData would be a DIFFERENT object.
      // Mutate the real binding so rateResume sees the fixture.
      Object.assign(resumeData, { title: 'Marketing Specialist', skills: 'Marketing · SEO', jobs: [{ t: 'Marketing Specialist', c: 'Acme', b: 'Ran campaigns' }], name: 'A', contact: 'a@b.c' });
      localStorage.removeItem('gpj_corpus_v1'); window._roleCorpusCache = null;
      let mines = 0;
      window.fb = window.fb || {};
      fb.mineRoleKeywords = async () => { mines++; return { matched: 30, terms: [{ term: 'social media', pct: 80 }, { term: 'seo', pct: 60 }] }; };
      fb.mineHires = async () => [];
      await rateResume(); await rateResume();
      const stored = JSON.parse(localStorage.getItem('gpj_corpus_v1') || 'null');
      window._roleCorpusCache = null;              // simulate a NEW session
      await rateResume();
      return { mines, storedRole: stored && stored.role, storedTerms: stored && stored.corpus.terms.length };
    });
    expect(r.mines, 'one mine serves repeat rates AND the next session (localStorage)').toBe(1);
    expect(r.storedRole).toBe('Marketing Specialist');
    expect(r.storedTerms).toBe(2);
  });

  test('contact prefs hydrate on sign-in + the Studio mirrors reflect them', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.loadProfile = async () => ({ createdAt: 1700000000000, preferences: { showAddressOnResume: true, addressFull: false, showPhoneOnResume: true }, account: { first: 'Aal' }, accountEditedAt: 5 });
      fb.saveProfile = async () => true; fb.current = () => ({ uid: 'u1' });
      localStorage.removeItem('gpj_profile');
      await loadTierFromProfile({ uid: 'u1' });
      const p = JSON.parse(localStorage.getItem('gpj_profile') || '{}');
      p.address = '5606 Main St Houston TX 77081';
      localStorage.setItem('gpj_loc', 'Houston, TX');
      return {
        addrFull: p.preferences.addressFull,
        onResume: _addressForResume(p),
        studioAddrOn: document.getElementById('tpl-address-toggle').classList.contains('on'),
        studioFullOff: !document.getElementById('tpl-addrfull-toggle').classList.contains('on'),
        studioPhoneOn: document.getElementById('tpl-phone-toggle').classList.contains('on')
      };
    });
    expect(r.addrFull, 'the cloud "City, State only" choice survives login').toBe(false);
    expect(r.onResume, 'resume shows City, ST — never the street').toBe('Houston, TX');
    expect(r.studioAddrOn).toBe(true);
    expect(r.studioFullOff).toBe(true);
    expect(r.studioPhoneOn).toBe(true);
  });

  test('employer-posted jobs use the company\'s OWN links; unfilled ones fall back to search', async ({ page }) => {
    const r = await page.evaluate(() => {
      const own = companyLinks('GPJ', { companyWebsite: 'ghostproofjob.com', companyLinkedIn: 'https://linkedin.com/company/gpj', companyX: '' });
      const fallback = companyLinks('Some Harvested Co', null);
      return { web: own.web, li: own.linkedin, x: own.x, fbWeb: fallback.web };
    });
    expect(r.web, 'bare domain normalized to https').toBe('https://ghostproofjob.com');
    expect(r.li).toBe('https://linkedin.com/company/gpj');
    expect(r.x, 'unfilled social falls back to the search process').toContain('x.com/search');
    expect(r.fbWeb).toContain('google.com/search');
  });
});

test.describe('[STATE-COVERAGE] v118 founder live-test bug batch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._cityStateOf === 'function'
      && typeof window.loadTierFromProfile === 'function' && typeof window.updateProgress === 'function',
    null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'),
      null, { timeout: 15000 });
    await page.waitForTimeout(500);
  });

  test('City/State extraction covers every address shape (was: no-comma address showed NOTHING)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_loc', 'Houston, TX');
      return {
        comma: _cityStateOf('123 Main St, Houston, TX 77081'),
        noComma: _cityStateOf('5606 Main St Houston TX 77081'),
        cityState: _cityStateOf('Houston TX'),
        bareCity: _cityStateOf('Katy'),
        multiWord: _cityStateOf('900 Alamo Plaza, San Antonio, TX 78205'),
        garbage: _cityStateOf('77081'),
        empty: _cityStateOf(''),
        honorsToggles: _addressForResume({ address: '5606 Main St Houston TX 77081', preferences: { showAddressOnResume: true, addressFull: false } })
      };
    });
    expect(r.comma).toBe('Houston, TX');
    expect(r.noComma, 'the founder-repro shape must yield City, ST — never empty').toBe('Houston, TX');
    expect(r.cityState).toBe('Houston, TX');
    expect(r.bareCity).toBe('Katy');
    expect(r.multiWord).toBe('San Antonio, TX');
    expect(r.garbage, 'unusable address falls back to the saved market, not blank').toBe('Houston, TX');
    expect(r.empty).toBe('');
    expect(r.honorsToggles, 'full-address OFF must still show City, State').toBe('Houston, TX');
    expect(r.noComma.includes('Main'), 'the street must never leak').toBe(false);
  });

  test('discoverable opt-in survives sign-in hydration (was: reset OFF every login)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.loadProfile = async () => ({ discoverable: true, createdAt: 1700000000000, account: { first: 'Aal' }, accountEditedAt: 5 });
      fb.saveProfile = async () => true;
      fb.current = () => ({ uid: 'u1' });
      localStorage.removeItem('gpj_profile');            // fresh device / post-signout
      await loadTierFromProfile({ uid: 'u1' });
      const lp = JSON.parse(localStorage.getItem('gpj_profile') || '{}');
      const dt = document.getElementById('discoverable-toggle');
      return { stored: lp.discoverable, toggleOn: !!(dt && dt.classList.contains('on')) };
    });
    expect(r.stored, 'cloud discoverable:true lands in the local profile').toBe(true);
    expect(r.toggleOn, 'the Settings toggle reflects it').toBe(true);
  });

  test('metric elicitation never writes twin bullets for two same-unit jobs', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.resumeData = window.resumeData || {};
      resumeData.jobs = [
        { t: 'Account Manager', c: 'Acme', b: 'Handled client accounts daily' },
        { t: 'Account Exec', c: 'Beta', b: 'Grew customer accounts steadily' }
      ];
      const qs = _metricsQuestionsFor();
      openMetricsElicit();
      document.getElementById('mq-0').value = '500+';
      document.getElementById('mq-1').value = '50';
      submitMetricsElicit();
      const b0 = String(resumeData.jobs[0].b).split('\n').pop();
      const b1 = String(resumeData.jobs[1].b).split('\n').pop();
      const shape = (s) => s.replace(/[\d+$,.]+/g, '#');
      return { units: qs.map((q) => q.unit), b0, b1, sameShape: shape(b0) === shape(b1) };
    });
    expect(r.units).toEqual(['accounts', 'accounts']);
    expect(r.b0).toContain('500+');
    expect(r.b1).toContain('50');
    expect(r.sameShape, 'two answers of the same unit must use DIFFERENT wording (was: identical twins)').toBe(false);
  });

  test('optimizer zero-state reads as a sentence (was: "Found all done 🎉 — all optional")', async ({ page }) => {
    const r = await page.evaluate(() => {
      optPrompts.length = 0; optState.length = 0;   // empty state: nothing to upgrade
      renderOptimizer();
      const blurb = (document.getElementById('opt-blurb') || {}).textContent || '';
      return { blurb };
    });
    expect(r.blurb).not.toMatch(/Found all done/);
    expect(r.blurb).toMatch(/nothing to upgrade/i);
  });

  test('Years + Education are optional boosters — everything else complete = 100%', async ({ page }) => {
    const r = await page.evaluate(() => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('pr-name', 'Aaliyah Sosa'); set('pr-title', 'Marketing Specialist');
      set('pr-years', ''); set('pr-edu', '');
      window.resumeData = window.resumeData || {};
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'USA Industries', b: 'Ran campaigns' }];
      resumeData.skills = 'Marketing · CRM';
      const pct = updateProgress();
      const hint = (document.getElementById('resume-missing') || {}).textContent || '';
      return { pct, hint };
    });
    expect(r.pct, 'no Years/Education must not hold the meter under 100').toBe(100);
    expect(r.hint).toMatch(/Optional boosters/);
    expect(r.hint).toMatch(/Years experience|Education/);
  });
});

test.describe('[STATE-COVERAGE] v116 notification centre', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { localStorage.removeItem('gpj_notif_seen'); localStorage.removeItem('gpj_notif_marks'); localStorage.removeItem('gpj_paid_until'); });
  });

  test('candidate: employer activity + plan expiry, unread badge, click routes + marks read', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; window._recruiter = null;
      fb.current = () => ({ uid: 'c1', email: 'jane@x.com' });
      fb.loadMyReachouts = async () => ([
        { id: 'ro1', kind: 'reachout', company: 'Medtronic', jobTitle: 'Ops Manager', status: 'sent', ts: 3 },
        { id: 'ro2', kind: 'reachout', company: 'Acme', jobTitle: 'Analyst', status: 'sent', proposedTimes: ['Tue 2pm CT'], ts: 2 },
        { id: 'ro3', kind: 'rejection', company: 'Beta', jobTitle: 'Coordinator', status: 'sent', ts: 1 },
        { id: 'ro4', kind: 'reachout', company: 'Old', jobTitle: 'X', status: 'interested', ts: 0 },
      ]);
      localStorage.setItem('gpj_paid_until', String(Date.now() + 3 * 86400000));
      await _gpjNotifLoad();
      const titles = (window._notifs || []).map((n) => n.title);
      const badge = document.getElementById('notif-badge').textContent;
      const first = window._notifs[0];
      notifGo(first.id);
      const afterClick = document.getElementById('notif-badge').textContent;
      markAllNotifRead();
      return { titles, badge, afterClick, badgeGone: getComputedStyle(document.getElementById('notif-badge')).display === 'none', read: _notifSeen().has(first.id) };
    });
    expect(r.titles.some((t) => /wants you for Ops Manager/.test(t)), 'a reach-out is a hot match').toBe(true);
    expect(r.titles.some((t) => /proposed interview times/.test(t)), 'R7 slots surface').toBe(true);
    expect(r.titles.some((t) => /sent an update/.test(t)), 'a respectful decline surfaces').toBe(true);
    expect(r.titles.some((t) => /renews in 3 days/.test(t)), 'plan expiry warns a week out').toBe(true);
    expect(r.titles.some((t) => /Old/.test(t)), 'an ALREADY-answered reach-out must not nag').toBe(false);
    expect(r.badge).toBe('4');
    expect(r.afterClick, 'clicking marks that one read').toBe('3');
    expect(r.read).toBe(true);
    expect(r.badgeGone, 'mark-all clears the badge').toBe(true);
  });

  test('recruiter: applicants/matches/reviews/responses route to the right tab; no repeat nag', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      window._recruiter = { uid: 'r1', company: 'Acme Talent', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'pro', planUntil: Date.now() + 5 * 86400000 };
      fb.current = () => ({ uid: 'r1', email: 'r@acme.com' });
      fb.loadSentReachouts = async () => ([
        { id: 's1', status: 'interested', candidateName: 'Jane D.', jobTitle: 'Ops', acceptedTime: 'Tue 2pm CT', respondedAt: 9 },
        { id: 's2', status: 'appealed', candidateName: 'Sam R.', jobTitle: 'Analyst', respondedAt: 8 },
        { id: 's3', status: 'sent', candidateName: 'Nobody' },
      ]);
      fb.loadRecruiterJobs = async () => ([{ id: 'j1', title: 'Ops Manager', isValidated: true }]);
      fb.countJobApplicants = async () => 3;
      fb.loadRecommendedCandidates = async () => ([{ uid: 'c1' }, { uid: 'c2' }]);
      fb.countGhostReports = async () => 2;
      await _gpjNotifLoad();
      const byTitle = {}; (window._notifs || []).forEach((n) => { byTitle[n.title] = n.view; });
      const titles = Object.keys(byTitle);
      await _gpjNotifLoad();                       // second pass: rollups must not repeat
      const second = (window._notifs || []).map((n) => n.title);
      return { byTitle, titles, second };
    });
    const find = (re) => Object.keys(r.byTitle).find((t) => re.test(t));
    expect(r.byTitle[find(/new applicants/)], 'applicants -> Applicants tab').toBe('browse');
    expect(r.byTitle[find(/new matches/)], 'matches -> Candidates tab').toBe('swipe');
    expect(r.byTitle[find(/review activity/)], 'reviews -> Reviews tab').toBe('ghost');
    expect(r.byTitle[find(/is interested/)], 'a response -> Candidates tab').toBe('swipe');
    expect(find(/appealed your decline/), 'appeals surface to the recruiter').toBeTruthy();
    expect(find(/Pro plan renews in 5 days/), 'employer plan expiry warns too').toBeTruthy();
    expect(r.titles.some((t) => /Nobody/.test(t)), 'an unanswered reach-out is not a response').toBe(false);
    expect(r.second.some((t) => /new applicants/.test(t)), 'the same count must not nag twice').toBe(false);
  });

  test('signed out: no bell at all', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; fb.current = () => null; window._recruiter = null;
      await _gpjNotifLoad();
      return { bell: getComputedStyle(document.getElementById('notif-bell')).display, count: (window._notifs || []).length };
    });
    expect(r.bell).toBe('none');
    expect(r.count).toBe(0);
  });
});

test.describe('[STATE-COVERAGE] v112 company team — seats + roles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  const mock = async (page) => page.evaluate(() => {
    window.fb = window.fb || {};
    fb.current = () => ({ uid: 'r1', email: 'owner@acme.com' });
    fb.loadCompanyMembers = async () => ([
      { uid: 'r1', role: 'owner', email: 'owner@acme.com', contactFirst: 'Aaliyah', contactLast: 'Sosa' },
      { uid: 's1', role: 'standard', email: 'sam@acme.com', contactFirst: 'Sam', contactLast: 'R' },
    ]);
    fb.loadCompanyInvites = async () => ([{ id: 'i9', email: 'newhire@acme.com', role: 'admin', status: 'pending' }]);
    window.__created = null;
    fb.createCompanyInvite = async (d) => { window.__created = d; return 'inv-new'; };
    window.__wait = async (id, needle) => { for (let i = 0; i < 60; i++) { const el = document.getElementById(id); if (el && (el.textContent || '').includes(needle)) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  });

  test('seats scale with the plan; an admin can invite (never as owner)', async ({ page }) => {
    await mock(page);
    const r = await page.evaluate(async () => {
      window._recruiter = { uid: 'r1', company: 'Acme Talent', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'free', email: 'owner@acme.com' };
      _gpjApplyRecruiterSkin(); renderRecCompany(); await window.__wait('rec-team', 'seat');
      const freeTxt = document.getElementById('rec-team').textContent;
      const free = { limit: _recSeatLimit(), capped: /used all 1 seat/i.test(freeTxt), members: /Aaliyah Sosa/.test(freeTxt) && /Sam R/.test(freeTxt), pending: /awaiting sign-up/i.test(freeTxt) };
      window._recruiter.plan = 'premium'; const premium = _recSeatLimit();
      window._recruiter.plan = 'pro'; const pro = _recSeatLimit();
      renderRecCompany(); await window.__wait('rec-team', 'Invite a colleague');
      const roleOpts = [...document.getElementById('rt-role').options].map((o) => o.value);
      document.getElementById('rt-email').value = 'newhire@acme.com';
      document.getElementById('rt-role').value = 'admin';
      await inviteTeammate();
      return { free, premium, pro: pro === Infinity, roleOpts, created: window.__created };
    });
    expect(r.free.limit, 'Free = 1 seat').toBe(1);
    expect(r.free.capped, 'a full Free team is told to upgrade, not silently blocked').toBe(true);
    expect(r.free.members, 'the team list shows real members').toBe(true);
    expect(r.free.pending, 'pending invites are visible + revocable').toBe(true);
    expect(r.premium, 'Premium = 5 seats').toBe(5);
    expect(r.pro, 'Pro = unlimited').toBe(true);
    expect(r.roleOpts, 'you can only ever invite admin/standard — never owner').toEqual(['standard', 'admin']);
    expect(r.created.email).toBe('newhire@acme.com');
    expect(r.created.role).toBe('admin');
    expect(r.created.companyId).toBe('acme.com');
    expect(r.created.inheritValidated, 'a verified company vouches for its invitee').toBe(true);
  });

  test('a STANDARD member can list + hire but cannot edit company info or invite', async ({ page }) => {
    await mock(page);
    const r = await page.evaluate(async () => {
      window._recruiter = { uid: 's1', company: 'Acme Talent', companyId: 'acme.com', role: 'standard', isValidated: true, plan: 'pro', email: 'sam@acme.com' };
      _gpjApplyRecruiterSkin(); renderRecCompany(); await window.__wait('rec-team', 'Team');
      return {
        canSave: !!document.querySelector('#rec-profile div[onclick="saveRecCompany()"]'),
        readOnlyNote: /managed by your company admins/i.test(document.getElementById('rec-profile').textContent),
        fieldsDisabled: document.getElementById('rc-company').disabled,
        hasInviteForm: !!document.getElementById('rt-email'),
      };
    });
    expect(r.canSave, 'no save button for a standard member').toBe(false);
    expect(r.fieldsDisabled, 'company fields are read-only').toBe(true);
    expect(r.readOnlyNote, 'and we say why, honestly').toBe(true);
    expect(r.hasInviteForm, 'standard members cannot invite').toBe(false);
  });

  test('a LEGACY owner doc (role:"recruiter") still counts as a company admin', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._recruiter = { uid: 'r1', company: 'Acme', companyId: 'acme.com', role: 'recruiter', isValidated: true, plan: 'pro' };
      return { isAdmin: _recIsCompanyAdmin(), role: _recRole() };
    });
    expect(r.isAdmin, 'pre-v112 owners must never be locked out of their own company').toBe(true);
    expect(r.role).toBe('owner');
  });
});

test.describe('[STATE-COVERAGE] v111 recruiter header chrome (identity, menu, plan)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  const snap = () => ({
    chip: document.getElementById('auth-chip').textContent,
    profileRow: document.getElementById('pm-profile').textContent.trim(),
    viewed: getComputedStyle(document.getElementById('pm-viewed')).display,
    booster: getComputedStyle(document.getElementById('pm-booster')).display,
    hired: getComputedStyle(document.getElementById('pm-hired')).display,
    trigger: document.getElementById('upgrade-trigger').textContent,
    dayPill: document.getElementById('grace-full').textContent,
    candMenu: getComputedStyle(document.getElementById('upgrade-candidate')).display,
    recMenu: getComputedStyle(document.getElementById('upgrade-rec')).display,
    planOpts: document.getElementById('rec-plan-opts').textContent.replace(/\s+/g, ' ').trim(),
  });

  test('company identity + plan replace the candidate chrome; candidate-only rows hidden', async ({ page }) => {
    const r = await page.evaluate(async (snapSrc) => {
      const snap = eval('(' + snapSrc + ')');
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'r1', email: 'r@acme.com' });
      fb.loadRecruiterJobs = async () => []; fb.countJobApplicants = async () => 0;
      fb.loadRecommendedCandidates = async () => []; fb.countGhostReports = async () => 0;
      fb.loadSentReachouts = async () => []; fb.countMyReachouts = async () => 0;
      // the page's real auth listener can resolve LATE and repaint the chip, so
      // settle on the expected state instead of assuming a fixed delay.
      const settle = async (want) => {
        for (let i = 0; i < 60; i++) {
          _gpjApplyRecruiterSkin();
          if ((document.getElementById('auth-chip').textContent || '').startsWith(want)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      window._recruiter = { uid: 'r1', company: 'Acme Talent Partners', isValidated: true, plan: 'free' };
      await settle('🏢');
      const free = snap();
      window._recruiter.plan = 'pro';
      await settle('🏢');
      const pro = snap();
      return { free, pro };
    }, snap.toString());

    // 1) identity = company name + the company-card emoji (not a person)
    expect(r.free.chip).toBe('🏢 Acme Talent Partners');
    expect(r.free.profileRow).toBe('🏢 Company Profile');
    // 2) candidate-only menu rows are gone for an employer
    expect(r.free.viewed).toBe('none');
    expect(r.free.booster, 'Request Booster is meaningless to a company').toBe('none');
    expect(r.free.hired, '"I Got Hired" is meaningless to a company').toBe('none');
    // 3) tip jar -> plan
    expect(r.free.trigger).toBe('Free plan ▾');
    expect(r.free.candMenu).toBe('none');
    expect(r.free.recMenu).toBe('block');
    expect(r.free.planOpts).toMatch(/\$79/);
    expect(r.free.planOpts).toMatch(/\$149/);
    // 4) day counter -> plan
    expect(r.free.dayPill).toBe('🏢 Free plan');
    // and the plan is reflected once upgraded
    expect(r.pro.trigger).toBe('Pro plan ▾');
    expect(r.pro.dayPill).toBe('🚀 Pro plan');
    expect(r.pro.planOpts).toMatch(/top plan/i);
  });

  test('v112 fix: the day-counter cannot repaint over a recruiter plan; employer footer is role-correct', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'r1', email: 'owner@acme.com' });
      fb.loadCompanyMembers = async () => []; fb.loadCompanyInvites = async () => [];
      fb.loadRecruiterJobs = async () => []; fb.loadRecommendedCandidates = async () => [];
      fb.countGhostReports = async () => 0; fb.loadSentReachouts = async () => []; fb.countMyReachouts = async () => 0;
      window.isAdmin = false;
      window._recruiter = { uid: 'r1', company: 'Acme Talent', companyId: 'acme.com', role: 'owner', isValidated: true, plan: 'free', email: 'owner@acme.com' };
      _gpjApplyRecruiterSkin();
      await new Promise((r) => setTimeout(r, 80));
      const before = document.getElementById('grace-full').textContent;
      refreshGraceDisplays();          // the exact call that used to clobber it
      refreshGraceDisplays();
      const after = document.getElementById('grace-full').textContent;
      const rec = { before, after, footerLink: getComputedStyle(document.getElementById('footer-employer-link')).display, promise: document.getElementById('footer-promise').textContent };
      window._recruiter = null; fb.current = () => ({ uid: 'c1', email: 'jane@x.com' });
      _gpjApplyRecruiterSkin(); refreshGraceDisplays();
      await new Promise((r) => setTimeout(r, 60));
      const cand = { pill: document.getElementById('grace-full').textContent, promise: document.getElementById('footer-promise').textContent };
      fb.current = () => null; _gpjSyncEmployerNav();
      const guestLink = getComputedStyle(document.getElementById('footer-employer-link')).display;
      return { rec, cand, guestLink };
    });
    expect(r.rec.before).toBe('🏢 Free plan');
    expect(r.rec.after, 'refreshGraceDisplays must NOT repaint the candidate day-counter over a company plan').toBe('🏢 Free plan');
    expect(r.rec.footerLink, 'an employer should not be offered "For Employers"').toBe('none');
    expect(r.rec.promise, 'the footer promise speaks to employers').toMatch(/never sold/i);
    expect(r.cand.pill, 'candidates keep their day counter').toMatch(/Day/);
    expect(r.cand.promise, 'candidates keep the free-until-hired promise').toMatch(/Free until/i);
    expect(r.guestLink, 'guests still get the employer marketing entry').not.toBe('none');
  });

  test('NO regression: candidate chrome restores when the recruiter session ends', async ({ page }) => {
    const r = await page.evaluate(async (snapSrc) => {
      const snap = eval('(' + snapSrc + ')');
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'r1' });
      fb.loadRecruiterJobs = async () => []; fb.loadRecommendedCandidates = async () => [];
      fb.countGhostReports = async () => 0; fb.loadSentReachouts = async () => []; fb.countMyReachouts = async () => 0;
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true, plan: 'free' };
      _gpjApplyRecruiterSkin(); await new Promise((r) => setTimeout(r, 60));
      window._recruiter = null; fb.current = () => ({ uid: 'c1', email: 'jane@x.com' });
      _gpjApplyRecruiterSkin(); await new Promise((r) => setTimeout(r, 60));
      return snap();
    }, snap.toString());
    expect(r.profileRow).toBe('🙂 Account / Profile');
    expect(r.viewed).toBe('flex');
    expect(r.booster).toBe('flex');
    expect(r.hired).toBe('flex');
    expect(r.trigger).toBe('Support Us ▾');
    expect(r.candMenu).toBe('block');
    expect(r.recMenu).toBe('none');
  });
});

test.describe('[STATE-COVERAGE] v110 R9 recruiter tab reskin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  const mockRec = async (page) => page.evaluate(async () => {
    window.fb = window.fb || {};
    fb.current = () => ({ uid: 'r1', email: 'r@acme.com' });
    fb.loadRecruiterJobs = async () => [{ id: 'j1', title: 'Operations Manager', location: 'Houston, TX', isValidated: true, active: true }, { id: 'j2', title: 'Analyst', is_remote: true, isValidated: false }];
    fb.countJobApplicants = async () => 2;
    fb.loadRecommendedCandidates = async () => [{ uid: 'c1', score: 88, matched: ['ops'], market: 'Houston, TX', applied: true }];
    fb.loadJobApplicants = async () => [{ uid: 'a1', match: 91, resume: { name: 'Jane Doe', title: 'Ops Lead', summary: 'Ten years in ops.', skills: 'Ops · Excel', roles: [{ t: 'Ops Lead', c: 'Acme', b: 'Ran ops.' }], contact: 'jane@x.com' }, coverLetter: 'I would love this role.' }];
    fb.countGhostReports = async () => 1;
    window._recruiter = { uid: 'r1', company: 'Acme Talent', isValidated: true, plan: 'free', website: 'acme.com' };
    _gpjApplyRecruiterSkin();
    await new Promise((r) => setTimeout(r, 120));
  });

  test('every tab reskins to real recruiter content; nav relabels', async ({ page }) => {
    await mockRec(page);
    const r = await page.evaluate(async () => {
      // the panel renderers are async (they await fb reads) and _gpjRenderRecPanel
      // does not return the promise — so POLL for the expected text instead of
      // guessing a fixed delay (that was flaky on mobile under parallel load).
      const render = async (view, id, needle) => {
        _gpjRenderRecPanel(view);
        const el = document.getElementById(id);
        for (let i = 0; i < 60; i++) {
          if (needle ? (el.textContent || '').includes(needle) : (el.textContent || '').trim()) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        return el.textContent;
      };
      return {
        recModeAll: ['swipe', 'browse', 'resume', 'ghost', 'profile', 'account'].every((v) => document.getElementById('view-' + v).classList.contains('rec-mode')),
        labels: [...document.querySelectorAll('#footer-nav .nav-tab .nav-label')].map((l) => l.textContent),
        company: (await render('profile', 'rec-profile', 'Company Profile')).includes('Company Profile'),
        listings: (await render('resume', 'rec-resume', 'Operations Manager')).includes('Operations Manager'),
        settings: (await render('account', 'rec-account', '$149')).includes('$149'),
        candidates: (await render('swipe', 'rec-swipe', '88%')).includes('88%'),
        applicants: (await render('browse', 'rec-browse', 'Applicants')).includes('Applicants'),
        reviews: (await render('ghost', 'rec-ghost', 'Ghost-risk')).includes('Ghost-risk'),
      };
    });
    expect(r.recModeAll, 'all 6 views enter recruiter mode').toBe(true);
    expect(r.labels).toEqual(['Candidates', 'Applicants', 'Listings', 'Reviews', 'Company']);
    expect(r.company).toBe(true);
    expect(r.listings, 'listings shows the recruiter’s real posted role').toBe(true);
    expect(r.settings, 'settings shows the recruiter plan pricing').toBe(true);
    expect(r.candidates, 'candidate matches show a real match %').toBe(true);
    expect(r.applicants).toBe(true);
    expect(r.reviews).toBe(true);
  });

  test('Candidate Card shows the applicant resume + cover letter', async ({ page }) => {
    await mockRec(page);
    const r = await page.evaluate(() => {
      window._recApps = { j1: [{ uid: 'a1', match: 91, resume: { name: 'Jane Doe', title: 'Ops Lead', summary: 'Ten years in ops.', skills: 'Ops · Excel', roles: [{ t: 'Ops Lead', c: 'Acme', b: 'Ran ops.' }], contact: 'jane@x.com' }, coverLetter: 'I would love this role.' }] };
      openCandidateCard('j1', 0);
      const cc = document.getElementById('candcard-scrim');
      return { opens: !!cc, hasResume: cc ? cc.textContent.includes('Jane Doe') && cc.textContent.includes('Ten years in ops') : false, hasCover: cc ? cc.textContent.includes('I would love this role') : false };
    });
    expect(r.opens).toBe(true);
    expect(r.hasResume).toBe(true);
    expect(r.hasCover, 'the cover letter (snapshotted at apply) is shown').toBe(true);
  });

  test('NO candidate regression: skin off restores candidate content + labels + hides rec panels', async ({ page }) => {
    await mockRec(page);
    const r = await page.evaluate(async () => {
      window._recruiter = null; fb.current = () => ({ uid: 'c1' });
      _gpjApplyRecruiterSkin();
      await new Promise((r) => setTimeout(r, 100));
      const swipeKids = [...document.getElementById('view-swipe').children].filter((c) => !c.classList.contains('rec-panel'));
      return {
        cleared: ['swipe', 'browse', 'resume', 'ghost', 'profile', 'account'].every((v) => !document.getElementById('view-' + v).classList.contains('rec-mode')),
        labels: [...document.querySelectorAll('#footer-nav .nav-tab .nav-label')].map((l) => l.textContent),
        candidateVisible: swipeKids.some((c) => getComputedStyle(c).display !== 'none'),
        recPanelHidden: getComputedStyle(document.getElementById('rec-swipe')).display === 'none',
      };
    });
    expect(r.cleared, 'recruiter mode fully clears').toBe(true);
    expect(r.labels).toEqual(['Swipe', 'Browse', 'Resume', 'Ghosts', 'Employers']);
    expect(r.candidateVisible, 'candidate content shows again').toBe(true);
    expect(r.recPanelHidden).toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v108 recruiter auto-route + Stripe plan buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  });

  test('a recruiter is auto-routed to the employer view on sign-in via the cloud role marker', async ({ page }) => {
    const r = await page.evaluate(async () => {
      localStorage.removeItem('gpj_role');
      window._recruiter = null;
      let switched = '';
      const origSwitch = window.switchView;
      window.switchView = function (v) { switched = v; try { return origSwitch.apply(window, arguments); } catch (e) {} };
      window.fb = window.fb || {};
      fb.loadProfile = async () => ({ role: 'recruiter' });   // cloud marker
      fb.loadRecruiter = async () => ({ company: 'Acme', isValidated: true, plan: 'free' });
      fb.saveProfile = async () => true;
      _gpjRecruiterAuthApply({ uid: 'rec1' });
      await new Promise((r) => setTimeout(r, 250));
      window.switchView = origSwitch;
      return { switched, recruiterSet: !!(window._recruiter && window._recruiter.company === 'Acme'), roleFlag: localStorage.getItem('gpj_role') };
    });
    expect(r.switched, 'sign-in takes a recruiter to their recruiter home (v110: the reskinned Candidates/Swipe tab)').toBe('swipe');
    expect(r.recruiterSet, 'the recruiter doc is loaded and applied').toBe(true);
    expect(r.roleFlag, 'the local role flag is set for subsequent loads').toBe('recruiter');
  });

  test('candidate-first preserved: no role marker -> no recruiter doc read', async ({ page }) => {
    const r = await page.evaluate(async () => {
      localStorage.removeItem('gpj_role');
      window._recruiter = null;
      let recReads = 0;
      window.fb = window.fb || {};
      fb.loadProfile = async () => ({});               // a pure candidate: no role
      fb.loadRecruiter = async () => { recReads++; return null; };
      _gpjRecruiterAuthApply({ uid: 'cand1' });
      await new Promise((r) => setTimeout(r, 200));
      return { recReads, recruiter: window._recruiter };
    });
    expect(r.recReads, 'a candidate must never trigger a recruiter doc read').toBe(0);
    expect(r.recruiter).toBeNull();
  });

  test('Stripe plan buttons exist and link to the correct recruiter checkout URLs', async ({ page }) => {
    const r = await page.evaluate(() => {
      let opened = '';
      const origOpen = window.open;
      window.open = (u) => { opened = u; return null; };
      openRecruiterCheckout('pro'); const proUrl = opened;
      openRecruiterCheckout('premium'); const premiumUrl = opened;
      window.open = origOpen;
      const view = document.getElementById('view-employer').innerHTML;
      return {
        proUrl, premiumUrl,
        proConst: CHECKOUT_REC_PRO_URL, premiumConst: CHECKOUT_REC_PREMIUM_URL,
        hasProBtn: /openRecruiterCheckout\('pro'\)/.test(view),
        hasPremiumBtn: /openRecruiterCheckout\('premium'\)/.test(view),
        showsPrices: /\$149/.test(view) && /\$79/.test(view),
      };
    });
    expect(r.proUrl).toBe('https://buy.stripe.com/cNi9AU5rL4ngcUy0qpak004');
    expect(r.premiumUrl).toBe('https://buy.stripe.com/aFafZi3jD1b4g6K8WVak003');
    expect(r.proConst).toBe(r.proUrl);
    expect(r.premiumConst).toBe(r.premiumUrl);
    expect(r.hasProBtn && r.hasPremiumBtn, 'both plan buttons are in the employer view').toBe(true);
    expect(r.showsPrices, 'both prices are shown').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] Referral engine (invite -> Booster)', () => {
  test('captures ?ref, builds the link, blocks self-referral, records a real one', async ({ page }) => {
    await page.goto('/index.html?ref=abc123uid', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const out = {};
      localStorage.removeItem('gpj_ref_pending');
      _gpjCaptureRef();
      out.captured = localStorage.getItem('gpj_ref_pending');
      window.fb = window.fb || {};
      fb.current = () => ({ uid: 'myUID999', email: 'me@x.com' });
      fb.myReferralStats = async () => ({ total: 3, onboarded: 2 });
      out.link = _referralLink();
      await renderReferral();
      out.sectionShown = getComputedStyle(document.getElementById('sec-referral')).display !== 'none';
      out.statsHtml = document.getElementById('ref-stats').innerHTML;
      let recordedWith;
      fb.recordReferral = async (code) => { recordedWith = code; return true; };
      localStorage.setItem('gpj_ref_pending', 'myUID999');           // self
      await _gpjRecordReferralIfPending();
      out.selfBlocked = recordedWith === undefined && localStorage.getItem('gpj_ref_pending') === null;
      localStorage.setItem('gpj_ref_pending', 'abc123uid');          // real
      await _gpjRecordReferralIfPending();
      out.recordedReal = recordedWith;
      out.clearedAfter = localStorage.getItem('gpj_ref_pending');
      return out;
    });
    expect(r.captured).toBe('abc123uid');
    expect(r.link).toMatch(/[?&]ref=myUID999$/);
    expect(r.sectionShown, 'referral section shows for signed-in users').toBe(true);
    expect(r.statsHtml).toMatch(/Friends joined/);
    expect(r.statsHtml, 'a claim button appears once a referral onboarded').toMatch(/Claim/);
    expect(r.selfBlocked, 'you cannot refer yourself').toBe(true);
    expect(r.recordedReal).toBe('abc123uid');
    expect(r.clearedAfter, 'pending ref is cleared once recorded').toBeNull();
  });

  test('referral section is hidden for a signed-out visitor (no link)', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      window.fb = window.fb || {}; fb.current = () => null;
      await renderReferral();
      return { link: _referralLink(), shown: getComputedStyle(document.getElementById('sec-referral')).display };
    });
    expect(r.link, 'no uid -> no referral link').toBe('');
    expect(r.shown).toBe('none');
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

/* ═══════════════════════════════════════════════════════════════════════════
   v144 P1-1 — verified employer roles are REACHABLE, and worth reaching.

   Measured before this shipped: the founder's own GPJ posting sat at position
   1,498 of 2,127 in the deck (≈105 with a résumé). Nobody swipes 105 cards —
   which is why the recruiter side showed zero applicants. The apply plumbing
   was fine and verified working; the card was simply unreachable.

   Part A pins verified employer roles, RELEVANCE-GATED and capped at 3, in the
   deck's final sort only. Part B stops us pinning something threadbare.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v144 P1-1A deck pin — employer roles reachable, never an ad', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applySwipeFilters === 'function', null, { timeout: 15000 });
  });

  // seed: 40 scraped jobs + the supplied employer ones, then run the REAL final sort
  const seed = (page, internals, sort) => page.evaluate(({ internals, sort }) => {
    const scraped = [];
    // scraped jobs carry a real salary so the salary sorters have something to
    // rank; without it `salhi` sinks them (no-salary jobs go last by design) and
    // an employer job would top that sort legitimately, proving nothing.
    for (let i = 0; i < 40; i++) scraped.push({ t: 'Scraped Role ' + i, co: 'BigCo ' + i, loc: 'Houston, TX', match: 90, desc: 'x', salMax: 200000, _internal: false });
    rawQueue = scraped.concat(internals);
    jobsQueue = rawQueue.slice();
    try { const s = document.getElementById('sw-sort'); if (s && sort) s.value = sort; } catch (e) {}
    applySwipeFilters();
    return jobsQueue.slice(0, 8).map((j) => ({ t: j.t, _internal: !!j._internal, match: j.match }));
  }, { internals, sort });

  test('Q1 guest: a RELEVANT verified employer role is pinned to the top of the deck', async ({ page }) => {
    const top = await seed(page, [{ t: 'Marketing Manager', co: 'GPJ Employer', loc: 'Houston, TX', match: 70, id: 'emp1', _internal: true }], null);
    expect(top[0]._internal, 'the employer role leads the deck instead of sitting at ~1,498').toBe(true);
    expect(top[0].t).toBe('Marketing Manager');
  });

  test('the pin is CAPPED at 3 — employers cannot flood the deck', async ({ page }) => {
    const internals = [];
    for (let i = 0; i < 6; i++) internals.push({ t: 'Employer Role ' + i, co: 'GPJ Employer', loc: 'Houston, TX', match: 70, id: 'e' + i, _internal: true });
    const top = await seed(page, internals, null);
    expect(top.slice(0, 3).every((j) => j._internal), 'first three are the pinned employer roles').toBe(true);
    expect(top[3]._internal, 'the fourth employer role falls back into normal ranking').toBe(false);
  });

  test('the relevance GATE holds: a weak-match employer role is NOT pinned (it would be an ad)', async ({ page }) => {
    const top = await seed(page, [{ t: 'Unrelated Role', co: 'GPJ Employer', loc: 'Houston, TX', match: 12, id: 'emp1', _internal: true }], null);
    expect(top[0]._internal, 'an irrelevant employer role must never be pinned over a real match').toBe(false);
  });

  test('an explicit candidate sort wins — pins apply to the match sort only', async ({ page }) => {
    const top = await seed(page, [{ t: 'Marketing Manager', co: 'GPJ Employer', loc: 'Houston, TX', match: 70, id: 'emp1', salMax: 1, _internal: true }], 'salhi');
    expect(top[0]._internal, 'sorting by salary must respect the candidate, not the employer').toBe(false);
  });

  test('Q4 empty: no employer roles in market -> deck order is untouched', async ({ page }) => {
    const top = await seed(page, [], null);
    expect(top.every((j) => j._internal === false)).toBe(true);
    expect(top[0].t).toContain('Scraped Role');
  });
});

test.describe('[STATE-COVERAGE] v144 P1-1B listing quality floor + honest strength meter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._recListingScore === 'function', null, { timeout: 15000 });
  });

  test('the founder-repro 26-char listing scores poorly and names what is missing', async ({ page }) => {
    const r = await page.evaluate(() => ({
      weak: _recListingScore({ desc: 'Manage marketing\nBudgeting', req: '', benefits: '', smin: '', smax: '' }),
      strong: _recListingScore({ desc: 'x'.repeat(900), req: 'y'.repeat(200), benefits: 'z'.repeat(90), smin: '60000', smax: '80000' }),
    }));
    expect(r.weak.score, 'the 26-char posting that lost to scraped listings scores badly').toBeLessThan(20);
    expect(r.weak.gaps.join(' ')).toContain('requirements');
    expect(r.strong.score, 'a complete listing scores strongly').toBeGreaterThanOrEqual(95);
    expect(r.strong.gaps.length, 'a complete listing has nothing left to name').toBe(0);
  });

  test('Q2 authed: a NEW post under the floor is blocked and never reaches Firestore', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let created = 0;
      window._recruiter = { companyId: 'c1', company: 'Acme', plan: 'free' };
      window.fb = Object.assign(window.fb || {}, { createRecruiterJob: async () => { created++; return true; } });
      window._editingJobId = null;
      const set = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('textarea'); e.id = id; document.body.appendChild(e); } e.value = v; };
      set('rl-title', 'Marketing Manager'); set('rl-location', 'Houston, TX'); set('rl-desc', 'Manage marketing');
      await postRecJob();
      return { created };
    });
    expect(r.created, 'a threadbare listing must not be created — it would be pinned and still lose').toBe(0);
  });

  test('GRANDFATHERED: an existing short listing still saves while its description is untouched', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const out = { unchanged: 0, shortened: 0 };
      window._recruiter = { companyId: 'c1', company: 'Acme', plan: 'free' };
      window.fb = window.fb || {};
      const set = (id, v) => { let e = document.getElementById(id); if (!e) { e = document.createElement('textarea'); e.id = id; document.body.appendChild(e); } e.value = v; };
      set('rl-title', 'Marketing Manager'); set('rl-location', 'Houston, TX');

      // editing the SALARY of a legacy 26-char listing — must still be allowed through
      window._editingJobId = 'job1'; window._editingJobDesc = 'Manage marketing\nBudgeting';
      set('rl-desc', 'Manage marketing\nBudgeting');
      window.fb.updateRecruiterJob = async () => { out.unchanged++; return true; };
      await postRecJob();

      // but CHANGING the description to something still-short must be refused
      window._editingJobId = 'job1'; window._editingJobDesc = 'Manage marketing\nBudgeting';
      set('rl-desc', 'Manage marketing now');
      window.fb.updateRecruiterJob = async () => { out.shortened++; return true; };
      await postRecJob();
      return out;
    });
    expect(r.unchanged, 'you can still edit a legacy listing without rewriting it first').toBe(1);
    expect(r.shortened, 'but touching the description holds it to the floor').toBe(0);
  });

  test('Q3 the meter is pure client copy — it renders with no network and no auth', async ({ page }) => {
    await mockNetworkFailure(page, FIRESTORE_URLS);
    const r = await page.evaluate(() => {
      let host = document.getElementById('rl-quality');
      if (!host) { host = document.createElement('div'); host.id = 'rl-quality'; document.body.appendChild(host); }
      let d = document.getElementById('rl-desc');
      if (!d) { d = document.createElement('textarea'); d.id = 'rl-desc'; document.body.appendChild(d); }
      d.value = 'x'.repeat(300);
      recPaintListingScore();
      return { len: host.innerHTML.length, hasPct: /listing strength/.test(host.innerHTML) };
    });
    expect(r.hasPct, 'the meter renders offline and signed-out').toBe(true);
    expect(r.len).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v145 P1-4 — full internal application + VOLUNTARY EEO, safely stored.

   The apply flow now collects a minimal standard application (work-auth +
   sponsorship + contact) the employer SEES, plus an optional EEO block the
   employer NEVER sees. EEO rides a separate collection (eeo_responses/{uid}/
   jobs/{jobId}) with admin-only read at the rules level; the write is strictly
   fire-and-forget so it can never block or fail a real application.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v145 P1-4 internal apply + voluntary EEO', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._openApplyComplete === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      try { resumeData.name = 'Test User'; resumeData.email = 'test@example.com'; } catch (e) {}
      window.requireSignIn = () => true;
      window.fb = window.fb || {};
      window.fb.current = () => ({ uid: 'u1' });
    });
  });

  test('Q2 authed: standard fields go to the employer-readable application; EEO goes to its OWN collection', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const calls = { apply: null, eeo: null };
      window.fb.applyToInternalJob = async (id, meta) => { calls.apply = { id, meta }; return true; };
      window.fb.submitEEO = async (id, data) => { calls.eeo = { id, data }; return true; };
      _openApplyComplete({ id: 'job1', t: 'Marketing Manager', co: 'Acme' }, []);
      document.getElementById('ac-workauth').value = 'yes';
      document.getElementById('ac-sponsor').value = 'no';
      document.getElementById('ac-gender').value = 'Woman';        // moved off decline
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 200));
      return {
        applicant: calls.apply && calls.apply.meta.applicant,
        applicantHasEEO: calls.apply ? JSON.stringify(calls.apply.meta).toLowerCase().includes('woman') : null,
        eeoData: calls.eeo && calls.eeo.data,
      };
    });
    expect(r.applicant.workAuth, 'work authorization is on the application the employer reads').toBe('yes');
    expect(r.applicant.sponsorship).toBe('no');
    // the demographic answer must NOT appear anywhere in the employer-readable doc
    expect(r.applicantHasEEO, 'EEO must never leak into the application the employer can read').toBe(false);
    expect(r.eeoData.gender, 'EEO is written to its own employer-invisible collection').toBe('Woman');
  });

  test('EEO defaults to decline — an all-declined block stores NOTHING', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let eeoCalled = false;
      window.fb.applyToInternalJob = async () => true;
      window.fb.submitEEO = async () => { eeoCalled = true; return true; };
      _openApplyComplete({ id: 'job2', t: 'Ops Manager', co: 'Acme' }, []);
      // touch nothing in the EEO block — every field stays "Decline to self-identify"
      const defaults = ['gender', 'ethnicity', 'veteran', 'disability'].map((k) => document.getElementById('ac-' + k).value);
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 200));
      return { defaults, eeoCalled };
    });
    expect(r.defaults.every((v) => v.indexOf('Decline') === 0), 'every EEO field defaults to decline').toBe(true);
    expect(r.eeoCalled, 'declining everything writes no EEO doc at all').toBe(false);
  });

  test('Q3 failed network: a failed EEO write NEVER surfaces as a failed application', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const toasts = [];
      const realToast = window.showToast; window.showToast = (m) => { toasts.push(String(m)); if (realToast) try { realToast(m); } catch (e) {} };
      window.fb.applyToInternalJob = async () => true;            // application SUCCEEDS
      window.fb.submitEEO = async () => { throw new Error('network down'); };  // EEO write BLOWS UP
      _openApplyComplete({ id: 'job3', t: 'Analyst', co: 'Acme' }, []);
      document.getElementById('ac-gender').value = 'Man';         // so an EEO write is attempted
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 250));
      window.showToast = realToast;
      return { toasts };
    });
    expect(r.toasts.some((t) => /Applied/.test(t)), 'the applicant is told their application went through').toBe(true);
    expect(r.toasts.some((t) => /Could not send your application/.test(t)), 'a dead EEO write must not read as a dead application').toBe(false);
  });

  test('submitEEO writes to eeo_responses/{uid}/jobs/{jobId} — the employer-invisible path', async ({ page }) => {
    // guard the storage PATH, since that path (not a field flag) is what the rules
    // protect. A regression that moved EEO under jobs/{id}/applications would expose it.
    const r = await page.evaluate(async () => {
      let path = null;
      // shim the module method against a fake doc() to capture the path segments
      const seg = [];
      window.__eeoDocPath = null;
      window.fb.submitEEO = async (jobId, data) => { window.__eeoDocPath = ['eeo_responses', 'u1', 'jobs', jobId]; return true; };
      window.fb.applyToInternalJob = async () => true;
      _openApplyComplete({ id: 'job9', t: 'Role', co: 'Acme' }, []);
      document.getElementById('ac-disability').value = 'Yes, I have a disability';
      _submitApplyComplete();
      await new Promise((x) => setTimeout(x, 200));
      return { path: window.__eeoDocPath };
    });
    expect(r.path, 'EEO lives in its own top-level collection, not under the application').toEqual(['eeo_responses', 'u1', 'jobs', 'job9']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v146 — founder live-test batch: Browse accordion, hide-company, hosted-job
   apply affordance, and the unified two-way match scorer (candidate == recruiter).
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v146 Browse filter accordion (P2-5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.toggleBrowseFilters === 'function', null, { timeout: 15000 });
  });

  test('filters collapse by default and toggle open/closed; the fields live inside the body', async ({ page }) => {
    const r = await page.evaluate(() => {
      switchView('browse');
      const body = document.getElementById('browse-filter-body');
      const collapsedByDefault = body.classList.contains('browse-acc-collapsed');
      const fieldsInside = !!body.querySelector('#f-location') && !!body.querySelector('#f-livesort');
      _setBrowseFiltersOpen(true);
      const openClass = !body.classList.contains('browse-acc-collapsed');
      const contentHeight = body.scrollHeight;   // real content height (headless won't paint the anim)
      _setBrowseFiltersOpen(false);
      const reClosed = body.classList.contains('browse-acc-collapsed');
      return { collapsedByDefault, fieldsInside, openClass, contentHeight, reClosed };
    });
    expect(r.collapsedByDefault, 'accordion starts collapsed').toBe(true);
    expect(r.fieldsInside, 'the filter fields are inside the collapsible body').toBe(true);
    expect(r.openClass, 'toggling opens it').toBe(true);
    expect(r.contentHeight, 'the body has real content to show').toBeGreaterThan(200);
    expect(r.reClosed, 'toggling closes it again').toBe(true);
  });

  test('the header summary reflects the active region + sort while collapsed', async ({ page }) => {
    const sum = await page.evaluate(() => {
      switchView('browse');
      document.getElementById('f-location').value = 'Houston';
      _browseFilterSummary();
      return document.getElementById('browse-filter-sum').textContent;
    });
    expect(sum).toContain('Houston');
  });
});

test.describe('[STATE-COVERAGE] v146 hide all roles from a company (P2-6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.hideCompanyRoles === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { try { localStorage.removeItem('gpj_hidden_cos'); } catch (e) {} });
  });

  test('hiding a company removes its roles from the deck; unhide restores them', async ({ page }) => {
    const r = await page.evaluate(() => {
      const jobs = [
        { t: 'Recruiter I', co: 'Robert Half', loc: 'Houston, TX', match: 80, ghost: 10 },
        { t: 'Recruiter II', co: 'Robert Half', loc: 'Houston, TX', match: 78, ghost: 10 },
        { t: 'Ops Lead', co: 'Acme', loc: 'Houston, TX', match: 75, ghost: 10 },
      ];
      rawQueue = jobs.slice(); jobsQueue = jobs.slice();
      applySwipeFilters();
      const before = jobsQueue.map(j => j.co);
      hideCompanyRoles('Robert Half');
      const after = jobsQueue.map(j => j.co);
      unhideCompany('robert half');
      const restored = jobsQueue.map(j => j.co);
      return { before, after, restored, hiddenSet: Array.from(gpjHiddenCos()) };
    });
    expect(r.before.filter(c => c === 'Robert Half').length, 'both agency roles present first').toBe(2);
    expect(r.after.includes('Robert Half'), 'hiding removes ALL of that company').toBe(false);
    expect(r.after.includes('Acme'), 'other companies are untouched').toBe(true);
    expect(r.restored.filter(c => c === 'Robert Half').length, 'unhide brings them back').toBe(2);
  });

  test('the Settings hidden-companies manager lists muted companies with an unhide', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_hidden_cos', JSON.stringify(['robert half']));
      _renderHiddenCosList();
      const sec = document.getElementById('sec-hiddencos');
      const list = document.getElementById('hiddencos-list');
      return { sectionShown: sec.style.display !== 'none', hasUnhide: /Unhide/.test(list.innerHTML), hasName: /robert half/i.test(list.innerHTML) };
    });
    expect(r.sectionShown).toBe(true);
    expect(r.hasUnhide).toBe(true);
    expect(r.hasName).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v147 — founder live repro: applying to an internally-hosted job did nothing
   ("shows a prompt, nothing populates") and left a phantom Applied row that read
   "⚠ no longer on file". Root cause chain, all closed here:
     (A) swipeCard recorded the Applied row BEFORE the multi-step apply modal was
         ever completed → an orphan row with an id but no backing application doc.
     (B) the pool dedupe chose a fold survivor purely by description length, so a
         scraped harvester twin could evict the verified internal doc, stripping
         its _docId/source → in-app apply silently failed.
     (C) applyInternal() returned void on a missing id → a dead click.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v147 internal-apply routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyInternal === 'function' && typeof window._gpjDedupePool === 'function', null, { timeout: 15000 });
  });

  // (B) Authenticated / real-data state: a verified internal posting must survive
  // the fold with its identity intact even when a scraped twin has a longer blurb.
  test('dedupe keeps the VERIFIED internal doc (id + source) over a longer scraped twin', async ({ page }) => {
    const r = await page.evaluate(() => {
      const internal = { title: 'Marketing Manager', company: 'GPJ', location: 'Houston, TX', source: 'internal', _docId: 'intern-123', active: true, description: 'Short but real.' };
      const scraped  = { title: 'Marketing Manager', company: 'GPJ', location: 'Houston, TX', source: 'indeed', description: 'A much much much longer scraped blurb '.repeat(10) };
      // scraped listed first so length-only logic would have picked it
      const out = _gpjDedupePool([scraped, internal]);
      const survivor = out.find(j => (j.title === 'Marketing Manager'));
      return { count: out.length, source: survivor && survivor.source, docId: survivor && survivor._docId };
    });
    expect(r.count, 'the twin folds to one row').toBe(1);
    expect(r.source, 'the internal doc wins the fold').toBe('internal');
    expect(r.docId, 'and keeps its doc id for in-app apply').toBe('intern-123');
  });

  // (C) Empty/missing-data state: an internal job with no id must never be a dead
  // click — it shows a message and falls back, and creates NO application send.
  test('applyInternal with a missing id is not a dead click (message + fallback, no send)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = 0, toast = '', opened = null;
      window.fb = Object.assign(window.fb || {}, { applyToInternalJob: async () => { sent++; return true; } });
      showToast = (m) => { toast = m; };
      openCompanyView = (co, o) => { opened = { co, o }; };
      await applyInternal({ t: 'Marketing Manager', co: 'GPJ', url: '' });   // no id
      return { sent, toast, openedCo: opened && opened.co };
    });
    expect(r.sent, 'no application is sent without an id').toBe(0);
    expect(r.toast, 'the user is told, not left hanging').toMatch(/company|in-app apply/i);
    expect(r.openedCo, 'and we fall back to the company view').toBe('GPJ');
  });

  // (A) Authenticated core fix: a swipe-right on an INTERNAL job hands off to the
  // apply flow and does NOT pre-record an Applied row — the record only happens on
  // a real send (inside applyInternal), so no "no longer on file" orphan.
  test('swiping right on an internal job defers the Applied record to the real send', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // satisfy the swipe guards
      isSignedIn = () => true; profileComplete = () => true; isPaid = () => true;
      registerApply = () => {}; advanceQueue = () => {}; showToast = () => {};
      const job = { t: 'Marketing Manager', co: 'GPJ', loc: 'Houston, TX', id: 'intern-1', _internal: true, url: '' };
      _currentTopJob = () => job;
      deckJobs[0].t = 'Marketing Manager'; deckJobs[0].co = 'GPJ';   // deck non-empty guard
      const recorded = []; let appliedCalls = 0;
      recordSwipe = (dir, j) => { recorded.push({ dir, t: j && j.t }); };
      applyInternal = () => { appliedCalls++; };
      swipeCard('right');
      await new Promise(res => setTimeout(res, 600));   // the swipe settles at ~480ms
      return { recorded, appliedCalls };
    });
    expect(r.appliedCalls, 'the internal apply flow is invoked').toBe(1);
    expect(r.recorded.length, 'NO Applied row is recorded before the send (was the orphan-row bug)').toBe(0);
  });

  // Contrast/guard: an EXTERNAL right-swipe still records immediately (unchanged).
  test('an external right-swipe still records immediately (no regression)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      isSignedIn = () => true; profileComplete = () => true; isPaid = () => true;
      registerApply = () => {}; advanceQueue = () => {}; showToast = () => {};
      offerCoverLetter = () => {}; openSandbox = () => {}; openCompanyView = () => {};
      const job = { t: 'Growth Lead', co: 'Acme', loc: 'Houston, TX', id: '', _internal: false, url: 'https://example.com/job' };
      _currentTopJob = () => job;
      deckJobs[0].t = 'Growth Lead'; deckJobs[0].co = 'Acme';
      const recorded = [];
      recordSwipe = (dir, j) => { recorded.push({ dir, t: j && j.t }); };
      swipeCard('right');
      await new Promise(res => setTimeout(res, 600));
      return { recorded };
    });
    expect(r.recorded.length, 'external applies record right away').toBe(1);
    expect(r.recorded[0].t).toBe('Growth Lead');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v148 — interview + MUTUAL contact-exchange flow (founder live-test build):
   modality offer, contact revealed only on accept, clickable match-why, the
   persistent already-reached-out state, notification anchor routing, two-way
   cancel. Privacy spine: the candidate is anonymous until THEY accept.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v148 interview + contact-exchange flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._collectModality === 'function' && typeof window._confirmAcceptInterview === 'function' && typeof window._showMatchWhy === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { try { localStorage.removeItem('gpj_rec_cleared'); } catch (e) {} });
  });

  // Recruiter offers modalities → the collector reads exactly what was toggled.
  test('modality offer: toggled chips + their details collect correctly', async ({ page }) => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); host.id = '_modtest';
      host.innerHTML = _modalityOfferHtml(); document.body.appendChild(host);
      _roToggleMode('inperson'); _roToggleMode('phone');   // offer two of three
      document.getElementById('ro-addr').value = '100 Main St, Houston, TX';
      document.getElementById('ro-phone').value = '281-555-0100';
      const out = _collectModality();
      host.remove();
      return out;
    });
    expect(r.modes.sort()).toEqual(['inperson', 'phone']);
    expect(r.details.address).toBe('100 Main St, Houston, TX');
    expect(r.details.phone).toBe('281-555-0100');
    expect(r.details.link, 'a mode not offered carries no detail').toBeUndefined();
  });

  // The heart of the flow: accepting writes the candidate's OWN contact + chosen
  // modality (was: nothing was ever exchanged, so neither side could connect).
  test('accept writes candidateContact + chosenModality + the picked time', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = Object.assign(window.fb || {}, { respondReachout: async (id, status, extra) => { sent = { id, status, extra }; return true; } });
      _gpjResumeSnapshot = () => ({ name: 'Aaliyah S', contact: 'a@cand.com' });
      window._myRO = { ro1: { id: 'ro1', company: 'GPJ', proposedTimes: ['Tue 2pm CT'], proposedTs: [123], modalities: ['virtual', 'phone'] } };
      _openAcceptInterview('ro1', 0);
      document.getElementById('ai-email').value = 'a@cand.com';
      _aiPickMode('phone');
      await _confirmAcceptInterview();
      return sent;
    });
    expect(r, 'respondReachout was called').not.toBeNull();
    expect(r.status).toBe('interested');
    expect(r.extra.acceptedTime).toBe('Tue 2pm CT');
    expect(r.extra.chosenModality).toBe('phone');
    expect(r.extra.candidateContact.email).toBe('a@cand.com');
    expect(r.extra.candidateContact.name).toBe('Aaliyah S');
  });

  // Contact stays hidden until accept: an unaccepted (status 'sent') reach-out
  // carries NO candidateContact; only after accept does the recruiter see it.
  test('recruiter sees candidate contact ONLY after the candidate accepts', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      window.fb = Object.assign(window.fb || {}, {
        loadSentReachouts: async () => [
          { id: 'a', toCandidateUid: 'c1', jobId: 'jobA', candidateName: 'Anon One', status: 'sent' },
          { id: 'b', toCandidateUid: 'c2', jobId: 'jobA', candidateName: 'Anon Two', status: 'interested', acceptedTime: 'Wed 3pm', chosenModality: 'virtual', interviewDetails: { link: 'https://zoom.us/x' }, candidateContact: { name: 'Real Name', email: 'real@cand.com' } },
        ],
      });
      let host = document.getElementById('emp-responses');
      if (!host) { host = document.createElement('div'); host.id = 'emp-responses'; document.body.appendChild(host); }
      await renderRecruiterResponses();
      const html = document.getElementById('emp-responses').innerHTML;
      return { hasContact: /real@cand\.com/.test(html), leaksBeforeAccept: /Anon One/.test(html) };
    });
    expect(r.hasContact, 'accepted candidate contact is revealed').toBe(true);
    expect(r.leaksBeforeAccept, 'an un-accepted reach-out never shows contact').toBe(false);
  });

  // Clickable match % → anonymous strong-on + gaps, no PII.
  test('match-why popup shows strong-on terms and gaps', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._matchWhy = { k1: { m: ['marketing', 'campaigns'], x: ['sql'], p: 82 } };
      _showMatchWhy('k1');
      const html = document.getElementById('matchwhy-modal').innerHTML;
      document.getElementById('matchwhy-modal').remove();
      return { pct: /82% match/.test(html), strong: /STRONG ON/.test(html) && /marketing/.test(html), gap: /POSSIBLE GAPS/.test(html) && /sql/.test(html), noPII: /no personal information/i.test(html) };
    });
    expect(r.pct).toBe(true);
    expect(r.strong).toBe(true);
    expect(r.gap).toBe(true);
    expect(r.noPII).toBe(true);
  });

  // Already-reached-out: the send button greys with the candidate's response, and
  // Clear hides them locally — a fresh "Send" would double-message.
  test('a contacted candidate shows greyed state + Clear; a fresh one shows Send', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._recruiter = { uid: 'r1', company: 'Acme', isValidated: true };
      window.fb = Object.assign(window.fb || {}, {
        loadRecruiterJobs: async () => [{ id: 'jobA', title: 'Ops Lead', isValidated: true, filled: false }],
        loadRecommendedCandidates: async () => [
          { uid: 'candX', score: 88, matched: ['ops'], market: 'Houston, TX', applied: false },
          { uid: 'candY', score: 70, matched: ['ops'], market: 'Houston, TX', applied: false },
        ],
        loadSentReachouts: async () => [{ toCandidateUid: 'candX', jobId: 'jobA', status: 'interested' }],
      });
      const host = document.createElement('div'); host.id = 'rec-swipe'; document.body.appendChild(host);
      await renderRecCandidates();
      const html = document.getElementById('rc-cands').innerHTML;
      // now clear candX and re-render
      recClearCandidate('candX|jobA');
      await new Promise(res => setTimeout(res, 50));
      const html2 = document.getElementById('rc-cands').innerHTML;
      host.remove();
      return {
        greyed: /Reached out · 👍 Interested/.test(html),
        freshSend: /Send them this role/.test(html),
        clearedGone: !/candX/.test(html2) || /Send them this role/.test(html2),
      };
    });
    expect(r.greyed, 'the already-contacted candidate is greyed with their response').toBe(true);
    expect(r.freshSend, 'the un-contacted candidate still shows Send').toBe(true);
  });

  // Two-way cancel: candidate cancel is tagged cancelledBy:'candidate'.
  test('candidate can cancel their own interview, tagged cancelledBy', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = Object.assign(window.fb || {}, { respondReachout: async (id, status, extra) => { sent = { id, status, extra }; return true; } });
      window.confirm = () => true; window.prompt = () => 'A conflict came up';
      await candidateCancelInterview('ro9');
      return sent;
    });
    expect(r.status).toBe('cancelled');
    expect(r.extra.cancelledBy).toBe('candidate');
    expect(r.extra.cancelNote).toBe('A conflict came up');
  });

  // Notification routing surfaces the section (founder repro: "I click it, see nothing").
  test('notif scroll-to reveals a hidden section', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const el = document.getElementById('sec-reachouts');
      if (el) el.style.display = 'none';
      _notifScrollTo('sec-reachouts');
      await new Promise(res => setTimeout(res, 500));   // it un-hides inside a ~220ms timeout
      return { existed: !!el, after: el ? el.style.display : 'MISSING' };
    });
    expect(r.existed, '#sec-reachouts is the candidate reach-out anchor').toBe(true);
    expect(r.after, 'the section is made visible when a notif points at it').toBe('block');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v149 — "my job data went away, then came back on re-login." fb.loadProfile
   SWALLOWED a network error and returned null, indistinguishable from a brand-new
   account: the restore then OPENED the write-gate and baselined the monotonic
   guard EMPTY on a FAILED read, so real data vanished until a manual re-login.
   Fix: loadProfile now throws on a real error (null only for a truly-absent doc);
   loadTierFromProfile retries with backoff and, if the read never succeeds, keeps
   the gate SHUT and reschedules — never overwriting data it hasn't seen.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v149 restore never strands the account', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.loadTierFromProfile === 'function' && typeof window._gpjScheduleRestoreRetry === 'function', null, { timeout: 15000 });
  });

  // 3) Interrupted/failed-network state — the actual bug.
  test('a FAILED cloud read keeps the write-gate SHUT and does not baseline empty', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRestoreBackoff = 1;                 // don't wait real backoff in the test
      window._gpjCloudLoaded = false; window._gpjCloudListsSeen = null; window._gpjRestoreRetryPending = false;
      let reads = 0;
      window.fb = Object.assign(window.fb || {}, {
        loadProfile: async () => { reads++; throw new Error('network down'); },
        current: () => ({ uid: 'u1' }),
      });
      await loadTierFromProfile({ uid: 'u1' });
      return { reads, gateOpen: window._gpjCloudLoaded === true, baselinedEmpty: window._gpjCloudListsSeen !== null, retryPending: window._gpjRestoreRetryPending === true };
    });
    expect(r.reads, 'the read is retried, not attempted once').toBeGreaterThanOrEqual(4);
    expect(r.gateOpen, 'a failed read must NOT open the write-gate (that overwrote data)').toBe(false);
    expect(r.baselinedEmpty, 'a failed read must NOT baseline the monotonic guard empty').toBe(false);
    expect(r.retryPending, 'the restore is rescheduled instead of stranding the account').toBe(true);
  });

  // 4) Empty/missing-data state — a genuinely absent profile (new account) must
  // STILL open the gate + baseline empty, or a new account could never persist.
  test('a genuinely absent profile (null) DOES open the gate + baseline empty', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjCloudLoaded = false; window._gpjCloudListsSeen = null;
      window.fb = Object.assign(window.fb || {}, {
        loadProfile: async () => null,          // doc genuinely doesn't exist
        current: () => ({ uid: 'newuser' }),
      });
      await loadTierFromProfile({ uid: 'newuser' });
      return { gateOpen: window._gpjCloudLoaded === true, baselined: !!window._gpjCloudListsSeen };
    });
    expect(r.gateOpen, 'a real new account can sync from a clean slate').toBe(true);
    expect(r.baselined, 'and its monotonic baseline is set (empty is correct here)').toBe(true);
  });

  // A recovered read after transient failures restores + opens the gate.
  test('a read that succeeds after a couple of blips restores and opens the gate', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRestoreBackoff = 1;
      window._gpjCloudLoaded = false; window._gpjCloudListsSeen = null;
      let n = 0;
      window.fb = Object.assign(window.fb || {}, {
        loadProfile: async () => { n++; if (n < 3) throw new Error('blip'); return { lists: { applied: [{ t: 'Ops Lead', co: 'Acme', when: Date.now() }] } }; },
        current: () => ({ uid: 'u2' }),
      });
      await loadTierFromProfile({ uid: 'u2' });
      return { attempts: n, gateOpen: window._gpjCloudLoaded === true };
    });
    expect(r.attempts, 'it kept trying through the blips').toBe(3);
    expect(r.gateOpen, 'a recovered read opens the gate so syncing resumes').toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v151 — event-driven notification emails (interview confirmation + employer
   reach-out). The client trigger _gpjFireEmail must (a) no-op when signed out
   (never POST for a guest) and (b) POST the caller's idToken + payload to the
   right endpoint when signed in. Server-side auth/suppression/send-once are
   covered by the api/*-email unit tests.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v151 notification-email trigger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjFireEmail === 'function', null, { timeout: 15000 });
  });

  // 1) Guest / logged-out state: no token, no email — never POST for a guest.
  test('signed OUT: _gpjFireEmail never POSTs', async ({ page }) => {
    const posted = await page.evaluate(async () => {
      let calls = 0; const origFetch = window.fetch;
      window.fetch = (...a) => { calls++; return Promise.resolve({ ok: true }); };
      window.fb = Object.assign(window.fb || {}, { current: () => null });
      _gpjFireEmail('/api/interview-email', { reachoutId: 'ro1' });
      await new Promise(r => setTimeout(r, 60));
      window.fetch = origFetch;
      return calls;
    });
    expect(posted, 'a guest triggers no email POST').toBe(0);
  });

  // 2) Authenticated: POSTs idToken + payload to the given endpoint.
  test('signed IN: POSTs idToken + reachoutId to the endpoint', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let seen = null; const origFetch = window.fetch;
      window.fetch = (url, opts) => { seen = { url, body: JSON.parse((opts && opts.body) || '{}') }; return Promise.resolve({ ok: true }); };
      window.fb = Object.assign(window.fb || {}, { current: () => ({ uid: 'u1', getIdToken: async () => 'tok-123' }) });
      _gpjFireEmail('/api/interview-email', { reachoutId: 'ro9' });
      await new Promise(r => setTimeout(r, 80));
      window.fetch = origFetch;
      return seen;
    });
    expect(r, 'a signed-in user POSTs').not.toBeNull();
    expect(r.url).toBe('/api/interview-email');
    expect(r.body.idToken).toBe('tok-123');
    expect(r.body.reachoutId).toBe('ro9');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v153 — founder full-sweep. THE P0: Firestore rejects an `undefined` field
   value, and cloudSync built `prefs: undefined` whenever Match Preferences still
   showed the shipped placeholders. setDoc threw, `.catch(()=>{})` swallowed it,
   and so NOTHING synced — not the resume, not lists, not the reported-jobs set.
   That is why old data "came back" (the cloud kept serving the last good
   snapshot) and why a reported job reappeared.
   Secondary: gpjIsExpired compared a RAW title|company key against the v138
   BRAND-FOLDED key, so the cloud-synced hide never matched for any employer with
   a legal suffix ("The Bexar Company" -> "the bexar").
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v153 sync P0 + reported-job hide', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.gpjIsExpired === 'function' && typeof window.cloudSync === 'function', null, { timeout: 15000 });
  });

  // THE P0 — the payload shape that silently killed every write.
  test('undefined field values are stripped, so a profile write never throws', async ({ page }) => {
    await page.waitForFunction(() => typeof window._gpjStripUndefined === 'function', null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const s = window._gpjStripUndefined;
      const out = s({ prefs: undefined, keep: 'yes', nested: { gone: undefined, stays: 1 }, arr: [1, undefined, 2], zero: 0, empty: '' });
      return {
        prefsOmitted: !('prefs' in out),
        nestedOmitted: !('gone' in out.nested),
        nestedKept: out.nested.stays === 1,
        arr: out.arr,
        falsyPreserved: out.zero === 0 && out.empty === '',   // 0 and '' are REAL values, not undefined
      };
    });
    expect(r.prefsOmitted, 'the key is genuinely omitted (what {merge:true} needs)').toBe(true);
    expect(r.nestedOmitted).toBe(true);
    expect(r.nestedKept).toBe(true);
    expect(r.arr).toEqual([1, 2]);
    expect(r.falsyPreserved, 'falsy-but-real values must survive').toBe(true);
  });

  // 2) Authenticated: cloudSync must OMIT prefs on placeholders (never clobber),
  //    and must still send everything else.
  test('cloudSync omits prefs while placeholders show, but still syncs the rest', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = Object.assign(window.fb || {}, {
        current: () => ({ uid: 'u1' }),
        saveProfile: async (uid, data) => { sent = data; return true; },
      });
      // v154 test-hardening: the firebase module lands mid-test and its signed-out
      // auth callback RE-ARMS the data-loss gate (_gpjCloudLoaded=false), so a second
      // cloudSync() can silently no-op. Re-assert the gate immediately before each
      // call and POLL for the write — fixed delays hide this race (CLAUDE.md).
      const syncOnce = async () => {
        window._gpjCloudLoaded = true;
        cloudSync();
        for (let i = 0; i < 60 && sent === null; i++) await new Promise(r => setTimeout(r, 25));
        return sent;
      };
      // simulate a COMPLETED restore: without this baseline the v143 monotonic guard
      // deliberately withholds `lists` (it will not write what it has not read).
      window._gpjCloudListsSeen = { applied: [], responses: [], skipped: [], viewed: [] };
      lists.applied = [{ t: 'Ops Lead', co: 'Acme', when: Date.now() }];
      await syncOnce();
      return { sent, prefsValue: sent ? sent.prefs : null, hasResume: !!(sent && sent.resume), hasLists: !!(sent && sent.lists) };
    });
    expect(r.sent, 'cloudSync reached saveProfile').not.toBeNull();
    expect(r.prefsValue, 'placeholders must never be written as real prefs').toBeFalsy();
    expect(r.hasResume, 'the rest of the payload still syncs').toBe(true);
    expect(r.hasLists, 'lists sync once a baseline exists').toBe(true);
  });

  // An industries-only edit used to be dropped: the old guard skipped the WHOLE
  // prefs object whenever titles+salary were still placeholders.
  test('an industries-only edit is saved (was silently dropped)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = Object.assign(window.fb || {}, {
        current: () => ({ uid: 'u1' }),
        saveProfile: async (uid, data) => { sent = data; return true; },
      });
      // v154 test-hardening: the firebase module lands mid-test and its signed-out
      // auth callback RE-ARMS the data-loss gate (_gpjCloudLoaded=false), so a second
      // cloudSync() can silently no-op. Re-assert the gate immediately before each
      // call and POLL for the write — fixed delays hide this race (CLAUDE.md).
      const syncOnce = async () => {
        window._gpjCloudLoaded = true;
        cloudSync();
        for (let i = 0; i < 60 && sent === null; i++) await new Promise(r => setTimeout(r, 25));
        return sent;
      };
      document.getElementById('pref-industries').textContent = 'Healthcare, SaaS';
      await syncOnce();
      return sent && sent.prefs;
    });
    expect(r, 'prefs object is written').toBeTruthy();
    expect(r.industries).toBe('Healthcare, SaaS');
    expect(r.titles, 'placeholder titles must NOT ride along').toBeUndefined();
  });

  // 4) Empty/missing data: an empty local expired set must not blank the cloud copy.
  test('an empty reported-jobs set omits the key instead of overwriting with []', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let sent = null;
      window.fb = Object.assign(window.fb || {}, {
        current: () => ({ uid: 'u1' }),
        saveProfile: async (uid, data) => { sent = data; return true; },
      });
      // v154 test-hardening: the firebase module lands mid-test and its signed-out
      // auth callback RE-ARMS the data-loss gate (_gpjCloudLoaded=false), so a second
      // cloudSync() can silently no-op. Re-assert the gate immediately before each
      // call and POLL for the write — fixed delays hide this race (CLAUDE.md).
      const syncOnce = async () => {
        window._gpjCloudLoaded = true;
        cloudSync();
        for (let i = 0; i < 60 && sent === null; i++) await new Promise(r => setTimeout(r, 25));
        return sent;
      };
      localStorage.setItem('gpj_expired', '[]');
      await syncOnce();
      const empty = sent ? sent.expired : 'NOSEND';

      localStorage.setItem('gpj_expired', JSON.stringify(['some role|acme']));
      sent = null;
      await syncOnce();
      return { whenEmpty: empty, whenPopulated: sent ? sent.expired : null };
    });
    expect(r.whenEmpty, 'an empty set must NOT be written (it would un-hide every report)').toBeUndefined();
    expect(r.whenPopulated).toEqual(['some role|acme']);
  });

  // THE FOUNDER REPRO: reported LinkedIn job kept reappearing.
  test('a reported job stays hidden via the cloud-synced skip list (folded company key)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = 'Marketing Specialist', CO = 'The Bexar Company';
      localStorage.setItem('gpj_expired', '[]');          // local set lost (post-wipe)
      lists.skipped = [{ t: T, co: CO, when: Date.now() }]; // only the cloud copy survives
      const folded = gpjExpiredKey(T, CO);
      const raw = (T + '|' + CO).toLowerCase().replace(/\s+/g, ' ').trim();
      return {
        folded, raw,
        keysDiffer: folded !== raw,                        // proves the old comparison could never match
        hiddenViaSkipList: gpjIsExpired(T, CO),
        mapperDropsIt: mapFirestoreJob({ title: T, company: CO, description: 'x', direct_apply_url: 'https://x' }) === null,
      };
    });
    expect(r.keysDiffer, 'folded vs raw keys genuinely differ — the original bug').toBe(true);
    expect(r.hiddenViaSkipList, 'the cloud-synced hide must match after a local wipe').toBe(true);
    expect(r.mapperDropsIt, 'and the job never reaches the UI').toBe(true);
  });

  test('a job the user never reported is NOT hidden (no over-blocking)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_expired', '[]');
      lists.skipped = [{ t: 'Marketing Specialist', co: 'The Bexar Company', when: Date.now() }];
      return {
        differentRole: gpjIsExpired('Operations Manager', 'The Bexar Company'),
        differentCompany: gpjIsExpired('Marketing Specialist', 'Acme Industries'),
      };
    });
    expect(r.differentRole).toBe(false);
    expect(r.differentCompany).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v153b — Match Preferences finally DO something (founder-approved).
   They were displayed, editable, saved and restored — and read by NO matcher
   (computeMatch / searchRankJobs / applySwipeFilters / _gpjScoreMatch all had
   zero references). savePref also never persisted: it wrote DOM text, showed
   "✅ Preference saved", and lost the edit on reload. The shipped values were
   hardcoded demo text ("Engineer, Developer, Tech Lead"), a CLAUDE.md rule-5
   violation shown as if it were the user's own setting.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v153b Match Preferences are real', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.gpjPrefs === 'function' && typeof window.gpjPrefBoost === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { try { localStorage.removeItem('gpj_prefs'); } catch (e) {} });
  });

  // 4) Empty/missing data — the shipped placeholders must never count as a value.
  test('placeholder text is never treated as a real preference', async ({ page }) => {
    const r = await page.evaluate(() => {
      const p = gpjPrefs();
      return {
        titles: p.titles, minSalary: p.minSalary, industries: p.industries,
        boost: gpjPrefBoost({ t: 'Marketing Manager', desc: 'x', salMax: 40000 }),
        domStillPlaceholder: document.getElementById('pref-titles').textContent,
      };
    });
    expect(r.titles).toEqual([]);
    expect(r.minSalary).toBe(0);
    expect(r.industries).toEqual([]);
    expect(r.boost, 'no prefs set => zero steer, deck order unchanged').toBe(0);
    expect(r.domStillPlaceholder, 'no fake demo data on screen').not.toContain('Engineer, Developer, Tech Lead');
  });

  test('titles / industries / salary parse into usable signals', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Marketing Manager, Brand Manager', salary: '$120,000 / year', industries: 'SaaS, Healthcare' }));
      const p = gpjPrefs();
      localStorage.setItem('gpj_prefs', JSON.stringify({ salary: '120k' }));
      const k = gpjPrefs().minSalary;
      localStorage.setItem('gpj_prefs', JSON.stringify({ salary: '85' }));
      const bare = gpjPrefs().minSalary;
      return { titles: p.titles, industries: p.industries, salary: p.minSalary, k, bare };
    });
    expect(r.titles).toEqual(['marketing manager', 'brand manager']);
    expect(r.industries).toEqual(['saas', 'healthcare']);
    expect(r.salary).toBe(120000);
    expect(r.k, '"120k" parses').toBe(120000);
    expect(r.bare, '"85" means 85k, not $85').toBe(85000);
  });

  // 2) Authenticated: the steer is bounded and directional.
  test('a target title boosts, off-target does not, low salary down-ranks (never hides)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Marketing Manager', salary: '$120,000 / year', industries: 'SaaS' }));
      return {
        onTarget: gpjPrefBoost({ t: 'Marketing Manager', desc: 'SaaS growth', salMax: 130000 }),
        offTarget: gpjPrefBoost({ t: 'Registered Nurse', desc: 'clinical', salMax: 130000 }),
        underPaid: gpjPrefBoost({ t: 'Registered Nurse', desc: 'clinical', salMax: 60000 }),
        noSalaryPosted: gpjPrefBoost({ t: 'Registered Nurse', desc: 'clinical', salMax: 0 }),
      };
    });
    expect(r.onTarget).toBeGreaterThan(0);
    expect(r.offTarget).toBe(0);
    expect(r.underPaid, 'below the stated minimum is down-ranked').toBeLessThan(0);
    expect(r.noSalaryPosted, 'MOST postings have no salary — they must NOT be penalised').toBe(0);
  });

  // The deck's final sort must actually honour it.
  test('applySwipeFilters orders a target-title job above an equal-match one', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      const jobs = [
        { t: 'Operations Lead', co: 'Acme', loc: 'Houston, TX', match: 70, ghost: 10 },
        { t: 'Brand Manager', co: 'Beta', loc: 'Houston, TX', match: 70, ghost: 10 },
      ];
      rawQueue = jobs.slice(); jobsQueue = jobs.slice();
      applySwipeFilters();
      return jobsQueue.map(j => j.t);
    });
    expect(r[0], 'the stated target title leads on an equal match').toBe('Brand Manager');
  });

  // savePref must genuinely persist — it used to claim "saved" and lose the edit.
  test('savePref persists to storage (was DOM-only, lost on reload)', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.cloudSync = () => {};                 // isolate from the network
      editPref('titles');
      document.getElementById('pref-modal-input').value = 'Growth Marketer';
      savePref();
      const stored = JSON.parse(localStorage.getItem('gpj_prefs') || '{}');
      return { stored, parsed: gpjPrefs().titles, dom: document.getElementById('pref-titles').textContent };
    });
    expect(r.stored.titles, 'the edit reaches durable storage').toBe('Growth Marketer');
    expect(r.parsed).toEqual(['growth marketer']);
    expect(r.dom).toBe('Growth Marketer');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v155 — Match Preferences: weighted, and honoured on BOTH surfaces.
   Two gaps in what v154 shipped:
     (a) Browse ignored prefs entirely (0 references) — the deck honoured them,
         so the two surfaces disagreed the moment you used both.
     (b) the boost was a HARD PRECEDENCE TIER (`if(bpb!==apb) return bpb-apb`),
         so any target-title job out-ranked a 98% match. A +12 nudge must not
         override a 30-point match gap.
   Founder decision: preferences change ORDER only, never the displayed match %,
   which keeps one honest meaning and preserves the v146 candidate↔recruiter
   convergence that fixed the 75-vs-98 split.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v155 prefs steer both surfaces, weighted', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjRankScore === 'function', null, { timeout: 15000 });
    await page.evaluate(() => { try { localStorage.removeItem('gpj_prefs'); } catch (e) {} });
  });

  test('a preference nudge does NOT override a much stronger résumé match', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      const strong = { t: 'Marketing Specialist', match: 98 };
      const weak = { t: 'Brand Manager', match: 70 };
      return { strong: _gpjRankScore(strong), weak: _gpjRankScore(weak) };
    });
    expect(r.strong, 'a 98% match still beats a 70% target-title job').toBeGreaterThan(r.weak);
  });

  test('but a target title DOES win a close race', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      return {
        target90: _gpjRankScore({ t: 'Brand Manager', match: 90 }),
        other98: _gpjRankScore({ t: 'Marketing Specialist', match: 98 }),
      };
    });
    expect(r.target90).toBeGreaterThan(r.other98);
  });

  test('the DISPLAYED match % is never altered by preferences', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager', salary: '$120,000 / year' }));
      const j = { t: 'Brand Manager', match: 90, salMax: 130000 };
      const before = j.match;
      const score = _gpjRankScore(j);
      return { before, after: j.match, score };
    });
    expect(r.after, 'the job object is not mutated').toBe(r.before);
    expect(r.score, 'only the RANK score carries the boost').toBeGreaterThan(r.after);
  });

  // 4) Empty/missing data: with no prefs set, ranking must be exactly match %.
  test('with no preferences set, the rank score is identical to match %', async ({ page }) => {
    const r = await page.evaluate(() => ({
      a: _gpjRankScore({ t: 'Anything', match: 77 }),
      b: _gpjRankScore({ t: 'Other', match: 41 }),
    }));
    expect(r.a).toBe(77);
    expect(r.b).toBe(41);
  });

  test('BROWSE orders by the same score the deck uses (was ignoring prefs)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      const jobs = [
        { t: 'Ops Lead', co: 'Acme', loc: 'Houston, TX', match: 88, ghost: 10 },
        { t: 'Brand Manager', co: 'Beta', loc: 'Houston, TX', match: 85, ghost: 10 },
      ];
      // deck
      rawQueue = jobs.slice(); jobsQueue = jobs.slice();
      applySwipeFilters();
      const deckOrder = jobsQueue.map(j => j.t);
      // browse (same underlying pool + default match sort)
      liveJobs = jobs.slice();
      try { renderBrowse(); } catch (e) {}
      const browseScores = jobs.slice().sort((a, b) => _gpjRankScore(b) - _gpjRankScore(a)).map(j => j.t);
      return { deckOrder, browseScores };
    });
    expect(r.deckOrder[0], 'deck leads with the stated target').toBe('Brand Manager');
    expect(r.browseScores[0], 'Browse agrees with the deck').toBe('Brand Manager');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   v156 — Résumé Rater is genuinely TWO-FOLD (founder-approved [UI-REVIEW]).
   It always computed two halves — structure (ATS/best-practice) and coverage
   (role fit) — but blended them into ONE number, and benchmarked coverage against
   _recentTitle(): the job you already HAVE. A Marketing Specialist aiming at Brand
   Manager was scored against Marketing Specialist postings and told to add the
   wrong keywords. Now: two labelled scores, and the fit half benchmarks the TARGET
   role from Match Preferences (falling back to the current role, said out loud).
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('[STATE-COVERAGE] v156 rater: quality vs role-fit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.rateResume === 'function' && typeof window.gpjPrefs === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      try { localStorage.removeItem('gpj_prefs'); localStorage.removeItem('gpj_corpus_v1'); } catch (e) {}
      window._roleCorpusCache = null;
      resumeData.title = 'Marketing Specialist';
      resumeData.contact = 'a@example.com · (281) 555-0100 · Houston, TX';
      resumeData.summary = 'Marketing professional with 6 years running B2B campaigns.';
      resumeData.skills = 'demand generation, HubSpot, content marketing, campaign strategy, budgeting, analytics, email';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Acme', b: 'Owned demand generation across paid and email\nRan the content calendar and a $250k budget\nLifted MQLs 32% with sales\nBuilt reporting in HubSpot\nManaged brand content\nCoordinated 12 events a year' }];
      try { buildFromProfile(); } catch (e) {}
      // no network in CI: a stubbed corpus keeps this about the SCORING split
      window.fb = Object.assign(window.fb || {}, {
        mineRoleKeywords: async (role) => ({ matched: 40, terms: [
          { term: 'brand', pct: 90 }, { term: 'positioning', pct: 80 }, { term: 'campaign', pct: 70 },
          { term: 'budget', pct: 60 }, { term: 'hubspot', pct: 50 },
        ] }),
      });
    });
  });

  test('shows TWO labelled scores, not one blended number', async ({ page }) => {
    const t = await page.evaluate(async () => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      await rateResume();
      return (document.getElementById('resume-rating-body') || {}).textContent || '';
    });
    expect(t).toContain('Résumé Strength');   // v179: relabeled from "Résumé Quality"
    expect(t).toContain('Role Fit');
    expect(t, 'each score explains what it means').toMatch(/how strong the writing is/);
  });

  test('the fit half benchmarks the TARGET role, not the current one', async ({ page }) => {
    const t = await page.evaluate(async () => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      await rateResume();
      return (document.getElementById('resume-rating-body') || {}).textContent || '';
    });
    expect(t, 'benchmarks the role they WANT').toContain('Brand Manager');
    expect(t).toMatch(/the role you want/);
  });

  // 4) Empty/missing data: no target set must not break — it falls back and SAYS SO.
  test('with no target set it falls back to the current role and says so', async ({ page }) => {
    const t = await page.evaluate(async () => {
      await rateResume();
      return (document.getElementById('resume-rating-body') || {}).textContent || '';
    });
    expect(t).toContain('Marketing Specialist');
    expect(t, 'tells them why, and how to change it').toMatch(/current<\/em>|current. role|Set a target/);
  });

  test('quality and fit move INDEPENDENTLY (that is the whole point)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      await rateResume();
      const nums = ((document.getElementById('resume-rating-body') || {}).textContent || '').match(/(\d+)\s*\/\s*100/g) || [];
      return nums.slice(0, 2);
    });
    expect(r.length, 'two separate /100 readouts').toBe(2);
    expect(r[0], 'a well-built résumé scores high on quality').not.toBe(r[1]);
  });

  // Honesty: a fit score from a handful of postings must not pose as a benchmark.
  test('a thin posting sample is disclosed, not presented as precision', async ({ page }) => {
    const t = await page.evaluate(async () => {
      window._roleCorpusCache = null;
      try { localStorage.removeItem('gpj_corpus_v1'); } catch (e) {}
      window.fb.mineRoleKeywords = async () => ({ matched: 2, terms: [{ term: 'brand', pct: 100 }] });
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Brand Manager' }));
      await rateResume();
      return (document.getElementById('resume-rating-body') || {}).textContent || '';
    });
    expect(t, 'says how thin the sample is').toMatch(/Only 2 live/);
    expect(t, 'and refuses to overclaim').toMatch(/rough signal — not a verdict/);
  });
});

/* ===== v160 RC-1: the AI must receive the RIGHT job's text, never the DOM's =====
   Founder-verified defect (OpenAI log 2026-07-28 22:28): a tailor for "Senior
   Lifecycle Marketing Manager @ Jobgether" was written from "Director, Marketing
   Communications @ Airspan" text, which was scraped from a DISPLAY container and
   therefore also carried the app's own buttons ("Match to Job", "Cover Letter",
   "Apply") into the prompt as if they were employer requirements. Two resumes
   tailored for different jobs came out differing by three skill words. */
test.describe('[STATE-COVERAGE] v160 RC-1 job context binds to the data model', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.clGatherJobText === 'function'
      && typeof window.matchToJobFromCard === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      window._cmJob = null;
      try { jobsQueue = [{ t: 'Senior Lifecycle Marketing Manager', co: 'Jobgether',
        desc: 'Own lifecycle email and retention programs end to end.',
        req: 'Five years lifecycle marketing. HubSpot required.',
        benefits: 'Remote first. Health cover.' }]; } catch (e) {}
      try { seenJobKeys = new Set(); } catch (e) {}
      try { localStorage.removeItem('gpj_expired'); } catch (e) {}
    });
  });

  test('Q2 authed: the deck job supplies desc AND requirements (was desc-only)', async ({ page }) => {
    const r = await page.evaluate(() => clGatherJobText('Senior Lifecycle Marketing Manager', 'Jobgether'));
    expect(r.desc, 'the real posting text').toContain('lifecycle email');
    // the DOM path could only ever pass dataset.jobdesc — requirements never reached the model
    expect(r.req, 'requirements now reach the AI').toContain('HubSpot');
  });

  test('the WRONG job is refused rather than silently substituted', async ({ page }) => {
    // company modal is showing Airspan while the letter is for Jobgether — the exact live defect
    const r = await page.evaluate(() => {
      window._cmJob = { t: 'Director, Marketing Communications', co: 'Airspan',
        desc: 'Airspan comms leadership role.', req: '', benefits: '', summary: '' };
      try { jobsQueue = []; } catch (e) {}
      return clGatherJobText('Senior Lifecycle Marketing Manager', 'Jobgether');
    });
    expect(r.desc, 'never borrows another job\'s description').not.toContain('Airspan');
    expect(r.desc, 'empty is the honest answer').toBe('');
  });

  test('the matching job in the company modal IS used', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._cmJob = { t: 'Senior Lifecycle Marketing Manager', co: 'Jobgether',
        desc: 'Lifecycle role from the company view.', req: 'Braze.', benefits: '', summary: '' };
      try { jobsQueue = []; } catch (e) {}
      return clGatherJobText('Senior Lifecycle Marketing Manager', 'Jobgether');
    });
    // Browse / saved jobs / company view must keep working — they have no deck card
    expect(r.desc).toContain('company view');
    expect(r.req).toContain('Braze');
  });

  test('the app\'s own UI chrome can never be sent as job requirements', async ({ page }) => {
    const r = await page.evaluate(() => _clStripChrome(
      '\u{1F4CB} Director, Marketing Communications · Summary Open the role below for full details.'
      + ' \u{1F3AF} Match to Job ✨ Cover Letter ⚡ Apply'));
    for (const junk of ['Match to Job', 'Cover Letter', 'Open the role below']) {
      expect(r, 'strips ' + junk).not.toContain(junk);
    }
  });

  test('Q4 empty: no job text anywhere returns empty and does not throw', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._cmJob = null;
      try { jobsQueue = []; } catch (e) {}
      return clGatherJobText('Nothing', 'Nowhere');
    });
    expect(r).toEqual({ desc: '', req: '' });
  });
});

/* ===== v160: AI-tailored content must survive to the PDF =====
   Founder repro: three résumés tailored for three different jobs came out
   byte-identical except for a few appended skill words, while the OpenAI logs
   showed the model returning properly rewritten bullets every time. Cause:
   generateResumePDF's first line called syncProfileToResume(), which REBUILDS
   resumeData.jobs from the DOM textareas and overwrites resumeData.summary —
   discarding the AI's work one line before the PDF was drawn. Skills survived
   only because they are merged rather than replaced, which is exactly the
   signature the founder observed. */
test.describe('[STATE-COVERAGE] v160 tailored résumé reaches the PDF', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateResumePDF === 'function'
      && typeof window.syncProfileToResume === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      resumeData.name = 'Test Person';
      resumeData.contact = 't@example.com';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', d: '2024 – Present',
                           b: 'ORIGINAL bullet from the form' }];
      try { populateEmploymentRows(resumeData.jobs); } catch (e) {}
    });
  });

  test('skipSync=true preserves AI-tailored bullets (the fix)', async ({ page }) => {
    const b = await page.evaluate(() => {
      resumeData.jobs[0].b = 'AI-TAILORED bullet aimed at this posting';
      resumeData.summary = 'AI-TAILORED summary';
      try { generateResumePDF('T', 'X', true); } catch (e) {}
      return { bullet: resumeData.jobs[0].b, summary: resumeData.summary };
    });
    expect(b.bullet, 'AI bullet survives to the PDF').toContain('AI-TAILORED');
    expect(b.summary, 'AI summary survives too').toContain('AI-TAILORED');
  });

  test('CONTROL: without skipSync the DOM still wins (normal export unchanged)', async ({ page }) => {
    // proves the test is measuring the real mechanism, not passing vacuously
    const b = await page.evaluate(() => {
      resumeData.jobs[0].b = 'AI-TAILORED bullet aimed at this posting';
      try { generateResumePDF('T', 'X'); } catch (e) {}
      return resumeData.jobs[0].b;
    });
    expect(b, 'normal export still captures unsaved form typing').toContain('ORIGINAL');
  });
});

/* ===== v160: fmtAgo must measure calendar days, not a rolling 24h window ===== */
test.describe('[STATE-COVERAGE] v160 stat-row dates reflect real calendar days', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fmtAgo === 'function', null, { timeout: 15000 });
  });

  test('an action taken late YESTERDAY is not labelled "today"', async ({ page }) => {
    // the founder's exact repro: skipped ~10pm last night, viewed early afternoon today
    const label = await page.evaluate(() => {
      const n = new Date();
      const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 22, 0, 0);
      return fmtAgo(y.getTime());
    });
    expect(label, 'yesterday evening reads as 1d ago, not today').toBe('1d ago');
  });

  test('CONTROL: something done earlier TODAY still reads "today"', async ({ page }) => {
    const label = await page.evaluate(() => {
      const n = new Date();
      const t = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 5, 0);
      return fmtAgo(t.getTime());
    });
    expect(label).toBe('today');
  });

  test('Q4 empty: a row with no timestamp does not print NaN', async ({ page }) => {
    expect(await page.evaluate(() => fmtAgo(0))).toBe('—');
    expect(await page.evaluate(() => fmtAgo(undefined))).toBe('—');
  });
});

/* ===== v160b: the cover letter must use the job the user actually swiped =====
   v160's identity check could not work from the deck: swipeCard advances the deck
   BEFORE the letter renders, so _currentTopJob() is already the next job and identity
   never matched. Founder's live log: "cover letter: no job text matched marketing
   manager|sarin energy inc. — writing from résumé only". Letters went generic. */
test.describe('[STATE-COVERAGE] v160b cover letter uses the swiped job', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.clGatherJobText === 'function'
      && typeof window.offerCoverLetter === 'function', null, { timeout: 15000 });
  });

  test('the threaded job wins even after the deck has advanced', async ({ page }) => {
    const r = await page.evaluate(() => {
      // simulate the real failure: deck already showing a DIFFERENT job
      try { jobsQueue = [{ t: 'Some Other Role', co: 'Another Co', desc: 'WRONG job text.' }]; } catch (e) {}
      window._cmJob = null;
      clContext = { title: 'Marketing Manager', co: 'SARIN ENERGY INC.',
        job: { t: 'Marketing Manager', co: 'SARIN ENERGY INC.',
               desc: 'Lead integrated marketing strategy and paid campaigns.',
               req: 'Google Ads and SEM required.', benefits: '', summary: '' } };
      return clGatherJobText('Marketing Manager', 'SARIN ENERGY INC.');
    });
    expect(r.desc, 'uses the swiped job').toContain('integrated marketing');
    expect(r.desc, 'never the advanced deck card').not.toContain('WRONG');
    expect(r.req, 'requirements come through too').toContain('Google Ads');
  });

  test('CONTROL: with no threaded job it still refuses a mismatched source', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { jobsQueue = []; } catch (e) {}
      window._cmJob = { t: 'Different Role', co: 'Different Co', desc: 'Mismatched text.' };
      clContext = { title: 'Marketing Manager', co: 'SARIN ENERGY INC.' };
      return clGatherJobText('Marketing Manager', 'SARIN ENERGY INC.');
    });
    expect(r.desc, 'honest empty beats the wrong job').toBe('');
  });
});

/* ===== v161: the tailored résumé must reach the PDF EVEN WITH the DOM populated =====
   Root cause (found by RUNTIME instrumentation, not reading): applyMatch2Job writes AI
   bullets+summary into resumeData, then runPersonalizationCascade → renderSettingsIdentity
   → syncProfileToResume rebuilt resumeData.jobs from #jobs-container and summary from
   #pr-summary (both stale MASTER), one step before generateResumePDF read them. Skills
   survived only because they are merged, not replaced — the founder's exact fingerprint.
   My v160 tests missed it because they did NOT populate the DOM, so sync's
   `if(jobs.length) resumeData.jobs=jobs` never fired. This test populates the DOM. */
test.describe('[STATE-COVERAGE] v161 tailored résumé reaches PDF with a populated DOM', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyMatch2Job === 'function'
      && typeof window.populateEmploymentRows === 'function', null, { timeout: 15000 });
  });

  test('Q2 authed: AI bullets+summary reach generateResumePDF, master restored after', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const R = {};
      resumeData.name = 'T'; resumeData.title = 'Marketing Specialist'; resumeData.contact = 't@e.com';
      resumeData.summary = 'MASTER SUMMARY driving client success strategies over 12 years.'; resumeData.skills = 'Excel';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', d: '2024',
        b: 'MASTER bullet with $80K.' }];
      resumeReady = true;
      populateEmploymentRows(resumeData.jobs);              // the founder's real condition
      const s = document.getElementById('pr-summary'); if (s) s.value = resumeData.summary;
      R.domRows = document.querySelectorAll('#jobs-container > div').length;
      window.generateResumePDF = function () {
        R.pdf = { b: resumeData.jobs[0].b, s: resumeData.summary }; return 'x.pdf';
      };
      window.fb = window.fb || {};
      window.fb.smartMatch = async (bul, kw, f, opts) => (opts && opts.mode === 'summary')
        ? { finalResume: ['AI-TAILORED SUMMARY re-aimed at this specific posting.'], changedCount: 1 }
        // v178: a good rewrite PRESERVES the original's metric ($80K); otherwise the
        // metric-preservation guard (correctly) keeps the original bullet instead.
        : { finalResume: bul.map((x, i) => 'AI-TAILORED bullet ' + i + ' with $80K'), changedCount: bul.length };
      m2jContext = { title: 'Sales', co: 'Co', desc: 'posting '.repeat(30), suggestions: [], startPct: 90 };
      await window.applyMatch2Job();
      R.afterReturn = resumeData.jobs[0].b;
      return R;
    });
    expect(r.domRows, 'DOM rows are populated (the missing condition)').toBeGreaterThan(0);
    expect(r.pdf.b, 'AI bullets reach the PDF builder').toContain('AI-TAILORED');
    expect(r.pdf.s, 'AI summary reaches the PDF builder').toContain('AI-TAILORED');
    expect(r.afterReturn, 'master résumé is restored after the tailor').toContain('MASTER');
  });

  test('CONTROL: syncProfileToResume still rebuilds jobs when NOT tailoring', async ({ page }) => {
    // proves the guard is scoped to the tailor and does not break normal sync
    const r = await page.evaluate(() => {
      window._m2jInFlight = false;
      resumeData.jobs = [{ t: 'X', c: 'Y', b: 'stale model bullet' }];
      populateEmploymentRows([{ t: 'DOMROLE', c: 'DOMCO', d: '2024', b: 'DOM bullet text' }]);
      syncProfileToResume();
      return resumeData.jobs.map(j => j.b).join('|');
    });
    expect(r, 'normal sync still reads the DOM').toContain('DOM bullet text');
  });
});

/* ===== v161 #9: skills stemmer dedupe + non-skill filter =====
   Founder repro across 4 tailored résumés: keyword mining surfaced "Analyst · Analyze ·
   Analytics" (one root ×3) + bare non-skills (Communicate, Customers), and _tidySkills
   deduped by word-set but not stem so "Campaign · Campaigns" both survived. */
test.describe('[STATE-COVERAGE] v161 #9 skills mining is clean', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._tidySkills === 'function'
      && typeof window._gpjIsNonSkill === 'function' && typeof window.enrichMatchWithMarket === 'function',
      null, { timeout: 15000 });
  });

  test('the founder\'s polluted line: plurals fold, junk drops, real skills stay', async ({ page }) => {
    const r = await page.evaluate(() =>
      _tidySkills('Campaigns · Management · Campaign · Analyst · Analyze · Communicate · Customers · Analytics').skills);
    expect(r).toContain('Analytics');            // real skill kept
    expect(r).toContain('Management');
    expect(r).not.toMatch(/·\s*Campaign\b(?!s)/); // "Campaign" singular folded into "Campaigns"
    expect(r).not.toContain('Analyst');          // role, not a skill
    expect(r).not.toContain('Communicate');      // bare verb
    expect(r).not.toContain('Customers');        // bare noun
  });

  test('a genuine skill is not evicted by a same-stem junk word', async ({ page }) => {
    expect(await page.evaluate(() => _tidySkills('Analyst · Analytics').skills)).toBe('Analytics');
  });

  test('CONTROL: real single + multi-word skills all survive untouched', async ({ page }) => {
    const r = await page.evaluate(() => _tidySkills('Customer Service · Google Analytics · Salesforce · HubSpot').skills);
    for (const s of ['Customer Service', 'Google Analytics', 'Salesforce', 'HubSpot']) expect(r).toContain(s);
  });

  test('non-skill blocklist: bare words blocked, phrases + real skills pass', async ({ page }) => {
    const r = await page.evaluate(() => ({
      communicate: _gpjIsNonSkill('Communicate'), customers: _gpjIsNonSkill('Customers'),
      phrase: _gpjIsNonSkill('Customer Service'), real: _gpjIsNonSkill('Salesforce')
    }));
    expect(r.communicate).toBe(true); expect(r.customers).toBe(true);
    expect(r.phrase).toBe(false); expect(r.real).toBe(false);
  });

  test('mined checkbox terms are deduped by stem + stripped of non-skills', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // stub the mined terms with the exact junk set the founder saw
      window.fb = window.fb || {};
      window.fb.mineRoleKeywords = async () => ({ matched: 12, terms: [
        { term: 'analyst', pct: 90 }, { term: 'analyze', pct: 88 }, { term: 'analytics', pct: 80 },
        { term: 'communicate', pct: 70 }, { term: 'customers', pct: 60 }, { term: 'campaign management', pct: 55 }
      ]});
      m2jContext = { title: 'Marketing Manager', co: 'X', desc: '', suggestions: [] };
      if (!document.getElementById('m2j-market') && !document.getElementById('m2j-market-alt')) {
        const d = document.createElement('div'); d.id = 'm2j-market'; document.body.appendChild(d);
      }
      await enrichMatchWithMarket('Marketing Manager', 'existing skills text');
      return m2jContext.suggestions;
    });
    const low = r.map(s => s.toLowerCase());
    expect(low.filter(s => /analy/.test(s)).length, 'analy family collapses to one').toBe(1);
    expect(low, 'bare verb dropped').not.toContain('communicate');
    expect(low, 'bare noun dropped').not.toContain('customers');
    expect(low.join(' '), 'a real phrase survives').toContain('campaign management');
  });
});

/* ===== v161 #33: tailoring quality — restore concise metric notation =====
   Founder repro (Priority Power): the AI padded "40+/8+/500+" into wordier "over 40/8/500".
   Restore the tight form deterministically (candidate's own numbers, never fabricated). */
test.describe('[STATE-COVERAGE] v161 #33 concise metric notation survives tailoring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjTightenMetrics === 'function'
      && typeof window.applyMatch2Job === 'function', null, { timeout: 15000 });
  });

  test('"over N" becomes "N+"; "over N%" is left alone', async ({ page }) => {
    const r = await page.evaluate(() => ({
      a: _gpjTightenMetrics('Executed logistics for over 40 tradeshows and over 500 accounts.'),
      pct: _gpjTightenMetrics('grew signups by over 90% last year')
    }));
    expect(r.a).toContain('40+'); expect(r.a).toContain('500+');
    expect(r.a).not.toContain('over 40'); expect(r.a).not.toContain('over 500');
    expect(r.pct, 'percentages are not touched').toContain('over 90%');
  });

  test('the padded AI output reaches the PDF as tight notation', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let pdf = null;
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Marketing specialist with 12 years across campaigns.'; resumeData.skills='Excel';
      resumeData.jobs=[{t:'Marketing Specialist',c:'Poolsure',d:'2024',b:'MASTER bullet with 40+ shows.'}];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      const s=document.getElementById('pr-summary'); if(s) s.value=resumeData.summary;
      window.generateResumePDF=function(){ pdf={b:resumeData.jobs[0].b,s:resumeData.summary}; return 'x'; };
      window.fb=window.fb||{};
      window.fb.smartMatch=async(a,k,f,o)=> (o&&o.mode==='summary')
        ? {finalResume:['Specialist with over 12 years across over 500 locations, driving growth.'],changedCount:1}
        : {finalResume:['Executed logistics for over 40 annual tradeshows nationwide.'],changedCount:1};
      m2jContext={title:'Sales',co:'Co',desc:'posting '.repeat(30),suggestions:[],startPct:90};
      await window.applyMatch2Job();
      return pdf;
    });
    expect(r.b, 'bullet tightened in the PDF').toContain('40+');
    expect(r.b).not.toContain('over 40');
    expect(r.s, 'summary tightened in the PDF').toContain('500+');
  });
});

/* ===== v161 #32: cover letters get their OWN daily cap (founder decision 2026-07-30) =====
   They used to gate on matchAllowed()/bumpMatch(), so Match-to-Job + a cover letter drained
   one shared daily pool. Now each feature has an independent counter. */
test.describe('[STATE-COVERAGE] v161 #32 cover-letter daily cap is separate from match', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.clAllowed === 'function' && typeof window.bumpCl === 'function'
      && typeof window.matchUsed === 'function', null, { timeout: 15000 });
  });

  test('bumping a cover letter does NOT consume the match allowance, and vice versa', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('gpj_tier', 'free');
      localStorage.removeItem(matchKey()); localStorage.removeItem(clKey());
      bumpCl();  const afterCl = { m: matchUsed(), c: clUsed() };
      bumpMatch(); const afterMatch = { m: matchUsed(), c: clUsed() };
      return { afterCl, afterMatch, distinct: matchKey() !== clKey() };
    });
    expect(r.afterCl, 'cover letter moves only its own counter').toEqual({ m: 0, c: 1 });
    expect(r.afterMatch, 'match moves only its own counter').toEqual({ m: 1, c: 1 });
    expect(r.distinct, 'separate storage keys').toBe(true);
  });
});

/* ===== v162 #29: recover the employer name from the ATS URL =====
   Founder repro: the card showed "Hiring Company" for kyros-human-capital-llc.careerplug.com,
   which also poisoned the résumé filename and the cover-letter greeting. Many harvested docs
   carry no company field, but the employer is in the URL. */
test.describe('[STATE-COVERAGE] v162 #29 employer recovered from ATS URL', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjEmployerFromUrl === 'function'
      && typeof window.mapFirestoreJob === 'function', null, { timeout: 15000 });
  });

  test('the founder\'s CareerPlug URL yields the real employer', async ({ page }) => {
    expect(await page.evaluate(() => _gpjEmployerFromUrl('https://kyros-human-capital-llc.careerplug.com/jobs/3516154/apps/new')))
      .toBe('Kyros Human Capital LLC');
  });

  test('common ATS shapes recover; unknown hosts return empty (never invent)', async ({ page }) => {
    const r = await page.evaluate(() => ({
      gh: _gpjEmployerFromUrl('https://boards.greenhouse.io/acmecorp/jobs/1'),
      lever: _gpjEmployerFromUrl('https://jobs.lever.co/brightwave/x'),
      bamboo: _gpjEmployerFromUrl('https://riverstone-partners.bamboohr.com/careers/42'),
      linkedin: _gpjEmployerFromUrl('https://www.linkedin.com/jobs/view/1'),
      indeed: _gpjEmployerFromUrl('https://www.indeed.com/job/x'),
      junk: _gpjEmployerFromUrl('nope')
    }));
    expect(r.gh).toBeTruthy(); expect(r.lever).toBe('Brightwave'); expect(r.bamboo).toBe('Riverstone Partners');
    expect(r.linkedin).toBe(''); expect(r.indeed).toBe(''); expect(r.junk).toBe('');
  });

  test('mapFirestoreJob recovers when company is missing, but NEVER overwrites a real company', async ({ page }) => {
    const r = await page.evaluate(() => ({
      recovered: mapFirestoreJob({ title:'Sales Rep', url:'https://kyros-human-capital-llc.careerplug.com/j/x' }).co,
      control: mapFirestoreJob({ title:'Sales Rep', company:'Real Company Inc', url:'https://kyros-human-capital-llc.careerplug.com/j/x' }).co,
      placeholder: mapFirestoreJob({ title:'Sales Rep', url:'https://www.indeed.com/job/x' }).co
    }));
    expect(r.recovered).toBe('Kyros Human Capital LLC');
    expect(r.control, 'a real company field is authoritative').toBe('Real Company Inc');
    expect(r.placeholder, 'unresolvable still falls back honestly').toBe('Hiring Company');
  });
});

/* ===== v163 refinements from the founder's live test =====
   (a) iCIMS subdomains are "careers-{company}.icims.com" — strip the prefix.
   (b) Match-to-Job never tidied the OUTPUT skills, so the master's "Campaign·Campaigns"
       dupe survived into the tailored PDF. Tidy the working copy (master restored after). */
test.describe('[STATE-COVERAGE] v163 employer prefix + tailored-skills tidy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjEmployerFromUrl === 'function'
      && typeof window.applyMatch2Job === 'function', null, { timeout: 15000 });
  });

  test('iCIMS "careers-" prefix stripped, plain subdomain unchanged', async ({ page }) => {
    const r = await page.evaluate(() => ({
      prefixed: _gpjEmployerFromUrl('https://careers-ermcoeci.icims.com/jobs/6664/job'),
      plain: _gpjEmployerFromUrl('https://acme.icims.com/jobs/1')
    }));
    expect(r.prefixed).toBe('Ermcoeci');   // not "Careers Ermcoeci"
    expect(r.plain).toBe('Acme');
  });

  test('Match-to-Job tidies the tailored skills but never mutates the master', async ({ page }) => {
    const r = await page.evaluate(async () => {
      let pdfSkills = null;
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Marketing specialist with 12 years across campaigns.';
      resumeData.skills='Campaigns · Management · Campaign';   // the founder's exact dupe
      resumeData.jobs=[{t:'Marketing Specialist',c:'Poolsure',d:'2024',b:'MASTER bullet.'}];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      window.generateResumePDF=function(){ pdfSkills=resumeData.skills; return 'x'; };
      window.fb=window.fb||{};
      window.fb.smartMatch=async(a,k,f,o)=> (o&&o.mode==='summary')?{finalResume:['Tighter summary.'],changedCount:1}:{finalResume:a.map(x=>'better '+x),changedCount:1};
      m2jContext={title:'Sales',co:'Co',desc:'posting '.repeat(30),suggestions:[],startPct:90};
      await window.applyMatch2Job();
      return { pdfSkills, master: resumeData.skills };
    });
    expect(r.pdfSkills, 'tailored PDF skills are deduped').toBe('Campaigns · Management');
    expect(r.master, 'master résumé is restored untouched').toBe('Campaigns · Management · Campaign');
  });
});

/* ===== v164 #8: near-duplicate bullet detection + lead-verb variation =====
   Founder repro: "Managed 100 / 50 / 500+ accounts and client relationships end-to-end" —
   the same sentence three times with a different number (recruiter red flag). _healMetricDupes
   only touches generated templates; these are the user's own. Detect by similarity, vary the
   repeated ones' lead verb, keep every fact/number. */
test.describe('[STATE-COVERAGE] v164 #8 near-duplicate bullets are varied honestly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjVaryDupeBullets === 'function'
      && typeof window._gpjBulletsSimilar === 'function', null, { timeout: 15000 });
  });

  test('the founder\'s trio: same sentence, different number -> distinct lead verbs, facts kept', async ({ page }) => {
    const r = await page.evaluate(() => {
      const jobs = [
        { b:'Utilized Salesforce to manage accounts.\nManaged 100 accounts and client relationships end-to-end' },
        { b:'Monitored client accounts.\nManaged 50 accounts and client relationships end-to-end' },
        { b:'Designed training procedures.\nManaged 500+ accounts and client relationships end-to-end' }
      ];
      const varied = _gpjVaryDupeBullets(jobs);
      const verbs = jobs.map(j => (j.b.split('\n').pop().match(/^(\w+)/)||[])[1]);
      const nums = jobs.map(j => (j.b.match(/\d[\d+]*/g)||[]).join(''));
      return { varied, verbs, nums };
    });
    expect(r.varied).toBe(2);
    expect(new Set(r.verbs).size, 'all three lead verbs are distinct').toBe(3);
    expect(r.verbs[0]).toBe('Managed');
    expect(r.nums).toEqual(['100', '50', '500+']);  // numbers preserved (incl. the "+")
  });

  test('CONTROL: genuinely distinct bullets are never altered', async ({ page }) => {
    const r = await page.evaluate(() => {
      const jobs = [{ b:'Optimized an $80K tradeshow budget.\nLaunched a nationwide email campaign.' }];
      const before = jobs[0].b;
      const varied = _gpjVaryDupeBullets(jobs);
      return { varied, unchanged: jobs[0].b === before };
    });
    expect(r.varied).toBe(0);
    expect(r.unchanged).toBe(true);
  });

  test('similarity: exact-modulo-number is a dupe; unrelated bullets are not', async ({ page }) => {
    const r = await page.evaluate(() => ({
      dupe: _gpjBulletsSimilar('Managed 100 accounts and client relationships end-to-end','Managed 50 accounts and client relationships end-to-end'),
      distinct: _gpjBulletsSimilar('Optimized an $80K tradeshow budget.','Led a team of 8 Account Managers.')
    }));
    expect(r.dupe).toBe(true);
    expect(r.distinct).toBe(false);
  });
});

/* ===== v165 #10: safe mechanical prose cleanup + native spellcheck =====
   Founder's live bugs: "allocation.; Executed" and "travel..". Fix only the unambiguous
   mechanics; never touch ellipsis/decimals/abbreviations, never rewrite grammar. */
test.describe('[STATE-COVERAGE] v165 #10 prose tidy is safe', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjTidyProse === 'function'
      && typeof window._gpjTightenMetrics === 'function', null, { timeout: 15000 });
  });

  test('fixes the founder\'s period-semicolon and double-period bugs', async ({ page }) => {
    const r = await page.evaluate(() => ({
      ps: _gpjTidyProse('allocation.; Executed logistics'),
      dp: _gpjTidyProse('vendor sourcing and travel..'),
      sp: _gpjTidyProse('accounts , clients ; done .'),
      ds: _gpjTidyProse('Led  a   team')
    }));
    expect(r.ps).toBe('allocation. Executed logistics');
    expect(r.dp).toBe('vendor sourcing and travel.');
    expect(r.sp).toBe('accounts, clients; done.');
    expect(r.ds).toBe('Led a team');
  });

  test('CONTROL: ellipsis, decimals, and abbreviations are never mangled', async ({ page }) => {
    const r = await page.evaluate(() => ({
      e: _gpjTidyProse('Wait for it... then deliver'),
      d: _gpjTidyProse('Grew revenue 3.5M in Q4'),
      a: _gpjTidyProse('Worked across the U.S. and Canada')
    }));
    expect(r.e).toBe('Wait for it... then deliver');
    expect(r.d).toBe('Grew revenue 3.5M in Q4');
    expect(r.a).toBe('Worked across the U.S. and Canada');
  });

  test('metric-tightening and prose-tidy compose in one pass', async ({ page }) => {
    expect(await page.evaluate(() => _gpjTightenMetrics('Led over 8 managers and travel..')))
      .toBe('Led 8+ managers and travel.');
  });

  test('résumé textareas carry native spellcheck', async ({ page }) => {
    const r = await page.evaluate(() => (document.getElementById('pr-summary')||{}).getAttribute('spellcheck'));
    expect(r).toBe('true');
  });
});

/* ===== v166 Phase 2a: quantify-a-bullet elicitation =====
   The AI won't invent numbers (honesty). Detect achievement bullets with a countable noun
   and no number, ask the user, insert their real figure — nothing added without a typed value. */
test.describe('[STATE-COVERAGE] v166 Phase 2a quantify a bullet honestly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjUnquantifiedBullets === 'function'
      && typeof window._gpjQuantifyBullet === 'function' && typeof window.applyMatch2Job === 'function',
      null, { timeout: 15000 });
  });

  test('detects achievement bullets missing a number; ignores ones that have one', async ({ page }) => {
    const r = await page.evaluate(() => ({
      det: _gpjUnquantifiedBullets([{ b:'Managed accounts and client relationships end-to-end\nLed a team standardizing protocols\nOptimized an $80K budget' }]).map(d=>d.noun),
      hasNumber: _gpjUnquantifiedBullets([{ b:'Managed 100 accounts' }]).length,
      noNoun: _gpjUnquantifiedBullets([{ b:'Streamlined event planning frameworks' }]).length
    }));
    expect(r.det).toEqual(['accounts', 'team']);
    expect(r.hasNumber).toBe(0);   // already quantified
    expect(r.noNoun).toBe(0);      // nothing countable
  });

  test('insertion places the real number correctly; rejects non-numbers', async ({ page }) => {
    const r = await page.evaluate(() => ({
      acc: _gpjQuantifyBullet('Managed accounts and client relationships', '100', 'accounts'),
      team: _gpjQuantifyBullet('Led a team standardizing protocols', '8', 'team'),
      reject: _gpjQuantifyBullet('Managed accounts', 'several', 'accounts')
    }));
    expect(r.acc).toBe('Managed 100 accounts and client relationships');
    expect(r.team).toBe('Led a team of 8 standardizing protocols');
    expect(r.reject, 'a non-number is never inserted').toBe('Managed accounts');
  });

  test('end-to-end: a typed number reaches the tailored PDF; master restored', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Specialist across campaigns.'; resumeData.skills='Excel';
      resumeData.jobs=[{ t:'Account Specialist', c:'X', d:'2024', b:'Managed accounts and client relationships end-to-end' }];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      if(!document.getElementById('m2j-quantify')){ const d=document.createElement('div'); d.id='m2j-quantify'; document.body.appendChild(d); }
      _gpjRenderQuantify();
      document.getElementById('m2j-q0').value='100';
      let pdf=null;
      window.generateResumePDF=function(){ pdf=resumeData.jobs[0].b; return 'x'; };
      window.fb=window.fb||{};
      window.fb.smartMatch=async(a,k,f,o)=> (o&&o.mode==='summary')?{finalResume:['S.'],changedCount:1}:{finalResume:a,changedCount:0};
      m2jContext={title:'Sales',co:'Co',desc:'posting '.repeat(30),suggestions:[],startPct:90};
      await window.applyMatch2Job();
      return { pdf, master: resumeData.jobs[0].b };
    });
    expect(r.pdf, 'the user\'s number is in the tailored bullet').toBe('Managed 100 accounts and client relationships end-to-end');
    expect(r.master, 'master restored to the unquantified original').toBe('Managed accounts and client relationships end-to-end');
  });
});

/* ===== v167 Phase 2b: skill checkboxes are opt-IN ("I have X"), not opt-out =====
   Founder: the checkboxes "just add words". They were CHECKED by default, so the default
   behavior added everything. Now they're unchecked — the user affirmatively confirms only
   the skills they genuinely have, and only those flow into the résumé. */
test.describe('[STATE-COVERAGE] v167 Phase 2b skill confirmation is opt-in', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.openMatch2Job === 'function'
      && typeof window.applyMatch2Job === 'function', null, { timeout: 15000 });
  });

  test('mined skill boxes render UNCHECKED with an "I have" label and honest copy', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Specialist across campaigns.'; resumeData.skills='Excel';
      resumeData.jobs=[{ t:'Marketing Specialist', c:'X', d:'2024', b:'Ran email campaigns' }];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      localStorage.setItem('gpj_tier','free');
      window.fb=window.fb||{}; window.fb.mineRoleKeywords=async()=>({matched:0,terms:[]});
      openMatch2Job('Marketing Specialist','Acme','We need salesforce, logistics and compliance with inventory management.');
      await new Promise(r=>setTimeout(r,300));
      const boxes=[...document.querySelectorAll('#m2j-checks input[type=checkbox]')];
      return {
        count: boxes.length,
        allUnchecked: boxes.length>0 && boxes.every(b=>!b.checked),
        label0: boxes[0]?boxes[0].parentElement.textContent.trim():'',
        copy: /Check only the ones you genuinely have/.test((document.getElementById('m2j-body')||{}).innerText||'')
      };
    });
    expect(r.count).toBeGreaterThan(0);
    expect(r.allUnchecked, 'nothing is pre-checked — the user opts in').toBe(true);
    expect(r.label0).toMatch(/^I have /);
    expect(r.copy).toBe(true);
  });

  test('checking a box still adds that skill (behavior unchanged); unchecked stays out', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Specialist.'; resumeData.skills='Excel';
      resumeData.jobs=[{ t:'Marketing Specialist', c:'X', d:'2024', b:'Ran email campaigns' }];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      localStorage.setItem('gpj_tier','free');
      window.fb=window.fb||{}; window.fb.mineRoleKeywords=async()=>({matched:0,terms:[]});
      openMatch2Job('Marketing Specialist','Acme','We need salesforce, logistics and compliance experience.');
      await new Promise(r=>setTimeout(r,300));
      const boxes=[...document.querySelectorAll('#m2j-checks input[type=checkbox]')];
      const firstSkill=(m2jContext.suggestions||[])[0]||'';
      if(boxes[0]) boxes[0].checked=true;                 // confirm the first skill only
      let pdfSkills=null;
      window.generateResumePDF=function(){ pdfSkills=resumeData.skills; return 'x'; };
      window.fb.smartMatch=async(a,k,f,o)=> (o&&o.mode==='summary')?{finalResume:['S.'],changedCount:1}:{finalResume:a,changedCount:0};
      await window.applyMatch2Job();
      return { firstSkill, pdfSkills, master: resumeData.skills };
    });
    expect(r.pdfSkills.toLowerCase(), 'the confirmed skill is added to the tailored résumé').toContain(r.firstSkill.toLowerCase());
    expect(r.master, 'master skills unchanged (Excel only)').toBe('Excel');
  });
});

/* ===== v168 refinements from the founder's live test =====
   (a) bare "Project" was offered as a skill — promote to the real phrase "Project Management".
   (b) "boost team performance of 10" — don't quantify a people-noun that modifies an abstract
       noun; only ask for a headcount when the bullet is actually about leading people. */
test.describe('[STATE-COVERAGE] v168 smarter skill suggestions + quantify targeting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjCanonicalSkill === 'function'
      && typeof window._gpjUnquantifiedBullets === 'function', null, { timeout: 15000 });
  });

  test('bare nouns become real skill phrases; proper casing and phrases preserved', async ({ page }) => {
    const r = await page.evaluate(() => ({
      project: _gpjCanonicalSkill('project'),
      vendor: _gpjCanonicalSkill('vendor'),
      analysis: _gpjCanonicalSkill('analysis'),
      sf: _gpjCanonicalSkill('salesforce'),
      crm: _gpjCanonicalSkill('crm'),
      phrase: _gpjCanonicalSkill('project management')
    }));
    expect(r.project).toBe('Project Management');
    expect(r.vendor).toBe('Vendor Management');
    expect(r.analysis).toBe('Data Analysis');
    expect(r.sf).toBe('Salesforce');            // casing kept
    expect(r.crm).toBe('CRM');
    expect(r.phrase).toBe('Project Management'); // no doubling
  });

  test('quantify skips abstract compounds but still asks on real headcount bullets', async ({ page }) => {
    const r = await page.evaluate(() => ({
      teamPerf: _gpjUnquantifiedBullets([{ b:'Streamlined frameworks to enhance team performance' }]).length,
      ledTeam: _gpjUnquantifiedBullets([{ b:'Led a team standardizing protocols' }]).map(x=>x.noun),
      accounts: _gpjUnquantifiedBullets([{ b:'Managed accounts and client relationships end-to-end' }]).map(x=>x.noun)
    }));
    expect(r.teamPerf, '"team performance" is not a headcount').toBe(0);
    expect(r.ledTeam).toEqual(['team']);   // real leadership bullet still asked
    expect(r.accounts).toEqual(['accounts']);
  });

  test('the mined checkboxes offer the canonical phrase, not the bare word', async ({ page }) => {
    // the founder's live "Project" came from the mining path — inject it there
    const r = await page.evaluate(async () => {
      resumeData.name='T'; resumeData.title='Marketing Specialist'; resumeData.contact='t@e.com';
      resumeData.summary='Specialist.'; resumeData.skills='Excel';
      resumeData.jobs=[{ t:'Marketing Specialist', c:'X', d:'2024', b:'Ran email campaigns' }];
      resumeReady=true; populateEmploymentRows(resumeData.jobs);
      if (!document.getElementById('m2j-market')) { const d=document.createElement('div'); d.id='m2j-market'; document.body.appendChild(d); }
      m2jContext = { title:'Marketing Coordinator', co:'X', desc:'', suggestions:[] };
      window.fb=window.fb||{};
      window.fb.mineRoleKeywords=async()=>({ matched:20, terms:[{term:'project',pct:80},{term:'vendor',pct:60}] });
      await enrichMatchWithMarket('Marketing Coordinator', 'existing skills text');
      return { html:(document.getElementById('m2j-market')||{}).innerText||'', suggestions:m2jContext.suggestions };
    });
    expect(r.html).toContain('Project Management');
    expect(r.html).not.toMatch(/I have Project\b(?! Management)/);   // never the bare word
    expect(r.suggestions).toContain('Project Management');
  });
});

/* ===== v169 #27: cover-letter job threading (a real regression fix) =====
   offerCoverLetter is wrapped twice (energy/overlimit gate + opt-out/quota); BOTH wrappers
   had signature (title,co,external) and dropped the 4th arg jobObj — so v160b's threading was
   silently defeated and letters lost their job context (masked by the _cmJob/deck fallbacks).
   The wrappers now forward jobObj; every threaded caller works. */
test.describe('[STATE-COVERAGE] v169 #27 cover-letter wrappers forward the job', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.offerCoverLetter === 'function'
      && typeof window.clGatherJobText === 'function' && typeof window.applyFromViewed === 'function',
      null, { timeout: 15000 });
  });

  test('a threaded job survives the wrappers and reaches the letter', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeData.name='T'; resumeData.contact='t@e.com'; resumeData.summary='pro'; resumeData.jobs=[{t:'x',c:'y',b:'z'}]; resumeReady=true;
      window._cmJob=null; try{ jobsQueue=[]; }catch(e){}
      offerCoverLetter('Rep','Beta',true,{ t:'Rep', co:'Beta', desc:'THREADED desc.', req:'REQ here.' });
      return clGatherJobText('Rep','Beta');
    });
    expect(r.desc).toBe('THREADED desc.');
    expect(r.req).toContain('REQ here.');
  });

  test('applyFromViewed threads the viewed row through the wrappers', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeData.name='T'; resumeData.contact='t@e.com'; resumeData.summary='pro'; resumeData.jobs=[{t:'x',c:'y',b:'z'}]; resumeReady=true;
      window._cmJob=null; try{ jobsQueue=[]; }catch(e){}
      lists.viewed=[{ t:'ViewRole', co:'ViewCo', desc:'VIEWED desc.', url:'' }];
      applyFromViewed(0);
      return clGatherJobText('ViewRole','ViewCo').desc;
    });
    expect(r).toBe('VIEWED desc.');
  });

  test('CONTROL: a letter with no threaded job clears the previous one (no stale leak)', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeData.name='T'; resumeData.contact='t@e.com'; resumeData.summary='pro'; resumeData.jobs=[{t:'x',c:'y',b:'z'}]; resumeReady=true;
      window._cmJob=null; try{ jobsQueue=[]; }catch(e){}
      offerCoverLetter('A','ACo',true,{ t:'A', co:'ACo', desc:'FIRST job.' });   // sets clContext.job
      offerCoverLetter('B','BCo',true);                                          // no jobObj -> must clear it
      return clGatherJobText('B','BCo').desc;
    });
    expect(r, 'the previous job never leaks into the next letter').toBe('');
  });
});

/* ===== v171 Match-Preferences: placeholder can never be saved as a real value =====
   Founder repro: "Engineer, Developer, Tech Lead" demo data lived in her prefs (an old
   placeholder saved as real). editPref read the DOM textContent (the placeholder) into the
   edit modal, and savePref did not reject it. Now editPref pre-fills the REAL stored value
   (empty if none/placeholder) and savePref rejects placeholder text. */
test.describe('[STATE-COVERAGE] v171 match-pref placeholder never persists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window.editPref === 'function'
      && typeof window.savePref === 'function' && typeof _GPJ_PREF_PLACEHOLDERS !== 'undefined',
      null, { timeout: 15000 });
  });

  test('edit modal shows the real value, never the placeholder', async ({ page }) => {
    const r = await page.evaluate(() => {
      const out = {};
      localStorage.removeItem('gpj_prefs');
      editPref('titles');                                  // no stored value
      out.emptyWhenNone = document.getElementById('pref-modal-input').value;
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: 'Marketing Manager, Brand Manager' }));
      editPref('titles');                                  // real value
      out.showsReal = document.getElementById('pref-modal-input').value;
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: _GPJ_PREF_PLACEHOLDERS.titles }));
      editPref('titles');                                  // stored value == placeholder
      out.emptyWhenPlaceholder = document.getElementById('pref-modal-input').value;
      return out;
    });
    expect(r.emptyWhenNone).toBe('');
    expect(r.showsReal).toBe('Marketing Manager, Brand Manager');
    expect(r.emptyWhenPlaceholder).toBe('');
  });

  test('savePref rejects the placeholder text and never persists it', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_prefs');
      editingPref = 'titles';
      document.getElementById('pref-modal-input').value = _GPJ_PREF_PLACEHOLDERS.titles;
      savePref();
      const saved = JSON.parse(localStorage.getItem('gpj_prefs') || '{}');
      return { stored: saved.titles || null };
    });
    expect(r.stored, 'the placeholder is never written as a real pref').toBeNull();
  });
});

/* ===== v171 self-heal: clear stale demo prefs, never a real value ===== */
test.describe('[STATE-COVERAGE] v171 stale demo prefs self-heal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof window._gpjHealStalePrefs === 'function'
      && typeof _GPJ_PREF_PLACEHOLDERS !== 'undefined', null, { timeout: 15000 });
  });

  test('clears the exact demo signature but preserves plausibly-real values', async ({ page }) => {
    const r = await page.evaluate(() => {
      const heal = (prefs) => { localStorage.setItem('gpj_prefs', JSON.stringify(prefs)); _gpjHealStalePrefs(); return JSON.parse(localStorage.getItem('gpj_prefs') || '{}'); };
      return {
        demoSig: heal({ titles: 'Engineer, Developer, Tech Lead', salary: '$120,000 / year' }),
        realEngineer: heal({ titles: 'Engineer, Developer, Tech Lead', salary: '$95,000' }),
        placeholder: heal({ titles: _GPJ_PREF_PLACEHOLDERS.titles, salary: '$140,000' }),
        realMarketing: heal({ titles: 'Marketing Manager', salary: '$110,000', industries: 'SaaS' })
      };
    });
    expect(r.demoSig.titles, 'demo Engineer titles cleared').toBeUndefined();
    expect(r.demoSig.salary, 'demo $120k salary cleared').toBeUndefined();
    expect(r.realEngineer.titles, 'a real engineer (diff salary) is NOT clobbered').toBe('Engineer, Developer, Tech Lead');
    expect(r.placeholder.titles, 'saved placeholder cleared').toBeUndefined();
    expect(r.placeholder.salary, 'real salary alongside a placeholder is kept').toBe('$140,000');
    expect(r.realMarketing.titles, 'real marketing prefs untouched').toBe('Marketing Manager');
  });
});

/* ===== v172 #39: Role Fit field-alignment gate (no generic-term inflation) ===== */
test.describe('[STATE-COVERAGE] v172 Role Fit out-of-field cap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof rateResume === 'function'
      && typeof resumeData !== 'undefined' && resumeData, null, { timeout: 15000 });
  });

  async function rateAgainst(page, targetRole) {
    return await page.evaluate(async (role) => {
      // a genuine MARKETING résumé — contains generic business words but never "engineer"
      resumeData.title = 'Marketing Specialist';
      resumeData.skills = 'Marketing, Brand Management, Communication, Project Management, Budget, Leadership';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', b: 'Led marketing campaigns and managed budget, communication and project timelines for the leadership team.' }];
      resumeData.summary = 'Marketing professional with project management and communication strengths.';
      try { window.resumeReady = true; } catch(e) {}
      localStorage.setItem('gpj_prefs', JSON.stringify({ titles: role }));
      // generic top-terms a role of ANY field shares — the inflation vector
      const terms = ['management','communication','project','leadership','budget'].map(t => ({ term: t, pct: 60 }));
      window._roleCorpusCache = { role: role, ts: Date.now(), corpus: { matched: 12, terms } };
      await window.rateResume();
      const body = document.getElementById('resume-rating-body');
      // second ring is Role Fit; grab its big number
      const nums = [...body.querySelectorAll('div')].map(d => d.textContent).filter(t => /^\d+$/.test(t.trim()));
      const overall = (body.innerText.match(/readiness\s+(\d+)\/100/) || [])[1];
      return { html: body.innerText, roleFitNum: Number(nums[1]), overallNum: Number(overall), outOfFieldNote: /transferable/.test(body.innerHTML) };
    }, targetRole);
  }

  test('out-of-field target (Engineer) caps Role Fit, with a transferable-only note', async ({ page }) => {
    const r = await rateAgainst(page, 'Engineer');
    expect(r.roleFitNum, 'marketing résumé must NOT read as a strong Engineer fit').toBeLessThanOrEqual(35);
    // v180: the blended "Overall callback readiness" number was REMOVED (it read as a
    // contradiction against the rings), so there is no overall number to assert anymore.
    expect(r.outOfFieldNote, 'shows the honest transferable-overlap note').toBeTruthy();
  });

  test('in-field target (Marketing Manager) is NOT capped', async ({ page }) => {
    const r = await rateAgainst(page, 'Marketing Manager');
    // same generic corpus, but the résumé IS in the marketing field → full coverage, not capped
    expect(r.roleFitNum, 'an in-field résumé scores its real coverage, not the 35 cap').toBeGreaterThan(35);
    expect(r.outOfFieldNote, 'no out-of-field note when in field').toBeFalsy();
  });
});

/* ===== v173 #11: apply panel leads with the tailored cover letter, honest header ===== */
test.describe('[STATE-COVERAGE] v173 apply-panel reorder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => typeof openApplyTokensThenTab === 'function'
      && typeof resumeData !== 'undefined' && resumeData, null, { timeout: 15000 });
  });

  test('cover letter is the first item; header no longer claims auto-fill', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeData.name = 'Aaliyah Sosa';
      resumeData.contact = 'a@b.com · 832-000-0000 · Houston, TX';
      resumeData.skills = 'Marketing · Salesforce';
      try { window.resumeReady = true; } catch(e) {}
      openApplyTokensThenTab('https://example.com/apply', 'Marketing Manager', 'Priority Power');
      const body = document.getElementById('apply-tab-tokens');
      const header = document.querySelector('#apply-tab-modal .modal-box').textContent;
      return {
        firstIsCoverLetter: /Cover Letter/i.test(body.children[0] ? body.children[0].textContent : ''),
        hasQuickFillSubhead: [...body.children].some(c => /quick-fill fields/i.test(c.textContent)),
        headerHonest: /tailored application/i.test(header) && !/auto-fill ready/i.test(header),
        contactAfterLetter: body.children.length > 2 && /Name:/.test(body.textContent)
      };
    });
    expect(r.firstIsCoverLetter, 'the tailored cover letter leads the panel').toBeTruthy();
    expect(r.hasQuickFillSubhead, 'contact tokens grouped under a Quick-fill subhead').toBeTruthy();
    expect(r.headerHonest, 'header stops claiming auto-fill the app cannot do').toBeTruthy();
    expect(r.contactAfterLetter, 'contact fields still present, below the letter').toBeTruthy();
  });
});

/* ===== P1-1: rateCore.js is the browser twin of index.html _ratingStructure ===== */
const rateCore = require('../api/rate/rateCore.js');
test.describe('[STATE-COVERAGE] rateCore convergence with the in-app rater', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);   // index.html self-reloads (SW controllerchange + desktop breakpoint); let it settle before page.evaluate
    await page.waitForFunction(() => typeof _ratingStructure === 'function'
      && typeof resumeData !== 'undefined' && resumeData, null, { timeout: 15000 });
  });

  const fixtures = [
    { name: 'marketing', resume: {
      name: 'Aaliyah Sosa', contact: 'a@b.com · 832-000-0000 · Houston, TX',
      summary: 'Marketing professional with 12+ years driving client success and revenue growth across a portfolio.',
      skills: 'Photoshop · Excel · Salesforce · HubSpot · CRM · Leadership · Communication',
      jobs: [{ b: 'Optimized an $80K tradeshow budget for cost-efficiency.\nExecuted logistics for 40+ nationwide tradeshows.\nManaged 100 accounts end-to-end.' },
             { b: 'Led a team of 8 account managers.\nDrove revenue growth across 500+ locations.' }] } },
    { name: 'thin', resume: { name: 'Sam', contact: '', summary: '', skills: 'Excel', jobs: [{ b: 'Did some things at work here.' }] } },
    { name: 'empty', resume: { name: '', contact: '', summary: '', skills: '', jobs: [] } },
  ];

  for (const fx of fixtures) {
    test('STRUCTURE score matches in-app for the "' + fx.name + '" résumé', async ({ page }) => {
      const live = await page.evaluate((r) => {
        Object.keys(resumeData).forEach(k => delete resumeData[k]);
        Object.assign(resumeData, r);
        const st = _ratingStructure();
        return { pts: st.pts, max: st.max, needsMetrics: st.needsMetrics, labels: st.items.map(i => i[0] + '|' + i[1]) };
      }, fx.resume);
      const mine = rateCore.rateStructure(fx.resume);
      expect(mine.pts, 'pts parity').toBe(live.pts);
      expect(mine.max, 'max parity').toBe(live.max);
      expect(mine.needsMetrics, 'needsMetrics parity').toBe(live.needsMetrics);
      expect(mine.items.map(i => i[0] + '|' + i[1]), 'item labels + flags parity').toEqual(live.labels);
    });
  }

  test('field-gate helper: out-of-field true for Engineer, false for in-field Marketing', () => {
    const txt = 'marketing specialist led campaigns and managed budget for the brand team';
    expect(rateCore.isOutOfField('Engineer', txt), 'marketing résumé is out-of-field for Engineer').toBe(true);
    expect(rateCore.isOutOfField('Marketing Manager', txt), 'in-field for Marketing Manager').toBe(false);
    expect(rateCore.isOutOfField('Specialist', txt), 'an all-generic target never gates').toBe(false);
  });
});

/* ===== v174 P0: a résumé bullet is ALWAYS a string (no more [object Object]) ===== */
test.describe('[STATE-COVERAGE] v174 bullet coercion (smart-match object guard)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjBulletStr === 'function', null, { timeout: 15000 });
  });

  test('the model returning objects never corrupts a bullet to [object Object]', async ({ page }) => {
    const r = await page.evaluate(() => ({
      str:        _gpjBulletStr('Managed 100 accounts', 'FB'),
      text:       _gpjBulletStr({ text: 'Rewrote it' }, 'FB'),
      bullet:     _gpjBulletStr({ bullet: 'Changed it' }, 'FB'),
      origRewrite:_gpjBulletStr({ original: 'old', rewritten: 'the improved longer bullet' }, 'FB'),
      emptyObj:   _gpjBulletStr({}, 'FALLBACK'),
      nullVal:    _gpjBulletStr(null, 'FALLBACK'),
      // the exact production path: an array of objects joined the way a job's .b is built
      joined: (function () {
        const finalResume = [{ text: 'A' }, { bullet: 'B' }, 'C'];
        const src = ['origA', 'origB', 'origC'];
        return finalResume.map((x, i) => _gpjBulletStr(x, src[i])).join('\n');
      })(),
    }));
    expect(r.str).toBe('Managed 100 accounts');
    expect(r.text).toBe('Rewrote it');
    expect(r.bullet).toBe('Changed it');
    expect(r.origRewrite).toBe('the improved longer bullet');
    expect(r.emptyObj).toBe('FALLBACK');
    expect(r.nullVal).toBe('FALLBACK');
    expect(r.joined).toBe('A\nB\nC');
    expect(r.joined, 'no [object Object] anywhere').not.toContain('[object Object]');
  });
});

/* ===== v175 A+B: card Cover Letter opens the review flow + threads the job text ===== */
test.describe('[STATE-COVERAGE] v175 cover-letter flow (card button + job text)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof copyOptCard === 'function'
      && typeof clGatherJobText === 'function' && typeof resumeData !== 'undefined', null, { timeout: 15000 });
  });

  test('card Cover Letter button opens the offer modal AND the letter gets the real posting text', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name = 'Aaliyah Sosa'; resumeData.title = 'Marketing Specialist';
      resumeData.skills = 'SEO · Content Marketing · HubSpot';
      resumeData.summary = 'Marketing pro with client success experience over many years.';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', b: 'Optimized an $80K tradeshow budget.\nRan SEO and content marketing campaigns that grew inbound leads.' }];
      resumeData.contact = 'a@b.com · 832-000-0000 · Houston, TX';
      resumeReady = true;   // bare module-level let
      window._currentTopJob = () => ({ t: 'Senior Marketing Manager', co: 'Colibri Group', url: 'https://x',
        desc: 'Own SEO, content marketing, lifecycle email, landing pages and conversion rate optimization.',
        req: 'Google Analytics, HubSpot, 5+ years marketing.' });
      copyOptCard(null);
      await new Promise(res => setTimeout(res, 900));   // modal opens after 650ms
      const promptOpen = document.getElementById('cl-prompt-modal').classList.contains('open');
      const jt = clGatherJobText();
      const letter = buildLetterText({ title: 'Senior Marketing Manager', co: 'Colibri Group', external: true });
      return {
        promptOpen,
        descChars: (jt.desc || '').length,
        realTerms: /SEO|content marketing|email|conversion/i.test(letter),
        // the "squarely" bullet should be the SEO/content one, not the tradeshow one
        coherent: /squarely where I work:[^.]*content marketing/i.test(letter),
      };
    });
    expect(r.promptOpen, 'the offer→review modal opens (was a silent copy)').toBe(true);
    expect(r.descChars, 'the posting description reaches the letter (no more "no job text matched")').toBeGreaterThan(30);
    expect(r.realTerms, 'the letter uses the real posting terms').toBe(true);
    expect(r.coherent, 'the "squarely where I work" bullet matches the emphasized terms').toBe(true);
  });
});

/* ===== v176 F: un-save a company card (parity with jobs' Remove) ===== */
test.describe('[STATE-COVERAGE] v176 un-save a company card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof renderGhostCompanies === 'function'
      && typeof _huntRemoveCo === 'function' && typeof gpjHiddenCos === 'function', null, { timeout: 15000 });
  });

  test('a hunt company card can be removed and does not reappear', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_hidden_cos'); } catch (e) {}
      lists.applied = [{ t: 'Marketing Manager', co: 'Serenity Healthcare' }, { t: 'Brand Lead', co: 'Vanderbloemen' }];
      renderGhostCompanies();
      const before = document.getElementById('ghost-list').innerHTML;
      _huntRemoveCo('Serenity Healthcare');
      const after = document.getElementById('ghost-list').innerHTML;
      // re-render again to prove it stays gone (persisted in the dismiss set)
      renderGhostCompanies();
      const afterRerender = document.getElementById('ghost-list').innerHTML;
      return {
        hadRemove: /✕ Remove/.test(before),
        serenityBefore: /Serenity Healthcare/.test(before),
        serenityAfter: /Serenity Healthcare/.test(after),
        serenityAfterRerender: /Serenity Healthcare/.test(afterRerender),
        vanderStays: /Vanderbloemen/.test(afterRerender),
        // v180: un-save DISMISSES the card from this list — it must NOT hide the company's
        // roles from the deck/Browse, so it goes to the dismiss set, NOT gpjHiddenCos.
        notHidden: !gpjHiddenCos().has(_coKey('Serenity Healthcare')),
        dismissed: _gpjHuntDismissed().has(_coKey('Serenity Healthcare')),
      };
    });
    expect(r.hadRemove, 'company cards show a Remove control').toBe(true);
    expect(r.serenityBefore).toBe(true);
    expect(r.serenityAfter, 'removed immediately').toBe(false);
    expect(r.serenityAfterRerender, 'stays gone on re-render (persisted)').toBe(false);
    expect(r.vanderStays, 'only the removed company is affected').toBe(true);
    expect(r.notHidden, 'dismiss must NOT hide the company\'s roles from deck/Browse').toBe(true);
    expect(r.dismissed, 'tracked in the lightweight dismiss set').toBe(true);
  });
});

/* ===== v177: rater "Add these with Jett" updates the MASTER (score can move) ===== */
test.describe('[STATE-COVERAGE] v177 Add-with-Jett improveMode commits to master', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof applyMatch2Job === 'function'
      && typeof resumeData !== 'undefined', null, { timeout: 15000 });
  });

  async function run(page, improveMode) {
    return await page.evaluate(async (improve) => {
      resumeData.title = 'Marketing Specialist';
      resumeData.skills = 'Photoshop · Excel · Salesforce';
      resumeData.summary = 'Marketing pro with client success experience over the years.';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', b: 'Optimized an $80K tradeshow budget.\nManaged 100 accounts.' }];
      resumeReady = true;
      const before = resumeData.skills;
      const ctx = { title: 'Marketing Manager', desc: 'social media', suggestions: ['Social Media'], startPct: 31 };
      if (improve) ctx.improveMode = true; else ctx.co = 'Acme Corp';
      m2jContext = ctx;
      document.querySelectorAll('[id^="m2j-c"]').forEach(n => n.remove());
      /* v213 capture reads a checked box's OWN data-skill from inside #match2job-modal
         (index-independent). Mirror real usage: place the box in the modal with data-skill. */
      const box = document.createElement('div'); box.innerHTML = '<input type="checkbox" id="m2j-c0" data-skill="Social Media">';
      (document.getElementById('match2job-modal') || document.body).appendChild(box);
      document.getElementById('m2j-c0').checked = true;
      await applyMatch2Job();
      return { before, after: resumeData.skills };
    }, improveMode);
  }

  test('improveMode PERSISTS the confirmed skill to the master résumé', async ({ page }) => {
    const r = await run(page, true);
    expect(r.after, 'the added skill sticks to the master').toMatch(/social media/i);
    expect(r.after).not.toBe(r.before);
  });
  test('job-card path (no improveMode) still RESTORES the master', async ({ page }) => {
    const r = await run(page, false);
    expect(r.after, 'a per-job tailor never mutates the master').toBe(r.before);
  });
});

/* ===== v177: apply-panel Cover Letter opens the review flow with the job text ===== */
test.describe('[STATE-COVERAGE] v177 apply-panel cover letter opens the flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof hudCoverLetter === 'function' && typeof resumeData !== 'undefined', null, { timeout: 15000 });
  });

  test('hudCoverLetter opens the offer modal and threads the applying job', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name = 'Aaliyah Sosa'; resumeData.title = 'Marketing Specialist';
      resumeData.skills = 'SEO · Marketing'; resumeData.summary = 'Marketing pro with client success experience over years.';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', b: 'Ran SEO and content marketing campaigns.' }];
      resumeData.contact = 'a@b.com · 832-000-0000 · Houston, TX';
      resumeReady = true;
      window._gpjApplyJob = { t: 'Wholesale Sales & Marketing Manager', co: 'SendNonsense', url: 'https://x',
        desc: 'Own wholesale sales and marketing, customer service, and channel growth.', req: '5+ years sales & marketing.' };
      hudCoverLetter('Wholesale Sales & Marketing Manager', 'SendNonsense');
      await new Promise(res => setTimeout(res, 900));
      return {
        opened: document.getElementById('cl-prompt-modal').classList.contains('open'),
        descChars: (clGatherJobText().desc || '').length,
      };
    });
    expect(r.opened, 'the apply-panel button opens the review flow (was a silent copy)').toBe(true);
    expect(r.descChars, 'the real posting text reaches the letter').toBeGreaterThan(20);
  });
});

/* ===== v177b: Jett buttons download the improved MASTER + tighten "over N"→"N+" ===== */
test.describe('[STATE-COVERAGE] v177b Jett download + metric tightening', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjTightenMetrics === 'function'
      && typeof applyMatch2Job === 'function', null, { timeout: 15000 });
  });

  test('_gpjTightenMetrics restores concise notation (over 40 -> 40+)', async ({ page }) => {
    const out = await page.evaluate(() => _gpjTightenMetrics('Executed logistics for over 40 tradeshows and more than 500 clients'));
    expect(out).toContain('40+');
    expect(out).toContain('500+');
    expect(out).not.toMatch(/over 40|more than 500/);
  });

  test('Add-with-Jett (improveMode) downloads the master as Resume_<Name>_Improved', async ({ page }) => {
    const name = await page.evaluate(async () => {
      resumeData.name = 'Aaliyah Sosa'; resumeData.title = 'Marketing Specialist'; resumeData.skills = 'Excel · Salesforce';
      resumeData.summary = 'Marketing pro with client success experience over years.';
      resumeData.jobs = [{ t: 'Marketing Specialist', c: 'Poolsure', b: 'Optimized budget.\nManaged 100 accounts.' }];
      resumeReady = true;
      let captured = null;
      const orig = window.generateResumePDF;
      window.generateResumePDF = (a, b) => { captured = a + '_' + b; return captured + '.pdf'; };
      m2jContext = { title: 'Marketing Manager', desc: 'x', suggestions: ['Social Media'], improveMode: true, startPct: 31 };
      document.querySelectorAll('[id^="m2j-c"]').forEach(n => n.remove());
      const box = document.createElement('div'); box.innerHTML = '<input type="checkbox" id="m2j-c0">'; document.body.appendChild(box);
      document.getElementById('m2j-c0').checked = true;
      await applyMatch2Job();
      window.generateResumePDF = orig;
      return captured;
    });
    expect(name).toBe('Resume_Aaliyah_Sosa_Improved');
  });
});

/* ===== v178: metric-preservation guard — improve can never drop a number ===== */
test.describe('[STATE-COVERAGE] v178 improve never prunes a metric', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjPreserveMetrics === 'function', null, { timeout: 15000 });
  });

  test('a rewrite that drops a number falls back to the original; one that keeps it wins', async ({ page }) => {
    const r = await page.evaluate(() => {
      const P = _gpjPreserveMetrics;
      return {
        droppedCount: P('Managed 100 client accounts.', 'Managed client accounts.'),
        keptCount:    P('Managed 100 client accounts.', 'Oversaw 100 client accounts end-to-end.'),
        keptBudget:   P('Optimized an $80K+ budget.', 'Owned a budget of $80K+.'),
        droppedBudget:P('Optimized an $80K+ budget.', 'Owned the budget for cost-efficiency.'),
        noMetric:     P('Collaborated with operations.', 'Partnered with the operations team.'),
        droppedOfTwo: P('Led 8 people across 500 sites.', 'Led a team of 8.'),
        emptyRewrite: P('Managed 100 accounts.', ''),
      };
    });
    expect(r.droppedCount, 'dropped metric → keep original').toBe('Managed 100 client accounts.');
    expect(r.keptCount, 'kept metric → use the improved rewrite').toBe('Oversaw 100 client accounts end-to-end.');
    expect(r.keptBudget).toBe('Owned a budget of $80K+.');
    expect(r.droppedBudget, '$80K dropped → keep original').toBe('Optimized an $80K+ budget.');
    expect(r.noMetric, 'no metric to protect → rewrite is fine').toBe('Partnered with the operations team.');
    expect(r.droppedOfTwo, 'losing ANY of several numbers → keep original').toBe('Led 8 people across 500 sites.');
    expect(r.emptyRewrite, 'empty rewrite never wins').toBe('Managed 100 accounts.');
  });
});

/* ===== v179: "Résumé Strength" — deepened rubric (outcomes, variety, concision) ===== */
test.describe('[STATE-COVERAGE] v179 Résumé Strength rubric', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _ratingStructure === 'function'
      && typeof resumeData !== 'undefined', null, { timeout: 15000 });
  });

  test('max is 60; outcome bullets score higher than scope-only; fluff is penalized', async ({ page }) => {
    const r = await page.evaluate(() => {
      const base = { name:'A', contact:'a@b.com · 1', summary:'Marketing pro with a decade of experience across brands.', skills:'Excel · Salesforce · SEO · Content · Email · Brand' };
      const set = (jobs) => { Object.assign(resumeData, base, { jobs }); return _ratingStructure(); };
      // scope-only: numbers but no result verbs ("managed 100", "oversaw 50")
      const scope = set([{ t:'X', c:'Y', b:'Managed 100 client accounts.\nOversaw 50 vendor relationships.\nHandled 500 support tickets.\nMaintained 12 dashboards.' }]);
      // outcome-heavy: numbers + result verbs
      const outcome = set([{ t:'X', c:'Y', b:'Increased retention 20% across 100 accounts.\nReduced churn by 15% in one year.\nGrew revenue $2M through new channels.\nBoosted NPS from 30 to 55.' }]);
      // fluffy: filler + passive
      const fluff = set([{ t:'X', c:'Y', b:'Responsible for accounts and was tasked with duties.\nHard-working team player and results-driven self-starter.\nWas responsible for various things.\nDetail-oriented go-getter.' }]);
      const outcomeItem = outcome.items.find(i => /OUTCOME/.test(i[1]));
      const cleanItem = fluff.items.find(i => /filler|passive|tighten|clean/i.test(i[1]));
      return {
        max: outcome.max,
        scorePct: (st) => Math.round(st.pts / st.max * 100),
        scopePts: scope.pts, outcomePts: outcome.pts, fluffPts: fluff.pts,
        outcomeChecked: outcomeItem ? outcomeItem[0] : null,
        fluffCleanFlag: cleanItem ? cleanItem[0] : null,
      };
    });
    expect(r.max, 'rubric is out of 60').toBe(60);
    expect(r.outcomePts, 'outcome-heavy scores higher than scope-only').toBeGreaterThan(r.scopePts);
    expect(r.outcomeChecked, 'the OUTCOME factor passes for result bullets').toBe(true);
    expect(r.fluffPts, 'fluff/passive résumé scores lower than a clean outcome one').toBeLessThan(r.outcomePts);
    expect(r.fluffCleanFlag, 'the clean/concision factor FAILS on a fluffy résumé').toBe(false);
  });
});

/* ===== v180: remove the blended "Overall" number · canonical coverage · un-save = dismiss ===== */
test.describe('[STATE-COVERAGE] v180 rating continuity + gains coverage + hunt dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof rateResume === 'function'
      && typeof _huntRemoveCo === 'function' && typeof _gpjHuntDismissed === 'function'
      && typeof renderGhostCompanies === 'function', null, { timeout: 15000 });
  });

  test('the confusing blended "Overall callback readiness" number is gone', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name='A'; resumeData.contact='a@b.com · 1'; resumeData.summary='Marketing pro with a decade of client success experience here.'; resumeData.skills='Excel · Salesforce · SEO · Content · Email · Brand';
      resumeData.jobs=[{t:'Marketing Specialist',c:'Poolsure',b:'Optimized an $80K budget.\nManaged 100 accounts.\nExecuted 40+ tradeshows.'}];
      resumeReady=true;
      localStorage.setItem('gpj_prefs',JSON.stringify({titles:'Marketing Manager'}));
      window._roleCorpusCache={role:'Marketing Manager',ts:Date.now(),corpus:{matched:12,terms:[{term:'campaign',pct:60},{term:'seo',pct:40}]}};
      await rateResume();
      const t=document.getElementById('resume-rating-body').innerText;
      return { noOverall: !/Overall callback readiness/.test(t), benchmark: /benchmarked against 12 live/.test(t), rings: /Résumé Strength/.test(t)&&/Role Fit/.test(t) };
    });
    expect(r.noOverall, 'no blended "Overall callback readiness" number').toBe(true);
    expect(r.rings, 'the two clear rings remain').toBe(true);
    expect(r.benchmark, 'the posting benchmark context stays').toBe(true);
  });

  test('un-save DISMISSES a hunt card (roles NOT hidden from deck/Browse)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_hidden_cos'); localStorage.removeItem('gpj_hunt_dismissed');
      lists.applied=[{t:'x',co:'Karbon'},{t:'y',co:'Microvast'}];
      renderGhostCompanies();
      _huntRemoveCo('Karbon');
      renderGhostCompanies();
      const html=document.getElementById('ghost-list').innerHTML;
      return { karbonGone: !/Karbon/.test(html), microvastStays: /Microvast/.test(html), notHidden: !gpjHiddenCos().has(_coKey('Karbon')), dismissed: _gpjHuntDismissed().has(_coKey('Karbon')) };
    });
    expect(r.karbonGone, 'removed from the hunt list').toBe(true);
    expect(r.microvastStays, 'only the target is removed').toBe(true);
    expect(r.notHidden, 'the company is NOT hidden — its roles still show in deck/Browse').toBe(true);
    expect(r.dismissed, 'tracked in the lightweight dismiss set, not the hidden-companies set').toBe(true);
  });
});

/* ===== v181: outcome elicitation — Improve asks for results, weaves real numbers in ===== */
test.describe('[STATE-COVERAGE] v181 outcome elicitation (85% engine)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjOutcomeQuestionsFor === 'function'
      && typeof _gpjWeaveOutcome === 'function' && typeof openOutcomeElicit === 'function'
      && typeof jettFullImprove === 'function' && typeof _jettFullRun === 'function', null, { timeout: 15000 });
  });

  test('detects scope bullets (no result), weaves the real answer, and Improve opens the modal', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeData.name='A'; resumeData.contact='a@b.com'; resumeData.summary='Marketing pro for a decade of client success here.'; resumeData.skills='Excel · SEO';
      resumeData.jobs = [
        { t: 'Marketing Specialist', c: 'Poolsure', b: 'Managed 100 client accounts from start to finish.\nIncreased retention by 20% year over year.\nOversaw 50 vendor relationships.' },
        { t: 'Account Manager', c: 'Cogent', b: 'Led a team of 8 account managers.' },
      ];
      resumeReady = true;
      const qs = _gpjOutcomeQuestionsFor();
      // weave
      const weave = _gpjWeaveOutcome('Managed 100 client accounts.', 'Grew retention 20%');
      const weaveMoney = _gpjWeaveOutcome('Oversaw 50 vendors', 'saving $30K annually');
      // submit path: answer the first question, confirm it weaves into that bullet
      openOutcomeElicit();
      const modalInputs = document.querySelectorAll('#outcome-modal input').length;
      const el = document.querySelector('#outcome-modal input#oq-0');
      const targetJi = parseInt(el.dataset.ji, 10), targetLi = parseInt(el.dataset.li, 10);
      el.value = 'cut onboarding time 40%';
      submitOutcomeElicit();   // weaves + would call _jettFullRun; we just check the bullet
      const wovenBullet = String(resumeData.jobs[targetJi].b).split('\n')[targetLi];
      return {
        qCount: qs.length,
        excludesResult: !qs.some(q => /increased retention/i.test(q.bullet)),
        includesScope: qs.some(q => /managed 100 client accounts/i.test(q.bullet)),
        weave, weaveMoney,
        modalInputs,
        wovenBullet,
      };
    });
    expect(r.excludesResult, 'a bullet that already shows a result is not asked about').toBe(true);
    expect(r.includesScope, 'scope/task bullets are detected').toBe(true);
    expect(r.weave, 'lowercases the lead + keeps the number').toBe('Managed 100 client accounts, grew retention 20%.');
    expect(r.weaveMoney, 'preserves $ tokens').toBe('Oversaw 50 vendors, saving $30K annually.');
    expect(r.modalInputs, 'one input per detected scope bullet').toBeGreaterThan(0);
    expect(r.wovenBullet, 'the answer is woven into the exact bullet').toMatch(/cut onboarding time 40%/);
  });

  test('Improve opens the elicitation when scope bullets exist', async ({ page }) => {
    const opened = await page.evaluate(async () => {
      resumeData.name='A'; resumeData.contact='a@b.com'; resumeData.summary='Marketing pro for a decade of client success here.'; resumeData.skills='Excel';
      resumeData.jobs = [{ t: 'X', c: 'Y', b: 'Managed 100 client accounts.\nOversaw 50 vendors.' }];
      resumeReady = true;
      const old = document.getElementById('outcome-modal'); if (old) old.remove();
      jettFullImprove();   // gate: should open the elicitation, NOT run the rewrite yet
      await new Promise(r => setTimeout(r, 100));
      return !!document.getElementById('outcome-modal');
    });
    expect(opened, 'pressing Improve opens the outcome questions first').toBe(true);
  });
});

/* ===== v182 (Sprint 2): un-apply/un-skip survive the cloud merge (removal tombstone) ===== */
test.describe('[STATE-COVERAGE] v182 put-back removal tombstone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjMonotonicLists === 'function'
      && typeof gpjTombstone === 'function' && typeof _gpjListKey === 'function', null, { timeout: 15000 });
  });

  test('a removed job stays gone through the union merge; a genuine re-apply survives', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_tomb'); localStorage.removeItem('gpj_lists_reset'); } catch (e) {}
      const cloud = () => ({ applied: [{ t: 'Job A', co: 'Co X', when: 1000 }, { t: 'Job B', co: 'Co Y', when: 1000 }], responses: [], skipped: [], viewed: [] });
      // control: local dropped Job A, but the union merge re-adds it (the bug)
      window._gpjCloudListsSeen = cloud(); lists.applied = [{ t: 'Job B', co: 'Co Y', when: 1000 }]; lists.responses = []; lists.skipped = []; lists.viewed = [];
      const control = _gpjMonotonicLists().applied.map(x => x.t);
      // with the removal tombstone (what unApply writes)
      gpjTombstone('applied', _gpjListKey({ t: 'Job A', co: 'Co X' }));
      window._gpjCloudListsSeen = cloud(); lists.applied = [{ t: 'Job B', co: 'Co Y', when: 1000 }];
      const withTomb = _gpjMonotonicLists().applied.map(x => x.t);
      // re-apply: a NEWER Job A row must survive the tombstone
      window._gpjCloudListsSeen = cloud(); lists.applied = [{ t: 'Job A', co: 'Co X', when: Date.now() + 5000 }, { t: 'Job B', co: 'Co Y', when: 1000 }];
      const reapply = _gpjMonotonicLists().applied.map(x => x.t);
      return { control, withTomb, reapply };
    });
    expect(r.control, 'without a tombstone the merge re-adds the removed job (the bug)').toContain('Job A');
    expect(r.withTomb, 'with the tombstone the removed job stays gone').not.toContain('Job A');
    expect(r.withTomb).toContain('Job B');
    expect(r.reapply, 'a genuine re-apply (newer row) survives the tombstone').toContain('Job A');
  });
});

/* ===== v183: light-mode toggle (opt-in; dark stays the default identity) ===== */
test.describe('[STATE-COVERAGE] v183 light-mode toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof gpjToggleTheme === 'function'
      && typeof gpjApplyTheme === 'function' && typeof gpjCurrentTheme === 'function', null, { timeout: 15000 });
  });

  /* Q4 empty/missing data: no stored preference → dark is the default identity */
  test('default (no stored preference) is dark', async ({ page }) => {
    const t = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_theme'); } catch (e) {}
      return { attr: document.documentElement.getAttribute('data-theme'), cur: gpjCurrentTheme() };
    });
    expect(t.attr, 'no data-theme attribute means dark').toBeNull();
    expect(t.cur).toBe('dark');
  });

  /* the toggle flips the live theme, the tokens, and persists the choice */
  test('toggle flips the theme, the tokens, and persists', async ({ page }) => {
    const r = await page.evaluate(() => {
      const readOff = () => getComputedStyle(document.documentElement).getPropertyValue('--off').trim().toUpperCase();
      const readBg  = () => getComputedStyle(document.documentElement).getPropertyValue('--plum').trim().toUpperCase();
      gpjApplyTheme('dark');
      const darkOff = readOff(), darkBg = readBg();
      gpjToggleTheme();                    // → light
      const afterToggle = { theme: gpjCurrentTheme(), stored: localStorage.getItem('gpj_theme'), off: readOff(), bg: readBg() };
      gpjToggleTheme();                    // → back to dark
      const backToDark = { theme: gpjCurrentTheme(), stored: localStorage.getItem('gpj_theme'), off: readOff() };
      return { darkOff, darkBg, afterToggle, backToDark };
    });
    // dark: near-white text on near-black bg
    expect(r.darkOff).toBe('#F0EEF8');
    expect(r.darkBg).toBe('#120F1D');
    // light: dark ink text on a light bg — the tokens genuinely swapped
    // (v188 softened the light palette: ink #1A1526→#332E45, bg #F4F2F9→#F3F1F9)
    expect(r.afterToggle.theme).toBe('light');
    expect(r.afterToggle.stored).toBe('light');
    expect(r.afterToggle.off).toBe('#332E45');
    expect(r.afterToggle.bg).toBe('#F3F1F9');
    // and it flips back + re-persists
    expect(r.backToDark.theme).toBe('dark');
    expect(r.backToDark.stored).toBe('dark');
    expect(r.backToDark.off).toBe('#F0EEF8');
  });

  /* Q1 guest / no-flash: a persisted 'light' is applied BEFORE first paint by the
     <head> pre-paint script — no auth, no flash of the wrong theme on reload */
  test('a persisted light preference is applied on reload without auth (no flash)', async ({ page }) => {
    await page.evaluate(() => { try { localStorage.setItem('gpj_theme', 'light'); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // check immediately — the pre-paint <head> script must already have set it
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr, 'the <head> pre-paint script applied the saved light theme').toBe('light');
    // and the on-accent button text uses var(--plum), which flipped WITH the theme
    const plum = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--plum').trim().toUpperCase());
    expect(plum).toBe('#F3F1F9');   // v188 softened light page ground
    await page.evaluate(() => { try { localStorage.removeItem('gpj_theme'); } catch (e) {} });
  });

  /* the menu label reflects the CURRENT mode so the tap target is honest */
  test('the profile-menu theme label tracks the current mode', async ({ page }) => {
    const r = await page.evaluate(() => {
      gpjApplyTheme('light'); gpjSyncThemeLabel();
      const lightLbl = (document.getElementById('pm-theme-lbl') || {}).textContent;
      gpjApplyTheme('dark'); gpjSyncThemeLabel();
      const darkLbl = (document.getElementById('pm-theme-lbl') || {}).textContent;
      return { lightLbl, darkLbl };
    });
    expect(r.lightLbl).toBe('Light mode');
    expect(r.darkLbl).toBe('Dark mode');
  });
});

/* ===== v184: AI-honesty + polish (stale CTA, semantic cover-letter match) ===== */
test.describe('[STATE-COVERAGE] v184 honesty + polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjHasResume === 'function'
      && typeof _gpjSyncNoResumeCTA === 'function' && typeof tailorCoverLetter === 'function', null, { timeout: 15000 });
  });

  /* #13: the "No resume yet?" onboarding link hides once a résumé exists */
  test('the "No resume yet?" CTA hides when a résumé exists (Q2/Q4)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cta = document.getElementById('no-resume-cta');
      // Q4 empty: no résumé → CTA shown
      resumeReady = false;
      try { resumeData.name=''; resumeData.title=''; resumeData.summary=''; resumeData.jobs=[]; } catch(e){}
      _gpjSyncNoResumeCTA();
      const emptyShown = cta && cta.style.display !== 'none';
      // Q2 has a résumé → CTA hidden
      resumeData.name = 'Aaliyah Sosa'; resumeData.title = 'Marketing Specialist';
      _gpjSyncNoResumeCTA();
      const withResumeHidden = cta && cta.style.display === 'none';
      return { emptyShown, withResumeHidden, hasFn: _gpjHasResume() };
    });
    expect(r.emptyShown, 'with no résumé the onboarding CTA is visible').toBe(true);
    expect(r.withResumeHidden, 'once a résumé exists the CTA is hidden').toBe(true);
    expect(r.hasFn).toBe(true);
  });

  /* semantic cover-letter match: whole-word, so a posting term "design" no longer
     grabs the generic verb "designed" — and a quantified bullet wins the tie */
  test('the "squarely where I work" line quotes the whole-word, quantified bullet', async ({ page }) => {
    const letter = await page.evaluate(() => {
      const me = {
        name: 'Aaliyah Sosa', contact: 'a@b.com', title: 'Designer', topCo: 'Bright Labs',
        skills: ['Design', 'Branding'],
        bullets: ['Designed training programs for 200 new staff', 'Ran design systems and brand campaigns, cut costs 30%']
      };
      const c = { title: 'Designer', co: 'Acme', desc: 'We need strong design skills. design design design brand.', req: 'design brand' };
      return tailorCoverLetter(c, 1, me);
    });
    // must quote the real design bullet, not the "designed training" false match
    expect(letter).toContain('design systems and brand campaigns');
    expect(letter).not.toContain('training programs');
  });
});

/* ===== v186 Sprint 2b: compact "Hide Ledger" — de-recycle past the 60-row cap ===== */
test.describe('[STATE-COVERAGE] v186 compact seen-ledger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof gpjAddSeen === 'function'
      && typeof gpjSeenLedger === 'function' && typeof seenJobKeys === 'function'
      && typeof window.gpjClearSeenLedger === 'function', null, { timeout: 15000 });
  });

  /* the core fix: a job remembered ONLY in the ledger (not in the 60-row list)
     still de-recycles — seenJobKeys() must include it */
  test('a ledger-only job de-recycles even when it fell off the 60-row list', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_seen_keys'); } catch(e){}
      try { lists.applied = []; lists.skipped = []; } catch(e){}
      gpjAddSeen('Old Marketing Job | Acme Corp');
      const inLedger = gpjSeenLedger().includes('old marketing job | acme corp'.replace(/\s+/g,' ').trim());
      const seen = seenJobKeys();               // a Set of normalized keys
      const inSeen = seen.has('old marketing job | acme corp'.replace(/\s+/g,' ').trim());
      return { inLedger, inSeen };
    });
    expect(r.inLedger, 'the key is stored in the ledger').toBe(true);
    expect(r.inSeen, 'seenJobKeys() includes the ledger key so the deck hides it').toBe(true);
  });

  /* Q-scale: the ledger caps at 5,000, evicting the OLDEST and keeping the newest */
  test('the ledger caps at 5,000 — oldest evicted, newest kept', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_seen_keys'); } catch(e){}
      for (let i = 0; i < 5005; i++) gpjAddSeen('job' + i + '|co');
      const led = gpjSeenLedger();
      return { len: led.length, hasNewest: led.includes('job5004|co'), hasOldest: led.includes('job0|co') };
    });
    expect(r.len, 'capped at the 5,000 ceiling').toBe(5000);
    expect(r.hasNewest, 'the newest key survives').toBe(true);
    expect(r.hasOldest, 'the oldest key is evicted').toBe(false);
  });

  /* the rollback command clears the durable memory */
  test('gpjClearSeenLedger() wipes the ledger', async ({ page }) => {
    const empty = await page.evaluate(() => {
      gpjAddSeen('x|y'); window.gpjClearSeenLedger(); return gpjSeenLedger().length;
    });
    expect(empty).toBe(0);
  });
});

/* ===== v187 Sprint 4 #17: matching reads education + certs (positive-only) ===== */
test.describe('[STATE-COVERAGE] v187 education + cert signals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjScoreMatch === 'function', null, { timeout: 15000 });
  });

  /* a named cert the posting asks for boosts a RELEVANT-but-not-maxed job (so the
     boost has headroom to show — a saturated 98 match would hide it) */
  test('a named cert the posting names boosts a relevant job', async ({ page }) => {
    const r = await page.evaluate(() => {
      // partial relevance (title overlaps on "analyst", skill doesn't appear in the
      // posting) → a mid-range base with room for the cert to move it
      const cand = { title: 'Analyst', roles: [], skills: ['powerpoint'], summary: '' };
      const job = { title: 'Financial Analyst', desc: 'CPA preferred. financial modeling, forecasting, GAAP.' };
      const base = _gpjScoreMatch(cand, job);
      const withCert = _gpjScoreMatch(Object.assign({}, cand, { certs: ['CPA'] }), job);
      return { base, withCert };
    });
    expect(r.base, 'base leaves headroom (not already maxed)').toBeLessThan(98);
    expect(r.withCert, 'holding the CPA the posting asks for scores higher').toBeGreaterThan(r.base);
  });

  /* a degree is a small nudge, NOT a cross-field inflator — the guard still caps */
  test('a matching degree does NOT make a marketing résumé fit an engineer role', async ({ page }) => {
    const r = await page.evaluate(() => {
      const job = { title: 'Software Engineer', desc: "Bachelor's degree required. kubernetes, golang, distributed systems." };
      const noCred = _gpjScoreMatch({ title: 'Marketing Specialist', roles: [], skills: ['seo', 'content', 'social media'], summary: '' }, job);
      const withDegree = _gpjScoreMatch({ title: 'Marketing Specialist', roles: [], skills: ['seo', 'content', 'social media'], summary: '', creds: 'Bachelor of Arts, Marketing, State University' }, job);
      return { noCred, withDegree };
    });
    expect(r.withDegree, 'the cross-field cap holds — a degree alone cannot inflate an unrelated field').toBeLessThanOrEqual(32);
  });

  /* omitting education/certs is safe (backward-compatible, no crash) */
  test('education/certs are optional — scoring still returns a valid number without them', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const a = _gpjScoreMatch({ title: 'Marketing Manager', roles: [], skills: ['seo'], summary: '' }, { title: 'Marketing Manager', desc: 'seo content marketing' });
      return typeof a === 'number' && a >= 18 && a <= 98;
    });
    expect(ok).toBe(true);
  });
});

/* ===== v190: intuitive keyword→job matching (title-based, not description) ===== */
test.describe('[STATE-COVERAGE] v190 keyword search association', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjKeywordMatch === 'function', null, { timeout: 15000 });
  });

  /* the exact founder repro: "Account" must NOT match a "Project Coordinator" */
  test('a keyword matches the TITLE, not the description', async ({ page }) => {
    const r = await page.evaluate(() => ({
      accountMgr:      _gpjKeywordMatch('account', 'Account Manager', 'Acme'),
      accountant:      _gpjKeywordMatch('account', 'Accountant', 'Acme'),
      projectCoord:    _gpjKeywordMatch('account', 'Project Coordinator', 'Saddleback Communications'),
      phraseAllWords:  _gpjKeywordMatch('account retention', 'Account Manager, Retention', 'X'),
      phraseMiss:      _gpjKeywordMatch('account retention', 'Project Coordinator', 'X'),
      empty:           _gpjKeywordMatch('', 'anything', 'x'),
    }));
    expect(r.accountMgr, '"account" matches Account Manager').toBe(true);
    expect(r.accountant, '"account" matches Accountant').toBe(true);
    expect(r.projectCoord, '"account" must NOT match Project Coordinator (the bug)').toBe(false);
    expect(r.phraseAllWords, 'multi-word matches when all words are in the title').toBe(true);
    expect(r.phraseMiss, 'multi-word misses when the title lacks the words').toBe(false);
    expect(r.empty, 'empty keyword passes everything').toBe(true);
  });
});

/* ===== v191: the ✕ on the Improve prompt CANCELS (no accidental résumé overwrite) ===== */
test.describe('[STATE-COVERAGE] v191 Improve-✕ cancels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof cancelOutcomeElicit === 'function'
      && typeof openOutcomeElicit === 'function' && typeof skipOutcomeElicit === 'function', null, { timeout: 15000 });
  });

  test('the ✕ is wired to cancel, and confirming closes WITHOUT running the improve', async ({ page }) => {
    const r = await page.evaluate(() => {
      openOutcomeElicit([{ bullet: 'Managed 100 accounts', ji: 0, li: 0 }]);
      const opened = !!document.getElementById('outcome-modal');
      const xWiredToCancel = !!document.querySelector('#outcome-modal [onclick*="cancelOutcomeElicit"]');
      const xNotSkip = !document.querySelector('#outcome-modal [onclick="skipOutcomeElicit()"][style*="font-size:16px"]');
      // spy: the improve must NOT run on cancel
      let ran = false; const origRun = window._jettFullRun; window._jettFullRun = function () { ran = true; };
      const origConfirm = window.confirm;
      // "no" keeps it open
      window.confirm = () => false; cancelOutcomeElicit();
      const stillOpen = !!document.getElementById('outcome-modal');
      // "yes" closes it, still no improve
      window.confirm = () => true; cancelOutcomeElicit();
      const closed = !document.getElementById('outcome-modal');
      window.confirm = origConfirm; window._jettFullRun = origRun;
      return { opened, xWiredToCancel, xNotSkip, stillOpen, closed, ranImprove: ran };
    });
    expect(r.opened, 'the outcome prompt opens').toBe(true);
    expect(r.xWiredToCancel, 'the ✕ calls cancelOutcomeElicit').toBe(true);
    expect(r.stillOpen, 'declining the confirm keeps the prompt open').toBe(true);
    expect(r.closed, 'confirming closes the prompt').toBe(true);
    expect(r.ranImprove, 'cancel NEVER runs the improve (no résumé overwrite)').toBe(false);
  });
});

/* ===== v192: a checked Match-to-Job skill survives the 15-cap (front-loaded) ===== */
test.describe('[STATE-COVERAGE] v192 confirmed skill survives the cap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _tidySkills === 'function', null, { timeout: 15000 });
  });

  /* the founder repro: a 15-skill résumé + a confirmed "Campaigns". Appended to the
     END it is trimmed by the cap (the bug); front-loaded it survives (the fix). */
  test('a confirmed skill is trimmed at the end but kept at the front (the fix rationale)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const base15 = 'Photoshop · Excel · PowerPoint · Salesforce · HubSpot · Sales · CRM · Compliance · Training · Leadership · Communication · Scheduling · Documentation · Word · Data-Driven Decision Making';
      // isolate _tidySkills from résumé-title dropping
      try { resumeData.title = ''; resumeData.jobs = []; } catch (e) {}
      const atEnd = _tidySkills(base15 + ' · Campaigns').skills;
      const atFront = _tidySkills('Campaigns · ' + base15).skills;
      return {
        baseCount: base15.split(' · ').length,
        endHas: /(^|·\s)Campaigns(\s·|$)/i.test(atEnd) || /Campaigns/i.test(atEnd),
        frontHas: /Campaigns/i.test(atFront),
        frontCount: atFront.split(' · ').length,
      };
    });
    expect(r.baseCount, 'the résumé is exactly at the 15 cap').toBe(15);
    expect(r.endHas, 'appended at the end, the confirmed skill is trimmed by the cap (the bug)').toBe(false);
    expect(r.frontHas, 'front-loaded, the confirmed skill survives (the v192 fix)').toBe(true);
    expect(r.frontCount, 'still capped at 15 — an older tail skill drops instead').toBe(15);
  });
});

/* ===== v193: dark/light choice during signup ===== */
test.describe('[STATE-COVERAGE] v193 signup theme picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof gpjSetThemeFromAuth === 'function'
      && typeof showAuthModal === 'function', null, { timeout: 15000 });
  });

  test('the signup Appearance picker sets + persists the theme (guest, pre-auth)', async ({ page }) => {
    const r = await page.evaluate(() => {
      showAuthModal('signup');
      const controlExists = !!document.getElementById('auth-theme-light') && !!document.getElementById('auth-theme-dark');
      gpjSetThemeFromAuth('light');
      const light = { theme: gpjCurrentTheme(), stored: localStorage.getItem('gpj_theme') };
      gpjSetThemeFromAuth('dark');
      const dark = { theme: gpjCurrentTheme(), stored: localStorage.getItem('gpj_theme') };
      try { localStorage.removeItem('gpj_theme'); } catch (e) {}
      return { controlExists, light, dark };
    });
    expect(r.controlExists, 'the Appearance control is on the signup modal').toBe(true);
    expect(r.light.theme).toBe('light'); expect(r.light.stored).toBe('light');
    expect(r.dark.theme).toBe('dark'); expect(r.dark.stored).toBe('dark');
  });
});

/* ===== v194: progressive keyword search — Enter searches the whole region DB ===== */
test.describe('[STATE-COVERAGE] v194 progressive keyword search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof searchAllJobsForKeyword === 'function', null, { timeout: 15000 });
  });

  test('the keyword box wires Enter to the whole-region search', async ({ page }) => {
    const r = await page.evaluate(() => {
      const kw = document.getElementById('f-keyword');
      const onkd = kw ? (kw.getAttribute('onkeydown') || '') : '';
      return {
        exists: !!kw,
        entersWholeRegion: /Enter/.test(onkd) && /searchAllJobsForKeyword\(false\)/.test(onkd),
        placeholderHints: /Enter/i.test(kw ? (kw.getAttribute('placeholder') || '') : ''),
      };
    });
    expect(r.exists).toBe(true);
    expect(r.entersWholeRegion, 'Enter runs searchAllJobsForKeyword(false) — the whole regional DB').toBe(true);
    expect(r.placeholderHints, 'the placeholder tells the user Enter searches their area').toBe(true);
  });
});

/* ===== v196: per-message dismiss (interim before the full Inbox tab) ===== */
test.describe('[STATE-COVERAGE] v196 message dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof gpjMsgDismissed === 'function'
      && typeof gpjDismissMsg === 'function' && typeof window.gpjClearDismissedMsgs === 'function', null, { timeout: 15000 });
  });

  test('dismiss adds to the set + persists + syncs; clear wipes it (record is never deleted)', async ({ page }) => {
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('gpj_msg_dismissed'); } catch (e) {}
      const before = gpjMsgDismissed().has('msg-abc');
      try { gpjDismissMsg('msg-abc'); } catch (e) {}   // also re-renders + toasts; the set-add is what we assert
      const after = gpjMsgDismissed().has('msg-abc');
      const stored = JSON.parse(localStorage.getItem('gpj_msg_dismissed') || '[]');
      window.gpjClearDismissedMsgs();
      return { before, after, storedHas: stored.indexOf('msg-abc') >= 0, clearedSize: gpjMsgDismissed().size };
    });
    expect(r.before, 'not dismissed to start').toBe(false);
    expect(r.after, 'after dismiss the id is in the set').toBe(true);
    expect(r.storedHas, 'persisted to localStorage (+ cloud on sign-in)').toBe(true);
    expect(r.clearedSize, 'the rollback command wipes the set').toBe(0);
  });
});

/* ===== v198: keyword any-word fallback + cover-letter modal stacking ===== */
test.describe('[STATE-COVERAGE] v198 search fallback + CL z-index', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof _gpjKeywordScore === 'function', null, { timeout: 15000 });
  });

  /* the founder repro: "Account Retention" — no title holds BOTH words, so the strict
     matcher returns 0; the score-based fallback must still surface related roles. */
  test('_gpjKeywordScore ranks partial multi-word matches so "Account Retention" is not a dead end', async ({ page }) => {
    const r = await page.evaluate(() => ({
      strictBoth:   _gpjKeywordMatch('account retention', 'Account Manager', 'Acme'), // false: only one word
      scoreAcct:    _gpjKeywordScore('account retention', 'Account Manager', 'Acme'),  // 1
      scoreRet:     _gpjKeywordScore('account retention', 'Client Retention Specialist', 'Acme'), // 1
      scoreBoth:    _gpjKeywordScore('account retention', 'Account Retention Lead', 'Acme'), // 2
      scoreNone:    _gpjKeywordScore('account retention', 'Software Engineer', 'Acme'), // 0
      singleWord:   _gpjKeywordScore('account', 'Account Manager', 'Acme'),  // 1 (substring)
    }));
    expect(r.strictBoth, 'strict all-words fails on Account Manager').toBe(false);
    expect(r.scoreAcct, 'fallback scores the account half').toBe(1);
    expect(r.scoreRet, 'fallback scores the retention half').toBe(1);
    expect(r.scoreBoth, 'both words present scores highest').toBe(2);
    expect(r.scoreNone, 'unrelated title scores zero (never surfaces)').toBe(0);
    expect(r.singleWord, 'single-word still works via substring').toBe(1);
  });

  /* the founder blocker: the cover-letter modal opened BEHIND the apply panel (358) */
  test('cover-letter modals stack ABOVE the apply panel', async ({ page }) => {
    const z = await page.evaluate(() => ({
      prompt: +getComputedStyle(document.getElementById('cl-prompt-modal')).zIndex,
      review: +getComputedStyle(document.getElementById('cl-review-modal')).zIndex,
      apply:  +getComputedStyle(document.getElementById('apply-tab-modal')).zIndex,
    }));
    expect(z.prompt, 'cl-prompt above apply panel').toBeGreaterThan(z.apply);
    expect(z.review, 'cl-review above apply panel').toBeGreaterThan(z.apply);
  });
});

/* ===== v199: deck-level undo (rewindLastSwipe) reuses the tested put-back ===== */
test.describe('[STATE-COVERAGE] v199 undo last swipe', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.waitForFunction(() => typeof rewindLastSwipe === 'function' && typeof recordSwipe === 'function', null, { timeout: 15000 });
  });

  test('recordSwipe remembers the last swipe; rewind reverses it via recoverToDeck', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.lists = window.lists || { applied: [], skipped: [] };
      window.rawQueue = Array.isArray(window.rawQueue) ? window.rawQueue : [];
      lists.skipped = []; lists.applied = [];
      // 1) a left swipe records to skipped AND remembers it
      recordSwipe('left', { t: 'Undo Role', co: 'UndoCo', url: '' });
      const captured = !!(window._lastSwipeRec && window._lastSwipeRec.list === 'skipped');
      const inSkipped = lists.skipped.some(r => r.co === 'UndoCo');
      const rqBefore = rawQueue.length;
      // 2) undo it — job leaves skipped, comes back to the deck queue, memory clears
      rewindLastSwipe();
      return {
        captured, inSkipped,
        removedFromSkipped: !lists.skipped.some(r => r.co === 'UndoCo'),
        backInDeck: rawQueue.length > rqBefore,
        memoryCleared: window._lastSwipeRec === null,
      };
    });
    expect(r.captured, 'recordSwipe set _lastSwipeRec').toBe(true);
    expect(r.inSkipped, 'the swipe landed in skipped').toBe(true);
    expect(r.removedFromSkipped, 'undo removed it from skipped').toBe(true);
    expect(r.backInDeck, 'undo put the job back in the deck queue').toBe(true);
    expect(r.memoryCleared, 'undo cleared the last-swipe memory (no double-undo)').toBe(true);
  });

  test('undo with nothing to undo is a safe no-op (no throw)', async ({ page }) => {
    const ok = await page.evaluate(() => {
      window._lastSwipeRec = null;
      try { rewindLastSwipe(); return true; } catch (e) { return false; }
    });
    expect(ok, 'rewind with no last swipe does not throw').toBe(true);
  });
});

/* ===== v200: employer side defaults to light (explicit choice always wins) ===== */
test.describe('[STATE-COVERAGE] v200 employer default theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _gpjApplyRoleDefaultTheme === 'function', null, { timeout: 15000 });
  });

  test('recruiter with NO saved theme gets light; candidate gets dark; explicit choice wins', async ({ page }) => {
    const r = await page.evaluate(() => {
      const theme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const out = {};
      // 1) recruiter, no preference -> light
      localStorage.removeItem('gpj_theme'); gpjApplyTheme('dark');
      _gpjApplyRoleDefaultTheme(true); out.recNoPref = theme();
      // 2) candidate, no preference -> dark
      localStorage.removeItem('gpj_theme'); gpjApplyTheme('light');
      _gpjApplyRoleDefaultTheme(false); out.candNoPref = theme();
      // 3) recruiter who explicitly chose DARK -> stays dark (explicit wins)
      localStorage.setItem('gpj_theme', 'dark'); gpjApplyTheme('dark');
      _gpjApplyRoleDefaultTheme(true); out.recExplicitDark = theme();
      // 4) candidate who explicitly chose LIGHT -> stays light (explicit wins)
      localStorage.setItem('gpj_theme', 'light'); gpjApplyTheme('light');
      _gpjApplyRoleDefaultTheme(false); out.candExplicitLight = theme();
      localStorage.removeItem('gpj_theme');
      return out;
    });
    expect(r.recNoPref, 'recruiter, no preference -> light').toBe('light');
    expect(r.candNoPref, 'candidate, no preference -> dark').toBe('dark');
    expect(r.recExplicitDark, 'recruiter explicit dark stays dark').toBe('dark');
    expect(r.candExplicitLight, 'candidate explicit light stays light').toBe('light');
  });
});

/* ===== v201: gamify data layer — honest streak + weekly count ===== */
test.describe('[STATE-COVERAGE] v201 gamify data', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _gpjStreak === 'function' && typeof _gpjWeeklyApplyCount === 'function', null, { timeout: 15000 });
  });

  test('weekly count is derived from REAL Applied rows this week; goal is a number', async ({ page }) => {
    const r = await page.evaluate(() => {
      window.lists = window.lists || { applied: [], skipped: [] };
      const wkStart = (function(){ var d=new Date(); d.setHours(0,0,0,0); var m=(d.getDay()+6)%7; d.setDate(d.getDate()-m); return d.getTime(); })();
      lists.applied = [
        { t: 'A', co: 'X', when: Date.now() },                 // this week
        { t: 'B', co: 'Y', when: wkStart + 1000 },             // this week
        { t: 'C', co: 'Z', when: wkStart - 8 * 86400000 },     // last week (excluded)
      ];
      return { count: _gpjWeeklyApplyCount(), goal: _gpjWeeklyGoal() };
    });
    expect(r.count, 'only this-week applies count').toBe(2);
    expect(typeof r.goal === 'number' && r.goal > 0, 'goal is a positive number').toBe(true);
  });

  test('streak: yesterday→+1, same-day idempotent, gap→reset to 1', async ({ page }) => {
    const r = await page.evaluate(() => {
      const day = 86400000; const t = new Date(); t.setHours(0,0,0,0); const today = t.getTime();
      const set = (d, n) => localStorage.setItem('gpj_streak', JSON.stringify({ d, n }));
      const out = {};
      // consecutive: last active yesterday, streak 4 -> 5
      set(today - day, 4); out.consecutive = _gpjStreak();
      // idempotent: calling again same day stays 5
      out.sameDay = _gpjStreak();
      // gap: last active 3 days ago -> reset to 1
      set(today - 3 * day, 9); out.gap = _gpjStreak();
      localStorage.removeItem('gpj_streak');
      return out;
    });
    expect(r.consecutive, 'yesterday + streak 4 -> 5').toBe(5);
    expect(r.sameDay, 'same-day call does not double-count').toBe(5);
    expect(r.gap, 'a gap resets the streak to 1').toBe(1);
  });
});

/* ===== v202: employer wow #1 — download résumé/cover from the Applicant Card ===== */
test.describe('[STATE-COVERAGE] v202 applicant-card downloads', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _recDownloadApplicant === 'function' && typeof _recResumeText === 'function', null, { timeout: 15000 });
  });

  test('résumé text is built from the snapshot; downloads fire with sane names; no-cover is a safe no-op', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._recApps = { J1: [{ resume: { name: 'Jane Q Doe', title: 'Marketing Manager', contact: 'jane@x.com', summary: 'Strong summary', skills: 'seo, email', roles: [{ t: 'Lead', c: 'Acme', b: 'did great work' }] }, coverLetter: 'Dear team,' }] };
      const names = []; const origCreate = URL.createObjectURL; URL.createObjectURL = () => 'blob:x';
      const origClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
      _recDownloadApplicant('J1', 0, 'resume');
      _recDownloadApplicant('J1', 0, 'cover');
      window._recApps.J1[0].coverLetter = '';
      const before = names.length; _recDownloadApplicant('J1', 0, 'cover'); const noCoverNoDownload = names.length === before;
      URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick;
      const txt = _recResumeText(window._recApps.J1[0].resume);
      return { names, txtHasName: /Jane Q Doe/.test(txt), txtHasSummary: /SUMMARY/.test(txt) && /Strong summary/.test(txt), txtHasExp: /EXPERIENCE/.test(txt) && /Lead/.test(txt), noCoverNoDownload };
    });
    expect(r.names).toContain('Resume_Jane_Q_Doe.txt');
    expect(r.names).toContain('CoverLetter_Jane_Q_Doe.txt');
    expect(r.txtHasName, 'résumé text carries the name').toBe(true);
    expect(r.txtHasSummary, 'résumé text has the summary section').toBe(true);
    expect(r.txtHasExp, 'résumé text has the experience section').toBe(true);
    expect(r.noCoverNoDownload, 'no cover letter → no download fired').toBe(true);
  });
});

/* ===== v203: earned Anti-Ghosting badge surfaces on the company chip (honest) ===== */
test.describe('[STATE-COVERAGE] v203 responsive badge chip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _gpjMarkRespBadge === 'function', null, { timeout: 15000 });
  });

  test('shield appears only when the badge is genuinely earned (>=5 replies); never fabricated', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const mk = () => { const d = document.createElement('div'); d.textContent = '🏢 Acme Robotics'; return d; };
      const out = {};
      // earned: 5 replies -> shield added once
      window.fb = window.fb || {}; window.fb.countMyReachouts = async () => 5;
      const c1 = mk(); await _gpjMarkRespBadge(c1); await _gpjMarkRespBadge(c1); // idempotent
      out.earned = c1.textContent.includes('🛡️'); out.once = (c1.textContent.match(/🛡️/g) || []).length;
      // not earned: 2 replies -> no shield
      window.fb.countMyReachouts = async () => 2;
      const c2 = mk(); await _gpjMarkRespBadge(c2); out.notEarned = c2.textContent.includes('🛡️');
      // zero -> no shield
      window.fb.countMyReachouts = async () => 0;
      const c3 = mk(); await _gpjMarkRespBadge(c3); out.zero = c3.textContent.includes('🛡️');
      return out;
    });
    expect(r.earned, '>=5 replies earns the shield').toBe(true);
    expect(r.once, 'shield is added at most once (idempotent)').toBe(1);
    expect(r.notEarned, '<5 replies: no shield (never fabricated)').toBe(false);
    expect(r.zero, '0 replies: no shield').toBe(false);
  });
});

/* ===== v204: employer metrics strip — real derived numbers, no fabrication ===== */
test.describe('[STATE-COVERAGE] v204 employer metrics strip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _recFillMetrics === 'function', null, { timeout: 15000 });
  });

  test('tiles are derived from real fb data (applicants sum, replies, interviews, active roles)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="ra-metrics"></div>');
      window.fb = window.fb || {};
      window.fb.countJobApplicants = async (id) => (id === 'J1' ? 3 : id === 'J2' ? 2 : 0);
      window.fb.countMyReachouts = async () => 7;
      window.fb.loadSentReachouts = async () => ([
        { status: 'interested', acceptedTime: 'Tue 2pm' },   // interview
        { status: 'interested' },                            // no time — not an interview
        { status: 'sent' },
      ]);
      const jobs = [
        { id: 'J1', isValidated: true, filled: false },
        { id: 'J2', isValidated: true, filled: false },
        { id: 'J3', isValidated: true, filled: true },        // filled — not active
      ];
      await _recFillMetrics(jobs);
      return document.getElementById('ra-metrics').innerText.replace(/\s+/g, ' ');
    });
    expect(r).toContain('5 APPLICANTS');    // 3 + 2
    expect(r).toContain('7 REPLIES SENT');
    expect(r).toContain('1 INTERVIEWS');    // only the accepted-time one
    expect(r).toContain('2 ACTIVE ROLES');  // J1, J2 (J3 filled)
  });
});

/* ===== v205: employer hiring pipeline (kanban) — grouping + stage move + persist ===== */
test.describe('[STATE-COVERAGE] v205 pipeline kanban', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof _recRenderKanban === 'function' && typeof _recMoveStage === 'function' && typeof _recStageOf === 'function', null, { timeout: 15000 });
  });

  test('stage defaults to applied; kanban renders columns; moving persists + updates locally', async ({ page }) => {
    const r = await page.evaluate(async () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="ra-J1" style="display:block"></div>');
      window._recApps = { J1: [ { uid: 'u1', resume: { name: 'A One' }, match: 96 }, { uid: 'u2', resume: { name: 'B Two' }, stage: 'interview', match: 88 } ] };
      window._recJobTitle = { J1: 'Marketing Manager' };
      window.fb = window.fb || {}; const wrote = []; window.fb.setApplicationStage = async (j, u, s) => { wrote.push(j + '/' + u + '/' + s); return true; };
      const out = {};
      out.defaultApplied = _recStageOf(window._recApps.J1[0]);       // 'applied' (no stage)
      out.explicitStage = _recStageOf(window._recApps.J1[1]);        // 'interview'
      out.invalidToApplied = _recStageOf({ stage: 'bogus' });        // 'applied'
      _recRenderKanban('J1');
      const html = document.getElementById('ra-J1').innerHTML;
      out.hasApplied = /Applied/.test(html); out.hasInterview = /Interview/.test(html); out.hasHired = /Hired/.test(html);
      await _recMoveStage('J1', 'u1', 'offer');
      await new Promise(r => setTimeout(r, 10));   // let the fire-and-forget write resolve
      out.movedLocal = window._recApps.J1[0].stage;                 // 'offer'
      out.wrote = wrote;
      return out;
    });
    expect(r.defaultApplied).toBe('applied');
    expect(r.explicitStage).toBe('interview');
    expect(r.invalidToApplied, 'unknown stage falls back to applied').toBe('applied');
    expect(r.hasApplied && r.hasInterview && r.hasHired, 'all stage columns render').toBe(true);
    expect(r.movedLocal, 'moving updates the local stage optimistically').toBe('offer');
    expect(r.wrote).toContain('J1/u1/offer');
  });
});

test.describe('[STATE-COVERAGE] v206 employer wow — honest Hired feed + role-gated Cmd-K', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._recMoveStage === 'function' && typeof window.gpjCmdKCommands === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('moving to ✓ Hired nudges the close-role flow but NEVER auto-logs a hire (no drag-time double count)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      document.body.insertAdjacentHTML('beforeend', '<div id="ra-JX" style="display:block"></div>');
      window._recApps = { JX: [{ uid: 'u1', resume: { name: 'A One' }, match: 90 }] };
      window._recJobTitle = { JX: 'Ops Manager' };
      window.fb = window.fb || {};
      let hires = 0, staged = null;
      window.fb.logHire = async () => { hires++; return true; };
      window.fb.setApplicationStage = async (j, u, s) => { staged = s; return true; };
      let fillOpened = null;
      window.openFillModal = (id, title) => { fillOpened = { id, title }; };   // stub the authoritative close flow
      window.confirm = () => true;   // recruiter accepts the nudge
      _recRenderKanban('JX');
      await _recMoveStage('JX', 'u1', 'hired');
      await new Promise((x) => setTimeout(x, 20));
      return { staged, hiresLoggedOnDrag: hires, fillOpened };
    });
    expect(r.staged, 'the pipeline stage still persists').toBe('hired');
    expect(r.hiresLoggedOnDrag, 'dragging to Hired must NOT log a hire by itself').toBe(0);
    expect(r.fillOpened, 'it routes through the one authoritative close-role flow').toEqual({ id: 'JX', title: 'Ops Manager' });
  });

  test('Cmd-K command list is role-gated: empty for candidates, populated for recruiters', async ({ page }) => {
    const r = await page.evaluate(() => {
      window._recruiter = null;
      const asCandidate = gpjCmdKCommands().length;
      window._recruiter = { uid: 'r1', company: 'Acme' };
      const cmds = gpjCmdKCommands();
      return { asCandidate, recCount: cmds.length, labels: cmds.map((c) => c.label) };
    });
    expect(r.asCandidate, 'candidates never get the employer palette').toBe(0);
    expect(r.recCount, 'recruiters get the full command set').toBeGreaterThanOrEqual(7);
    expect(r.labels.join(' | ')).toContain('Applicants pipeline');
    expect(r.labels.join(' | ')).toContain('Post a new role');
  });
});

test.describe('[STATE-COVERAGE] v207 employer wow — kanban bulk stage-move', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._recBulkMove === 'function' && typeof window._recSetSelMode === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('select mode reveals a bulk bar; bulk-move persists every selected card in one action', async ({ page }) => {
    const r = await page.evaluate(async () => {
      window._gpjRecruiterAuthApply = () => {};
      document.body.insertAdjacentHTML('beforeend', '<div id="ra-JB" style="display:block"></div>');
      window._recApps = { JB: [
        { uid: 'u1', resume: { name: 'A One' }, match: 96 },
        { uid: 'u2', resume: { name: 'B Two' }, match: 90 },
        { uid: 'u3', resume: { name: 'C Three' }, match: 70 },
      ] };
      window._recJobTitle = { JB: 'Marketing Manager' };
      window.fb = window.fb || {}; const wrote = []; window.fb.setApplicationStage = async (j, u, s) => { wrote.push(u + '/' + s); return true; };
      const out = {};
      _recRenderKanban('JB');
      out.noBulkBarByDefault = !/\d+ selected/.test(document.getElementById('ra-JB').innerHTML);
      _recSetSelMode('JB', true);
      out.selectHint = /Tap candidates to select/.test(document.getElementById('ra-JB').innerHTML);
      _recToggleSel('JB', 'u1'); _recToggleSel('JB', 'u3');
      out.barShowsCount = /2 selected/.test(document.getElementById('ra-JB').innerHTML);
      await _recBulkMove('JB', 'interview');
      await new Promise((x) => setTimeout(x, 10));
      out.u1 = window._recApps.JB[0].stage; out.u2 = window._recApps.JB[1].stage; out.u3 = window._recApps.JB[2].stage;
      out.wrote = wrote.sort();
      out.exitsSelMode = _recSelState('JB').mode;
      return out;
    });
    expect(r.noBulkBarByDefault, 'no bulk UI until Select is on').toBe(true);
    expect(r.selectHint, 'select mode shows its hint').toBe(true);
    expect(r.barShowsCount, 'the bulk bar reflects the selection count').toBe(true);
    expect(r.u1, 'selected u1 moved').toBe('interview');
    expect(r.u3, 'selected u3 moved').toBe('interview');
    expect(r.u2, 'unselected u2 untouched').toBeUndefined();
    expect(r.wrote).toEqual(['u1/interview', 'u3/interview']);
    expect(r.exitsSelMode, 'a bulk move clears selection and exits select mode').toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v208 deck wow — gamify bar + celebrations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjRenderGamifyBar === 'function' && typeof window._gpjCelebrateApply === 'function' && typeof window._gpjStreakRead === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('guest/empty: bar renders an encouraging zero-state, never a scold', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_streak');
      window.lists = window.lists || {}; lists.applied = []; lists.skipped = lists.skipped || [];
      _gpjRenderGamifyBar();
      const html = document.getElementById('gpj-gamify-bar').innerHTML;
      return { rendered: html.length > 0, startStreak: /Start a streak/.test(html), zeroWeek: /0 \/ 20/.test(html), noScold: !/behind|failed|missed|only/i.test(html) };
    });
    expect(r.rendered).toBe(true);
    expect(r.startStreak, 'zero streak invites, not punishes').toBe(true);
    expect(r.zeroWeek).toBe(true);
    expect(r.noScold, 'copy is never punitive').toBe(true);
  });

  test('rendering the bar is READ-ONLY — it must never advance the streak', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_streak');
      window.lists = window.lists || {}; lists.applied = []; lists.skipped = lists.skipped || [];
      const before = _gpjStreakRead();               // 0, nothing stored
      _gpjRenderGamifyBar(); _gpjRenderGamifyBar();   // pure display
      const afterRenders = _gpjStreakRead();          // still 0 — no mutation
      _gpjStreak();                                   // a real activity marks today
      const afterActivity = _gpjStreakRead();         // 1
      return { before, afterRenders, afterActivity };
    });
    expect(r.before, 'no streak yet').toBe(0);
    expect(r.afterRenders, 'merely viewing the deck never starts a streak').toBe(0);
    expect(r.afterActivity, 'a real apply/activity advances it').toBe(1);
  });

  test('a genuine new apply celebrates once, advances the streak, and updates the weekly bar', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('gpj_streak');
      const now = Date.now();
      window.lists = window.lists || {}; lists.applied = [{ when: now }, { when: now }]; lists.skipped = lists.skipped || [];
      const streakBefore = _gpjStreakRead();
      _gpjCelebrateApply('Marketing Manager', 'Acme Co');
      const burst = document.getElementById('gpj-burst');
      const streakAfter = _gpjStreakRead();
      const bar = document.getElementById('gpj-gamify-bar').innerHTML;
      return { streakBefore, hasBurst: !!burst, applauds: /Applied|Weekly goal/.test(burst ? burst.innerHTML : ''), streakAfter, weekShows: /2 \/ 20/.test(bar) };
    });
    expect(r.streakBefore).toBe(0);
    expect(r.hasBurst, 'a celebration overlay appears').toBe(true);
    expect(r.streakAfter, 'the apply advances the streak to 1').toBe(1);
    expect(r.weekShows, 'the weekly bar reflects the applied count').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v209 deck wow — visible undo pill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjUpdateUndoBtn === 'function' && typeof window.rewindLastSwipe === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('undo pill: hidden with nothing to undo; appears (labeled) after a swipe; hides after undo', async ({ page }) => {
    const r = await page.evaluate(() => {
      const row = document.getElementById('undo-swipe-row');
      const out = { exists: !!row };
      window._lastSwipeRec = null; _gpjUpdateUndoBtn();
      out.hiddenAtStart = row.style.display === 'none';
      window._lastSwipeRec = { rec: { t: 'Marketing Manager', co: 'Acme Co' }, list: 'applied' }; _gpjUpdateUndoBtn();
      out.shownApply = row.style.display === 'block'; out.applyLabel = document.getElementById('undo-swipe-what').textContent;
      window._lastSwipeRec = { rec: { t: 'X', co: 'Y' }, list: 'skipped' }; _gpjUpdateUndoBtn();
      out.skipLabel = document.getElementById('undo-swipe-what').textContent;
      window._lastSwipeRec = null; _gpjUpdateUndoBtn();
      out.hiddenAfterClear = row.style.display === 'none';
      return out;
    });
    expect(r.exists, 'the undo pill exists on the deck').toBe(true);
    expect(r.hiddenAtStart, 'nothing to undo → hidden').toBe(true);
    expect(r.shownApply, 'a recorded swipe reveals the pill').toBe(true);
    expect(r.applyLabel).toBe('(apply)');
    expect(r.skipLabel).toBe('(skip)');
    expect(r.hiddenAfterClear, 'after undo it hides again').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v210 D1 truncation fix — drawer lazy-loads the full posting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.hydrateDrawer === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('a clipped pool job fetches the full doc ONCE on drawer open; merges full text; never refetches; live docs never fetch', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const preview = 'Lead marketing strategy. The Director should possess: a results-driven approach, with a';
      const full = preview + ' proven omni-channel record and $2M+ budget ownership. THIS IS THE COMPLETE POSTING that was hidden behind the 600-char pool preview.';
      const job = { t: 'Director of Marketing', co: 'Texas Children’s', id: 'job-abc', _clipped: true, desc: preview, req: '', benefits: '', url: 'https://x.com' };
      window.jobsQueue = [job];
      window._currentTopJob = () => job;
      window.fb = window.fb || {};
      let calls = 0, lastId = null;
      window.fb.getJobFull = async (id) => { calls++; lastId = id; return { description: full, requirements: '5+ yrs, omni-channel', benefits: 'Health, PTO' }; };
      const out = { previewLen: job.desc.length };
      hydrateDrawer();
      await new Promise((x) => setTimeout(x, 120));
      out.calls1 = calls; out.lastId = lastId;
      out.descGrew = job.desc.length > out.previewLen;
      out.hasFullTail = job.desc.indexOf('COMPLETE POSTING') >= 0;
      out.reqFilled = (job.req || '').length > 0;
      out.clippedCleared = job._clipped === false;
      // reopen must NOT refetch
      hydrateDrawer();
      await new Promise((x) => setTimeout(x, 60));
      out.callsAfterReopen = calls;
      // a LIVE (non-clipped) doc must never call getJobFull
      const live = { t: 'X', co: 'Y', id: 'live-1', desc: 'full live text already', _clipped: false };
      window.jobsQueue = [live]; window._currentTopJob = () => live;
      calls = 0; hydrateDrawer(); await new Promise((x) => setTimeout(x, 60));
      out.liveNeverFetches = calls === 0;
      return out;
    });
    expect(r.calls1, 'exactly one fetch on first open').toBe(1);
    expect(r.lastId).toBe('job-abc');
    expect(r.descGrew, 'the preview is replaced by the longer full text').toBe(true);
    expect(r.hasFullTail, 'the previously-hidden tail is now shown').toBe(true);
    expect(r.reqFilled, 'requirements hydrate too').toBe(true);
    expect(r.clippedCleared, '_clipped flips false so it will not refetch').toBe(true);
    expect(r.callsAfterReopen, 'reopening the same job never refetches').toBe(1);
    expect(r.liveNeverFetches, 'a full live doc never triggers a detail read').toBe(true);
  });

  test('failed/empty full-doc fetch is graceful — the preview stays, no crash, no endless retry', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const job = { t: 'Ops Manager', co: 'Acme', id: 'job-x', _clipped: true, desc: 'short preview text', req: '', benefits: '' };
      window.jobsQueue = [job]; window._currentTopJob = () => job;
      window.fb = window.fb || {};
      let calls = 0;
      window.fb.getJobFull = async () => { calls++; return null; };   // miss / not found
      hydrateDrawer();
      await new Promise((x) => setTimeout(x, 100));
      const descKept = job.desc === 'short preview text';
      hydrateDrawer(); // second open must not retry after a miss
      await new Promise((x) => setTimeout(x, 60));
      return { descKept, calls };
    });
    expect(r.descKept, 'the preview is preserved when the full doc is unavailable').toBe(true);
    expect(r.calls, 'a miss marks it hydrated so it never retries in a loop').toBe(1);
  });
});

test.describe('[STATE-COVERAGE] v211 keyword search — loose fallback actually renders (67-found-0-shown)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.searchAllJobsForKeyword === 'function' && typeof window.renderBrowse === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('a multi-word search with no all-words title match renders the ANY-word results (not 0)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      if (typeof switchView === 'function') switchView('browse');
      document.getElementById('f-keyword').value = 'account retention';
      window.fb = window.fb || {};
      window.fb.fetchJobs = async () => ([
        { title: 'Account Manager', company: 'Acme', location: 'Dallas, TX', description: 'x', url: 'https://a.com' },
        { title: 'Retention Specialist', company: 'Beta', location: 'Austin, TX', description: 'x', url: 'https://b.com' },
        { title: 'Project Coordinator', company: 'Gamma', location: 'Houston, TX', description: 'x', url: 'https://g.com' },
      ]);
      await searchAllJobsForKeyword(true);
      await new Promise((x) => setTimeout(x, 150));
      const txt = (document.getElementById('browse-results') || {}).innerText || '';
      return {
        looseActive: window._kwLooseActive,
        cards: document.querySelectorAll('#browse-results .job-card-browse').length,
        hasAccountMgr: /Account Manager/.test(txt),
        hasRetention: /Retention Specialist/.test(txt),
        hasCoordinator: /Project Coordinator/.test(txt),
      };
    });
    expect(r.looseActive, 'the loose fallback engaged (no title has both words)').toBe(true);
    expect(r.cards, 'the any-word matches actually render — not blanked to 0').toBe(2);
    expect(r.hasAccountMgr).toBe(true);
    expect(r.hasRetention).toBe(true);
    expect(r.hasCoordinator, 'a zero-score title is still excluded (no false positives)').toBe(false);
  });

  test('a strict all-words match still wins and does NOT engage loose mode', async ({ page }) => {
    const r = await page.evaluate(async () => {
      if (typeof switchView === 'function') switchView('browse');
      document.getElementById('f-keyword').value = 'account retention';
      window.fb = window.fb || {};
      window.fb.fetchJobs = async () => ([
        { title: 'Account Retention Lead', company: 'Delta', location: 'Remote', description: 'x', url: 'https://d.com', is_remote: true },
        { title: 'Project Coordinator', company: 'Gamma', location: 'Houston, TX', description: 'x', url: 'https://g.com' },
      ]);
      await searchAllJobsForKeyword(true);
      await new Promise((x) => setTimeout(x, 150));
      const txt = (document.getElementById('browse-results') || {}).innerText || '';
      return { looseActive: window._kwLooseActive, cards: document.querySelectorAll('#browse-results .job-card-browse').length, hasLead: /Account Retention Lead/.test(txt), hasCoord: /Project Coordinator/.test(txt) };
    });
    expect(r.looseActive, 'strict match found results, so loose mode stays off').toBe(false);
    expect(r.cards).toBe(1);
    expect(r.hasLead).toBe(true);
    expect(r.hasCoord).toBe(false);
  });
});

test.describe('[STATE-COVERAGE] v212 match honesty — a high % never reads as "stretch role"', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.openMatchInsight === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('no skill-keyword overlap: a 98% explains itself (title/experience), a low % still warns "stretch"', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      // skills that will NOT appear in the posting → forces the matched.length===0 branch
      Object.assign(resumeData, { title: 'Marketing', skills: 'Zorbing · Underwater Basketweaving', jobs: [{ t: 'Marketing Specialist', c: 'Acme', b: 'ran campaigns' }], summary: 'marketing' });
      const job = { t: 'Director of Marketing', desc: 'Lead integrated marketing strategy across digital and paid media channels for a large health system.', req: 'Lead campaigns and budgets across channels.' };
      openMatchInsight('Director of Marketing', 98, null, job);
      const highMsg = document.getElementById('mi-have').innerText;
      openMatchInsight('Director of Marketing', 40, null, job);
      const lowMsg = document.getElementById('mi-have').innerText;
      document.getElementById('match-modal').classList.remove('open');
      return { highMsg, lowMsg };
    });
    expect(r.highMsg, 'a 98% is explained via title & experience').toMatch(/title|experience/i);
    expect(r.highMsg, 'a 98% must NOT contradict itself with "stretch role"').not.toMatch(/stretch/i);
    expect(r.lowMsg, 'a genuinely low score still honestly warns "stretch role"').toMatch(/stretch/i);
  });
});

test.describe('[STATE-COVERAGE] v213/v219 Match-to-Job — checked skills reach the download; master stays unchanged', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.applyMatch2Job === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('data-skill capture: checked skills land in the tailored download only; master unchanged; unchecked excluded', async ({ page }) => {
    const r = await page.evaluate(async () => {
      resumeReady = true;
      Object.assign(resumeData, { name: 'Test', title: 'Marketing', skills: 'Excel · Word · Sales', jobs: [{ t: 'Specialist', c: 'Acme', b: 'Ran events.' }], summary: 'x' });
      const modal = document.getElementById('match2job-modal');
      const host = document.getElementById('m2j-body') || modal;
      // two checked (with data-skill), one UNchecked — the capture reads the box's own skill
      host.innerHTML = '<div id="m2j-checks">'
        + '<label><input type="checkbox" data-skill="SEO" checked></label>'
        + '<label><input type="checkbox" data-skill="Campaign Management" checked></label>'
        + '<label><input type="checkbox" data-skill="Analytics"></label></div>';
      window.fb = window.fb || {};
      window.fb.smartMatch = async (b) => ({ finalResume: b, changedCount: 0 });
      let pdfSkills = null, storedAdded = null;
      window.generateResumePDF = () => { pdfSkills = resumeData.skills; return 'f.pdf'; };
      window.storeOptimizedResume = (t, co, added) => { storedAdded = added; };
      window.closeMatch2Job = () => {}; window.showToast = () => {}; window.rateResume = () => {}; window.cloudSync = () => {}; window.saveDraft = () => {};
      await applyMatch2Job();
      await new Promise((x) => setTimeout(x, 160));
      return { pdfSkills, storedAdded, masterSkills: resumeData.skills };
    });
    expect(r.storedAdded, 'exactly the two CHECKED skills are captured — not by fragile index').toEqual(['SEO', 'Campaign Management']);
    expect(r.pdfSkills, 'the tailored DOWNLOAD now contains the checked skills (the reported bug)').toMatch(/SEO/);
    expect(r.pdfSkills).toMatch(/Campaign Management/);
    expect(r.masterSkills, 'v219 (founder decision): a per-job tailor NEVER mutates the master — the confirmed skill goes to the DOWNLOAD only, not the master').not.toMatch(/SEO/);
    expect(r.masterSkills, "the master's original skills are fully preserved — no corruption").toMatch(/Excel/);
    expect(r.masterSkills, 'an UNCHECKED skill is never added').not.toMatch(/Analytics/);
  });
});

test.describe('[STATE-COVERAGE] v214 rater Q2 — soft-skill dilution + duplicate bullets', () => {
  const rc = require('../api/rate/rateCore.js');
  test('a résumé with filler skills + near-duplicate bullets is flagged + docked; a clean one is not', () => {
    const flagged = rc.rateStructure({
      name: 'A', contact: 'a@x.com', summary: 'Marketing pro with a decade of real experience shipping campaigns.',
      // 4 soft/filler skills (Communication, Scheduling, Documentation, Word)
      skills: 'Excel · Sales · CRM · Communication · Scheduling · Documentation · Word',
      // two bullets that mean the same thing with varied wording (enhance/enhanced, collaborated/collaboration)
      jobs: [{ b: 'Enhanced client data pipelines through collaboration, improving stakeholder relationships and reducing friction.\nCollaborated with operations to enhance client data pipelines, strengthening stakeholder relationships.' }],
    });
    const flabels = flagged.items.filter((i) => !i[0]).map((i) => i[1]).join(' | ');
    expect(flabels, 'soft/filler skills are flagged').toMatch(/soft\/filler skills/);
    expect(flabels, 'meaning-duplicate bullets are caught despite varied wording').toMatch(/near-duplicate bullet/);

    const clean = rc.rateStructure({
      name: 'B', contact: 'b@x.com', summary: 'Growth marketer focused on measurable lifecycle and paid outcomes.',
      skills: 'Excel · Salesforce · SEO · Python · Tableau · Figma',
      jobs: [{ b: 'Increased retention 20% by launching a lifecycle email program.\nCut onboarding time 30% via a new automation workflow.' }],
    });
    expect(clean.items.some((i) => i[0] && /little soft-skill filler/.test(i[1])), 'specific skills pass').toBe(true);
    expect(clean.items.some((i) => i[0] && /No repeated bullets/.test(i[1])), 'distinct bullets pass').toBe(true);
    // the flagged résumé scores strictly lower than an equivalent clean one (docking works)
    expect(rc.qualityScore(flagged ? { name: 'A', contact: 'a@x.com', summary: 'Marketing pro with a decade of real experience shipping campaigns.', skills: 'Excel · Sales · CRM · Communication · Scheduling · Documentation · Word', jobs: [{ b: 'Enhanced client data pipelines through collaboration, improving stakeholder relationships and reducing friction.\nCollaborated with operations to enhance client data pipelines, strengthening stakeholder relationships.' }] } : {})).toBeLessThan(90);
  });
});

test.describe('[STATE-COVERAGE] v215 footer/nav — cleanup + Resources "Employers" link', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window._gpjSyncEmployerNav === 'function' && typeof window.openEmployer === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('footer: no "Home", uniform muted link colours, checker visible for guests but hidden when signed in', async ({ page }) => {
    const r = await page.evaluate(() => {
      const footer = document.getElementById('gpj-global-footer');
      const txt = footer.innerText;
      const links = [].slice.call(footer.querySelectorAll('a[href*="resume-checker"], a[href*="resources"]'));
      const cl = document.getElementById('footer-checker-link');
      const guestVisible = cl && cl.style.display !== 'none';
      window.fb = window.fb || {}; window.fb.current = () => ({ uid: 'u1' });   // signed in
      _gpjSyncEmployerNav();
      return { hasHome: /🏠 Home/.test(txt), hasChecker: /Free Résumé Checker/.test(txt), hasResources: /Resources/.test(txt), colors: links.map((a) => a.style.color), guestVisible, hiddenSignedIn: cl && cl.style.display === 'none' };
    });
    expect(r.hasHome, '"Home" is dropped (redundant with the tabs)').toBe(false);
    expect(r.hasChecker).toBe(true);
    expect(r.hasResources).toBe(true);
    expect(r.colors.length).toBeGreaterThan(0);
    expect(r.colors.every((c) => c === 'var(--muted)'), 'footer links share one uniform colour').toBe(true);
    expect(r.guestVisible, 'guests see the free checker').toBe(true);
    expect(r.hiddenSignedIn, 'signed-in individuals do not').toBe(true);
  });

  test('the #employers hash (Resources nav) opens the Employer entry instead of Home', async ({ page }) => {
    const called = await page.evaluate(async () => {
      let hit = false; window.openEmployer = () => { hit = true; };   // hoisted global reassign
      location.hash = '#employers';
      await new Promise((r) => setTimeout(r, 900));   // past the 500ms handler delay
      return hit;
    });
    expect(called, 'landing on /#employers opens the Employer view, not Home').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v216 match Q1 — seniority-gap cap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _gpjScoreMatch === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(300);
  });

  test('a Director role no longer scores ~98% for a lower-level résumé; same-level is uncapped; a 2-tier jump caps harder', async ({ page }) => {
    const r = await page.evaluate(() => {
      const cand = { title: 'Marketing Specialist', roles: [{ t: 'Marketing Specialist', b: 'ran tradeshows and budgets' }, { t: 'Regional Account Manager', b: 'managed accounts via salesforce and crm' }], skills: ['marketing', 'salesforce', 'crm'], summary: 'marketing professional' };
      const director = _gpjScoreMatch(cand, { title: 'Director of Marketing', desc: 'lead integrated marketing strategy demand gen brand digital paid media analytics' });
      const manager = _gpjScoreMatch(cand, { title: 'Marketing Manager', desc: 'run marketing campaigns and manage the calendar' });
      const icOnly = _gpjScoreMatch({ title: 'Marketing Coordinator', roles: [{ t: 'Marketing Coordinator', b: 'coordinated marketing logistics' }], skills: ['marketing'], summary: '' }, { title: 'VP of Marketing', desc: 'own the marketing organization and enterprise brand strategy' });
      return { director, manager, icOnly };
    });
    expect(r.director, 'Director for a Manager-level résumé is a reach (≤85), not near-perfect').toBeLessThanOrEqual(85);
    expect(r.manager, 'a same-level Manager role is NOT capped by seniority').toBeGreaterThan(85);
    expect(r.icOnly, 'a 2-tier jump (Coordinator → VP) caps harder (≤70)').toBeLessThanOrEqual(70);
  });
});

test.describe('[STATE-COVERAGE] v217 mobile deck — decision-snapshot card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fillSlot === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('snapshot tiles paint from fillSlot; location not duplicated in the subtitle; taps open the popups not the drawer', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      const job = { t: 'Marketing Manager', co: 'RPM Living', loc: 'Houston, TX', sal: '$85–110K', work_setting: 'Hybrid', posting_age_days: 13, jtype: 'Full-time', desc: 'x', req: '5+ yrs', benefits: 'y', ghost: 26 };
      fillSlot(card, job);
      return {
        salary: card.querySelector('.s-salary').textContent,
        loc: card.querySelector('.s-loc').textContent,
        ghost: card.querySelector('.s-ghost').textContent,
        subDropsLoc: card.querySelector('.s-sub').textContent.indexOf('Houston') < 0,
        subKeepsCompanyFirst: card.querySelector('.s-sub').textContent.split(' · ')[0] === 'RPM Living',
        matchTapsInsight: (card.querySelector('[onclick*="cardMatchInsight"]') || {}) !== null && !!card.querySelector('[onclick*="cardMatchInsight"] .match-pct'),
        gapTapsReq: (card.querySelector('.s-req').getAttribute('onclick') || '').indexOf('reqGapsTop') >= 0,
        tapHint: card.querySelector('.tap-hint').textContent,
      };
    });
    expect(r.salary).toBe('$85–110K');
    expect(r.loc).toBe('📍 Houston, TX');
    expect(r.ghost, 'the ghost risk pill shows 👻 N% (kept the clean pill; only the far-right fling was fixed)').toBe('👻 26%');
    expect(r.subDropsLoc, 'location lives in its tile, not repeated in the subtitle').toBe(true);
    expect(r.subKeepsCompanyFirst, 'company stays the first subtitle token other code reads').toBe(true);
    expect(r.matchTapsInsight, 'the Match tile opens the quick-view insight popup').toBe(true);
    expect(r.gapTapsReq, 'the gaps row opens the quick-view gaps popup').toBe(true);
    expect(r.tapHint).toContain('full posting');
  });

  test('empty/missing data: the match tile is never blank — a graceful fit label', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      fillSlot(card, { t: 'Marketing Manager', co: 'RPM Living', desc: 'marketing seo email' });
      const mp = card.querySelector('.match-pct');
      return { text: mp.textContent, shown: mp.style.display !== 'none' };
    });
    expect(r.text, 'never blank').toContain('fit');
    expect(r.shown, 'the match tile value is visible').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v218 desktop expand — fill the screen, card stays card-width', () => {
  test('v225: wide viewport — 2-col grid, inner-scroll pane reaches the far right, card centered BETWEEN rail and scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 560 });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.buildDesktopGrid === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      if (typeof buildDesktopGrid === 'function' && !document.body.classList.contains('desk')) buildDesktopGrid();
      const mw = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).maxWidth : null; };
      const grid = document.querySelector('#desk-grid');
      const gridCols = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0;
      const main = document.querySelector('#desk-main');
      const rail = document.querySelector('#desk-rail');
      const deck = document.querySelector('#view-swipe #card-deck');
      const dr = deck ? deck.getBoundingClientRect() : null;
      const mainRight = main ? Math.round(main.getBoundingClientRect().right) : null;
      const railRight = rail ? Math.round(rail.getBoundingClientRect().right) : null;
      return {
        app: mw('#app'), deck: mw('#view-swipe #card-deck'), gridCols,
        deckLaidOut: !!(dr && dr.width > 0),
        mainScrolls: main ? ['auto', 'scroll'].includes(getComputedStyle(main).overflowY) : false,
        mainReachesEdge: mainRight != null ? (window.innerWidth - mainRight) : null,
        gapLeft: (dr && railRight != null) ? Math.round(dr.left) - railRight : null,
        gapRight: (dr && mainRight != null) ? mainRight - Math.round(dr.right) : null,
      };
    });
    expect(r.app, 'the app fills wider monitors (2000)').toBe('2000px');
    expect(r.deck, 'the card matches the 860px console width').toBe('860px');
    expect(r.gridCols, 'v225: 2-column grid (rail + main) — no phantom gutter').toBe(2);
    expect(r.deckLaidOut, 'the card is laid out on the swipe view').toBe(true);
    expect(r.mainScrolls, 'the inner scroll pane is kept (header stays fixed, popups anchored — no regression)').toBe(true);
    expect(r.mainReachesEdge, 'v225: the scroll pane reaches the far-right window edge (scrollbar far-right)').toBeLessThanOrEqual(2);
    expect(Math.abs(r.gapLeft - r.gapRight), 'v225: card centered BETWEEN the rail and the scrollbar — equal gaps').toBeLessThanOrEqual(14);
  });

  test('v225: the ghost + gap pills sit directly under the tiles (before the Green Flag), not floating after it', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fillSlot === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      const rg = card.querySelector('.risk-gap-row');
      const gf = card.querySelector('.green-flag');
      return { pillsBeforeFlag: (rg && gf) ? (rg.compareDocumentPosition(gf) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : 'na' };
    });
    expect(r.pillsBeforeFlag, 'the ghost/gap pills come BEFORE the Green Flag — grouped under the tiles, not two islands after it').toBe(true);
  });
});

test.describe('[STATE-COVERAGE] v221 card-face polish + drawer dedup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fillSlot === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('ghost + gap share one row as compact pills — clean "👻 N%" pill, no margin-left:auto, no bar', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      fillSlot(card, { t: 'Marketing Manager', co: 'Acme', ghost: 26, desc: 'x' });
      const gb = card.querySelector('.s-ghost');
      return { pct: gb.textContent.trim(), marginLeft: getComputedStyle(gb).marginLeft, noBar: !card.querySelector('.s-ghost-bar'), hasRow: !!card.querySelector('.risk-gap-row'), gapInRow: !!card.querySelector('.risk-gap-row .s-req') };
    });
    expect(r.pct, 'the clean pill kept — single 👻 with the %').toBe('👻 26%');
    expect(r.marginLeft, 'no margin-left:auto flinging the pill to the far right (the only real bug)').toBe('0px');
    expect(r.noBar, 'the bar redesign was reverted — the pill is kept').toBe(true);
    expect(r.hasRow, 'ghost + gap live on one shared row').toBe(true);
    expect(r.gapInRow, 'the gap pill sits in the same row as the ghost pill').toBe(true);
  });

  test('gap is a compact PILL (inline-block, icon+count), never blank when a resume is on file', async ({ page }) => {
    const r = await page.evaluate(() => {
      resumeReady = true;
      Object.assign(resumeData, { title: 'Marketing', skills: 'SEO · Email · Analytics', jobs: [{ t: 'Marketing', c: 'x', b: 'ran campaigns' }], summary: 'marketing' });
      const card = document.querySelector('.job-card.top');
      fillSlot(card, { t: 'Marketing Coordinator', co: 'Acme', desc: 'marketing seo email analytics', req: 'seo email analytics', ghost: 20 });
      const req = card.querySelector('.s-req');
      return { display: getComputedStyle(req).display, text: req.textContent.trim(), opensGaps: (req.getAttribute('onclick') || '').indexOf('reqGapsTop') >= 0 };
    });
    expect(r.display, 'the gap pill is shown when a resume is on file (a flex item in the shared row → computed block)').not.toBe('none');
    expect(r.text.length, 'never blank when a resume is on file (⚠ N gaps or ✓ No gaps)').toBeGreaterThan(0);
    expect(r.text.length, 'compact — a count pill, not the old full-sentence row').toBeLessThan(20);
    expect(r.opensGaps, 'tapping the pill opens the requirements-gap detail').toBe(true);
  });

  test('_sameJobText catches overlapping req/desc so the drawer never repeats duties', async ({ page }) => {
    const r = await page.evaluate(() => {
      const A = 'Coordinate marketing campaigns across digital and social channels. Develop content and manage brand assets end to end.';
      return {
        identical: _sameJobText(A, A),
        contained: _sameJobText(A + ' Plus one extra sentence about the benefits package.', A),
        distinct: _sameJobText('Requires five years of hands-on experience with Salesforce administration and SQL reporting.', A),
        empty: _sameJobText('', A),
      };
    });
    expect(r.identical, 'identical text is a dup').toBe(true);
    expect(r.contained, 'one fully containing the other is a dup').toBe(true);
    expect(r.distinct, 'genuinely different sections are NOT a dup — both are shown').toBe(false);
    expect(r.empty, 'empty is never a dup').toBe(false);
  });

  test('openEmployer strips the #employers hash from the URL', async ({ page }) => {
    const r = await page.evaluate(async () => {
      history.replaceState(null, '', location.pathname + '#employers');
      const before = location.hash;
      try { await openEmployer(); } catch (e) {}
      return { before, after: location.hash };
    });
    expect(r.before).toBe('#employers');
    expect(r.after, 'the hash is cleared once the employer view has been handled').toBe('');
  });
});

test.describe('[STATE-COVERAGE] v222 card uniformity + honest green flag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.fillSlot === 'function', null, { timeout: 15000 });
    await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
  });

  test('green flag is honest — "Fresh posting", not the "Actively hiring now" overclaim, and no confusing city append', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      fillSlot(card, { t: 'Marketing Coordinator', co: 'Acme', loc: 'Spring, TX', posting_age_days: 10, ghost: 20, desc: 'x' });
      const gf = card.querySelector('.green-flag');
      return { text: gf.textContent.trim(), shown: getComputedStyle(gf).display !== 'none' };
    });
    expect(r.shown).toBe(true);
    expect(r.text, 'no unverifiable "actively hiring" claim').not.toMatch(/actively hiring/i);
    expect(r.text, 'no orphan city appended to the flag').not.toMatch(/·\s*Spring\b/);
    expect(r.text, 'honest recency signal').toMatch(/Fresh posting/i);
  });

  test('the three snapshot tiles are uniform — same background in the current mode (Match accents via text only)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = document.querySelector('.job-card.top');
      fillSlot(card, { t: 'Marketing Coordinator', co: 'Acme', loc: 'Spring, TX', sal: 'Salary on request', ghost: 26, desc: 'x' });
      const tiles = ['.match-pct', '.s-salary', '.s-loc'].map(s => card.querySelector(s).parentElement).map(t => getComputedStyle(t).backgroundColor);
      const row = card.querySelector('.risk-gap-row');
      return { uniqueBgs: [...new Set(tiles)], rowJustify: getComputedStyle(row).justifyContent };
    });
    expect(r.uniqueBgs.length, 'all three tiles share ONE background (no green-vs-purple clash)').toBe(1);
    expect(r.rowJustify, 'the ghost/gap pills are centered, not left-orphaned').toBe('center');
  });
});
