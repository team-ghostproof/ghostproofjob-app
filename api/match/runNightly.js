'use strict';
// CLI entry for the nightly reverse-match batch (GitHub Action).
//   node api/match/runNightly.js
// Builds match tokens from opted-in profiles, then recomputes recommendations
// for every LIVE internal job. Needs FIREBASE_SERVICE_ACCOUNT. Never touches
// the candidate hot path; reads bounded by caps (D1-conscious).
const buildTokens = require('./buildMatchTokens');
const runner = require('./runReverseMatch');

async function main() {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  // v143: this used to `process.exit(0)` — a SILENT SUCCESS. A missing secret, an
  // empty opted-in pool, and a genuine no-match all produced the same green check
  // with no output, so the founder ran the workflow, saw it pass, and got nothing
  // back with no way to tell which stage failed. A missing credential is a broken
  // pipeline, not a no-op: fail loudly so the run goes red.
  if (!svc) { console.error('[reverse-match] FATAL: FIREBASE_SERVICE_ACCOUNT is not set on this repo. The nightly cannot read profiles or write recommendations.'); process.exit(1); }
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  const t = await buildTokens.run(db);
  console.log('[reverse-match] tokens:', JSON.stringify(t));
  const r = await runner.runAll(db);
  console.log('[reverse-match] recommendations:', JSON.stringify(r));

  // v143: name the specific dead end instead of leaving a green check to be read as
  // "it worked". Each of these is a DIFFERENT fix, and previously they were
  // indistinguishable from the outside.
  if (!t.discoverable) console.warn('[reverse-match] WARNING: zero profiles have discoverable==true — the candidate pool is empty, so no job can match anyone. Nothing downstream can fix this.');
  else if (!t.tokensWritten) console.warn('[reverse-match] WARNING: ' + t.discoverable + ' discoverable profile(s) found but NO tokens written — every one lacked both a resume title and skills.');
  if (!r.jobs) console.warn('[reverse-match] WARNING: no LIVE internal jobs found (source==internal AND active==true) — there is nothing to match candidates against.');
  else if (!r.totalRecs) console.warn('[reverse-match] WARNING: ' + r.jobs + ' live job(s) scored against ' + t.tokensWritten + ' token(s) but produced ZERO recommendations — the usual cause is a market mismatch (inScope requires the same city/state unless the job or candidate is remote).');

  // Durable run record so the result is visible in-app instead of only in CI logs
  // that expire. Written last so a partial failure never reports success.
  try {
    await db.collection('admin_runs').doc('reverse_match').set({
      ts: Date.now(), discoverable: t.discoverable || 0, tokensWritten: t.tokensWritten || 0,
      jobs: r.jobs || 0, totalRecs: r.totalRecs || 0, ok: true,
    }, { merge: true });
  } catch (e) { console.warn('[reverse-match] could not write run record:', e && e.message); }
}
main().catch((e) => { console.error('[reverse-match] failed:', e && e.message); process.exit(1); });
