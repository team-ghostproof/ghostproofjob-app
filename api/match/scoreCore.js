'use strict';
// ============================================================================
// GhostProofJob — SHARED bidirectional match scorer (v146 P-MATCH).
// ----------------------------------------------------------------------------
// THE PROBLEM this fixes (founder-caught): the candidate side showed 98% for a
// (résumé, job) pair while the recruiter side showed 75% for the SAME pair. Two
// causes: (1) two different algorithms, and (2) the reverse side scored against a
// stripped-down token (title + skills only) that could not see the candidate's
// DUTIES or summary — the very content computeMatch weighs.
//
// This module is the SINGLE source of truth for match math. It is a faithful,
// pure extraction of the candidate-side computeMatch algorithm, so scoring a pair
// from either direction gives the SAME number. index.html's computeMatch is its
// browser twin and MUST stay in lock-step (there is a convergence test).
//
// Inputs are normalized so either side can call it:
//   candidate: { title, roles:[{t,b}], skills:[...], summary }
//   job:       { title, desc }
// Pure (no I/O). Returns { score, matched, missing }.
// ============================================================================

const GENERIC_ROLE_WORDS = new Set([
  'specialist', 'manager', 'assistant', 'coordinator', 'associate', 'analyst',
  'representative', 'administrator', 'officer', 'agent', 'clerk', 'lead', 'senior',
  'junior', 'staff', 'team', 'member', 'supervisor', 'director', 'executive',
  'professional', 'consultant', 'generalist', 'intern', 'trainee', 'worker',
  'technician', 'support', 'services', 'service', 'general',
]);

function _lc(s) { return String(s == null ? '' : s).toLowerCase(); }
function _words(s) { return _lc(s).split(/\s+/).filter((w) => w.length > 3); }
function _splitSkills(s) {
  if (Array.isArray(s)) return s.map((x) => _lc(x).trim()).filter(Boolean);
  return _lc(s).split(/[·,]/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Score a candidate against a job. Faithful to index.html computeMatch.
 * @returns {{score:number, matched:string[], missing:string[]}}
 */
function scoreMatch(candidate, job) {
  candidate = candidate || {};
  job = job || {};
  const jt = _lc(job.title);
  const jd = _lc(job.desc);

  const title = String(candidate.title || '').trim();
  const roleObjs = Array.isArray(candidate.roles) ? candidate.roles : [];
  const skills = _splitSkills(candidate.skills);
  const summary = String(candidate.summary || '');

  if (!title && !skills.length) return { score: 52, matched: [], missing: [] };

  // FULL experience corpus — real DUTIES count, not just titles (computeMatch _cp).
  const cp = [];
  if (title) cp.push(title);
  roleObjs.forEach((r) => { if (r) { if (r.t && r.t !== '(role)') cp.push(r.t); if (r.b) cp.push(r.b); } });
  if (candidate.skills) cp.push(Array.isArray(candidate.skills) ? candidate.skills.join(' ') : candidate.skills);
  if (summary) cp.push(summary);
  const myCorpus = _lc(cp.join(' '));

  const jtWords = jt.split(/\s+/).filter((w) => w.length > 3);
  const jtFieldWords = jtWords.filter((w) => !GENERIC_ROLE_WORDS.has(w));

  // recency-ordered roles (current title first)
  const roles = [];
  if (title) roles.push(_lc(title));
  roleObjs.forEach((r) => { if (r && r.t && r.t !== '(role)') roles.push(_lc(r.t)); });
  if (!roles.length) roles.push('');

  const matched = [];
  function scoreAgainstRole(roleStr) {
    const rWordsAll = roleStr.split(/\s+/).filter((w) => w.length > 3);
    const rFieldWords = new Set(rWordsAll.filter((w) => !GENERIC_ROLE_WORDS.has(w)));
    const rWords = new Set(rWordsAll);
    let s = 22;
    let fieldHits = 0;
    jtFieldWords.forEach((w) => { if (rFieldWords.has(w)) { fieldHits++; if (matched.indexOf(w) < 0) matched.push(w); } });
    if (jtFieldWords.length) s += Math.round((fieldHits / jtFieldWords.length) * 50);
    if (fieldHits > 0) s += 12;
    let genHits = 0; jtWords.forEach((w) => { if (GENERIC_ROLE_WORDS.has(w) && rWords.has(w)) genHits++; });
    if (genHits) s += Math.min(8, genHits * 4);
    return { score: s, fieldHits };
  }

  let best = 0, bestFieldHits = 0;
  roles.forEach((roleStr, idx) => {
    const weight = Math.max(0.7, 1 - idx * 0.08);
    const r = scoreAgainstRole(roleStr);
    const weighted = Math.round(22 + (r.score - 22) * weight);
    if (weighted > best) { best = weighted; bestFieldHits = r.fieldHits; }
  });

  let titleSkillHits = 0, descSkillHits = 0;
  skills.forEach((sk) => { if (!sk) return; if (jt.includes(sk)) { titleSkillHits++; if (matched.indexOf(sk) < 0) matched.push(sk); } else if (jd.includes(sk)) { descSkillHits++; if (matched.indexOf(sk) < 0) matched.push(sk); } });
  let score = best;
  if (titleSkillHits > 0) { score += 22 + Math.min(12, (titleSkillHits - 1) * 6); }
  if (skills.length && descSkillHits) score += Math.round((descSkillHits / skills.length) * 18);
  const anySkill = (titleSkillHits + descSkillHits) > 0;

  let corpusFieldHits = 0;
  jtFieldWords.forEach((w) => { if (myCorpus.indexOf(w) >= 0) corpusFieldHits++; });
  if (jtFieldWords.length) { score += Math.round((corpusFieldHits / jtFieldWords.length) * 20); }

  const seen = new Set(); let jdHits = 0, jdTot = 0;
  jd.split(/[^a-z]+/).forEach((w) => { if (w.length < 6 || GENERIC_ROLE_WORDS.has(w) || seen.has(w)) return; if (jdTot >= 16) return; seen.add(w); jdTot++; if (myCorpus.indexOf(w) >= 0) jdHits++; });
  if (jdTot) score += Math.round((jdHits / jdTot) * 6);

  const anyRelevant = (bestFieldHits > 0) || anySkill || (corpusFieldHits > 0);
  if (jtFieldWords.length && !anyRelevant) score = Math.min(score, 32);
  score = Math.max(18, Math.min(98, score));

  // the job field words with NO signal anywhere in the candidate → "missing"
  const missing = [];
  jtFieldWords.forEach((w) => { if (myCorpus.indexOf(w) < 0) missing.push(w); });

  return { score, matched: matched.slice(0, 12), missing: missing.slice(0, 8) };
}

module.exports = { scoreMatch, GENERIC_ROLE_WORDS };
