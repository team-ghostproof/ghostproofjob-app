// ============================================================================
// GhostProofJob — Reverse-Match Scorer (R0 skeleton; R3 fleshes out)
// ----------------------------------------------------------------------------
// ARCHITECTURAL RULE (recruiter-tier.md §5): the reverse-match scorer is authored
// IN-REPO so it is unit-testable — NOT only inside the opaque Cloudflare Worker.
// The Worker (or a Cloud Function) imports this module; tests import it directly.
//
// It is the INVERSE of the candidate-side computeMatch: given a job, score a pool
// of candidate match-token docs and return the top-N, LOCAL-MARKET-SCOPED.
// Pure (no Firestore / no network) so it is deterministic and testable.
//
// Candidate token doc shape (from `match_tokens/{uid}`, backend-extracted):
//   { uid, title, skills:[...], market, is_remote, appliedJobIds:[...] }
// Job shape: { id, title, req, desc, market, is_remote }
// ============================================================================
'use strict';

// v146 P-MATCH: the scoring math now lives in ONE shared module so the recruiter
// side and the candidate side produce the SAME number for the same pair.
const { scoreMatch } = require('./scoreCore');

const GENERIC_ROLE_WORDS = new Set([
  'specialist', 'manager', 'assistant', 'coordinator', 'associate', 'analyst',
  'representative', 'administrator', 'officer', 'agent', 'clerk', 'lead', 'senior',
  'junior', 'staff', 'team', 'member', 'supervisor', 'director', 'executive',
  'professional', 'consultant', 'generalist', 'intern', 'trainee', 'worker',
  'technician', 'support', 'services', 'service', 'general',
]);

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
}
function fieldWords(s) { return words(s).filter((w) => !GENERIC_ROLE_WORDS.has(w)); }

// A job's market and a candidate's market are "same market" if their metro/state
// text overlaps. R3 replaces this with the shared jobMatchesLocation / F-GEO
// haversine check; here it is a conservative text match so the skeleton is real.
function sameMarket(jobMarket, candMarket) {
  const j = String(jobMarket || '').toLowerCase().trim();
  const c = String(candMarket || '').toLowerCase().trim();
  if (!j || !c) return false;
  if (j === c) return true;
  const jState = (j.split(',')[1] || '').trim();
  const cState = (c.split(',')[1] || '').trim();
  const jCity = (j.split(',')[0] || '').trim();
  const cCity = (c.split(',')[0] || '').trim();
  return (jCity && jCity === cCity) || (!!jState && jState === cState);
}

// Is this candidate in scope for this job? Remote job → the whole remote pool;
// on-site job → candidates in the same market (or remote candidates who match).
function inScope(job, cand) {
  if (job.is_remote === true) return true;                 // remote job: any candidate
  if (cand.is_remote === true) return true;                // remote-willing candidate
  return sameMarket(job.market, cand.market);
}

/** Score ONE candidate against a job → { score, matched, missing }.
 *  v146: delegates to the shared scoreCore so the recruiter number equals the
 *  candidate number for the same pair. The candidate input is built from the
 *  ENRICHED token (title + duties roles + skills + summary + req/desc) instead of
 *  the old title+skills-only view that made the two sides disagree. */
function scoreCandidateForJob(job, cand) {
  return scoreMatch(
    { title: cand.title, roles: cand.roles || [], skills: cand.skills || [], summary: cand.summary || '' },
    { title: job.title, desc: `${job.desc || ''} ${job.req || ''}`.trim() },
  );
}

/**
 * Reverse-match a job against a candidate pool.
 * @param job   { id, title, req, desc, market, is_remote }
 * @param pool  Array of candidate token docs
 * @param opts  { topN=50 }
 * @returns Array<{ uid, score, matched, missing, applied }> sorted desc, scoped.
 */
function reverseMatch(job, pool, opts) {
  opts = opts || {};
  const topN = opts.topN || 50;
  if (!job || !Array.isArray(pool) || !pool.length) return [];
  const scoped = pool.filter((c) => inScope(job, c));
  const scored = scoped.map((c) => {
    const s = scoreCandidateForJob(job, c);
    return {
      uid: c.uid,
      score: s.score,
      matched: s.matched,
      missing: s.missing,
      applied: Array.isArray(c.appliedJobIds) && c.appliedJobIds.indexOf(job.id) >= 0,
    };
  });
  // applied candidates first (already interested), then by score desc
  scored.sort((a, b) => (b.applied - a.applied) || (b.score - a.score));
  return scored.slice(0, topN);
}

module.exports = { reverseMatch, scoreCandidateForJob, inScope, sameMarket, GENERIC_ROLE_WORDS };
