'use strict';
/* ============================================================================
 * GhostProofJob — Weekly Ghost-Data adapter  (Sprint 4, growth automation)
 * ----------------------------------------------------------------------------
 * The single data source for the weekly content pack. It returns a NORMALIZED,
 * already-aggregated snapshot — the content generator never touches Firestore.
 *
 * TWO data sources:
 *   1. JOBS collection (LIVE TODAY): stale-posting rates by city/role. These are
 *      factual, derived from each doc's posting age — GPJ's core "ghost job"
 *      signal. Available now, zero dependency.
 *   2. GHOST_REPORTS collection (needs F-GHOST — NOT built yet): community flags
 *      per company. Until F-GHOST writes reports to Firestore, this returns [].
 *      A fixture can stand in for local/dev runs.
 *
 * Usage:
 *   getWeeklyGhostData()                 // live: firebase-admin (needs service acct)
 *   getWeeklyGhostData({ fixture })      // offline/test: pass a snapshot object
 *
 * NEVER posts anywhere. NEVER writes. Read-only aggregation for founder review.
 * ==========================================================================*/

const STALE_DAYS = 30;             // a posting older than this reads as a likely ghost job
const SAMPLE_CAP = 5000;           // cap docs scanned (read-cost guard; D1)
const MIN_CITY_SAMPLE = 8;         // don't publish a city rate from too-thin data

function _todayISO() { return new Date().toISOString().slice(0, 10); }

function _cityOf(loc) {
  const s = String(loc || '').trim();
  if (!s) return '';
  if (/\bremote\b/i.test(s)) return 'Remote';
  return s.split(',')[0].trim();
}

function _ageDays(rec) {
  const raw = rec.date_posted || rec.created || rec.ingestedAt || rec.posting_age_days;
  if (typeof rec.posting_age_days === 'number') return rec.posting_age_days;
  const t = raw && (raw.toMillis ? raw.toMillis() : Date.parse(raw));
  if (!t || isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* Aggregate an array of job records into stale-rate stats. Pure — unit-tested. */
function aggregateJobs(jobs) {
  let sampled = 0, staleCount = 0;
  const byCity = {};
  (jobs || []).forEach((j) => {
    const age = _ageDays(j);
    if (age === null) return;
    sampled++;
    const stale = age >= STALE_DAYS;
    if (stale) staleCount++;
    const city = _cityOf(j.location || j.loc);
    if (!city) return;
    const c = (byCity[city] = byCity[city] || { city, sampled: 0, stale: 0 });
    c.sampled++; if (stale) c.stale++;
  });
  const topStaleCities = Object.values(byCity)
    .filter((c) => c.sampled >= MIN_CITY_SAMPLE)
    .map((c) => ({ city: c.city, sampled: c.sampled, stalePct: Math.round((c.stale / c.sampled) * 100) }))
    .sort((a, b) => b.stalePct - a.stalePct)
    .slice(0, 5);
  return {
    sampled,
    staleCount,
    stalePct: sampled ? Math.round((staleCount / sampled) * 100) : 0,
    staleDays: STALE_DAYS,
    topStaleCities,
  };
}

/* Aggregate raw ghost-report docs (F-GHOST shape) into per-company counts. */
function aggregateReports(reports) {
  const byCo = {};
  (reports || []).forEach((r) => {
    const co = String(r.company || '').trim();
    if (!co) return;
    const c = (byCo[co] = byCo[co] || { company: co, reports: 0, stages: {} });
    c.reports++;
    const st = String(r.stage || 'unspecified');
    c.stages[st] = (c.stages[st] || 0) + 1;
  });
  return Object.values(byCo)
    .map((c) => ({ company: c.company, reports: c.reports, topStage: Object.entries(c.stages).sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.reports - a.reports);
}

async function _liveSnapshot() {
  /* lazy-require so tests / fixture runs need no firebase-admin install */
  let admin;
  try { admin = require('firebase-admin'); }
  catch (e) { throw new Error('firebase-admin not available — pass { fixture } for offline runs'); }
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) throw new Error('FIREBASE_SERVICE_ACCOUNT not set — cannot read live data');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  }
  const db = admin.firestore();
  const jobsSnap = await db.collection('jobs').orderBy('ingestedAt', 'desc').limit(SAMPLE_CAP).get();
  const jobs = jobsSnap.docs.map((d) => d.data());
  let reports = [];
  try {
    const rSnap = await db.collection('ghost_reports').limit(SAMPLE_CAP).get();  // F-GHOST target collection
    reports = rSnap.docs.map((d) => d.data());
  } catch (e) { /* collection doesn't exist until F-GHOST — leave empty */ }
  return { jobs, reports };
}

async function getWeeklyGhostData(opts = {}) {
  const snap = opts.fixture || (await _liveSnapshot());
  const jobsStats = aggregateJobs(snap.jobs || []);
  const reportedCompanies = aggregateReports(snap.reports || []);
  return {
    weekOf: _todayISO(),
    jobsStats,
    reportedCompanies,                 // [] until F-GHOST aggregates reports to Firestore
    greenFlags: snap.greenFlags || [], // curated/responsive companies (optional input)
    _note: reportedCompanies.length ? undefined
      : 'No Firestore ghost-report aggregate yet (F-GHOST unbuilt) — community-company posts are omitted; ghost-JOB stats below are live.',
  };
}

module.exports = { getWeeklyGhostData, aggregateJobs, aggregateReports, STALE_DAYS, MIN_CITY_SAMPLE };
