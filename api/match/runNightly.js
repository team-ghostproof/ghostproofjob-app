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
  if (!svc) { console.error('FIREBASE_SERVICE_ACCOUNT not set — skipping.'); process.exit(0); }
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  const t = await buildTokens.run(db);
  console.log('[reverse-match] tokens:', JSON.stringify(t));
  const r = await runner.runAll(db);
  console.log('[reverse-match] recommendations:', JSON.stringify(r));
}
main().catch((e) => { console.error('[reverse-match] failed:', e && e.message); process.exit(1); });
