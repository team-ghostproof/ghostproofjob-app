#!/usr/bin/env node
'use strict';
/**
 * scripts/market_taxonomy.mjs — single-source classifiers for the Resources engine.
 * ---------------------------------------------------------------------------
 * The Resources SEO engine publishes DATA-GROUNDED articles: every number in an
 * article is computed in code from our own jobs DB, never invented by the AI. To
 * compute those numbers we need to bucket a raw job doc into a FIELD and a CITY.
 *
 * This module is the ONE place that logic lives, imported by BOTH:
 *   - build_job_pool.mjs  — tallies aggregates during its existing daily stream
 *                           (zero extra Firestore reads — see market_stats there),
 *   - build_resources.mjs — turns those aggregates into an article.
 *
 * Keeping it single-source means a field label can never drift between the count
 * and the prose that describes it. Pure functions, no I/O, offline-testable.
 *
 * HONESTY NOTE: classification is by TITLE KEYWORD — approximate, and every
 * article says so ("grouped by role title"). We never present it as a precise
 * industry taxonomy. A title that matches nothing lands in 'Other', which the
 * articles report honestly rather than forcing into a bucket.
 */

/* Field buckets, checked in order — first match wins, so put the more specific
   fields before the broad ones. Keywords are lowercased substrings of the title. */
export const FIELDS = [
  ['Technology',  ['software','developer','engineer','programmer','devops','data scientist','data engineer','machine learning','ml ','ai ','frontend','front-end','backend','back-end','full stack','full-stack','sre','cloud','cybersecurity','security engineer','qa ','sdet','ios','android','web developer','platform engineer','systems engineer','network engineer','database','it ','information technology','technical support','help desk']],
  ['Healthcare',  ['nurse','rn ',' rn','physician','doctor','medical','clinical','pharmacy','pharmacist','therapist','therapy','healthcare','health care','caregiver','dental','patient','surgical','radiolog','phlebotom','cna ','lpn','behavioral health','physical therap','occupational therap','veterinar']],
  ['Marketing',   ['marketing','brand','seo','content','social media','communications','copywriter','growth','demand generation','digital marketing','pr ','public relations','campaign','creative director','marketing manager']],
  ['Finance',     ['accountant','accounting','finance','financial','auditor','bookkeeper','controller','tax ','payroll','underwriter','loan','banking','investment','actuary','treasury','fp&a','credit analyst']],
  ['Sales',       ['sales','account executive','account manager','business development','bdr','sdr','account rep','sales rep','territory manager','inside sales','outside sales','sales manager']],
  ['Operations',  ['operations','logistics','supply chain','warehouse','procurement','inventory','fulfillment','operations manager','ops ','plant manager','production manager','quality manager']],
  ['Customer Support', ['customer service','customer support','customer success','client success','support specialist','call center','contact center','client services','customer care']],
  ['Human Resources',  ['human resources','hr ','recruiter','talent','people operations','benefits','compensation','hris','onboarding specialist']],
  ['Education',   ['teacher','professor','instructor','tutor','education','curriculum','faculty','school','academic','teaching','paraprofessional','substitute']],
  ['Engineering', ['mechanical engineer','electrical engineer','civil engineer','industrial engineer','manufacturing engineer','process engineer','structural engineer','chemical engineer','aerospace','maintenance technician']],
  ['Administrative', ['administrative','admin assistant','office manager','executive assistant','receptionist','data entry','clerk','coordinator','scheduler','office administrator']],
  ['Design',      ['designer','ux ','ui ','ux/ui','graphic design','product designer','visual design','industrial design','interior design']],
  ['Legal',       ['attorney','lawyer','paralegal','legal','counsel','compliance','contract manager']],
];

/** Bucket a job title into a field. Returns 'Other' when nothing matches. */
export function fieldOf(title) {
  const t = ' ' + String(title || '').toLowerCase().replace(/[^a-z0-9&/ ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const [name, kws] of FIELDS) {
    for (const kw of kws) { if (t.includes(kw)) return name; }
  }
  return 'Other';
}

/* US state postal codes — used to pull a "City, ST" out of a location string. */
const STATES = new Set(['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc']);

/** Coerce a location value (string OR {display_name}) to a plain string. */
export function locStr(location) {
  if (location && typeof location === 'object') return String(location.display_name || location.name || '');
  return String(location == null ? '' : location);
}

/** Normalize a location string to "City, ST" when we can recognize one, else ''.
 *  Deliberately conservative: only returns a value when the last token is a real
 *  state code, so a street address never mints a fake city (the v120 bug class). */
export function cityOf(location) {
  const raw = locStr(location).trim();
  if (!raw) return '';
  if (/^(remote|anywhere|work from home|wfh)\b/i.test(raw)) return '';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  if (!STATES.has(last)) return '';
  const city = parts[parts.length - 2].replace(/\b\d{5}(-\d{4})?\b/g, '').trim();
  if (!city || /\d/.test(city)) return '';
  return city.replace(/\b\w/g, (c) => c.toUpperCase()) + ', ' + last.toUpperCase();
}

/** Is this job remote? Mirrors the flags the harvester/aggregators set. */
export function isRemote(v) {
  if (v && (v.is_remote === true || v.work_setting === 'remote')) return true;
  const loc = String((v && v.location) || '').toLowerCase();
  const title = String((v && v.title) || '').toLowerCase();
  return /\bremote\b|work from home|\bwfh\b|\banywhere\b/.test(loc) || /\bremote\b/.test(title);
}

/** Does this job disclose pay? (salary transparency article) */
export function hasPostedSalary(v) {
  return !!(v && (v.salary_min || v.salary_max || (v.salary && String(v.salary).replace(/[^0-9]/g, '').length >= 4)));
}

/** Fresh empty accumulator for the daily stream tally. */
export function newStats() {
  return { total: 0, remote: 0, salaryPosted: 0, verified: 0, byField: {}, byRemoteField: {}, byCity: {}, bySource: {} };
}

/** Fold ONE raw job doc into the accumulator. Called once per doc as it streams —
 *  O(1), no allocation growth, so it is safe to run inside the memory-bounded pool
 *  stream (the whole point of piggybacking: zero extra reads). */
export function tally(stats, v) {
  if (!v || !v.title || v.active === false) return stats;
  stats.total++;
  const f = fieldOf(v.title);
  stats.byField[f] = (stats.byField[f] || 0) + 1;
  const rem = isRemote(v);
  if (rem) { stats.remote++; stats.byRemoteField[f] = (stats.byRemoteField[f] || 0) + 1; }
  if (hasPostedSalary(v)) stats.salaryPosted++;
  if (v.source === 'internal' || v.verified === true) stats.verified++;
  const src = String(v.source || 'other').toLowerCase().slice(0, 20);
  stats.bySource[src] = (stats.bySource[src] || 0) + 1;
  const c = cityOf(v.location);
  if (c) stats.byCity[c] = (stats.byCity[c] || 0) + 1;
  return stats;
}

/** Sorted [name,count] pairs, biggest first, top N — the shape articles rank on. */
export function topN(obj, n = 8) {
  return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}
