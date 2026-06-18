'use strict';
/**
 * api/jobs/publicAggregator.js — LAYER 4 (isolated, self-contained)
 * Free public ATS JSON only (Greenhouse + Lever). Zero keys.
 * Schema out: title, company, location, direct_apply_url, source, region.
 */

const REQUEST_TIMEOUT_MS = 10000;
const CHUNK_SIZE = 5;            // bounded concurrency for Vercel 2GB ceiling
const MAX_PER_BOARD = 50;
const SOURCE = 'PublicATS';
const { parseSalary } = require('./salaryParser');

/* parent multi-industry staffing networks + SMB/retail/trades boards (all public, key-less) */
const GREENHOUSE_BOARDS = [
  'allegis', 'adecco', 'randstad', 'manpower', 'roberthalf', 'kellyservices',
  'thecontainerstore', 'sweetgreen', 'gopuff', 'bevi', 'shipbob',
  'faire', 'misfitsmarket', 'imperfectfoods', 'crunchfitness', 'redbull'
];
const LEVER_BOARDS = [
  'adecco', 'randstad', 'manpowergroup', 'roberthalf', 'kellyservices',
  'rivian', 'gopuff', 'fountain', 'veho', 'wonder',
  'method', 'kong', 'truework', 'pacaso', 'attentive'
];

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function getJSON(url) {
  try {
    const res = await withTimeout(fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GhostProofJob/1.0' } }), REQUEST_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function stripHtml(s) {
  return (s || '').toString().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}
function norm(s) { return (s || '').toString().toLowerCase(); }

/* pull the first salary-looking phrase out of free text for the parser */
function extractSalaryText(text) {
  if (!text) return '';
  var m = String(text).match(/\$\s*\d[\d,]*(\.\d+)?\s*k?(\s*(-|to|–)\s*\$?\s*\d[\d,]*(\.\d+)?\s*k?)?(\s*(\/|per)\s*(hour|hr|year|yr|annum))?/i);
  return m ? m[0] : '';
}

/* normalize a messy multi-location string into a clean region token:
   "Main Street Office - Dayton Area" -> "Dayton" ; falls back to caller region */
function normalizeRegion(rawLoc, fallback) {
  let s = stripHtml(rawLoc);
  if (!s) return (fallback || '').trim();
  s = s.split(/\s[-|/]\s/).pop();
  s = s.replace(/\b(area|office|region|hq|headquarters|remote|hybrid|onsite)\b/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  return s || (fallback || '').trim();
}

/* OMISSION ROUTING: blank/wildcard role => universal dump (role filter omitted) */
function isWildcardRole(role) {
  const r = norm(role).trim();
  return !r || r === '*' || r === 'all' || r === 'any';
}

function matches(text, role, region) {
  if (isWildcardRole(role)) {
    const city = norm(region).split(',')[0].trim();
    return !city || norm(text).includes(city);
  }
  const t = norm(text);
  const r = norm(role).trim();
  const city = norm(region).split(',')[0].trim();
  const roleHit = t.includes(r);
  const locHit = !city || t.includes(city);
  return roleHit || (locHit && !r);
}

function toRecord(p, region) {
  var sal = parseSalary(p.salaryText || '');
  return {
    title: (p.title || '').toString().trim(),
    company: (p.company || '').toString().trim(),
    location: (p.location || '').toString().trim(),
    direct_apply_url: (p.direct_apply_url || '').toString().trim(),
    source: SOURCE,
    region: (region || '').toString().trim(),
    salary_min: sal.salary_min,
    salary_max: sal.salary_max,
  };
}

async function pullGreenhouse(token, role, region) {
  let out = [];
  try {
    const data = await getJSON('https://boards-api.greenhouse.io/v1/boards/' + encodeURIComponent(token) + '/jobs?content=true');
    if (!data || !Array.isArray(data.jobs)) return [];
    for (const j of data.jobs) {
      if (out.length >= MAX_PER_BOARD) break;
      const loc = (j.location && j.location.name) || '';
      const hay = (j.title || '') + ' ' + loc + ' ' + stripHtml(j.content).slice(0, 400);
      if (!matches(hay, role, region)) continue;
      const subEmployer = (j.company_name && j.company_name.trim()) || '';
      const cleanLoc = normalizeRegion(loc, region);
      out.push(toRecord({
        title: j.title,
        company: subEmployer || token,
        location: cleanLoc,
        direct_apply_url: j.absolute_url,
        salaryText: extractSalaryText(stripHtml(j.content)),
      }, cleanLoc));
    }
  } catch (e) {
    return [];
  } finally {
    out = out.slice(0, MAX_PER_BOARD);
  }
  return out;
}

async function pullLever(token, role, region) {
  let out = [];
  try {
    const data = await getJSON('https://api.lever.co/v0/postings/' + encodeURIComponent(token) + '?mode=json');
    if (!Array.isArray(data)) return [];
    for (const j of data) {
      if (out.length >= MAX_PER_BOARD) break;
      const cats = j.categories || {};
      const loc = cats.location || '';
      const hay = (j.text || '') + ' ' + loc + ' ' + stripHtml(j.descriptionPlain || j.description).slice(0, 400);
      if (!matches(hay, role, region)) continue;
      const cleanLoc = normalizeRegion(loc, region);
      var leverSalRaw = (j.salaryRange && (j.salaryRange.min || j.salaryRange.max))
        ? ((j.salaryRange.min || '') + ' - ' + (j.salaryRange.max || '') + ' ' + (j.salaryRange.interval || ''))
        : extractSalaryText(stripHtml(j.descriptionPlain || j.description));
      out.push(toRecord({
        title: j.text,
        company: token,
        location: cleanLoc,
        direct_apply_url: j.hostedUrl || j.applyUrl,
        salaryText: leverSalRaw,
      }, cleanLoc));
    }
  } catch (e) {
    return [];
  } finally {
    out = out.slice(0, MAX_PER_BOARD);
  }
  return out;
}

/* MEMORY DRIFT SHIELD: bounded chunks, variables cleared each iteration */
async function runChunked(tasks, chunkSize) {
  const results = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    let slice = tasks.slice(i, i + chunkSize);
    let settled = [];
    try {
      settled = await Promise.all(slice.map((fn) => fn().catch(() => [])));
      for (const arr of settled) {
        if (Array.isArray(arr)) for (const r of arr) results.push(r);
      }
    } finally {
      slice = null;
      settled = null;
    }
  }
  return results;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r || !r.title || !r.direct_apply_url) continue;
    const key = norm(r.company) + '|' + norm(r.title) + '|' + norm(r.location);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function aggregatePublic(region, role) {
  let tasks = [];
  for (const t of GREENHOUSE_BOARDS) tasks.push(() => pullGreenhouse(t, role, region));
  for (const t of LEVER_BOARDS) tasks.push(() => pullLever(t, role, region));
  let raw = [];
  try {
    raw = await runChunked(tasks, CHUNK_SIZE);
    return dedupe(raw);
  } finally {
    tasks = null;
    raw = null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const q = req.query || {};
  const region = (q.region || '').toString().slice(0, 80);
  const role = (q.role || '').toString().slice(0, 60);

  let records = [];
  try { records = await aggregatePublic(region, role); }
  catch (e) { console.error('[publicAggregator] failed:', e && e.message); records = []; }

  let written = 0;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const writer = require('./firestoreWriter');
    const r = await writer.writeJobs(db, FieldValue, records);
    written = (r && r.written) || 0;
  } catch (e) {
    console.error('[publicAggregator] writer skipped:', e && e.message);
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
  res.status(200).json({ count: records.length, written, source: SOURCE, region, role, results: records });
};

module.exports.aggregatePublic = aggregatePublic;
module.exports.normalizeRegion = normalizeRegion;
module.exports.isWildcardRole = isWildcardRole;
module.exports.toRecord = toRecord;
module.exports.dedupe = dedupe;
