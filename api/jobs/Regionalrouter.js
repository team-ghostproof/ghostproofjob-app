'use strict';
/**
 * LAYER 1 — REGIONAL API ROUTER
 * ------------------------------
 * Accepts an ISO-3166 alpha-2 country code and routes the search to the correct
 * regional provider, normalizing every response to a single internal job shape.
 *
 *   US                 -> USAJOBS Search API
 *   GB / UK            -> UK Gov "Find a Job" API
 *   FR / DE / ES / IT  -> EU EURES API
 *
 * All providers return the SAME normalized object so downstream layers and the
 * Firestore writer never branch on region.
 *
 * Secrets are read from env (Cloud Functions config / process.env) — never hardcoded.
 *   USAJOBS_API_KEY, USAJOBS_USER_AGENT
 *   FINDAJOB_API_KEY            (UK)
 *   EURES_API_KEY              (optional; EURES public endpoints may not need it)
 */

const axios = require('axios');

const DEFAULT_TIMEOUT = 12000;

const EURES_COUNTRIES = new Set(['FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'AT', 'PL', 'IE', 'SE', 'FI', 'DK', 'PT']);

/** Normalized internal job shape — the single contract for all providers. */
function normalizedJob(p) {
  return {
    title: (p.title || '').toString().trim(),
    company: (p.company || '').toString().trim(),
    location: (p.location || '').toString().trim(),
    country: (p.country || '').toString().toUpperCase(),
    description: (p.description || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 4000),
    applyUrl: (p.applyUrl || '').toString().trim(),
    salaryText: (p.salaryText || '').toString().trim().slice(0, 80),
    postedAt: p.postedAt || null,
    source: p.source || 'regional',
  };
}

const httpClient = axios.create({
  timeout: DEFAULT_TIMEOUT,
  // Never throw on 4xx/5xx — we inspect status ourselves and degrade gracefully.
  validateStatus: () => true,
});

/** USAJOBS — https://developer.usajobs.gov/ */
async function fetchUSAJobs(env, { what, where, page }) {
  if (!env.USAJOBS_API_KEY) return [];
  const params = {
    Keyword: what || '',
    LocationName: where || '',
    Page: page || 1,
    ResultsPerPage: 25,
  };
  const res = await httpClient.get('https://data.usajobs.gov/api/search', {
    params,
    headers: {
      'Authorization-Key': env.USAJOBS_API_KEY,
      'User-Agent': env.USAJOBS_USER_AGENT || 'GhostProofJob/1.0 (contact@ghostproofjob.com)',
      Host: 'data.usajobs.gov',
    },
  });
  if (res.status !== 200 || !res.data) return [];
  const items = (res.data.SearchResult && res.data.SearchResult.SearchResultItems) || [];
  return items.map((it) => {
    const d = (it.MatchedObjectDescriptor) || {};
    const pay = (d.PositionRemuneration && d.PositionRemuneration[0]) || {};
    const loc = (d.PositionLocation && d.PositionLocation[0] && d.PositionLocation[0].LocationName) || (d.PositionLocationDisplay || '');
    return normalizedJob({
      title: d.PositionTitle,
      company: d.OrganizationName,
      location: loc,
      country: 'US',
      description: (d.UserArea && d.UserArea.Details && d.UserArea.Details.JobSummary) || d.QualificationSummary || '',
      applyUrl: d.ApplyURI && d.ApplyURI[0] ? d.ApplyURI[0] : d.PositionURI,
      salaryText: pay.MinimumRange ? `${pay.MinimumRange}–${pay.MaximumRange} ${pay.RateIntervalCode || ''}`.trim() : '',
      postedAt: d.PublicationStartDate || null,
      source: 'usajobs',
    });
  });
}

/** UK Gov Find a Job — https://findajob.dwp.gov.uk/apidocs */
async function fetchFindAJob(env, { what, where, page }) {
  if (!env.FINDAJOB_API_KEY) return [];
  const res = await httpClient.get('https://findajob.dwp.gov.uk/api/v1/jobs', {
    params: { q: what || '', w: where || '', p: page || 1 },
    headers: { 'Api-Key': env.FINDAJOB_API_KEY, Accept: 'application/json' },
  });
  if (res.status !== 200 || !res.data) return [];
  const items = res.data.results || res.data.jobs || [];
  return items.map((j) =>
    normalizedJob({
      title: j.title,
      company: j.company || j.employer,
      location: j.location || j.location_name,
      country: 'GB',
      description: j.description || j.summary,
      applyUrl: j.url || j.redirect_url,
      salaryText: j.salary || '',
      postedAt: j.date_posted || j.created || null,
      source: 'findajob',
    })
  );
}

/** EU EURES — https://ec.europa.eu/eures (JV portal API) */
async function fetchEures(env, { what, where, page, country }) {
  const body = {
    keywords: what ? [{ keyword: what, specificSearchCode: 'EVERYWHERE' }] : [],
    locationCodes: country ? [country] : [],
    positionScheduleCodes: [],
    page: { number: page || 1, size: 25 },
    resultLanguage: 'en',
    sortSearch: 'BEST_MATCH',
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (env.EURES_API_KEY) headers['X-Api-Key'] = env.EURES_API_KEY;
  const res = await httpClient.post(
    'https://europa.eu/eures/eures-apps/searchengine/page/jv-search/search',
    body,
    { headers }
  );
  if (res.status !== 200 || !res.data) return [];
  const items = (res.data.jvs) || (res.data.results) || [];
  return items.map((j) =>
    normalizedJob({
      title: j.title,
      company: (j.employer && j.employer.name) || j.companyName,
      location: (j.locationMap && Object.values(j.locationMap)[0]) || j.location || where,
      country: (country || '').toUpperCase(),
      description: j.description || j.jobDescription,
      applyUrl: j.jvUrl || j.applyUrl || j.url,
      salaryText: j.salaryInfo || '',
      postedAt: j.creationDate || j.modificationDate || null,
      source: 'eures',
    })
  );
}

/**
 * Route a search to the correct regional provider.
 * @param {object} opts
 * @param {string} opts.country  ISO alpha-2 (e.g. "US", "GB", "FR")
 * @param {string} [opts.what]   keyword
 * @param {string} [opts.where]  location string
 * @param {number} [opts.page]
 * @param {object} [env]         secret bag (defaults to process.env)
 * @returns {Promise<Array>} normalized job objects (never throws; [] on failure)
 */
async function routeRegionalSearch(opts, env) {
  const cfg = env || process.env;
  const country = ((opts && opts.country) || 'US').toUpperCase();
  const args = {
    what: (opts && opts.what) || '',
    where: (opts && opts.where) || '',
    page: (opts && opts.page) || 1,
    country,
  };
  try {
    if (country === 'US') return await fetchUSAJobs(cfg, args);
    if (country === 'GB' || country === 'UK') return await fetchFindAJob(cfg, args);
    if (EURES_COUNTRIES.has(country)) return await fetchEures(cfg, args);
    // Unmapped country: no regional provider — caller falls back to ATS/aggregators.
    return [];
  } catch (err) {
    // Resilient by contract: a provider outage must not crash the pipeline.
    console.error(`[regionalRouter] ${country} failed:`, err && err.message);
    return [];
  }
}

module.exports = { routeRegionalSearch, normalizedJob, EURES_COUNTRIES };
