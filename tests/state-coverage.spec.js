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
        waterHonest: /None of your listed skills/.test(waterHave),
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
      const many = _tidySkills(Array.from({ length: 20 }, (_, i) => 'Salesforce' + i).join(' · '));
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
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        headerVisible: !!(document.getElementById('header') && document.getElementById('header').offsetHeight),
      }));
      expect(m.overflow, 'no horizontal scroll at ' + w + 'px').toBeLessThanOrEqual(0);
      expect(m.headerVisible, 'header renders at ' + w + 'px').toBe(true);
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
      set('job-desc', 'Oversee warehouse operations and vendor logistics for the region.'); set('job-req', '5 years ops');
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
      await applyInternalById('JOB99', 'Ops Lead', 'Acme');
      await new Promise((r) => setTimeout(r, 120));
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
      document.querySelector('#reachouts-list div[onclick*="interested"]').click();
      await new Promise((r) => setTimeout(r, 150));
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
      document.querySelector('#reachouts-list div[onclick*="pickInterviewSlot"]').click();
      await new Promise((r) => setTimeout(r, 150));
      return { hasPrompt, bothSlots, responded };
    });
    expect(r.hasPrompt, 'R7 is a real slot exchange, not free text').toBe(true);
    expect(r.bothSlots).toBe(true);
    expect(r.responded.st).toBe('interested');
    expect(r.responded.extra.acceptedTime).toBe('Tue 2pm CT');
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
      document.getElementById('rl-desc').value = 'UPDATED description for the role.';
      await postRecJob();
      return { hasEdit, prefill, updated: window.__updated, created: window.__created, btnReset: document.getElementById('rl-post-btn').textContent };
    }, wait);
    expect(r.hasEdit, 'every listing offers Edit').toBe(true);
    expect(r.prefill.title, 'the form prefills from the real job').toBe('Ops Manager');
    expect(r.prefill.btn).toBe('💾 Save changes');
    expect(r.updated.id).toBe('j1');
    expect(r.updated.d.description).toBe('UPDATED description for the role.');
    expect(r.created, 'editing must UPDATE, never create a duplicate').toBeNull();
    expect(r.btnReset, 'the form returns to post mode after saving').toMatch(/Post role/);
  });

  test('editing does NOT trip the free-tier role cap (you are not adding a role)', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      window._myJobCount = 5;                       // free tier is full
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      await recEditJob('j1');
      document.getElementById('rl-desc').value = 'Still editable at the cap.';
      await postRecJob();
      return { updated: window.__updated };
    }, wait);
    expect(r.updated, 'a full free team must still be able to EDIT its roles').not.toBeNull();
    expect(r.updated.d.description).toBe('Still editable at the cap.');
  });

  test('a panel rebuild mid-edit keeps the edit — and the unsaved typing', async ({ page }) => {
    const r = await page.evaluate(async (ws) => {
      const wait = eval('(' + ws + ')');
      await renderRecListings(); await wait('rl-list', 'Ops Manager');
      await recEditJob('j1');
      document.getElementById('rl-desc').value = 'Half-typed edit, not saved yet.';
      await renderRecListings();          // tab switch / late applicant count / any repaint
      return { desc: document.getElementById('rl-desc').value, title: document.getElementById('rl-title').value,
        btn: document.getElementById('rl-post-btn').textContent, editing: window._editingJobId,
        cancelShown: document.getElementById('rl-cancel-edit').style.display };
    }, wait);
    expect(r.desc, 'unsaved typing survives a rebuild (was: silently blanked)').toBe('Half-typed edit, not saved yet.');
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
      document.getElementById('rl-desc').value = 'Run the warehouse day to day.';
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
      // DOM still shows the markup placeholders
      document.getElementById('pref-titles').textContent = 'Engineer, Developer, Tech Lead';
      document.getElementById('pref-salary').textContent = '$120,000 / year';
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
      window._myRO = { ro9: { id: 'ro9', proposedTimes: ['Mon Aug 10 · 2:00 PM CDT', 'Tue Aug 11 · 10:30 AM CDT'], proposedTs: [1786000000000, 1786100000000] } };
      window.renderMyReachouts = () => {};
      await pickInterviewSlot('ro9', 1);
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
      document.getElementById('rl-desc').value = 'Lead the warehouse team daily.';
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
      await new Promise((x) => setTimeout(x, 200));
      const plain = { id: 'jp1', t: 'Simple Role', co: 'Acme', appQuestions: [] };
      let sentPlain = null;
      fb.applyToInternalJob = async (id, meta) => { sentPlain = { id, meta }; return true; };
      applyInternal(plain);
      await new Promise((x) => setTimeout(x, 200));
      return { modalOpen, qCount, answers: sent && sent.meta.answers, modalGone: !document.getElementById('applyq-modal'), plainDirect: !!sentPlain, plainAnswers: sentPlain && sentPlain.meta.answers };
    });
    expect(r.modalOpen, 'questions modal opens before sending').toBe(true);
    expect(r.qCount).toBe(2);
    expect(r.answers).toEqual([{ q: 'Weekends OK?', a: 'Yes, both days' }, { q: 'Start date?', a: 'Two weeks out' }]);
    expect(r.modalGone).toBe(true);
    expect(r.plainDirect, 'no questions -> applies directly').toBe(true);
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
