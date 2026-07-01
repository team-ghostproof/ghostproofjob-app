'use strict';
/**
 * FIRESTORE WRITER  (patched: additive field alignment)
 * -----------------
 * Persists normalized jobs to the global `jobs` collection. Deterministic doc
 * IDs make re-ingest idempotent (update, not duplicate).
 *
 * PATCH (insert-only, no keys removed): the frontend card (mapFirestoreJob) reads
 * `direct_apply_url`, `description`, `salary_min/salary_max`, and `region`. The
 * previous writer stored `applyUrl` (wrong field name), dropped the numeric
 * salary, and omitted `region` — so ATS jobs landed with no apply link, no
 * salary, and were skipped by region-scoped deck queries. We now write those
 * fields too, while KEEPING every original key for backward-compat.
 */
const crypto = require('crypto');
const COLLECTION = 'jobs';
const BATCH_LIMIT = 450;

/** Stable doc id: never collides across sources, dedupes the same posting. */
function jobDocId(job) {
  const url = job.direct_apply_url || job.applyUrl || '';
  const basis = `${job.source || 'x'}::${(url || (job.company + '|' + job.title) || '').toLowerCase()}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * Upsert normalized jobs into Firestore.
 * @returns {Promise<{written:number, batches:number}>}
 */
async function writeJobs(db, FieldValue, jobs) {
  const list = Array.isArray(jobs)
    ? jobs.filter((j) => j && j.title && (j.direct_apply_url || j.applyUrl || j.company))
    : [];
  if (!list.length) return { written: 0, batches: 0 };
  const col = db.collection(COLLECTION);
  let written = 0;
  let batches = 0;
  for (let i = 0; i < list.length; i += BATCH_LIMIT) {
    const slice = list.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const job of slice) {
      const ref = col.doc(jobDocId(job));
      const applyUrl = job.direct_apply_url || job.applyUrl || '';
      batch.set(
        ref,
        {
          title: job.title,
          company: job.company || '',
          location: job.location || '',
          country: (job.country || '').toUpperCase(),
          region: job.region || '',                       // NEW: region-scoped queries include ATS jobs
          description: job.description || '',              // now populated by the aggregator
          requirements: job.requirements || '',           // NEW: carried through when present
          benefits: job.benefits || '',                   // NEW
          applyUrl: applyUrl,                              // original key kept for backward-compat
          direct_apply_url: applyUrl,                      // NEW: the field the card actually reads
          salaryText: job.salaryText || '',
          salary_min: job.salary_min || 0,                // NEW: numeric salary the card renders
          salary_max: job.salary_max || 0,                // NEW
          is_remote: !!job.is_remote,                      // NEW
          source: job.source || 'unknown',
          postedAt: job.postedAt || null,
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
          // ingestedAt only set on first write — merge:true preserves the original.
          ingestedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      written++;
    }
    await batch.commit();
    batches++;
  }
  return { written, batches };
}

module.exports = { writeJobs, jobDocId, COLLECTION };
