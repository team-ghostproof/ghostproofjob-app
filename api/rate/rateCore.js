'use strict';
// ============================================================================
// GhostProofJob — SHARED résumé rating core (P1-1, the zero-read foundation).
// ----------------------------------------------------------------------------
// WHY: the public "free résumé checker" (/tools/resume-checker) must score a
// résumé with ZERO Firestore reads and WITHOUT diverging from the in-app rater.
// The in-app rater's live corpus mine (`mineRoleKeywords`) costs ~1,200 reads
// per call — fatal for anonymous SEO traffic — so the checker uses (a) this pure
// STRUCTURAL scorer (the genuinely-free "Résumé Quality" half) and (b) a static
// pre-computed per-role corpus for Role Fit (zero reads).
//
// This module is the SINGLE source of truth for the STRUCTURE score + the v172
// field-alignment gate. `index.html`'s `_ratingStructure()` is its browser twin
// and MUST stay in lock-step — a convergence test (tests/rate/rateCore.test.mjs)
// runs the live in-app function and asserts identical output.
//
// UMD: require() in Node/tests; inlined into the static checker page it exposes
// `GPJRateCore` on the page global. Pure — no I/O, no globals read.
// ============================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GPJRateCore = api;
}(typeof self !== 'undefined' ? self : this, function () {

  // Kept in lock-step with index.html:8980 (also the twin of scoreCore.js).
  const GENERIC_ROLE_WORDS = new Set([
    'specialist', 'manager', 'assistant', 'coordinator', 'associate', 'analyst',
    'representative', 'administrator', 'officer', 'agent', 'clerk', 'lead', 'senior',
    'junior', 'staff', 'team', 'member', 'supervisor', 'director', 'executive',
    'professional', 'consultant', 'generalist', 'intern', 'trainee', 'worker',
    'technician', 'support', 'services', 'service', 'general',
  ]);

  // Twin of index.html:6700 — same list, same two spelling relaxations so the
  // verb match is stem-tolerant ("optimized"/"optimize", "spearheaded"/"spearhead").
  const STRONG_VERBS = ['led', 'built', 'drove', 'grew', 'managed', 'created', 'launched', 'delivered', 'improved', 'reduced', 'increased', 'designed', 'developed', 'owned', 'negotiated', 'trained', 'implemented', 'streamlined', 'coordinated', 'achieved', 'generated', 'expanded', 'optimized', 'spearheaded', 'oversaw', 'directed', 'boosted', 'handled', 'processed', 'maintained', 'supported', 'resolved', 'executed', 'organized', 'analyzed', 'produced', 'established'];
  const STRONG_VERBS_RX = new RegExp('^(?:' + STRONG_VERBS.join('|').replace('optimized', 'optimi').replace('spearheaded', 'spearhead') + ')', 'i');

  // v179: "Résumé Strength" rubric — outcomes, quantification, verb strength+variety,
  // concision. LOCK-STEP with index.html _ratingStructure (convergence test).
  const OUTCOME_RX = /\b(increas|grew|grow|reduc|improv|drove|driv|boost|cut |saved|saving|generat|expand|rais|lower|accelerat|doubl|tripl|decreas|gain|earned|won|achiev|exceed|surpass|streamlin|optimi|deliver|drove|led to|resulting)/i;
  const FILLER_RX = /responsible for|duties included|tasked with|hard[\s-]?working|team player|results?[\s-]driven|detail[\s-]oriented|go-getter|self-starter|synergy|think outside the box|proven track record|dynamic professional|hit the ground running|wear(s|ing)? many hats/i;
  const PASSIVE_RX = /\b(was|were|been|being)\s+[a-z]+(ed|en)\b/i;

  /**
   * STRENGTH score — how strong the résumé is (not just structurally complete). Pure
   * port of index.html's `_ratingStructure()`, parameterized on the résumé object.
   *   resume: { name, contact, summary, skills, jobs:[{b}] }
   * Returns { pts, max:60, items:[[ok,label]], needsMetrics }.
   */
  function rateStructure(resume) {
    const me = resume || {};
    const skills = String(me.skills || '').split(/[·,]/).map(function (x) { return x.trim(); }).filter(Boolean);
    const bullets = [];
    (me.jobs || []).forEach(function (j) {
      String((j && j.b) || '').split(/\n/).forEach(function (b) { b = b.trim(); if (b.length > 8) bullets.push(b); });
    });
    const nB = bullets.length || 1;
    const quantified = bullets.filter(function (b) { return /\d|%|\$/.test(b); }).length;
    const strongStart = bullets.filter(function (b) { return STRONG_VERBS_RX.test(b.replace(/^[•\-\s]+/, '')); }).length;
    const impact = bullets.filter(function (b) { return (/\d|%|\$/.test(b)) && OUTCOME_RX.test(b); }).length;
    const leads = {}; bullets.forEach(function (b) { const w = b.replace(/^[•\-\s]+/, '').split(/\s+/)[0]; if (w) leads[w.toLowerCase()] = 1; });
    const variety = bullets.length ? Object.keys(leads).length / bullets.length : 0;
    const fillerN = bullets.filter(function (b) { return FILLER_RX.test(b); }).length;
    const passiveN = bullets.filter(function (b) { return PASSIVE_RX.test(b); }).length;
    const bloatN = bullets.filter(function (b) { return b.split(/\s+/).length > 34; }).length;
    const cleanIssues = (fillerN > 0 ? 1 : 0) + (passiveN > 0 ? 1 : 0) + (bloatN > 0 ? 1 : 0);

    const items = []; let pts = 0;
    const contact = !!(me.name && me.contact); pts += contact ? 6 : 0; items.push([contact, 'Contact details complete']);
    const hasSummary = !!(me.summary && me.summary.length > 30); pts += hasSummary ? 4 : 0; items.push([hasSummary, 'Has a professional summary']);
    const skOk = skills.length >= 6; pts += skOk ? 5 : Math.round(skills.length / 6 * 5); items.push([skOk, skills.length + ' skills listed (aim 6+)']);
    const blOk = bullets.length >= 6; pts += blOk ? 5 : Math.round(bullets.length / 6 * 5); items.push([blOk, bullets.length + ' experience bullets (aim 6+)']);
    const qFrac = quantified / nB; pts += Math.round(Math.min(1, qFrac / 0.4) * 12); items.push([qFrac >= 0.3, quantified + ' of ' + bullets.length + ' bullets are quantified']);
    const impFrac = impact / nB; pts += Math.round(Math.min(1, impFrac / 0.35) * 12); items.push([impFrac >= 0.3, impact + ' bullets show a measurable OUTCOME (not just a task)']);
    const vFrac = strongStart / nB; pts += Math.round(Math.min(1, vFrac / 0.5) * 6) + Math.round(Math.min(1, variety / 0.7) * 2); items.push([vFrac >= 0.4 && variety >= 0.6, 'Verbs are strong and varied']);
    const cleanPts = Math.max(0, 8 - cleanIssues * 3); pts += cleanPts; items.push([cleanIssues === 0, cleanIssues === 0 ? 'Tight & clean — no filler or passive phrasing' : ((fillerN + passiveN + bloatN) + ' phrase(s) to tighten (filler / passive / too long)')]);
    // v214 Q2: soft-skill dilution + near-duplicate bullets. LOCK-STEP with index.html.
    const weakN = skills.filter(function (s) { return WEAK_SKILL[String(s).toLowerCase()] === 1; }).length;
    const softOk = weakN <= 2; pts -= Math.min(6, Math.max(0, weakN - 2) * 2);
    items.push([softOk, softOk ? 'Skills read specific — little soft-skill filler' : (weakN + ' soft/filler skills dilute your list — swap for hard skills')]);
    const dupN = countDupeBullets(bullets);
    const dupOk = dupN === 0; pts -= Math.min(6, dupN * 3);
    items.push([dupOk, dupOk ? 'No repeated bullets across roles' : (dupN + ' near-duplicate bullet(s) across roles — vary them')]);
    pts = Math.max(0, pts);
    return { pts: Math.min(60, pts), max: 60, items: items, needsMetrics: (bullets.length > 0 && qFrac < 0.3) };
  }
  // v214 Q2 shared helpers — LOCK-STEP with index.html _WEAK_SKILL / _countDupeBullets.
  const WEAK_SKILL = { 'communication': 1, 'communications': 1, 'scheduling': 1, 'documentation': 1, 'teamwork': 1, 'organization': 1, 'organized': 1, 'multitasking': 1, 'time management': 1, 'microsoft word': 1, 'word': 1, 'detail oriented': 1, 'detail-oriented': 1, 'hard working': 1, 'hard-working': 1, 'problem solving': 1, 'problem-solving': 1, 'critical thinking': 1, 'work ethic': 1, 'punctuality': 1, 'flexibility': 1, 'adaptability': 1, 'interpersonal': 1, 'interpersonal skills': 1, 'fast learner': 1, 'self motivated': 1, 'self-motivated': 1, 'team player': 1, 'reliability': 1, 'positive attitude': 1 };
  function countDupeBullets(bullets) {
    var words = function (b) { return String(b).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 3; }).map(function (w) { return w.length >= 6 ? w.slice(0, 6) : w; }); };
    var n = 0;
    for (var i = 0; i < bullets.length; i++) {
      var aw = words(bullets[i]); if (aw.length < 4) continue; var aset = {}; aw.forEach(function (w) { aset[w] = 1; });
      for (var j = i + 1; j < bullets.length; j++) {
        var bw = words(bullets[j]); if (bw.length < 4) continue;
        var inter = 0, seen = {}; bw.forEach(function (w) { if (aset[w] && !seen[w]) { inter++; seen[w] = 1; } });
        var uni = Object.keys(aset).length + bw.filter(function (w) { return !aset[w]; }).length;
        if (uni > 0 && (inter / uni) >= 0.5) { n++; break; }
      }
    }
    return n;
  }

  /** Strength score 1–100 (the ring the public checker shows for free). */
  function qualityScore(resume) {
    const st = rateStructure(resume);
    return Math.max(1, Math.min(100, st.max ? Math.round(st.pts / st.max * 100) : 1));
  }

  /**
   * v172 field-alignment gate. If the target role names a FIELD word (non-generic,
   * len>3) and NONE of those words appear in the résumé text, the résumé is out of
   * that field → Role Fit must be capped (transferable overlap only). Pure twin of
   * the guard in index.html's rateResume().
   */
  function isOutOfField(role, resumeText) {
    const toks = String(role || '').toLowerCase().split(/\s+/).filter(function (w) {
      return w.length > 3 && !GENERIC_ROLE_WORDS.has(w);
    });
    if (!toks.length) return false;
    const rt = String(resumeText || '').toLowerCase();
    return !toks.some(function (w) { return rt.indexOf(w) >= 0; });
  }

  return { rateStructure: rateStructure, qualityScore: qualityScore, isOutOfField: isOutOfField, GENERIC_ROLE_WORDS: GENERIC_ROLE_WORDS, STRONG_VERBS: STRONG_VERBS };
}));
