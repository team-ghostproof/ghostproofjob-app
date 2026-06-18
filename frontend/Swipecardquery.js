'use strict';
/**
 * frontend/swipeCardQuery.js
 * Binds swipe-deck search to the synced account profile (user.location) and
 * makes card apply read the raw direct_apply_url (no aggregator wrappers).
 *
 * Framework-agnostic: pass in your job-fetch + user-state accessors.
 */

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

/**
 * Build + run the swipe deck query from synced profile state.
 * @param {object} user  synced account profile ({location|city|state, role?})
 * @param {object} opts  { role?, country?, page?, fetchImpl? }
 * @returns {Promise<Array>} normalized job cards
 */
async function querySwipeDeck(user, opts) {
  opts = opts || {};
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
    const results = Array.isArray(data && data.results) ? data.results : [];
    return filterCleanSources(results, cleanSourcing);
  } catch (e) {
    return [];
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
  module.exports = { querySwipeDeck, getApplyUrl, applyToCard, resolveUserLocation, isValidLocation, buildCleanDeckQuery, filterCleanSources, openSavedJobCard };
}
