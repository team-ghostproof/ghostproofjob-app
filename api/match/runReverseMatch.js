'use strict';
// ============================================================================
// GhostProofJob — Reverse-Match Runner  (R3 backend)
// ----------------------------------------------------------------------------
// For ONE job: score the OPTED-IN candidate pool (match_tokens — discoverable
// only) and write the top-N to jobs/{jobId}/recommended_candidates. Backend-only
// (firebase-admin); the pure projection `buildRecommendations` is unit-tested.
//
// CONSENT MODEL (recruiter-tier.md §1): the pool is discoverable candidates ONLY,
// so every surfaced candidate has consented to be found AND contacted — their
// name + contact ride along. Applicants who never opted in are NOT surfaced here
// (the recruiter still sees their application via the R2-C applicant count).
// The `applied` flag marks an opted-in candidate who also applied (ranked first).
// ============================================================================

const { reverseMatch } = require('./reverseMatch');

/** Pure: job + discoverable token pool + applied uids → recommended_candidates docs. */
function buildRecommendations(job, pool, appliedUids, opts) {
  opts = opts || {};
  const appliedSet = new Set(appliedUids || []);
  const tokenByUid = {};
  (pool || []).forEach((t) => { if (t && t.uid) tokenByUid[t.uid] = t; });
  // stamp applied so the scorer ranks applicants first (it reads appliedJobIds)
  const augmented = (pool || []).map((t) => (t && appliedSet.has(t.uid)
    ? Object.assign({}, t, { appliedJobIds: (t.appliedJobIds || []).concat(job.id) })
    : t));
  const ranked = reverseMatch(job, augmented, { topN: opts.topN || 50 });
  const now = Date.now();
  return ranked.map((r) => {
    const t = tokenByUid[r.uid] || {};
    return {
      uid: r.uid,
      score: r.score,
      matched: r.matched || [],
      market: t.market || '',
      applied: appliedSet.has(r.uid) || !!r.applied,
      // discoverable pool → consented; name + contact are visible to the verified owner recruiter
      displayName: t.displayName || '',
      contact: t.contact || '',
      jobId: job.id || '',
      ts: now,
    };
  });
}

/** Orchestration for one job. Requires firebase-admin `db`. */
async function run(db, jobId, opts) {
  opts = opts || {};
  const jobDoc = await db.collection('jobs').doc(jobId).get();
  if (!jobDoc.exists) return { error: 'job_not_found' };
  const j = jobDoc.data() || {};
  if (j.source !== 'internal') return { error: 'not_internal' };
  const job = { id: jobId, title: j.title, req: j.requirements, desc: j.description, market: j.region || j.location, is_remote: j.is_remote === true };

  // load the opted-in pool (bounded); inScope() in the scorer trims to market
  const poolSnap = await db.collection('match_tokens').limit(opts.cap || 5000).get();
  const pool = poolSnap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));

  // applied uids for this job (subcollection ids)
  const appSnap = await db.collection('jobs').doc(jobId).collection('applications').limit(2000).get();
  const appliedUids = appSnap.docs.map((d) => d.id);

  const recs = buildRecommendations(job, pool, appliedUids, opts);

  // replace the job's recommendation set
  const recCol = db.collection('jobs').doc(jobId).collection('recommended_candidates');
  const existing = await recCol.get();
  let batch = db.batch(); let pending = 0;
  existing.docs.forEach((d) => { batch.delete(d.ref); pending++; });
  recs.forEach((rec) => { batch.set(recCol.doc(rec.uid), rec); pending++; });
  if (pending) await batch.commit();
  return { poolSize: pool.length, scoped: recs.length, applied: appliedUids.length };
}

/** Batch trigger: run every LIVE internal job (nightly Action). */
async function runAll(db, opts) {
  const snap = await db.collection('jobs').where('source', '==', 'internal').where('active', '==', true).limit((opts && opts.jobCap) || 500).get();
  const out = { jobs: 0, totalRecs: 0 };
  for (const d of snap.docs) {
    const r = await run(db, d.id, opts);
    out.jobs++; out.totalRecs += (r.scoped || 0);
  }
  return out;
}

module.exports = { buildRecommendations, run, runAll };
