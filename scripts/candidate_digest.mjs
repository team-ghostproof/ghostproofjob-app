// scripts/candidate_digest.mjs — P1-3 WEEKLY CANDIDATE DIGEST (matches-first).
//
// Makes the "New Job Matches" notification toggle actually SEND. Reads the pre-built
// D1 job pool + opted-in candidate profiles, scores every pool job against each résumé
// with the SHARED scorer (api/match/scoreCore — the exact card engine, so the email
// matches what the app shows), and emails each candidate their top NEW matches.
//
// HONOURS CONSENT + PREFS:
//   • skips unless preferences.newJobMatches !== false (the toggle),
//   • skips emailOptOut === true (the one-click unsubscribe),
//   • never emails without a real address.
//
// [FREE-TIER]: one pool read (a handful of aggregate docs) shared across all candidates
// + one bounded profiles read; Resend free tier is 100/day, guarded by SEND_CAP. Weekly.
//
// GO-LIVE GATE (default = DRY-RUN): does ALL the real work but sends ONLY a preview to
// the founder (DIGEST_TEST_EMAIL), never a real candidate. Set DIGEST_LIVE=1 to send real
// candidate emails. Safe no-op without FIREBASE_SERVICE_ACCOUNT; logs without RESEND_API_KEY.
//
// Self-test (offline, no creds/network): `node scripts/candidate_digest.mjs --fixture`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scoreMatch } = require('../api/match/scoreCore.js');

const MATCH_FLOOR = 55;   // same threshold the deck uses
const TOP_N = 5;          // matches per digest

export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function emailOf(profile) {
  const r = (profile && profile.resume) || {};
  const raw = String(r.contact || (profile && profile.email) || '');
  const m = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}
export function firstName(profile) {
  const a = (profile && profile.account) || {};
  return String(a.first || (profile && profile.resume && profile.resume.name) || '').split(/\s+/)[0] || 'there';
}
/** Consent + eligibility gate — returns true only if this candidate should get a digest. */
export function eligible(profile) {
  if (!profile) return false;
  const prefs = profile.preferences || {};
  if (prefs.newJobMatches === false) return false;   // toggle OFF
  if (profile.emailOptOut === true) return false;     // global unsubscribe
  const r = profile.resume || {};
  if (!r.title && !r.skills) return false;            // nothing to match on
  if (!emailOf(profile)) return false;                // no address
  return true;
}
/** Top matches for a candidate against the pool, using the shared card scorer. */
export function topMatches(profile, pool) {
  const r = (profile && profile.resume) || {};
  /* shape for the SHARED scorer: candidate uses .roles ([{t,b}]) + .skills + .title + .summary;
     job uses .title + .desc; scoreMatch returns { score, matched, missing }. */
  const cand = { title: r.title || '', skills: r.skills || '', roles: Array.isArray(r.jobs) ? r.jobs : [], summary: r.summary || '' };
  const scored = [];
  for (const j of (pool || [])) {
    let s = 0;
    try { const res = scoreMatch(cand, { title: j.title || j.t || '', desc: j.description || j.desc || '' }); s = (res && typeof res.score === 'number') ? res.score : 0; } catch (e) { s = 0; }
    if (s >= MATCH_FLOOR) scored.push({ job: j, score: Math.round(s) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_N);
}
export function digestHtml(name, matches) {
  const rows = (matches || []).map((m) => {
    const salv = m.job.salary_min || m.job.salary_max;
    const sal = salv ? `<span style="color:#00C880;">$${Math.round(salv / 1000)}k+</span> · ` : '';
    const loc = m.job.location || (m.job.is_remote ? 'Remote' : '');
    return `<tr><td style="padding:12px 14px;border:1px solid #eee;border-radius:12px;">`
      + `<div style="font-weight:700;font-size:15px;color:#120F1D;">${esc(m.job.title || m.job.t || 'Role')}</div>`
      + `<div style="font-size:12px;color:#666;margin:2px 0 6px;">${esc(m.job.company || m.job.co || '')}${loc ? ' · ' + esc(loc) : ''}</div>`
      + `<div style="font-size:12px;">${sal}<b style="color:#0B8A5E;">${m.score}% match</b></div></td></tr><tr><td style="height:8px;"></td></tr>`;
  }).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#120F1D;">`
    + `<p style="font-size:15px;">Hi ${esc(name)},</p>`
    + `<p style="font-size:14px;line-height:1.6;">Here are your top new job matches this week — scored against your résumé the same way the app does:</p>`
    + `<table style="width:100%;border-collapse:separate;">${rows}</table>`
    + `<p style="text-align:center;margin:18px 0;"><a href="https://ghostproofjob.com/#swipe" style="background:#00C880;color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:10px;display:inline-block;">Open your deck →</a></p>`
    + `<p style="font-size:11px;color:#999;line-height:1.6;">You get this because "New Job Matches" is on in your GhostProofJob settings. Turn it off anytime in Settings → Notifications. We never sell your data or show ads.</p>`
    + `<p style="font-size:12px;color:#666;">— GhostProofJob</p></div>`;
}

/* ---- Firestore + Resend I/O (only used in the live run) ---- */
async function readPoolBase(db, base) {
  const s0 = await db.collection('job_pools').doc(base + '-0').get();
  if (!s0.exists) return [];
  const d0 = s0.data() || {};
  if (!Array.isArray(d0.jobs) || !d0.jobs.length) return [];
  let rows = d0.jobs.slice();
  const of = Math.min(parseInt(d0.of, 10) || 1, 16);
  for (let i = 1; i < of; i++) {
    try { const s = await db.collection('job_pools').doc(base + '-' + i).get(); const d = s.exists ? (s.data() || {}) : {}; if (Array.isArray(d.jobs)) rows = rows.concat(d.jobs); } catch (e) {}
  }
  return rows;
}
async function sendEmail(key, to, subject, html) {
  if (!key) { console.log('[cand-digest] (no RESEND_API_KEY) would send to', to, '·', subject); return true; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'GhostProofJob <no-reply@ghostproofjob.com>', to: [to], subject, html }),
  });
  if (!res.ok) console.log('[cand-digest] resend', res.status, await res.text());
  return res.ok;
}

async function main() {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  const key = process.env.RESEND_API_KEY;
  const LIVE = process.env.DIGEST_LIVE === '1';
  const TEST_EMAIL = process.env.DIGEST_TEST_EMAIL || 'asosa@ghostproofjob.com';
  const PROFILE_CAP = Number(process.env.DIGEST_PROFILE_CAP || 800);
  const SEND_CAP = Number(process.env.DIGEST_SEND_CAP || 90);
  if (!svc) { console.log('[cand-digest] no FIREBASE_SERVICE_ACCOUNT — skip'); return; }
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  const pool = await readPoolBase(db, 'all');
  console.log('[cand-digest] pool jobs:', pool.length, '· mode:', LIVE ? 'LIVE (real candidates)' : 'DRY-RUN (founder preview only)');
  if (!pool.length) { console.log('[cand-digest] empty pool — nothing to match; exit'); return; }

  const snap = await db.collection('profiles').limit(PROFILE_CAP).get();
  let elig = 0, sent = 0, totalMatches = 0, previewHtml = '', previewTo = '', previewCount = 0;
  for (const doc of snap.docs) {
    const p = doc.data() || {};
    if (!eligible(p)) continue;
    const top = topMatches(p, pool);
    if (!top.length) continue;
    elig++; totalMatches += top.length;
    const html = digestHtml(firstName(p), top);
    const subject = `[GhostProofJob] ${top.length} new job match${top.length > 1 ? 'es' : ''} for you this week`;
    if (LIVE) {
      if (sent >= SEND_CAP) { console.log('[cand-digest] SEND_CAP reached — stopping'); break; }
      if (await sendEmail(key, emailOf(p), subject, html)) sent++;
    } else if (!previewHtml) { previewHtml = html; previewTo = emailOf(p); previewCount = top.length; }
  }
  console.log(`[cand-digest] eligible: ${elig} · matches: ${totalMatches} · sent: ${sent}`);
  if (!LIVE) {
    const summary = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">`
      + `<p style="font-size:14px;"><b>Candidate digest — DRY RUN.</b> No candidate was emailed.</p>`
      + `<ul style="font-size:13px;color:#333;"><li><b>${elig}</b> candidate(s) eligible (toggle on, résumé + email, ≥1 match)</li>`
      + `<li><b>${totalMatches}</b> total matches</li><li>Pool jobs scored: <b>${pool.length}</b></li></ul>`
      + (previewHtml ? `<p style="font-size:13px;">A real sample digest that <b>would</b> have gone to <code>${esc(previewTo)}</code> (${previewCount} match${previewCount > 1 ? 'es' : ''}):</p><hr>${previewHtml}` : `<p style="font-size:13px;color:#999;">No eligible candidate yet.</p>`)
      + `<hr><p style="font-size:12px;color:#666;">To go live: set <code>DIGEST_LIVE=1</code> on the workflow. — GhostProofJob</p></div>`;
    await sendEmail(key, TEST_EMAIL, `[GPJ] Candidate digest DRY RUN — ${elig} eligible, ${totalMatches} matches`, summary);
    console.log('[cand-digest] dry-run preview sent to', TEST_EMAIL);
  }
}

/* ---- offline self-test (no creds, no network) ---- */
function fixture() {
  const pool = [
    { title: 'Senior Lifecycle Marketing Manager', company: 'Talkiatry', location: 'Remote', is_remote: true, salary_min: 120000, description: 'Own lifecycle email campaigns, CRM, analytics, retention, segmentation.' },
    { title: 'Data Entry Clerk', company: 'Acme', location: 'Dallas, TX', description: 'Enter data into spreadsheets. Attention to detail.' },
    { title: 'Growth Marketing Manager', company: 'Northwind', location: 'Remote', is_remote: true, salary_min: 110000, description: 'Growth, lifecycle, retention, email, CRM, campaigns.' },
  ];
  const good = { account: { first: 'Aaliyah' }, email: 'a@x.com', preferences: {}, resume: { title: 'Lifecycle Marketing Manager', skills: 'lifecycle, CRM, email, analytics, campaigns', jobs: [{ t: 'Marketing Manager', b: 'Ran lifecycle email + CRM' }] } };
  const optedOut = Object.assign({}, good, { preferences: { newJobMatches: false } });
  const noEmail = Object.assign({}, good, { email: '', resume: Object.assign({}, good.resume, { contact: 'no email here' }) });
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
  ok(eligible(good) === true, 'a résumé+email+toggle-on candidate is eligible');
  ok(eligible(optedOut) === false, 'newJobMatches:false is skipped');
  ok(eligible(noEmail) === false, 'no email is skipped');
  ok(emailOf(good) === 'a@x.com', 'emailOf extracts the address');
  const tops = topMatches(good, pool);
  ok(tops.length >= 2 && tops.length <= 5, 'matches the two marketing roles, not the data-entry one: ' + tops.length);
  ok(tops.every((t) => /marketing/i.test(t.job.title)), 'only in-field matches surface');
  ok(tops[0].score >= 55, 'top match clears the floor');
  const html = digestHtml('Aaliyah', tops);
  ok(/Aaliyah/.test(html) && /% match/.test(html) && /Turn it off anytime/.test(html), 'digest html renders name + score + unsubscribe line');
  ok(!/undefined/.test(html), 'no undefined leaks into the email');
  console.log(`[cand-digest] self-test: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('[cand-digest] self-test PASSED');
}

const _isDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('candidate_digest.mjs');
if (process.argv.includes('--fixture')) fixture();
else if (_isDirect) main().catch((e) => { console.error('[cand-digest] failed:', e && e.message); process.exit(1); });
