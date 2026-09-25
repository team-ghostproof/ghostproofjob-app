'use strict';
/* PLAN A ([FREE-TIER], 2026-09-22) — the D1 pool is now built FROM the harvester's
   own scraped rows + the prior pool, instead of streaming ~205K jobs back out of
   Firestore (which blew the free-tier 50K reads/day cap → 429 → app + pipeline down).
   These tests cover the pure pieces that make that safe: dedup (today wins), the
   staleness filter, and — critically — METRO ACCUMULATION across the rotating harvest
   (a metro NOT scraped today must survive from the prior pool). */
process.env.GPJ_POOL_NO_MAIN = '1';   // don't run main() on import
import test from 'node:test';
import assert from 'node:assert/strict';

const { mergePoolRows, buildPool, poolsFromRows, searchIndexRows } = await import('../../scripts/build_job_pool.mjs');

const DAY = 86400000;
const row = (id, over = {}) => ({ _docId: id, title: 'Sales Manager', company: 'Acme', location: 'Houston, TX', region: 'Houston, TX', ingestedAt: Date.now(), ...over });

test('mergePoolRows: today wins on a duplicate _docId (fresher data replaces prior)', () => {
  const prior = [row('a', { title: 'OLD title', ingestedAt: Date.now() - 2 * DAY })];
  const today = [row('a', { title: 'NEW title' })];
  const merged = mergePoolRows(today, prior);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'NEW title', 'today overwrites the prior row');
});

test('mergePoolRows: drops rows older than the stale window, keeps fresh + undated', () => {
  const now = Date.now();
  const merged = mergePoolRows(
    [row('fresh', { ingestedAt: now })],
    [row('stale', { ingestedAt: now - 20 * DAY }), row('undated', { ingestedAt: 0 })],
    { staleDays: 14, now },
  );
  const ids = merged.map((r) => r._docId).sort();
  assert.deepEqual(ids, ['fresh', 'undated'], 'stale (20d) dropped; fresh + undated kept');
});

test('mergePoolRows: METRO ACCUMULATION — a metro not scraped today survives from the prior pool', () => {
  /* the harvester rotates metros, so today only has Houston; Dallas must persist. */
  const prior = [row('dal1', { region: 'Dallas, TX', location: 'Dallas, TX' })];
  const today = [row('hou1', { region: 'Houston, TX' })];
  const merged = mergePoolRows(today, prior);
  const regions = new Set(merged.map((r) => r.region));
  assert.ok(regions.has('Dallas, TX'), 'Dallas (prior, not scraped today) is retained');
  assert.ok(regions.has('Houston, TX'), 'Houston (today) is present');
  // and the built pool has BOTH metro shards
  const { pools } = poolsFromRows(merged);
  const keys = pools.map((p) => p.key);
  assert.ok(keys.some((k) => k.startsWith('metro-houston')), 'houston metro pool built');
  assert.ok(keys.some((k) => k.startsWith('metro-dallas')), 'dallas metro pool built');
  assert.ok(keys.some((k) => k.startsWith('all-')), 'national pool built');
});

test('buildPool: full text is trimmed to a preview but matchTerms keep whole-doc coverage', () => {
  const tail = 'kubernetes';
  const docs = [{ id: 'p', data: {
    title: 'Platform Engineer', company: 'Acme', location: 'Austin, TX', region: 'Austin, TX',
    description: 'Lead platform work. '.repeat(120) + ' We run on ' + tail + ' in production.',
    requirements: 'Deep systems background.', active: true, ingestedAt: Date.now(),
    direct_apply_url: 'https://x/1',
  } }];
  const jobRow = buildPool(docs).pools[0].doc.jobs[0];
  assert.ok(!jobRow.description.includes(tail), 'the tail term falls PAST the preview cutoff');
  assert.ok((jobRow.matchTerms || []).includes(tail), 'matchTerms still carry it (match % stays whole-doc)');
  assert.equal(jobRow._clipped, true, 'clipped flag set so getJobFull lazy-loads the full text');
});

test('mergePoolRows: tolerates null/empty inputs (harvester crash → prior-only, no throw)', () => {
  assert.deepEqual(mergePoolRows(null, null), []);
  assert.equal(mergePoolRows([], [row('x')]).length, 1, 'empty today → prior pool rebuild');
});

/* Tier B — the full-catalog SEARCH index (lite rows over ALL jobs). */
test('searchIndexRows: drops heavy text but keeps card fields + _lite flag', () => {
  const full = buildPool([{ id: 'j', data: {
    title: 'Account Retention Specialist', company: 'Acme', location: 'Houston, TX', region: 'Houston, TX',
    description: 'x'.repeat(3000), requirements: 'y'.repeat(1000), benefits: 'z'.repeat(500),
    direct_apply_url: 'https://x/1', salary_min: 60000, salary_max: 80000, active: true, ingestedAt: Date.now(),
  } }]).pools[0].doc.jobs;
  const lite = searchIndexRows(full);
  assert.equal(lite.length, 1);
  const r = lite[0];
  assert.ok(!r.description && !r.requirements && !r.benefits && !r.matchTerms, 'heavy text dropped');
  assert.ok(r.title && r.company && r.location && r.salary_min && (r.direct_apply_url || r.url), 'card fields kept');
  assert.equal(r._lite, true, 'flagged lite so the client renders a medium card + lazy-loads on open');
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 500, 'row stays compact (~200-300 B)');
});

test('searchIndexRows: null-safe and skips titleless rows', () => {
  assert.deepEqual(searchIndexRows(null), []);
  assert.equal(searchIndexRows([{ _docId: 'a' }, { _docId: 'b', title: 'Manager' }]).length, 1, 'titleless dropped');
});
