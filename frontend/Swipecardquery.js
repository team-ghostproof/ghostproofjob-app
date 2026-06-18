'use strict';
/**
 * frontend/swipeCardQuery.js
 * Binds swipe-deck search to the synced account profile (user.location) and
 * makes card apply read the raw direct_apply_url (no aggregator wrappers).
 *
 * Framework-agnostic: pass in your job-fetch + user-state accessors.
 */

/* ---- INITIALIZATION SAFETY + CIRCUIT BREAKER ---- */
/* ironclad one-shot telemetry lock: a caught init failure reports exactly once
   and short-circuits every downstream recursive log request. */
let telemetrySent = false;
function reportTelemetryOnce(err) {
  if (telemetrySent) return;
  telemetrySent = true;
  try {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[swipeCardQuery] init issue (reported once):', err && err.message ? err.message : err);
    }
  } catch (e) { /* never throw from the reporter */ }
}

/* protected baseline seed deck served when Firebase isn't mounted yet, so the
   UI degrades gracefully instead of throwing a script-breaking exception. */
function fallbackBaselineDeck() {
  return [];
}

/* true only when the Firebase app + auth are fully mounted by index.js */
function firebaseReady() {
  try {
    if (typeof window !== 'undefined' && window.fb && typeof window.fb.fetchJobs === 'function') return true;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) return true;
  } catch (e) { return false; }
  return false;
}

const REGIONAL_ENDPOINT = '/api/jobs/regionalRouter';
const AGGREGATOR_SOURCES = ['Jooble', 'Adzuna', 'jooble', 'adzuna'];

/* Build a clean-sourcing Firestore query: when the routing context specifies
   clean mode, exclude aggregator sources directly in the query builder so the
   client never even receives Jooble/Adzuna items (which trigger Cloudflare
   verification walls). Firestore allows multiple inequality filters on the SAME
   field, so chained '!=' on `source` is valid. */
function buildCleanDeckQuery(collectionRef, opts) {
  opts = opts || {};
  let q = collectionRef;
  if (opts.region) q = q.where('region', '==', opts.region);
  if (opts.cleanSourcing) {
    q = q.where('source', '!=', 'Jooble').where('source', '!=', 'Adzuna');
  }
  // cache-bypass: order by an ingestion field to force a fresh server read path
  if (q.orderBy) { try { q = q.orderBy('source').orderBy('ingestedAt', 'desc'); } catch (e) {} }
  return q;
}

/* strip aggregator items defensively in clean mode (covers API path too) */
function filterCleanSources(list, cleanSourcing) {
  if (!Array.isArray(list)) return [];
  if (!cleanSourcing) return list;
  return list.filter((r) => r && AGGREGATOR_SOURCES.indexOf(String(r.source || '')) === -1);
}

/* derive the active location strictly from synced profile state, with safe
   fallbacks; never from a hardcoded default. */
function resolveUserLocation(user) {
  if (!user) return '';
  if (user.location && String(user.location).trim()) return String(user.location).trim();
  const parts = [user.city, user.state].filter(Boolean);
  if (parts.length) return parts.join(', ');
  if (user.profile && user.profile.location) return String(user.profile.location).trim();
  return '';
}

/* reject corrupted bare-number locations (e.g. a years-exp leak) */
function isValidLocation(loc) {
  const s = (loc || '').trim();
  if (!s) return false;
  if (/^\d{1,4}$/.test(s)) return false;
  return true;
}

/* normalize any string for case-insensitive containment matching */
function normalizeText(s) {
  return (s == null ? '' : String(s)).toLowerCase().trim();
}

/* case-insensitive keyword containment: "Marketing" matches "marketing specialist".
   Every token in the query must appear somewhere in the record's searchable text. */
function matchesKeyword(record, query) {
  const q = normalizeText(query);
  if (!q) return true;
  const hay = normalizeText(
    [record && record.title, record && record.company, record && record.location, record && record.region]
      .filter(Boolean)
      .join(' ')
  );
  return q.split(/\s+/).every((tok) => hay.indexOf(tok) !== -1);
}

/* client-side case-insensitive filter over a result list */
function filterByKeyword(list, query) {
  if (!Array.isArray(list)) return [];
  const q = normalizeText(query);
  if (!q) return list;
  return list.filter((r) => matchesKeyword(r, q));
}

/* Pre-populate a search input with the user's saved location on mount so the
   dashboard never renders a blank placeholder row. Falls back to "United States". */
function initLocationField(inputEl, user) {
  if (!inputEl) return '';
  const loc = resolveUserLocation(user);
  const value = isValidLocation(loc) ? loc : 'United States';
  if (!inputEl.value || !inputEl.value.trim()) inputEl.value = value;
  return value;
}

/**
 * Build + run the swipe deck query from synced profile state.
 * @param {object} user  synced account profile ({location|city|state, role?})
 * @param {object} opts  { role?, country?, page?, fetchImpl? }
 * @returns {Promise<Array>} normalized job cards
 */
async function querySwipeDeck(user, opts) {
  opts = opts || {};
  /* INIT SHIELD: never query before Firebase app+auth are mounted by index.js */
  if (!firebaseReady()) {
    reportTelemetryOnce(new Error('firebase not mounted at query time'));
    return fallbackBaselineDeck();
  }
  const location = resolveUserLocation(user);
  const role = (opts.role || (user && user.targetRole) || '').toString();
  const country = (opts.country || (user && user.country) || 'US').toString();
  const page = opts.page || 1;
  const doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('no fetch implementation available');

  const params = new URLSearchParams();
  if (isValidLocation(location)) params.set('region', location);
  if (role) params.set('role', role);
  params.set('country', country);
  params.set('page', String(page));
  const cleanSourcing = opts.cleanSourcing === true || opts.clean === true;
  if (cleanSourcing) params.set('clean', '1');
  // cache-bust: unique token + no-store so a clean lookup never serves a cached
  // response that still contains aggregator items
  params.set('_cb', String(Date.now()));

  try {
    const res = await doFetch(REGIONAL_ENDPOINT + '?' + params.toString(), { cache: 'no-store' });
    if (!res || !res.ok) return [];
    const data = await res.json();
    let results = Array.isArray(data && data.results) ? data.results : [];
    results = filterCleanSources(results, cleanSourcing);
    // case-insensitive client-side keyword match so "Marketing" finds "marketing specialist"
    results = filterByKeyword(results, role);
    return results;
  } catch (e) {
    reportTelemetryOnce(e);
    return fallbackBaselineDeck();
  }
}

/**
 * Resolve the apply URL for a card: read the raw direct_apply_url stringently,
 * bypassing any aggregator redirect wrapper fields.
 * @param {object} card
 * @returns {string} the direct application URL, or '' if none
 */
function getApplyUrl(card) {
  if (!card) return '';
  // strict: only the canonical backend field; ignore legacy redirect/aggregator keys
  const url = card.direct_apply_url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url.trim();
  return '';
}

/**
 * Click-to-apply handler. Opens the direct employer URL in a new tab; never
 * routes through an aggregator wrapper. Returns false if no valid URL.
 * @param {object} card
 * @param {function} [opener] custom opener (defaults to window.open)
 */
function applyToCard(card, opener) {
  const url = getApplyUrl(card);
  if (!url) return false;
  const open = opener || (typeof window !== 'undefined' ? (u) => window.open(u, '_blank', 'noopener') : null);
  if (open) open(url);
  return true;
}

/**
 * Open a saved job into the full interactive overlay (Match / Cover Letter /
 * Company Intel) rather than a raw tracking link. Re-instantiates the rich card
 * view in the viewport via the host app's overlay renderer.
 * @param {object} job   saved job record
 * @param {object} hooks { openCompanyView?, renderCardOverlay? } host renderers
 */
function openSavedJobCard(job, hooks) {
  if (!job) return false;
  hooks = hooks || {};
  const co = job.company || job.co || '';
  const title = job.title || job.t || '';
  const url = getApplyUrl(job) || job.url || '';
  // prefer the rich overlay so the user keeps Match/Cover Letter/Company Intel
  if (typeof hooks.renderCardOverlay === 'function') {
    hooks.renderCardOverlay({ title: title, company: co, direct_apply_url: url });
    return true;
  }
  if (typeof hooks.openCompanyView === 'function' && co) {
    hooks.openCompanyView(co, { title: title, url: url });
    return true;
  }
  // last resort only — never the default path
  return applyToCard({ direct_apply_url: url });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { querySwipeDeck, getApplyUrl, applyToCard, resolveUserLocation, isValidLocation, buildCleanDeckQuery, filterCleanSources, openSavedJobCard, normalizeText, matchesKeyword, filterByKeyword, initLocationField, firebaseReady, fallbackBaselineDeck, reportTelemetryOnce };
}
