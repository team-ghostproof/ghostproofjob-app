/**
 * GhostProofJob — Backend Worker (Cloudflare)
 * ============================================
 * ONE worker, TWO secure endpoints:
 *
 *   GET  /jobs     → Adzuna job search proxy (keys stay server-side)
 *   POST /contact  → Support email via Resend (key stays server-side)
 *
 * DEPLOY (free tier, ~5 minutes):
 *   1. dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Paste this file, Deploy
 *   3. Settings → Variables and Secrets → add as SECRETS (encrypted):
 *        ADZUNA_APP_ID   = your app_id   (developer.adzuna.com — free)
 *        ADZUNA_APP_KEY  = your app_key
 *        RESEND_API_KEY  = your key      (resend.com — free tier: 100 emails/day)
 *   4. In Resend: verify the domain ghostproofjob.com (add their DNS records)
 *      so mail sends from support@ghostproofjob.com without spam-flagging.
 *   5. Copy your worker URL into WORKER_URL at the top of GhostProofJob.html
 *
 * SECURITY:
 *   - All third-party API keys live ONLY here, encrypted, never in the browser.
 *   - ALLOWED_ORIGINS locks both endpoints to your site.
 *   - /contact is rate-limited per IP (in-memory, best-effort) and
 *     length-capped to prevent abuse of your Resend quota.
 *   - /jobs responses cache 5 min at the edge to protect your Adzuna quota.
 *   - No customer data is stored or logged by this worker.
 */

const ALLOWED_ORIGINS = [
  'https://ghostproofjob.com',
  'https://www.ghostproofjob.com',
  'http://localhost:8000',   // local testing — remove for production
  'null',                    // file:// testing — REMOVE for production
];

const ADZUNA_COUNTRY = 'us';      // default; overridable per-request via &country=
const COUNTRY_WHITELIST = ['us','ca','mx','gb','au','nz','in','sg','za','de','fr','it','es','nl','be','at','pl','ch','br'];
const CACHE_SECONDS  = 300;
const SUPPORT_TO     = 'support@ghostproofjob.com';
const SUPPORT_FROM   = 'GhostProofJob Support <support@ghostproofjob.com>'; // must be on your verified Resend domain

/* naive per-isolate rate limiter for /contact (best-effort; fine at this scale) */
const contactHits = new Map();
const CONTACT_LIMIT = 5;          // max messages
const CONTACT_WINDOW = 3600_000;  // per hour per IP

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || 'null';
    // HARD ORIGIN GATE: browser requests from unknown sites are rejected outright,
    // not just denied the CORS header — protects your Adzuna/Resend quotas.
    // Requests with no Origin (curl, server-to-server, your own testing) pass through.
    if (request.headers.has('Origin') && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);

    /* ---------------- GET /jobs — Adzuna proxy ---------------- */
    if (url.pathname === '/jobs' && request.method === 'GET') {
      const what  = (url.searchParams.get('what')  || '').slice(0, 100);
      const where = (url.searchParams.get('where') || '').slice(0, 100);
      const days  = Math.min(parseInt(url.searchParams.get('days') || '0', 10) || 0, 365);
      const page  = Math.min(parseInt(url.searchParams.get('page') || '1', 10) || 1, 10);
      // WORLDWIDE: per-request country, whitelisted; falls back to default
      const cReq  = (url.searchParams.get('country') || '').toLowerCase();
      const country = COUNTRY_WHITELIST.includes(cReq) ? cReq : ADZUNA_COUNTRY;
      // ZIP/RADIUS: distance (km) passes ONLY alongside a concrete where target,
      // preventing Adzuna's silent zero-result filtering drops
      const distKm = Math.min(parseInt(url.searchParams.get('distance') || '0', 10) || 0, 200);

      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      /* map our 2-letter country codes to names Jooble's geo-resolver understands */
      const COUNTRY_NAMES = {
        us:'USA', ca:'Canada', mx:'Mexico', gb:'United Kingdom', au:'Australia',
        nz:'New Zealand', in:'India', sg:'Singapore', za:'South Africa', de:'Germany',
        fr:'France', it:'Italy', es:'Spain', nl:'Netherlands', be:'Belgium',
        at:'Austria', pl:'Poland', ch:'Switzerland', br:'Brazil'
      };
      /* ---- LINK UNWRAPPER ----
         Aggregators (Jooble, Adzuna) often wrap the real employer posting inside a
         redirect URL as a query param (?url=, ?u=, ?to=, ?dest=, ?target=, ?link=).
         When the true destination is exposed we extract it so the user lands on the
         employer's own posting and skips the ad/email-capture interstitial. When it's
         NOT exposed (hidden server-side) we honestly leave the link as-is. */
      function unwrapDest(raw) {
        if (!raw) return raw;
        try {
          let u = new URL(raw);
          for (let i = 0; i < 3; i++) {            // follow up to 3 nested wrappers
            let found = null;
            for (const key of ['url','u','to','dest','destination','target','link','r','redirect','out']) {
              const v = u.searchParams.get(key);
              if (v && /^https?:\/\//i.test(decodeURIComponent(v))) { found = decodeURIComponent(v); break; }
            }
            if (!found) break;
            u = new URL(found);
          }
          return u.toString();
        } catch (e) { return raw; }
      }
      /* ---- SOURCE HELPERS ---- */
      async function fetchJooble() {
        if (!env.JOOBLE_API_KEY || !what) return [];
        try {
          /* Jooble has no country param — it reads the location string. When the
             user gives a bare location (or none) we append the country name so a
             "London" search in GB mode doesn't silently return US results. */
          let loc = where || '';
          const cname = COUNTRY_NAMES[country];
          if (cname && country !== 'us' && !new RegExp(cname, 'i').test(loc)) {
            loc = loc ? (loc + ', ' + cname) : cname;
          }
          const jr = await fetch('https://jooble.org/api/' + env.JOOBLE_API_KEY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: what, location: loc, page: String(page) }),
          });
          if (!jr.ok) return [];
          const jd = await jr.json();
          return (jd.jobs || []).map(j => ({
            title: (j.title || 'Open Role').replace(/<[^>]+>/g, ''),
            company: (j.company || 'Hiring Company').trim(),
            salary_min: null,
            salary_max: null,
            salary_text: (j.salary || '').replace(/<[^>]+>/g, '').trim().slice(0, 40),
            location: j.location || '',
            redirect_url: unwrapDest(j.link || ''),
            created: j.updated || null,
            description: (j.snippet || '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 600),
            source: 'jooble',
          }));
        } catch (e) { return []; }
      }
      async function fetchAdzuna() {
        const upstream =
          `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}` +
          `?app_id=${encodeURIComponent(env.ADZUNA_APP_ID)}` +
          `&app_key=${encodeURIComponent(env.ADZUNA_APP_KEY)}` +
          `&results_per_page=20&content-type=application/json` +
          (days  ? `&max_days_old=${days}`               : '') +
          (where && distKm ? `&distance=${distKm}`       : '') +
          (what  ? `&what=${encodeURIComponent(what)}`   : '') +
          (where ? `&where=${encodeURIComponent(where)}` : '');
        try {
          const res = await fetch(upstream);
          if (!res.ok) return [];
          const data = await res.json();
          return (data.results || []).map(r => ({
            title: r.title,
            company: r.company && r.company.display_name,
            salary_min: r.salary_min,
            salary_max: r.salary_max,
            location: r.location && r.location.display_name,
            redirect_url: unwrapDest(r.redirect_url),
            created: r.created,
            description: (r.description || '').slice(0, 600),
            source: 'adzuna',
          }));
        } catch (e) { return []; }
      }

      try {
        /* ---- JOOBLE PRIMARY, ADZUNA BACKUP ----
           Jooble has far broader coverage and links closer to the employer's own
           portal (fewer dead apply links). We lead with it. Adzuna fills in only
           when Jooble is thin (<8) or its key isn't set — then we dedupe by
           company+title so the user never sees the same role twice. If Jooble has
           no key configured, Adzuna seamlessly becomes primary (zero downtime). */
        let results = await fetchJooble();
        const primary = results.length ? 'jooble' : 'adzuna';

        if (results.length < 8) {
          const adz = await fetchAdzuna();
          const seen = new Set(results.map(r => ((r.company || '') + '|' + (r.title || '')).toLowerCase()));
          adz.forEach(r => {
            const key = ((r.company || '') + '|' + (r.title || '')).toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            results.push(r);
          });
        }

        if (!results.length) return json({ error: 'no_results', count: 0, results: [] }, 200, cors);

        const slim = { count: results.length, primary, results };
        const out = json(slim, 200, { ...cors, 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
        await cache.put(cacheKey, out.clone());
        return out;
      } catch (e) {
        return json({ error: 'proxy_failure' }, 502, cors);
      }
    }

    /* ---------------- POST /contact — Resend email ---------------- */
    if (url.pathname === '/contact' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const now = Date.now();
      const rec = contactHits.get(ip) || { n: 0, t: now };
      if (now - rec.t > CONTACT_WINDOW) { rec.n = 0; rec.t = now; }
      if (rec.n >= CONTACT_LIMIT) return json({ error: 'rate_limited' }, 429, cors);

      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      const name    = String(body.name    || '').slice(0, 100).trim();
      const email   = String(body.email   || '').slice(0, 150).trim();
      const message = String(body.message || '').slice(0, 3000).trim();
      if (!message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: 'invalid_fields' }, 400, cors);
      }

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: SUPPORT_FROM,
            to: [SUPPORT_TO],
            reply_to: email,
            subject: `Support: ${name || email}`,
            text: `From: ${name || '(no name)'} <${email}>\n\n${message}`,
          }),
        });
        if (!res.ok) return json({ error: 'send_failed' }, 502, cors);
        rec.n++; contactHits.set(ip, rec);
        return json({ ok: true }, 200, cors);
      } catch (e) {
        return json({ error: 'send_failed' }, 502, cors);
      }
    }

    return json({ error: 'not_found' }, 404, cors);
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
