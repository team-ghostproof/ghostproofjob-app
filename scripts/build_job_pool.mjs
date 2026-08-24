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

import { newStats, tally } from './market_taxonomy.mjs';

const DRY = process.argv.includes('--dry-run');
const FIXTURE = process.argv.includes('--fixture');

/* Firestore hard limit is 1 MiB per document. Stay well under it: the estimate
   below counts the JSON payload, and Firestore adds per-field name overhead on
   top, so a generous margin is deliberate rather than optimistic. */
const MAX_DOC_BYTES = 800 * 1024;
/* DISPLAY budget only — the collapsed swipe/Browse card shows title, company,
   location, salary and badges; the full description/requirements/benefits are only
   ever revealed when the drawer is EXPANDED, which lazy-loads the real doc (1 read
   for a job the user actually opened). So the preview here just needs to be enough
   for a snippet, not the whole posting. */
const DESC_BUDGET = 600;
const REQ_BUDGET = 300;
const BEN_BUDGET = 200;
/* MATCH budget — separate from display ON PURPOSE. computeMatch() scores against
   the job text, so scoring a TRUNCATED description would make the same job score
   differently in the deck than after opening it. Instead of carrying prose we
   cannot afford, each row carries `matchTerms`: the distinctive terms mined from
   the FULL description + requirements at build time. Full-document term coverage
   in ~500 bytes, and the score is stable whether or not the full doc is loaded. */
const MATCH_TERMS = 60;
const MAX_SHARDS_PER_KEY = 12;  // ceiling per key; 12 x ~330 rows comfortably covers the 3,000 national cap
const POOL_COLLECTION = 'job_pools';

const cut = (s, n) => {
  const t = String(s == null ? '' : s);
  return t.length <= n ? t : t.slice(0, n);
};

/* Stopwords that carry no matching signal. Deliberately small: computeMatch does
   its own field-word logic, so this only strips filler that would waste bytes. */
const STOP = new Set(['this','that','with','from','have','will','your','their','they','been','were','which','while','about','into','than','then','them','these','those','when','where','what','would','could','should','being','other','more','most','such','also','after','before','during','through','over','under','both','each','some','many','must','able','work','role','team','join','help','make','used','using','across','within','including','include','includes','required','requirement','requirements','experience','years','year','plus','strong','excellent','ability','skills','knowledge','opportunity','position','candidate','candidates','applicants','company','business','support','ensure','provide','manage','manages','managing']);

/** Mine the distinctive terms from the FULL text so match scoring keeps whole-doc
 *  coverage even though the stored prose is only a preview. */
function mineTerms(full, limit = MATCH_TERMS) {
  const seen = new Set(), out = [];
  const words = String(full || '').toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/);
  for (const w of words) {
    if (w.length < 4 || w.length > 24) continue;
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

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
  /* v240: carry the company's website (harvester captures company_url) so the deck/Browse
     logo helper + "Website" button resolve the real company domain. Small, only-when-present. */
  if (v.companyWebsite) row.companyWebsite = cut(v.companyWebsite, 200);
  if (v.ingestedAt) row.ingestedAt = v.ingestedAt;
  if (v.date_posted) row.date_posted = cut(v.date_posted, 40);
  /* whole-document term coverage for stable match scoring (see MATCH_TERMS) —
     mined from the FULL description + requirements, not the stored preview. */
  const terms = mineTerms(desc + ' ' + req);
  if (terms.length) row.matchTerms = terms;
  /* _clipped tells the client "there is more text behind a detail fetch", which is
     what drives lazy-loading the full posting when the drawer is expanded. */
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

/** Pure: TRIMMED pool rows -> the full set of pool documents to write. This is
 *  the sharding half, split out from buildPool so main() can trim each doc as it
 *  STREAMS off Firestore (see below) instead of buffering every raw ~7KB doc in
 *  memory — the v192-era daily build OOM-crashed the runner on the grown
 *  collection ("JavaScript heap out of memory"). Rows here are already ~1.5KB. */
export function poolsFromRows(rows, opts = {}) {
  const builtAt = opts.now || Date.now();
  const perMetroCap = opts.perMetroCap || 2500;
  const nationalCap = opts.nationalCap || 3000;

  /* newest first — the deck and Browse both lead with recency (rows carry ingestedAt) */
  const sorted = rows.slice().sort((a, b) => (b.ingestedAt || 0) - (a.ingestedAt || 0));

  const out = [];
  /* 1) NATIONAL pool — the dominant path since v74. */
  out.push(...shard('all', sorted.slice(0, nationalCap), builtAt));
  /* 2) PER-METRO pools — keyed off the same `region` string the harvester writes. */
  const byMetro = new Map();
  for (const r of sorted) {
    const k = slug(r.region);
    if (k === 'unknown') continue;
    if (!byMetro.has(k)) byMetro.set(k, []);
    const arr = byMetro.get(k);
    if (arr.length < perMetroCap) arr.push(r);
  }
  for (const [k, arr] of byMetro) out.push(...shard('metro-' + k, arr, builtAt));

  return { pools: out, stats: { live: rows.length, metros: byMetro.size, docs: out.length, builtAt } };
}

/** Pure: raw docs -> pool documents. Unit-testable wrapper over poolsFromRows
 *  (trims then shards). The live path streams + trims instead — see main(). */
export function buildPool(docs, opts = {}) {
  const rows = docs
    .filter((d) => d.data && d.data.title && d.data.active !== false)
    .map((d) => toPoolRow(d.id, d.data));
  return poolsFromRows(rows, opts);
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

    /* THE CORRECTNESS CLAIM: the stored description is only a PREVIEW, so match
       scoring would drift if it were the scoring input. Prove that a distinctive
       term living past the preview cutoff still reaches matchTerms — that is what
       keeps the deck's match % equal to the full-document score. */
    const tailWord = 'kubernetes';
    const probe = buildPool([{ id: 'probe', data: {
      title: 'Platform Engineer', company: 'Acme', location: 'Houston, TX', region: 'Houston, TX',
      description: 'Lead platform work. '.repeat(120) + ' We run on ' + tailWord + ' in production.',
      requirements: 'Deep distributed systems background.', active: true, ingestedAt: Date.now(),
      direct_apply_url: 'https://x/1',
    } }]).pools[0].doc.jobs[0];
    const inPreview = probe.description.includes(tailWord);
    const inTerms = (probe.matchTerms || []).includes(tailWord);
    console.log('  tail-term probe: preview contains "' + tailWord + '"? ' + inPreview + '  |  matchTerms contains it? ' + inTerms);
    if (inPreview) { console.error('  FAIL: probe is invalid — the term must fall PAST the preview cutoff'); process.exit(1); }
    if (!inTerms) { console.error('  FAIL: a term past the preview cutoff was lost — match % would drift from the full-doc score'); process.exit(1); }
    if (!probe._clipped) { console.error('  FAIL: clipped row not flagged, so the client would never lazy-load the full text'); process.exit(1); }

    console.log('[pool] self-test PASSED');
    return;
  }

  const admin = (await import('firebase-admin')).default;
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) { console.error('[pool] FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  /* STREAM the read and TRIM each doc on arrival, so peak memory is bounded by the
     ~1.5KB pool rows — NOT by buffering every raw ~7KB active doc into one
     QuerySnapshot (that OOM-crashed the runner: "JavaScript heap out of memory").
     Node's default old-space is ~2GB; the workflow also passes a higher
     --max-old-space-size as a backstop. */
  console.log('[pool] streaming live jobs (trims each doc on arrival — memory-safe)…');
  const rows = [];
  /* Resources SEO engine piggyback: fold each doc into a tiny market tally IN THE
     SAME STREAM we already pay for, so the daily article numbers cost ZERO extra
     reads ([FREE-TIER]). O(1) per doc, no allocation growth — safe inside the
     memory-bounded pool stream. Written below as resources/_market_stats. */
  const mstats = newStats();
  let scanned = 0;
  await new Promise((resolve, reject) => {
    const stream = db.collection('jobs').where('active', '==', true).stream();
    stream.on('data', (d) => {
      scanned++;
      const data = (d && typeof d.data === 'function') ? (d.data() || {}) : {};
      if (data && data.title && data.active !== false) { rows.push(toPoolRow(d.id, data)); tally(mstats, data); }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  console.log('[pool] scanned', scanned, 'active docs → trimmed to', rows.length, 'pool rows in memory');
  console.log('[pool] market tally: ' + mstats.total + ' jobs, ' + mstats.remote + ' remote, ' + Object.keys(mstats.byField).length + ' fields, ' + Object.keys(mstats.byCity).length + ' cities');

  const { pools, stats } = poolsFromRows(rows);
  let maxBytes = 0;
  for (const p of pools) maxBytes = Math.max(maxBytes, bytes(p.doc));
  console.log('[pool] built', stats.docs, 'pool docs across', stats.metros, 'metros; largest', (maxBytes / 1024).toFixed(1) + 'KB');
  if (maxBytes > 1024 * 1024) { console.error('[pool] ABORT: a shard exceeds the 1MiB Firestore limit'); process.exit(1); }

  if (DRY) { console.log('[pool] --dry-run: nothing written'); return; }

  /* A Firestore commit is capped on TWO axes: 500 writes AND ~10 MiB total request
     PAYLOAD. Pool shards run up to ~800 KB each, so batching by COUNT alone packed
     ~40 near-max docs into one commit (~32 MB) and Firestore rejected it with
     "INVALID_ARGUMENT: Request payload size exceeds the limit" — which is exactly
     why the pool had NEVER been written. Flush on whichever cap hits first: byte
     budget (safe margin under 10 MiB) or the write count. */
  const MAX_BATCH_BYTES = 8 * 1024 * 1024;   // margin under Firestore's ~10 MiB request limit
  let wrote = 0, batch = db.batch(), pending = 0, batchBytes = 0;
  for (const p of pools) {
    const b = bytes(p.doc);
    if (pending && (pending >= 400 || batchBytes + b > MAX_BATCH_BYTES)) {
      await batch.commit(); batch = db.batch(); pending = 0; batchBytes = 0;
    }
    batch.set(db.collection(POOL_COLLECTION).doc(p.key), p.doc);
    wrote++; pending++; batchBytes += b;
  }
  if (pending) await batch.commit();
  /* a tiny manifest so the client can discover keys without guessing */
  await db.collection(POOL_COLLECTION).doc('_manifest').set({
    builtAt: stats.builtAt, docs: stats.docs, metros: stats.metros, liveJobs: stats.live,
    keys: pools.map((p) => p.key),
  });
  /* Resources engine: the daily market snapshot, computed FREE in the stream above.
     build_resources.mjs reads this ONE doc (not the whole collection) to write an
     article — that is the [FREE-TIER] seam. Trim the long-tail maps (6k+ cities) to
     the top slice the articles actually use, so the doc stays tiny and can never
     approach the 1 MiB doc limit. */
  const _top = (obj, n) => Object.fromEntries(Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n));
  await db.collection('resources').doc('_market_stats').set({
    builtAt: stats.builtAt,
    total: mstats.total, remote: mstats.remote, salaryPosted: mstats.salaryPosted, verified: mstats.verified,
    byField: mstats.byField, byRemoteField: mstats.byRemoteField,
    byCity: _top(mstats.byCity, 200), bySource: _top(mstats.bySource, 40),
  });
  console.log('[pool] wrote', wrote, 'pool docs +1 manifest +1 market_stats —', wrote + 2, 'writes total');
}

if (!process.env.GPJ_POOL_NO_MAIN) {
  main().catch((e) => { console.error('[pool] failed:', e && e.message); process.exit(1); });
}
