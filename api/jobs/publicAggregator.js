'use strict';
/**
 * api/jobs/publicAggregator.js — LAYER 4 (isolated, self-contained)
 * Free public ATS JSON only (Greenhouse + Lever). Zero keys.
 * Schema out: title, company, location, direct_apply_url, source, region,
 *             description, requirements, benefits, salary_min, salary_max.
 *
 * PATCH (insert-only): the full posting body was fetched but only used for salary
 * mining/matching and then DISCARDED, so ATS cards were empty. We now (a) convert
 * the body to structured text that PRESERVES line breaks, (b) carry the cleaned
 * description through (capped 3500), and (c) extract the real Responsibilities /
 * Requirements / Benefits sections — the SAME parsing the Python harvester uses —
 * so ATS cards are as detailed as JobSpy cards.
 */

const REQUEST_TIMEOUT_MS = 10000;
const CHUNK_SIZE = 5;            // bounded concurrency for Vercel 2GB ceiling
const MAX_PER_BOARD = 50;
const DESC_CAP = 3500;
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

/* one-line strip (kept for matching/salary hay where structure doesn't matter) */
function stripHtml(s) {
  return (s || '').toString().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

/* structured strip: turns block-level tags into newlines FIRST so section headers
   stay at line starts — this is what makes the ^header section parsing work. */
function htmlToText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*(p|div|li|h[1-6]|ul|ol|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}
function norm(s) { return (s || '').toString().toLowerCase(); }

/* ── SECTION PARSING (ported 1:1 from the Python harvester so ATS + JobSpy agree) ── */
const RESP_HEADER = /^\s*(?:•\s*)?(job responsibilities|responsibilities|what you(?:'| a)?ll do|key responsibilities|duties|the role|role overview|day[- ]to[- ]day|essential functions|what you will do)\b[:\s]*/im;
const REQ_HEADER = /^\s*(?:•\s*)?(requirements added by the job poster|requirements?|required qualifications?|minimum qualifications?|basic qualifications?|qualifications?|what you(?:'| a)?ll need|what you bring|required skills?|skills? (?:&|and) experience|who you are|the ideal candidate|experience required|must[- ]haves?)\b[:\s]*/im;
const BENE_HEADER = /^\s*(?:•\s*)?(featured benefits|benefits?(?: and perks)?|perks?(?: and benefits)?|what we offer|compensation (?:&|and) benefits|our benefits)\b[:\s]*/im;
const NEXT_SECTION = /^\s*(?:•\s*)?(about (?:us|the company|the team|our)|featured benefits|benefits?|perks?|requirements?|qualifications?|responsibilities|duties|what we offer|how to apply|to apply|equal opportunity|why join|our culture|compensation|pay range|salary range|set alert|job description)\b/im;

function grab(headerRx, text, limit) {
  limit = limit || 900;
  const m = headerRx.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const nxt = NEXT_SECTION.exec(rest);
  let block = nxt ? rest.slice(0, nxt.index) : rest;
  block = block.replace(/^[\s:*#>\-\n\t]+|[\s:*#>\-\n\t]+$/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return block.slice(0, limit);
}

function extractRequirements(description) {
  if (!description) return '';
  const text = String(description);
  const parts = [];
  const resp = grab(RESP_HEADER, text, 900);
  if (resp.length >= 20) parts.push("What you'll do:\n" + resp.slice(0, 700));
  const req = grab(REQ_HEADER, text, 900);
  if (req.length >= 20) parts.push('What you need:\n' + req.slice(0, 700));
  if (parts.length) return parts.join('\n\n').slice(0, 1400);
  // fallback A: a "responsible for ..." duties sentence (prose-only postings)
  const duty = /(?:will be |is |are )?responsible for\b([\s\S]{30,500}?)(?:\.\s|\n|$)/i.exec(text);
  if (duty) {
    const d = duty[1].replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '');
    if (d.length >= 25) return ('Responsible for ' + d + '.').slice(0, 900);
  }
  // fallback B: an unlabeled bulleted list
  const bullets = [];
  const bx = /^\s*•\s+(.{8,200})/gim;
  let bm;
  while ((bm = bx.exec(text)) !== null) { bullets.push(bm[1].trim()); if (bullets.length >= 12) break; }
  if (bullets.length >= 3) return ('• ' + bullets.join('\n• ')).slice(0, 1200);
  return '';
}

function extractBenefits(text) {
  if (!text) return '';
  const t = String(text);
  const b = grab(BENE_HEADER, t, 500);
  if (b.length >= 6) return b;
  const kws = ['medical insurance', 'health insurance', 'dental insurance', 'vision insurance',
    '401(k)', '401k', 'paid time off', 'pto', 'life insurance', 'remote work', 'flexible schedule', 'tuition'];
  const hits = [];
  for (const kw of kws) {
    if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) hits.push(kw);
  }
  if (hits.length >= 2) {
    const seen = new Set(); const out = [];
    for (const h of hits) {
      const key = h.toLowerCase().replace('401k', '401(k)');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key.replace(/\b\w/g, (c) => c.toUpperCase()).replace('401(K)', '401(k)').replace('Pto', 'PTO'));
    }
    return out.join(', ');
  }
  return '';
}

/* pull the first salary-looking phrase out of free text for the parser */
function extractSalaryText(text) {
  if (!text) return '';
  var m = String(text).match(/\$\s*\d[\d,]*(\.\d+)?\s*k?(\s*(-|to|–)\s*\$?\s*\d[\d,]*(\.\d+)?\s*k?)?(\s*(\/|per)\s*(hour|hr|year|yr|annum))?/i);
  return m ? m[0] : '';
}

/* normalize a messy multi-location string into a clean region token */
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
  var desc = (p.description || '').toString();
  return {
    title: (p.title || '').toString().trim(),
    company: (p.company || '').toString().trim(),
    location: (p.location || '').toString().trim(),
    direct_apply_url: (p.direct_apply_url || '').toString().trim(),
    source: SOURCE,
    region: (region || '').toString().trim(),
    description: desc.slice(0, DESC_CAP),                 // real body, structure preserved
    requirements: extractRequirements(desc),             // NEW: responsibilities + requirements sections
    benefits: extractBenefits(desc),                     // NEW: benefits section / inline sniff
    salaryText: (p.salaryText || '').toString(),
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
      const fullDesc = htmlToText(j.content);
      const hay = (j.title || '') + ' ' + loc + ' ' + fullDesc.slice(0, 400);
      if (!matches(hay, role, region)) continue;
      const subEmployer = (j.company_name && j.company_name.trim()) || '';
      const cleanLoc = normalizeRegion(loc, region);
      out.push(toRecord({
        title: j.title,
        company: subEmployer || token,
        location: cleanLoc,
        direct_apply_url: j.absolute_url,
        description: fullDesc,
        salaryText: extractSalaryText(fullDesc),
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
      const fullDesc = htmlToText(j.descriptionPlain || j.description);
      const hay = (j.text || '') + ' ' + loc + ' ' + fullDesc.slice(0, 400);
      if (!matches(hay, role, region)) continue;
      const cleanLoc = normalizeRegion(loc, region);
      var leverSalRaw = (j.salaryRange && (j.salaryRange.min || j.salaryRange.max))
        ? ((j.salaryRange.min || '') + ' - ' + (j.salaryRange.max || '') + ' ' + (j.salaryRange.interval || ''))
        : extractSalaryText(fullDesc);
      out.push(toRecord({
        title: j.text,
        company: token,
        location: cleanLoc,
        direct_apply_url: j.hostedUrl || j.applyUrl,
        description: fullDesc,
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
module.exports.extractRequirements = extractRequirements;
module.exports.extractBenefits = extractBenefits;
module.exports.htmlToText = htmlToText;
