'use strict';
/**
 * seo-generator/companies.js — static "Jobs at {Company}" pages.
 *
 * FOUNDER-APPROVED MODEL (v123, "the safest way"): these are NEUTRAL placeholder
 * pages built ONLY from facts the company itself published — its live job
 * postings in our pool — plus a "claim your page" invitation. They exist to earn
 * organic search traffic ("jobs at X", "is X hiring") and to recruit employers.
 *
 * HARD HONESTY CONSTRAINTS (enforced by tests/seo/seoPages.test.mjs):
 *  - NO ghost-report counts, NO risk percentages, NO negative claims about any
 *    named company. Community-report data stays inside the app where the
 *    dispute flow exists. (This is what made per-company pages safe to ship.)
 *  - Job counts are framed as "recently seen" — postings churn daily, and a
 *    static page must never pretend to be a live feed.
 *  - Zero runtime reads: data is fetched once at BUILD time via the public REST
 *    endpoint; the emitted HTML makes no requests.
 */

const https = require('https');

const SITE = 'https://ghostproofjob.com';
const MIN_ROLES = 2;      // no thin pages
const MAX_COMPANIES = 250;
const MAX_ROLES_SHOWN = 12;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fetchActiveJobs(cap) {
  const body = JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'jobs' }],
    where: { fieldFilter: { field: { fieldPath: 'active' }, op: 'EQUAL', value: { booleanValue: true } } },
    orderBy: [{ field: { fieldPath: 'ingestedAt' }, direction: 'DESCENDING' }],
    limit: cap || 3000 } });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: '/v1/projects/ghostproofjob-app/databases/(default)/documents:runQuery',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}

function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('booleanValue' in v) return v.booleanValue;
  return null;
}

const JUNK = /^(unknown|confidential|n\/a|various|private|staffing|recruiting agency)$/i;

/** Group live jobs by company → [{name, slug, count, roles:[{title,location}]}] */
function aggregate(jobs) {
  const by = new Map();
  for (const j of jobs || []) {
    const name = String(j.company || '').trim();
    if (name.length < 2 || name.length > 80 || JUNK.test(name)) continue;
    const title = String(j.title || '').trim();
    if (!title) continue;
    const k = name.toLowerCase();
    if (!by.has(k)) by.set(k, { name, count: 0, roles: [] });
    const c = by.get(k);
    c.count++;
    if (c.roles.length < MAX_ROLES_SHOWN) {
      c.roles.push({ title: title.slice(0, 90), location: String(j.location || (j.is_remote ? 'Remote' : '')).slice(0, 60) });
    }
  }
  const seenSlugs = new Set();
  return [...by.values()]
    .filter((c) => c.count >= MIN_ROLES)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COMPANIES)
    .map((c) => {
      let slug = 'co-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      while (seenSlugs.has(slug)) slug += '-2';
      seenSlugs.add(slug);
      return Object.assign({ slug }, c);
    });
}

function renderCompanyPage(c) {
  const n = c.count, name = esc(c.name);
  const roleRows = c.roles.map((r) =>
    '<li><strong>' + esc(r.title) + '</strong>' + (r.location ? (' — ' + esc(r.location)) : '') + '</li>').join('\n      ');
  const more = n > c.roles.length ? ('<p class="muted">…and ' + (n - c.roles.length) + ' more in the app.</p>') : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Jobs at ${name} — ${n} open role${n === 1 ? '' : 's'} | GhostProofJob</title>
<meta name="description" content="GhostProofJob recently spotted ${n} live opening${n === 1 ? '' : 's'} from ${name}. See the roles, check freshness signals, and apply free — no ads, no data selling."/>
<link rel="canonical" href="${SITE}/seo/${c.slug}.html"/>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#120F1D;color:#EDEAF6;line-height:1.6}
  .wrap{max-width:720px;margin:0 auto;padding:32px 20px 60px}
  a{color:#00F5A0} h1{font-size:26px;margin:18px 0 6px} h2{font-size:18px;margin:26px 0 8px;color:#B55FE6}
  .muted{color:#9b93b8;font-size:14px} .cta{display:inline-block;background:#00F5A0;color:#120F1D;font-weight:800;border-radius:12px;padding:12px 22px;text-decoration:none;margin:14px 0}
  .claim{background:rgba(181,95,230,.12);border:1px solid rgba(181,95,230,.4);border-radius:14px;padding:16px 18px;margin-top:26px}
  ul{padding-left:20px} li{margin-bottom:6px} .brand{font-weight:800;color:#B55FE6;text-decoration:none}
  footer{margin-top:40px;font-size:12px;color:#9b93b8;border-top:1px solid #2a2440;padding-top:14px}
</style>
</head>
<body>
<div class="wrap">
  <a class="brand" href="${SITE}/">👻 GhostProofJob</a>
  <h1>Jobs at ${name}</h1>
  <p>GhostProofJob has recently seen <strong>${n} live opening${n === 1 ? '' : 's'}</strong> from ${name} in its job pool. Openings change daily — the current list, freshness signals, and one-tap tailored applications are in the app.</p>
  <h2>Recently seen roles</h2>
  <ul>
      ${roleRows}
  </ul>
  ${more}
  <a class="cta" href="${SITE}/">See these roles on GhostProofJob →</a>
  <div class="claim">
    <strong>Are you ${name}?</strong> Claim your presence: create a free employer account to verify your company,
    add your logo and links, answer applicants directly, and earn an Anti-Ghosting Badge candidates can trust.
    <div><a href="${SITE}/">Create your employer account →</a></div>
  </div>
  <footer>
    GhostProofJob is free until you're hired — applications are always unlimited, there are no ads, and we never sell your data.
    Role counts reflect postings recently observed in our pool and update inside the app as roles open and close.<br/>
    GhostProofJob · Houston, TX · <a href="tel:+12819159482">(281) 915-9482</a> · <a href="mailto:support@ghostproofjob.com">support@ghostproofjob.com</a>
  </footer>
</div>
</body>
</html>
`;
}

async function buildCompanies() {
  const rows = await fetchActiveJobs(3000);
  const jobs = rows.filter((r) => r.document).map((r) => {
    const f = {}; for (const [k, v] of Object.entries(r.document.fields || {})) f[k] = val(v);
    return f;
  });
  const list = aggregate(jobs);
  return { list, pages: list.map((c) => ({ slug: c.slug, html: renderCompanyPage(c) })) };
}

module.exports = { buildCompanies, aggregate, renderCompanyPage, MIN_ROLES, MAX_COMPANIES };
