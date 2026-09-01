#!/usr/bin/env node
/* N8 / E3 — LIVE-URL POST-DEPLOY SMOKE.
 *
 * The §4 benchmark + Playwright gate (verify.yml) prove the code in the REPO is good.
 * They cannot catch a DEPLOY that never landed or landed broken — a stale Vercel build,
 * a paste-truncated upload (CLAUDE.md §5), or a CDN serving an old version. This closes
 * that gap: after a push that changes the app, it polls the live URL until it actually
 * serves THIS commit's APP_VERSION with a valid shell — the exact check done by hand
 * after every deploy, now automatic.
 *
 * PASS  = the live site served the expected version + the shell within the window.
 * FAIL  = it never did (stale / failed / broken deploy) → the run goes red.
 *
 * Env (all optional): SMOKE_URL (default the live index.html), SMOKE_MAX_MS (default 10min),
 * SMOKE_INTERVAL_MS (default 20s). Zero secrets, zero cost beyond a public GET.
 */
import { readFileSync } from 'node:fs';

const target = process.env.SMOKE_URL || 'https://ghostproofjob.com/index.html';
const MAX_MS = Number(process.env.SMOKE_MAX_MS || 600000);      // 10 minutes — a slow Vercel build still fits
const INTERVAL_MS = Number(process.env.SMOKE_INTERVAL_MS || 20000);

const verOf = (html) => {
  const m = String(html || '').match(/APP_VERSION\s*=\s*['"]v?([0-9]+)/i);
  return m ? ('v' + m[1]) : null;
};

let expected;
try { expected = verOf(readFileSync('index.html', 'utf8')); }
catch (e) { console.error('FATAL: cannot read local index.html —', e.message); process.exit(2); }
if (!expected) { console.error('FATAL: no APP_VERSION found in local index.html'); process.exit(2); }

console.log(`Post-deploy smoke → expecting ${target} to serve ${expected} (up to ${Math.round(MAX_MS / 1000)}s)`);

const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < MAX_MS) {
  n++;
  try {
    const url = target + (target.includes('?') ? '&' : '?') + 'cb=' + Date.now();
    const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    const html = await res.text();
    const live = verOf(html);
    const shell = /GhostProofJob/.test(html);
    console.log(`#${n} status=${res.status} live=${live || '?'} shell=${shell ? 'ok' : 'MISSING'}`);
    if (res.ok && shell && live === expected) {
      console.log(`SMOKE PASS — live is serving ${expected} with a valid shell (after ${Math.round((Date.now() - t0) / 1000)}s).`);
      process.exit(0);
    }
  } catch (e) {
    console.log(`#${n} fetch error: ${e.message}`);
  }
  if (Date.now() - t0 + INTERVAL_MS < MAX_MS) await new Promise(r => setTimeout(r, INTERVAL_MS));
  else break;
}
console.error(`SMOKE FAIL — after ${Math.round((Date.now() - t0) / 1000)}s the live URL never served ${expected} with a valid shell. Stale or failed deploy?`);
process.exit(1);
