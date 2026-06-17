'use strict';
/**
 * api/jobs/regionalRouter.js — Vercel Serverless Function
 * Conditional fallback hierarchy:
 *   PHASE 1 (clean primary, parallel, isolated try/catch):
 *     Layer 1: USAJOBS (US) / education.gov.uk (UK) / Adzuna (EU)
 *     Layer 2: seed companies (atsIngest, if present)
 *     Layer 4: publicAggregator
 *   COUNT GUARD:
 *     >= 15 combined  -> skip Jooble/Adzuna gap-fill, write, return
 *     <  15 combined  -> Jooble/Adzuna gap-fill via Layer 3 redirectResolver
 * Schema: title, company, location, direct_apply_url, source, region.
 */

const DEFAULT_TIMEOUT = 12000;
const PRIMARY_THRESHOLD = 15;
const ADZUNA_EU = new Set(['FR', 'DE', 'ES', 'IT']);
const ADZUNA_CC = { FR: 'fr', DE: 'de', ES: 'es', IT: 'it' };

function normalizedJob(p) {
  return {
    title: (p.title || '').toString().trim(),
    company: (p.company || '').toString().trim(),
    location: (p.location || '').toString().trim(),
    direct_apply_url: (p.direct_apply_url || '').toString().trim(),
    source: (p.source || 'regional').toString(),
    region: (p.region || '').toString().trim(),
  };
}

async function getJSON(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUSA(region, role, page) {
  if (!process.env.USAJOBS_API_KEY) return [];
  const qs = new URLSearchParams({ Keyword: role || '', LocationName: region || '', Page: String(page || 1), ResultsPerPage: '25' });
  const data = await getJSON('https://data.usajobs.gov/api/search?' + qs.toString(), {
    headers: {
      Host: 'data.usajobs.gov',
      'User-Agent': process.env.USAJOBS_USER_AGENT || 'GhostProofJob/1.0',
      'Authorization-Key': process.env.USAJOBS_API_KEY,
    },
  });
  const items = (data && data.SearchResult && data.SearchResult.SearchResultItems) || [];
  return items.map((it) => {
    const d = it.MatchedObjectDescriptor || {};
    const loc = (d.PositionLocation && d.PositionLocation[0] && d.PositionLocation[0].LocationName) || d.PositionLocationDisplay || region;
    return normalizedJob({
      title: d.PositionTitle,
      company: d.OrganizationName,
      location: loc,
      direct_apply_url: (d.ApplyURI && d.ApplyURI[0]) || d.PositionURI || '',
      source: 'usajobs',
      region: region,
    });
  });
}

async function fetchUK(region, role, page) {
  if (!process.env.FINDAJOB_API_KEY) return [];
  const qs = new URLSearchParams({ q: role || '', location: region || '', page: String(page || 1) });
  const data = await getJSON('https://education.gov.uk/api/apprenticeships/vacancies?' + qs.toString(), {
    headers: { 'Ocp-Apim-Subscription-Key': process.env.FINDAJOB_API_KEY, 'X-Version': '2', Accept: 'application/json' },
  });
  const items = (data && (data.results || data.vacancies || data.jobs)) || [];
  return items.map((j) =>
    normalizedJob({
      title: j.title || j.jobTitle,
      company: j.employer || j.company || j.providerName,
      location: j.location || j.locationName || region,
      direct_apply_url: j.url || j.applyUrl || j.vacancyUrl || '',
      source: 'uk-gov',
      region: region,
    })
  );
}

async function fetchAdzunaEU(region, role, page, country) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  const cc = ADZUNA_CC[country] || 'gb';
  const qs = new URLSearchParams({ app_id: process.env.ADZUNA_APP_ID, app_key: process.env.ADZUNA_APP_KEY, results_per_page: '25', 'content-type': 'application/json' });
  if (role) qs.set('what', role);
  if (region) qs.set('where', region);
  const data = await getJSON('https://api.adzuna.com/v1/api/jobs/' + cc + '/search/' + (page || 1) + '?' + qs.toString());
  const items = (data && data.results) || [];
  return items.map((r) =>
    normalizedJob({
      title: r.title,
      company: r.company && r.company.display_name,
      location: (r.location && r.location.display_name) || region,
      direct_apply_url: r.redirect_url || '',
      source: 'adzuna',
      region: region,
    })
  );
}

/* Jooble gap-fill (free key via env, optional). Returns raw links to resolve. */
async function fetchJooble(region, role) {
  if (!process.env.JOOBLE_API_KEY) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT);
    let data = null;
    try {
      const res = await fetch('https://jooble.org/api/' + process.env.JOOBLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: role || '', location: region || '' }),
        signal: ctrl.signal,
      });
      if (res.ok) data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const items = (data && data.jobs) || [];
    return items.map((j) =>
      normalizedJob({
        title: j.title,
        company: j.company || 'Hiring Company',
        location: j.location || region,
        direct_apply_url: j.link || '',
        source: 'jooble',
        region: region,
      })
    );
  } catch (e) {
    return [];
  }
}

async function routeByCountry(country, region, role, page) {
  const cc = (country || 'US').toUpperCase();
  if (cc === 'US') return fetchUSA(region, role, page);
  if (cc === 'GB' || cc === 'UK') return fetchUK(region, role, page);
  if (ADZUNA_EU.has(cc)) return fetchAdzunaEU(region, role, page, cc);
  return [];
}

async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const q = req.query || {};
  const country = (q.country || 'US').toString().slice(0, 2);
  const region = (q.region || q.where || '').toString().slice(0, 80);
  const role = (q.role || q.what || '').toString().slice(0, 60);
  const page = Math.min(parseInt(q.page, 10) || 1, 20);

  /* ---- PHASE 1: clean primary sources in parallel, each isolated ---- */
  const layer1 = routeByCountry(country, region, role, page).catch((e) => { console.error('[L1]', e && e.message); return []; });
  const layer2 = (async () => {
    try {
      const ats = require('./atsIngest');
      if (ats && typeof ats.ingestSeedCompanies === 'function') return await ats.ingestSeedCompanies(region, role);
      if (ats && typeof ats.ingestAtsBatch === 'function') return await ats.ingestAtsBatch([], 4);
      return [];
    } catch (e) { console.error('[L2]', e && e.message); return []; }
  })();
  const layer4 = (async () => {
    try {
      const agg = require('./publicAggregator');
      return await agg.aggregatePublic(region, role);
    } catch (e) { console.error('[L4]', e && e.message); return []; }
  })();

  const settled = await Promise.all([layer1, layer2, layer4]);
  let primaryJobs = [];
  for (const arr of settled) { if (Array.isArray(arr)) for (const j of arr) primaryJobs.push(normalizedJob(j)); }

  // de-dupe primary
  const seen = new Set();
  primaryJobs = primaryJobs.filter((j) => {
    if (!j.title || !j.direct_apply_url) return false;
    const k = (j.company + '|' + j.title + '|' + j.location).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  /* ---- COUNT GUARD ---- */
  let usedGapFill = false;
  if (primaryJobs.length < PRIMARY_THRESHOLD) {
    usedGapFill = true;
    let gap = await fetchJooble(region, role).catch(() => []);
    if (!gap.length) {
      gap = await fetchAdzunaEU(region, role, page, country).catch(() => []);
    }
    // resolve aggregator links through Layer 3 to strip tracking loops
    try {
      const resolver = require('./redirectResolver');
      if (resolver && typeof resolver.resolve === 'function') {
        for (const j of gap) {
          if (!j.direct_apply_url) continue;
          try {
            const out = await resolver.resolve(j.direct_apply_url);
            if (out && out.url) j.direct_apply_url = out.url;
          } catch (e) { /* keep original link on failure */ }
        }
      }
    } catch (e) { console.error('[L3]', e && e.message); }
    for (const j of gap) {
      const nj = normalizedJob(j);
      const k = (nj.company + '|' + nj.title + '|' + nj.location).toLowerCase();
      if (!nj.title || !nj.direct_apply_url || seen.has(k)) continue;
      seen.add(k);
      primaryJobs.push(nj);
    }
  }

  /* ---- WRITE ---- */
  let written = 0;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const writer = require('./firestoreWriter');
    const r = await writer.writeJobs(db, FieldValue, primaryJobs);
    written = (r && r.written) || 0;
  } catch (e) {
    console.error('[write]', e && e.message);
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ count: primaryJobs.length, written, gapFill: usedGapFill, country: country.toUpperCase(), region, role, results: primaryJobs });
}

module.exports = handler;
module.exports.routeByCountry = routeByCountry;
module.exports.normalizedJob = normalizedJob;
