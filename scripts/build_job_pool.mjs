#!/usr/bin/env node
'use strict';
/**
 * scripts/build_job_pool.mjs — D1 STEP 1: the zero-read job pool.
 * ---------------------------------------------------------------------------
 * THE PROBLEM (D1): every candidate session rebuilt the deck by reading
 * individual job docs — `fetchJobs(region, 3000)` plus a wide `8000` blend, i.e.
 * up to ~11,000 Firestore reads PER SESSION. That is fine at today's traffic and
 * ruinous the moment SEO works. `mineRoleKeywords` added another 1,200 per rate.
 *
 * THE FIX: job data is PUBLIC, IDENTICAL FOR EVERYONE, and changes once a day —
 * so it does not belong in per-user queries at all. This script runs ONCE per day
 * in GitHub Actions (free/unmetered: the repo is public), reads the live pool
 * server-side, and writes a handful of pre-built AGGREGATE "pool docs". The app
 * then reads ~1-5 docs instead of thousands.
 *
 *      deck build:  3,000-11,000 reads  ->  1-5 reads
 *
 * WHY FIRESTORE DOCS (not a CDN bucket / R2 / committed JSON):
 *   * no new vendor and no new free-tier quota to blow (CLAUDE.md rule 10),
 *   * works with the existing rules + SDK the client already loads,
 *   * committing daily JSON would add GBs/year to the git history.
 *
 * SECOND WIN — the v139 mobile OOM: raw job docs average ~7.2KB, so a 3,144-job
 * pool was ~22MB of JSON (~44MB heap as UTF-16) and Safari killed the tab. Pool
 * rows are TRIMMED to ~1.7KB, roughly a 4x cut in client memory.
 *
 * SHAPE: pool rows keep the SAME FIELD NAMES as real job docs, so mapFirestoreJob
 * and the deck's inline mapper consume them unchanged — that is what keeps this a
 * one-line seam in fetchJobs instead of a rewrite.
 *
 * DESCRIPTION BUDGET: computeMatch() scores against the job description, so a
 * hard truncation would SKEW match %. Each row keeps DESC_BUDGET chars — enough
 * for honest scoring — and the full text is lazy-loaded (1 read) only when the
 * user actually opens that job.
 *
 * Usage:
 *   node scripts/build_job_pool.mjs            # build + write (needs creds)
 *   node scripts/build_job_pool.mjs --dry-run  # build + report, write nothing
 *   node scripts/build_job_pool.mjs --fixture  # offline self-test, no creds
 *
 * Env: FIREBASE_SERVICE_ACCOUNT (same secret the reverse-match nightly uses).
 */

const DRY = process.argv.includes('--dry-run');
const FIXTURE = process.argv.includes('--fixture');

/* Firestore hard limit is 1 MiB per document. Stay well under it: the estimate
   below counts the JSON payload, and Firestore adds per-field name overhead on
   top, so a generous margin is deliberate rather than optimistic. */
const MAX_DOC_BYTES = 800 * 1024;
const DESC_BUDGET = 1500;      // enough for honest computeMatch scoring
const REQ_BUDGET = 600;
const BEN_BUDGET = 400;
const MAX_SHARDS_PER_KEY = 8;  // hard ceiling so one runaway metro can't balloon writes
const POOL_COLLECTION = 'job_pools';

const cut = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length <= n ? t : t.slice(0, n);
};

/** Trim one raw job doc to a pool row. Field NAMES must match the real doc shape
 *  so the client mappers need no special-casing. `_full` flags that description
 *  text was clipped, so the UI knows a detail fetch would add more. */
function toPoolRow(id, v) {
  const desc = String(v.description || v.desc || '');
  const req = String(v.requirements || v.req || '');
  const ben = String(v.benefits || '');
  const row = {
    _docId: id,
    title: cut(v.title, 200),
    company: typeof v.company === 'string' ? cut(v.company, 140) : cut((v.company && v.company.display_name) || '', 140),
    location: typeof v.location === 'string' ? cut(v.location, 140) : cut((v.location && v.location.display_name) || '', 140),
    description: cut(desc, DESC_BUDGET),
    requirements: cut(req, REQ_BUDGET),
    benefits: cut(ben, BEN_BUDGET),
    source: cut(v.source, 40),
    region: cut(v.region, 80),
    active: v.active !== false,
  };
  /* only carry optional fields when present — empty keys cost bytes in every row */
  if (v.direct_apply_url) row.direct_apply_url = cut(v.direct_apply_url, 500);
  else if (v.redirect_url) row.redirect_url = cut(v.redirect_url, 500);
  else if (v.url) row.url = cut(v.url, 500);
  if (v.salary_min) row.salary_min = v.salary_min;
  if (v.salary_max) row.salary_max = v.salary_max;
  if (v.salary) row.salary = cut(v.salary, 80);
  if (v.currency) row.currency = cut(v.currency, 8);
  if (v.is_hourly) row.is_hourly = true;
  if (v.is_remote) row.is_remote = true;
  if (v.job_type) row.job_type = cut(v.job_type, 40);
  if (v.work_setting) row.work_setting = cut(v.work_setting, 40);
  if (v.ingestedAt) row.ingestedAt = v.ingestedAt;
  if (v.date_posted) row.date_posted = cut(v.date_posted, 40);
  if (desc.length > DESC_BUDGET || req.length > REQ_BUDGET || ben.length > BEN_BUDGET) row._clipped = true;
  return row;
}

const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

/** Pack rows into <=MAX_DOC_BYTES shards. Returns [{key, doc}]. */
function shard(keyBase, rows, builtAt) {
  const shards = [];
  let cur = [], curBytes = 0;
  for (const r of rows) {
    const b = bytes(r) + 1;
    if (cur.length && curBytes + b > MAX_DOC_BYTES) {
      shards.push(cur); cur = []; curBytes = 0;
      /* hard ceiling: a runaway metro must not balloon the daily write count.
         Rows beyond the cap are dropped — the pool is a recency-ordered slice,
         not a mirror, and the live-query fallback still covers anything missed. */
      if (shards.length >= MAX_SHARDS_PER_KEY) break;
    }
    cur.push(r); curBytes += b;
  }
  if (cur.length && shards.length < MAX_SHARDS_PER_KEY) shards.push(cur);
  return shards.map((jobs, i) => ({
    key: `${keyBase}-${i}`,
    doc: { key: keyBase, shard: i, of: shards.length, builtAt, count: jobs.length, jobs },
  }));
}

/** slug a region/metro string into a stable doc key */
const slug = (s) => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';

/** Pure: raw docs -> the full set of pool documents to write. Unit-testable. */
export function buildPool(docs, opts = {}) {
  const builtAt = opts.now || Date.now();
  const perMetroCap = opts.perMetroCap || 2500;
  const nationalCap = opts.nationalCap || 3000;

  const live = docs.filter((d) => d.data && d.data.title && d.data.active !== false);
  /* newest first — the deck and Browse both lead with recency */
  const sorted = live.slice().sort((a, b) => (b.data.ingestedAt || 0) - (a.data.ingestedAt || 0));
  const rows = sorted.map((d) => toPoolRow(d.id, d.data));

  const out = [];

  /* 1) NATIONAL pool — the dominant path since v74: the client pulls wide and
        scopes by location text, so this is what most sessions actually read. */
  out.push(...shard('all', rows.slice(0, nationalCap), builtAt));

  /* 2) PER-METRO pools — a session that knows its region reads a smaller,
        denser slice. Keyed off the same `region` string the harvester writes. */
  const byMetro = new Map();
  for (const r of rows) {
    const k = slug(r.region);
    if (k === 'unknown') continue;
    if (!byMetro.has(k)) byMetro.set(k, []);
    const arr = byMetro.get(k);
    if (arr.length < perMetroCap) arr.push(r);
  }
  for (const [k, arr] of byMetro) out.push(...shard('metro-' + k, arr, builtAt));

  return { pools: out, stats: { live: live.length, metros: byMetro.size, docs: out.length, builtAt } };
}

/* ------------------------------- fixture ---------------------------------- */
function fixtureDocs(n = 60) {
  const metros = ['Houston, TX', 'Austin, TX', 'Remote'];
  return Array.from({ length: n }, (_, i) => ({
    id: 'job' + i,
    data: {
      title: 'Marketing Manager ' + i,
      company: 'Acme ' + (i % 7),
      location: metros[i % metros.length],
      region: metros[i % metros.length],
      description: 'Own demand generation and the content calendar. '.repeat(60),
      requirements: 'Five years B2B marketing. '.repeat(20),
      benefits: 'Health, dental, 401k. '.repeat(10),
      direct_apply_url: 'https://example.com/job/' + i,
      source: i % 5 === 0 ? 'internal' : 'indeed',
      active: true,
      ingestedAt: Date.now() - i * 1000,
      salary_min: 70000, salary_max: 90000,
    },
  }));
}

/* --------------------------------- main ----------------------------------- */
async function main() {
  if (FIXTURE) {
    const { pools, stats } = buildPool(fixtureDocs());
    let maxBytes = 0, clipped = 0;
    for (const p of pools) {
      maxBytes = Math.max(maxBytes, bytes(p.doc));
      clipped += p.doc.jobs.filter((j) => j._clipped).length;
    }
    const avg = Math.round(bytes(pools[0].doc) / pools[0].doc.count);
    console.log('[pool] FIXTURE ok');
    console.log('  live jobs      :', stats.live);
    console.log('  pool documents :', stats.docs, '(metros: ' + stats.metros + ')');
    console.log('  largest doc    :', (maxBytes / 1024).toFixed(1) + 'KB  (limit ' + (MAX_DOC_BYTES / 1024) + 'KB, Firestore hard cap 1024KB)');
    console.log('  avg row        :', avg + 'B  (raw docs average ~7200B — the v139 OOM driver)');
    console.log('  rows clipped   :', clipped, '(full text lazy-loads on open)');
    if (maxBytes > MAX_DOC_BYTES) { console.error('  FAIL: a shard exceeded the byte budget'); process.exit(1); }
    if (!pools.some((p) => p.key.startsWith('all-'))) { console.error('  FAIL: no national pool'); process.exit(1); }
    console.log('[pool] self-test PASSED');
    return;
  }

  const admin = (await import('firebase-admin')).default;
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) { console.error('[pool] FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  console.log('[pool] reading live jobs (ONE server-side pass — replaces thousands of per-session reads)…');
  const snap = await db.collection('jobs').where('active', '==', true).get();
  const docs = [];
  snap.forEach((d) => docs.push({ id: d.id, data: d.data() || {} }));
  console.log('[pool] read', docs.length, 'active job docs');

  const { pools, stats } = buildPool(docs);
  let maxBytes = 0;
  for (const p of pools) maxBytes = Math.max(maxBytes, bytes(p.doc));
  console.log('[pool] built', stats.docs, 'pool docs across', stats.metros, 'metros; largest', (maxBytes / 1024).toFixed(1) + 'KB');
  if (maxBytes > 1024 * 1024) { console.error('[pool] ABORT: a shard exceeds the 1MiB Firestore limit'); process.exit(1); }

  if (DRY) { console.log('[pool] --dry-run: nothing written'); return; }

  let wrote = 0, batch = db.batch(), pending = 0;
  for (const p of pools) {
    batch.set(db.collection(POOL_COLLECTION).doc(p.key), p.doc);
    wrote++; pending++;
    if (pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending) await batch.commit();
  /* a tiny manifest so the client can discover keys without guessing */
  await db.collection(POOL_COLLECTION).doc('_manifest').set({
    builtAt: stats.builtAt, docs: stats.docs, metros: stats.metros, liveJobs: stats.live,
    keys: pools.map((p) => p.key),
  });
  console.log('[pool] wrote', wrote, 'pool docs +1 manifest —', wrote + 1, 'writes total');
}

if (!process.env.GPJ_POOL_NO_MAIN) {
  main().catch((e) => { console.error('[pool] failed:', e && e.message); process.exit(1); });
}
