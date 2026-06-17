'use strict';
/**
 * LAYER 2 — NATIVE ATS ENDPOINT INGESTION
 * ----------------------------------------
 * Pulls jobs straight from public ATS JSON endpoints — no scraping, no keys.
 * These links point at the EMPLOYER'S OWN application page, so they're the
 * highest-quality, lowest-ghost-risk source in the pipeline.
 *
 *   Greenhouse:  https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   Lever:       https://api.lever.co/v0/postings/{token}?mode=json
 *
 * Output is the SAME normalized shape as Layer 1 (see regionalRouter.normalizedJob).
 */

const axios = require('axios');
const { normalizedJob } = require('./regionalRouter');

const DEFAULT_TIMEOUT = 12000;

const http = axios.create({
  timeout: DEFAULT_TIMEOUT,
  validateStatus: () => true,
  headers: { Accept: 'application/json', 'User-Agent': 'GhostProofJob/1.0' },
});

function stripHtml(s) {
  return (s || '').toString().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Greenhouse board → normalized jobs.
 * @param {string} boardToken e.g. "stripe", "airbnb"
 */
async function ingestGreenhouse(boardToken) {
  if (!boardToken) return [];
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  try {
    const res = await http.get(url);
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.jobs)) return [];
    return res.data.jobs.map((j) =>
      normalizedJob({
        title: j.title,
        company: (j.company_name) || boardToken,
        location: (j.location && j.location.name) || '',
        country: '', // Greenhouse location is free-text; left blank for the geo-tagger downstream
        description: stripHtml(j.content).slice(0, 4000),
        applyUrl: j.absolute_url, // direct corporate application URL
        salaryText: '',
        postedAt: j.updated_at || j.first_published || null,
        source: 'greenhouse',
      })
    );
  } catch (err) {
    console.error(`[ats:greenhouse] ${boardToken} failed:`, err && err.message);
    return [];
  }
}

/**
 * Lever postings → normalized jobs.
 * @param {string} companyToken e.g. "netflix", "figma"
 */
async function ingestLever(companyToken) {
  if (!companyToken) return [];
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(companyToken)}?mode=json`;
  try {
    const res = await http.get(url);
    if (res.status !== 200 || !Array.isArray(res.data)) return [];
    return res.data.map((j) => {
      const cats = j.categories || {};
      return normalizedJob({
        title: j.text,
        company: companyToken,
        location: cats.location || '',
        country: '',
        description: stripHtml(j.descriptionPlain || j.description).slice(0, 4000),
        applyUrl: j.hostedUrl || j.applyUrl, // direct corporate application URL
        salaryText: cats.commitment || '',
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        source: 'lever',
      });
    });
  } catch (err) {
    console.error(`[ats:lever] ${companyToken} failed:`, err && err.message);
    return [];
  }
}

/**
 * Ingest many ATS boards concurrently, with a bounded pool to cap memory/sockets
 * inside the serverless runtime. Failures on individual boards are isolated.
 *
 * @param {Array<{type:'greenhouse'|'lever', token:string}>} boards
 * @param {number} [concurrency=4]
 * @returns {Promise<Array>} flattened normalized jobs, de-duped by applyUrl
 */
async function ingestAtsBatch(boards, concurrency) {
  const list = Array.isArray(boards) ? boards.filter((b) => b && b.token && b.type) : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(concurrency || 4, 8));
  const out = [];
  let cursor = 0;

  async function worker() {
    while (cursor < list.length) {
      const idx = cursor++;
      const b = list[idx];
      const jobs = b.type === 'lever' ? await ingestLever(b.token) : await ingestGreenhouse(b.token);
      for (const j of jobs) out.push(j);
    }
  }

  // Spin up at most `limit` workers; each drains the shared cursor.
  const workers = [];
  for (let i = 0; i < Math.min(limit, list.length); i++) workers.push(worker());
  await Promise.all(workers);

  // De-dupe by direct apply URL (the canonical key for an ATS posting).
  const seen = new Set();
  const deduped = [];
  for (const j of out) {
    const key = (j.applyUrl || (j.company + '|' + j.title)).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(j);
  }
  return deduped;
}

module.exports = { ingestGreenhouse, ingestLever, ingestAtsBatch };
