'use strict';
/**
 * CLOUD FUNCTIONS ENTRY POINT
 * ----------------------------
 * Wires the three ingestion layers + Firestore writer into deployable functions.
 *
 *   ingestRegionAndAts  — scheduled: pull regional API + ATS boards, write to Firestore.
 *   resolveJobLink      — callable/HTTP: resolve one aggregator link on demand.
 *
 * Uses firebase-functions v2 (region/memory configurable). Admin SDK is
 * initialized once per cold start.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const { routeRegionalSearch } = require('./sources/regionalRouter');
const { ingestAtsBatch } = require('./sources/atsIngest');
const { resolveLink } = require('./sources/redirectResolver');
const { writeJobs } = require('./sources/firestoreWriter');

// Boards to poll each run. In production, read this from a Firestore config doc
// or env so you can add employers without redeploying.
const ATS_BOARDS = [
  { type: 'greenhouse', token: 'stripe' },
  { type: 'lever', token: 'netflix' },
];
const REGIONS = [
  { country: 'US', what: 'engineer' },
  { country: 'GB', what: 'engineer' },
  { country: 'FR', what: 'developer' },
];

/** Scheduled ingestion: regional APIs + ATS boards → Firestore. */
exports.ingestRegionAndAts = onSchedule(
  { schedule: 'every 6 hours', timeoutSeconds: 300, memory: '512MiB', region: 'us-central1' },
  async () => {
    const collected = [];

    // Regional providers (sequential to bound concurrency/memory).
    for (const r of REGIONS) {
      const jobs = await routeRegionalSearch(r, process.env);
      for (const j of jobs) collected.push(j);
    }

    // ATS boards (bounded concurrency inside the helper).
    const atsJobs = await ingestAtsBatch(ATS_BOARDS, 4);
    for (const j of atsJobs) collected.push(j);

    const result = await writeJobs(db, FieldValue, collected);
    console.log(`[ingest] collected=${collected.length} written=${result.written} batches=${result.batches}`);
    return null;
  }
);

/**
 * On-demand link resolution (called from the app when a user taps a job).
 * Resolving lazily keeps the heavy Chromium work off the bulk ingestion path.
 */
exports.resolveJobLink = onCall(
  { timeoutSeconds: 30, memory: '1GiB', region: 'us-central1' },
  async (request) => {
    const url = request && request.data && request.data.url;
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new HttpsError('invalid-argument', 'A valid http(s) url is required.');
    }
    const out = await resolveLink(url);
    return out; // { url, resolved }
  }
);
