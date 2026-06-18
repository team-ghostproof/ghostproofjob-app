/**
 * index.js — GhostProofJob Cloudflare Worker
 *
 * Routing rules (in order):
 *   1. POST /contact            -> Resend email submission (unchanged).
 *   2. Aggregator isolation     -> when env.DISABLE_AGGREGATORS === "true",
 *                                  intercept ONLY jooble.org / adzuna.com (and
 *                                  their scraper variants). Return clean [] with
 *                                  hard no-store headers to smash edge caches.
 *   3. Everything else          -> pass straight through to Vercel/Firestore.
 *
 * Schema untouched: title, company, location, direct_apply_url, source, region.
 */

const AGGREGATOR_HOSTS = [
  'jooble.org',
  'adzuna.com',
  'api.adzuna.com',
  'www.adzuna.com',
  'jooble.com',
  'www.jooble.org',
];

const NO_STORE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  'Access-Control-Allow-Origin': '*',
};

function isAggregatorTarget(url) {
  // direct host hit
  const host = (url.hostname || '').toLowerCase();
  if (AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
  // wrapped target inside a query param (?url=, ?to=, ?dest=, ?link=, ?resolve=)
  const probe = (url.search || '').toLowerCase();
  if (/jooble\.org|adzuna\.com/.test(probe)) return true;
  // path-encoded references to aggregator scrapers
  const path = (url.pathname || '').toLowerCase();
  if (/jooble|adzuna/.test(path)) return true;
  return false;
}

async function handleContact(request, env) {
  // Preserve existing Resend /contact POST behavior.
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const name = (payload && payload.name) || '';
  const email = (payload && payload.email) || '';
  const message = (payload && payload.message) || '';
  if (!email || !message) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (env.RESEND_API_KEY || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'GhostProofJob <noreply@ghostproofjob.com>',
        to: [env.CONTACT_TO || 'support@ghostproofjob.com'],
        reply_to: email,
        subject: 'GhostProofJob contact — ' + (name || email),
        text: 'From: ' + name + ' <' + email + '>\n\n' + message,
      }),
    });
    const ok = res.ok;
    return new Response(JSON.stringify({ ok: ok }), {
      status: ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'send_failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 1. Contact email submission — unchanged.
    if (request.method === 'POST' && url.pathname === '/contact') {
      return handleContact(request, env);
    }

    // 2. Aggregator isolation — only when explicitly enabled, and only for
    //    aggregator targets. Returns a clean empty list with no-store headers.
    if (env.DISABLE_AGGREGATORS === 'true' && isAggregatorTarget(url)) {
      return new Response('[]', { status: 200, headers: NO_STORE_HEADERS });
    }

    // 3. Clean passthrough for all in-app data pathways (Vercel/Firestore/etc).
    return fetch(request);
  },
};
