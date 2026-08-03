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

  /**
   * STRUCTURE score — the "how well is it BUILT" half of the rater. Pure port of
   * index.html's `_ratingStructure()` (index.html:9540), parameterized on the
   * résumé object instead of the `resumeData` global.
   *   resume: { name, contact, summary, skills, jobs:[{b}] }
   * Returns { pts, max:45, items:[[ok,label]], needsMetrics }.
   */
  function rateStructure(resume) {
    const me = resume || {};
    const skills = String(me.skills || '').split(/[·,]/).map(function (x) { return x.trim(); }).filter(Boolean);
    const bullets = [];
    (me.jobs || []).forEach(function (j) {
      String((j && j.b) || '').split(/\n/).forEach(function (b) { b = b.trim(); if (b.length > 8) bullets.push(b); });
    });
    const quantified = bullets.filter(function (b) { return /\d|%|\$/.test(b); }).length;
    const strongStart = bullets.filter(function (b) { return STRONG_VERBS_RX.test(b.replace(/^[•\-\s]+/, '')); }).length;
    const items = []; let pts = 0;
    const contact = !!(me.name && me.contact); if (contact) pts += 8; items.push([contact, 'Contact details complete']);
    const hasSummary = !!(me.summary && me.summary.length > 30); if (hasSummary) pts += 5; items.push([hasSummary, 'Has a summary / headline']);
    const skOk = skills.length >= 6; pts += skOk ? 8 : Math.round(skills.length / 6 * 8); items.push([skOk, skills.length + ' skills listed (aim 6+)']);
    const blOk = bullets.length >= 6; pts += blOk ? 8 : Math.round(bullets.length / 6 * 8); items.push([blOk, bullets.length + ' experience bullets (aim 6+)']);
    const qFrac = bullets.length ? quantified / bullets.length : 0; pts += Math.round(Math.min(1, qFrac / 0.4) * 10); items.push([qFrac >= 0.3, quantified + ' bullets with numbers/metrics']);
    const vFrac = bullets.length ? strongStart / bullets.length : 0; pts += Math.round(Math.min(1, vFrac / 0.5) * 6); items.push([vFrac >= 0.4, strongStart + ' bullets start with a strong action verb']);
    return { pts: Math.min(45, pts), max: 45, items: items, needsMetrics: (bullets.length > 0 && qFrac < 0.3) };
  }

  /** Quality score 1–100 (the ring the public checker shows for free). */
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
