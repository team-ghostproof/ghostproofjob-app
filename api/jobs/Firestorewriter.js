'use strict';
/**
 * FIRESTORE WRITER
 * -----------------
 * Persists normalized jobs to a global `jobs` collection WITHOUT touching any
 * existing schema. Each job gets a deterministic document ID (hash of
 * source + applyUrl) so re-ingesting the same posting UPDATES rather than
 * duplicates — safe to run on a schedule.
 *
 * Collection: jobs/{deterministicId}
 *   {
 *     title, company, location, country, description, applyUrl, salaryText,
 *     source, postedAt (string|null),
 *     ingestedAt (server timestamp), updatedAt (server timestamp),
 *     active (bool)
 *   }
 *
 * Writes use a 450-op batch ceiling (Firestore hard limit is 500) and commit in
 * chunks to keep memory flat.
 */

const crypto = require('crypto');

const COLLECTION = 'jobs';
const BATCH_LIMIT = 450;

/** Stable doc id: never collides across sources, dedupes the same posting. */
function jobDocId(job) {
  const basis = `${job.source || 'x'}::${(job.applyUrl || (job.company + '|' + job.title) || '').toLowerCase()}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * Upsert normalized jobs into Firestore.
 * @param {FirebaseFirestore.Firestore} db  an initialized Firestore instance
 * @param {object} FieldValue              admin.firestore.FieldValue (for serverTimestamp)
 * @param {Array} jobs                     normalized job objects
 * @returns {Promise<{written:number, batches:number}>}
 */
async function writeJobs(db, FieldValue, jobs) {
  const list = Array.isArray(jobs) ? jobs.filter((j) => j && j.title && (j.applyUrl || j.company)) : [];
  if (!list.length) return { written: 0, batches: 0 };

  const col = db.collection(COLLECTION);
  let written = 0;
  let batches = 0;

  for (let i = 0; i < list.length; i += BATCH_LIMIT) {
    const slice = list.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const job of slice) {
      const ref = col.doc(jobDocId(job));
      batch.set(
        ref,
        {
          title: job.title,
          company: job.company || '',
          location: job.location || '',
          country: (job.country || '').toUpperCase(),
          description: job.description || '',
          applyUrl: job.applyUrl || '',
          salaryText: job.salaryText || '',
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
