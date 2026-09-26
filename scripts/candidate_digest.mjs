// scripts/candidate_digest.mjs — WEEKLY CANDIDATE DIGEST (batched, per-toggle opt-in).
//
// ONE weekly email per candidate, assembled from up to three sections — each gated by its
// OWN "Also email me" sub-toggle (v282), which DEFAULTS OFF. Nothing is ever emailed for a
// section the candidate did not explicitly opt into:
//   • New job matches      → preferences.newJobMatchesEmail === true
//   • Ghost-risk heads-up  → preferences.ghostRiskAlertsEmail === true   (only companies they APPLIED to)
//   • Rate-a-company nudge → preferences.companyRatingRemindersEmail === true (companies applied to, not yet rated)
//
// The IN-APP toggles (newJobMatches / ghostRiskAlerts / companyRatingReminders) drive the 🔔 bell
// and are ON by default; they do NOT authorise email. Email is a separate, explicit opt-in — this
// is the whole point of the v282 split, and this sender is the other half of it.
//
// ALSO HONOURS: emailOptOut === true (one-click global unsubscribe) and a real address.
//
// [FREE-TIER]: one pool read (a handful of aggregate docs) + one bounded profiles read + ONE bounded
// ghost_reports read — all SHARED across every candidate. Sections B and C need ZERO extra per-candidate
// reads (applied list + ratings already live on the profile doc). Resend free tier 100/day, guarded by
// SEND_CAP. Runs weekly.
//
// GO-LIVE GATE (default = DRY-RUN): does ALL the real work but sends ONLY a preview to the founder
// (DIGEST_TEST_EMAIL), never a real candidate. Set DIGEST_LIVE=1 to send real candidate emails. Safe
// no-op without FIREBASE_SERVICE_ACCOUNT; logs (no send) without RESEND_API_KEY.
//
// Self-test (offline, no creds/network): `node scripts/candidate_digest.mjs --fixture`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scoreMatch } = require('../api/match/scoreCore.js');
// Reuse the canonical opt-out layer so a digest honors the SAME suppression + unsubscribe link
// as every other GPJ email (CAN-SPAM). isSuppressed reads emailUnsub / preferences.emailUnsub;
// withUnsubFooter appends the real contact + one-click unsubscribe URL the /api/unsubscribe endpoint sets.
const { withUnsubFooter, isSuppressed } = require('../api/notifications/sendAutomatedEmail.js');

const MATCH_FLOOR = 55;   // same threshold the deck uses
const TOP_N = 5;          // matches per digest
const GHOST_MIN = Number(process.env.DIGEST_GHOST_MIN || 3);      // distinct reports before we flag a company
const RATE_MIN_AGE_MS = Number(process.env.DIGEST_RATE_MIN_AGE_DAYS || 2) * 86400000; // give them time to interact first
const RATE_MAX = 6;       // rate-nudge companies per digest
const GHOST_MAX = 6;      // ghost-risk companies per digest
const _PLACEHOLDER_CO = /^(hiring company|company|employer|confidential|private|undisclosed|n\/?a|unknown)$/i;

export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function coKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
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

/* ---- per-section email opt-in (the v282 sub-toggles; ALL default OFF) ---- */
export function wantsEmail(profile, key) {
  const prefs = (profile && profile.preferences) || {};
  return prefs[key + 'Email'] === true;   // opt-in: only true counts; undefined/false = no email
}
/** Global guard shared by every section: has an address AND has not globally unsubscribed.
 *  Honors the canonical opt-out (emailUnsub / preferences.emailUnsub, set by /api/unsubscribe)
 *  as well as the legacy emailOptOut field — a match for the rest of the email system. */
export function contactable(profile) {
  if (!profile) return false;
  if (profile.emailOptOut === true) return false;
  if (isSuppressed(profile)) return false;   // emailUnsub / preferences.emailUnsub (canonical CAN-SPAM gate)
  return !!emailOf(profile);
}
/** Eligible for the digest at all = contactable AND opted into at least one email section. */
export function eligible(profile) {
  if (!contactable(profile)) return false;
  return wantsEmail(profile, 'newJobMatches') || wantsEmail(profile, 'ghostRiskAlerts') || wantsEmail(profile, 'companyRatingReminders');
}

/* ---- SECTION A: top new matches (shared card scorer) ---- */
export function topMatches(profile, pool) {
  const r = (profile && profile.resume) || {};
  if (!r.title && !r.skills) return [];   // nothing to match on
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

/* ---- shared ghost-risk map: companyKey -> distinct report count (built ONCE for all candidates) ---- */
export function riskMapFrom(reportDocs, min = GHOST_MIN) {
  const pairs = new Map();   // companyKey -> Set of reporterUid|jobKey (matches the app's distinct-report count)
  for (const d of (reportDocs || [])) {
    const ck = coKey(d.companyKey || d.company);
    if (!ck) continue;
    if (!pairs.has(ck)) pairs.set(ck, new Set());
    pairs.get(ck).add(String(d.reporterUid || '') + '|' + String(d.jobKey || ''));
  }
  const risk = new Map();
  for (const [ck, set] of pairs) { if (set.size >= min) risk.set(ck, set.size); }
  return risk;
}

/* ---- SECTION B: companies the candidate APPLIED to that the community has now flagged ---- */
export function ghostRiskApplied(profile, riskMap) {
  const applied = (profile && profile.lists && Array.isArray(profile.lists.applied)) ? profile.lists.applied : [];
  const out = [], seen = new Set();
  for (const a of applied) {
    const co = String((a && a.co) || '').trim();
    const ck = coKey(co);
    if (!co || _PLACEHOLDER_CO.test(co) || seen.has(ck)) continue;
    if (riskMap && riskMap.get && riskMap.has(ck)) { out.push({ company: co, title: String((a && a.t) || ''), reports: riskMap.get(ck) }); seen.add(ck); }
    if (out.length >= GHOST_MAX) break;
  }
  return out;
}

/* ---- SECTION C: companies applied to but not yet rated (feeds the community Vibe Score) ---- */
export function rateReminders(profile, now = Date.now()) {
  const applied = (profile && profile.lists && Array.isArray(profile.lists.applied)) ? profile.lists.applied : [];
  const rated = (profile && profile.vibeReviews) || {};
  const ratedKeys = new Set(Object.keys(rated).map(coKey));
  const out = [], seen = new Set();
  for (const a of applied) {
    const co = String((a && a.co) || '').trim();
    const ck = coKey(co);
    if (!co || _PLACEHOLDER_CO.test(co) || seen.has(ck) || ratedKeys.has(ck)) continue;
    const when = Number((a && a.when) || 0);
    if (when && (now - when) < RATE_MIN_AGE_MS) continue;   // too fresh — give them time to interact
    out.push({ company: co, title: String((a && a.t) || '') });
    seen.add(ck);
    if (out.length >= RATE_MAX) break;
  }
  return out;
}

/* ---- one batched email from whichever sections the candidate opted into + has content ---- */
export function digestHtml(name, sections) {
  // Back-compat: an array 2nd arg = matches-only (older callers/tests).
  const s = Array.isArray(sections) ? { matches: sections } : (sections || {});
  const matches = s.matches || [], ghost = s.ghost || [], rate = s.rate || [];
  const blocks = [];

  if (matches.length) {
    const rows = matches.map((m) => {
      const salv = m.job.salary_min || m.job.salary_max;
      const sal = salv ? `<span style="color:#00C880;">$${Math.round(salv / 1000)}k+</span> · ` : '';
      const loc = m.job.location || (m.job.is_remote ? 'Remote' : '');
      return `<tr><td style="padding:12px 14px;border:1px solid #eee;border-radius:12px;">`
        + `<div style="font-weight:700;font-size:15px;color:#120F1D;">${esc(m.job.title || m.job.t || 'Role')}</div>`
        + `<div style="font-size:12px;color:#666;margin:2px 0 6px;">${esc(m.job.company || m.job.co || '')}${loc ? ' · ' + esc(loc) : ''}</div>`
        + `<div style="font-size:12px;">${sal}<b style="color:#0B8A5E;">${m.score}% match</b></div></td></tr><tr><td style="height:8px;"></td></tr>`;
    }).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:20px 0 8px;">🔔 Your top new matches</h2>`
      + `<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 10px;">Scored against your résumé the same way the app does:</p>`
      + `<table style="width:100%;border-collapse:separate;">${rows}</table>`
      + `<p style="text-align:center;margin:14px 0;"><a href="https://ghostproofjob.com/#swipe" style="background:#00C880;color:#fff;text-decoration:none;font-weight:800;padding:11px 20px;border-radius:10px;display:inline-block;">Open your deck →</a></p>`);
  }

  if (ghost.length) {
    const rows = ghost.map((g) => `<li style="margin:6px 0;font-size:13px;color:#333;"><b style="color:#120F1D;">${esc(g.company)}</b>`
      + `${g.title ? ' <span style="color:#666;">(' + esc(g.title) + ')</span>' : ''} — flagged by <b>${g.reports}</b> ${g.reports === 1 ? 'hunter' : 'hunters'} in the community.</li>`).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:22px 0 8px;">👻 Heads-up on a place you applied</h2>`
      + `<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 6px;">${ghost.length === 1 ? 'A company' : 'Companies'} you applied to ${ghost.length === 1 ? 'has' : 'have'} community ghost-report${ghost.length === 1 ? '' : 's'}. This is other hunters' reports, not a verdict — it just means follow up or keep options open.</p>`
      + `<ul style="margin:0 0 6px;padding-left:18px;">${rows}</ul>`);
  }

  if (rate.length) {
    const rows = rate.map((c) => `<li style="margin:6px 0;font-size:13px;color:#333;"><b style="color:#120F1D;">${esc(c.company)}</b>${c.title ? ' <span style="color:#666;">(' + esc(c.title) + ')</span>' : ''}</li>`).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:22px 0 8px;">⭐ Rate a company you applied to</h2>`
      + `<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 6px;">One quick anonymous rating warns — or reassures — the next hunter. No pressure:</p>`
      + `<ul style="margin:0 0 8px;padding-left:18px;">${rows}</ul>`
      + `<p style="text-align:center;margin:12px 0;"><a href="https://ghostproofjob.com/#account" style="background:#B55FE6;color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:10px;display:inline-block;">Rate a company →</a></p>`);
  }

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#120F1D;">`
    + `<p style="font-size:15px;">Hi ${esc(name)},</p>`
    + `<p style="font-size:14px;line-height:1.6;">Here's your weekly GhostProofJob update:</p>`
    + blocks.join('')
    + `<hr style="border:none;border-top:1px solid #eee;margin:18px 0;">`
    + `<p style="font-size:11px;color:#999;line-height:1.6;">You get this because you turned on "Also email me" for one or more alerts in your GhostProofJob settings. Turn it off anytime in Settings → Notifications. We never sell your data or show ads.</p>`
    + `<p style="font-size:12px;color:#666;">— GhostProofJob</p></div>`;
}

/** Assemble the sections a candidate opted into AND that have content. Returns null if nothing to send. */
export function buildDigest(profile, pool, riskMap, now = Date.now()) {
  if (!contactable(profile)) return null;
  const sections = {};
  if (wantsEmail(profile, 'newJobMatches')) { const m = topMatches(profile, pool); if (m.length) sections.matches = m; }
  if (wantsEmail(profile, 'ghostRiskAlerts')) { const g = ghostRiskApplied(profile, riskMap); if (g.length) sections.ghost = g; }
  if (wantsEmail(profile, 'companyRatingReminders')) { const r = rateReminders(profile, now); if (r.length) sections.rate = r; }
  if (!sections.matches && !sections.ghost && !sections.rate) return null;
  return sections;
}
export function subjectFor(sections) {
  const parts = [];
  if (sections.matches) parts.push(`${sections.matches.length} new match${sections.matches.length > 1 ? 'es' : ''}`);
  if (sections.ghost) parts.push('a ghost-risk heads-up');
  if (sections.rate) parts.push('a company to rate');
  return '[GhostProofJob] Your weekly update — ' + (parts.join(' · ') || 'news for you');
}

/** A representative, fully-populated three-section digest so the dry-run can always SHOW what a
 *  candidate would receive — even when 0 real candidates have opted in yet. Clearly labelled SAMPLE. */
export function sampleSections() {
  return {
    matches: [
      { score: 88, job: { title: 'Senior Lifecycle Marketing Manager', company: 'Talkiatry', location: 'Remote', is_remote: true, salary_min: 120000 } },
      { score: 81, job: { title: 'Growth Marketing Manager', company: 'Northwind', location: 'Remote', is_remote: true, salary_min: 110000 } },
    ],
    ghost: [
      { company: 'Vertex Staffing', title: 'Operations Coordinator', reports: 4 },
    ],
    rate: [
      { company: 'Brightline Logistics', title: 'Logistics Analyst' },
    ],
  };
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
async function readRecentGhostReports(db) {
  const CAP = Number(process.env.DIGEST_GHOST_CAP || 3000);
  const out = [];
  try {
    const snap = await db.collection('ghost_reports').orderBy('ts', 'desc').limit(CAP).get();
    snap.forEach((d) => out.push(d.data() || {}));
  } catch (e) {
    // ts may be missing/unindexed on very old docs — fall back to an unordered bounded read
    try { const snap = await db.collection('ghost_reports').limit(CAP).get(); snap.forEach((d) => out.push(d.data() || {})); } catch (e2) {}
  }
  return out;
}
/** One bounded, SHARED read of the canonical suppression list → a Set of opted-out ids (uid AND email).
 *  Catches email-keyed unsubscribes that a profile.emailUnsub mirror would miss. [FREE-TIER]: one query. */
async function readSuppressed(db) {
  const CAP = Number(process.env.DIGEST_SUPPRESS_CAP || 5000);
  const ids = new Set();
  try {
    const snap = await db.collection('email_suppress').where('unsub', '==', true).limit(CAP).get();
    snap.forEach((d) => { const id = String(d.id || '').toLowerCase(); if (id) ids.add(id); });
  } catch (e) { /* collection may not exist yet — the profile.emailUnsub mirror still gates */ }
  return ids;
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
  const riskMap = riskMapFrom(await readRecentGhostReports(db));
  const suppressed = await readSuppressed(db);
  console.log('[cand-digest] pool jobs:', pool.length, '· flagged companies:', riskMap.size, '· suppressed ids:', suppressed.size, '· mode:', LIVE ? 'LIVE (real candidates)' : 'DRY-RUN (founder preview only)');

  const snap = await db.collection('profiles').limit(PROFILE_CAP).get();
  const now = Date.now();
  let elig = 0, sent = 0, secMatches = 0, secGhost = 0, secRate = 0, previewHtml = '', previewTo = '', previewSubj = '';
  for (const doc of snap.docs) {
    const p = doc.data() || {};
    const addr = emailOf(p);
    // canonical suppression by uid OR email (belt-and-braces with contactable's profile-flag check)
    if (suppressed.has(String(doc.id || '').toLowerCase()) || (addr && suppressed.has(addr))) continue;
    const sections = buildDigest(p, pool, riskMap, now);
    if (!sections) continue;
    elig++;
    if (sections.matches) secMatches++;
    if (sections.ghost) secGhost++;
    if (sections.rate) secRate++;
    // every email carries the shared CAN-SPAM footer (real contact + one-click unsubscribe link)
    const html = withUnsubFooter(digestHtml(firstName(p), sections), { uid: doc.id, email: addr });
    const subject = subjectFor(sections);
    if (LIVE) {
      if (sent >= SEND_CAP) { console.log('[cand-digest] SEND_CAP reached — stopping'); break; }
      if (await sendEmail(key, addr, subject, html)) sent++;
    } else if (!previewHtml) { previewHtml = html; previewTo = addr; previewSubj = subject; }
  }
  console.log(`[cand-digest] eligible: ${elig} · matches:${secMatches} ghost:${secGhost} rate:${secRate} · sent: ${sent}`);
  if (!LIVE) {
    const summary = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">`
      + `<p style="font-size:14px;"><b>Candidate digest — DRY RUN.</b> No candidate was emailed.</p>`
      + `<ul style="font-size:13px;color:#333;"><li><b>${elig}</b> candidate(s) eligible (opted into ≥1 email section, address, not unsubscribed, ≥1 section with content)</li>`
      + `<li>matches section: <b>${secMatches}</b> · ghost-risk section: <b>${secGhost}</b> · rate section: <b>${secRate}</b></li>`
      + `<li>Pool jobs scored: <b>${pool.length}</b> · flagged companies: <b>${riskMap.size}</b></li></ul>`
      + (previewHtml
          ? `<p style="font-size:13px;">A <b>real</b> sample digest that <b>would</b> have gone to <code>${esc(previewTo)}</code> — subject: <code>${esc(previewSubj)}</code>:</p><hr>${previewHtml}`
          : `<p style="font-size:13px;color:#999;">No <b>real</b> candidate is eligible yet — that's the opt-in gate working: nobody has turned on an "Also email me" sub-toggle (or an opted-in section has no content). Below is a <b>SAMPLE</b> so you can see exactly what a candidate would receive once they opt in.</p>`)
      + `<hr><p style="font-size:13px;margin:14px 0 4px;"><b>SAMPLE — representative data</b> (not a real candidate). The real send uses each candidate's own résumé, applications and ratings, and includes ONLY the sections they opted into:</p>`
      + `<p style="font-size:12px;color:#666;margin:0 0 6px;">Subject: <code>${esc(subjectFor(sampleSections()))}</code></p>`
      + withUnsubFooter(digestHtml('Alex', sampleSections()), { uid: 'sample', email: 'sample@candidate.com' })
      + `<hr><p style="font-size:12px;color:#666;">To go live: set <code>DIGEST_LIVE=1</code> on the workflow (only after you're happy with this). — GhostProofJob</p></div>`;
    await sendEmail(key, TEST_EMAIL, `[GPJ] Candidate digest DRY RUN — ${elig} eligible`, summary);
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
  const DAY = 86400000, now = Date.now();
  const resume = { title: 'Lifecycle Marketing Manager', skills: 'lifecycle, CRM, email, analytics, campaigns', jobs: [{ t: 'Marketing Manager', b: 'Ran lifecycle email + CRM' }] };
  const applied = [
    { t: 'Ops Lead', co: 'ShadyCo', when: now - 5 * DAY },       // flagged + not rated + old enough
    { t: 'Analyst', co: 'GoodCo', when: now - 5 * DAY },          // not flagged, not rated -> rate nudge
    { t: 'PM', co: 'RatedCo', when: now - 5 * DAY },              // already rated -> no nudge
    { t: 'Clerk', co: 'FreshCo', when: now - 1000 },              // too fresh -> no nudge
    { t: 'Temp', co: 'Hiring Company', when: now - 5 * DAY },     // placeholder -> ignored
  ];
  const base = { account: { first: 'Aaliyah' }, email: 'a@x.com', resume, lists: { applied }, vibeReviews: { RatedCo: [{ stars: 4 }] } };
  const wantsAll = { ...base, preferences: { newJobMatchesEmail: true, ghostRiskAlertsEmail: true, companyRatingRemindersEmail: true } };
  const wantsNone = { ...base, preferences: {} };                                   // in-app defaults on, but NO email opt-in
  const inAppOnly = { ...base, preferences: { newJobMatches: true, ghostRiskAlerts: true } }; // main toggles on, NO email opt-in
  const optedOut = { ...wantsAll, emailOptOut: true };
  const noEmail = { ...wantsAll, email: '', resume: { ...resume, contact: '' } };
  const riskMap = riskMapFrom([
    { companyKey: 'shadyco', reporterUid: 'u1', jobKey: 'ops-lead' },
    { companyKey: 'shadyco', reporterUid: 'u2', jobKey: 'ops-lead' },
    { companyKey: 'shadyco', reporterUid: 'u3', jobKey: 'analyst' },
    { companyKey: 'goodco', reporterUid: 'u1', jobKey: 'x' },      // only 1 -> below GHOST_MIN(3)
  ]);

  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

  // gates
  ok(eligible(wantsAll) === true, 'opted into ≥1 email section + address = eligible');
  ok(eligible(wantsNone) === false, 'NO email opt-in = not eligible (in-app defaults never email)');
  ok(eligible(inAppOnly) === false, 'in-app toggles ON but no email opt-in = NOT eligible (the whole v282 split)');
  ok(eligible(optedOut) === false, 'global emailOptOut is skipped');
  ok(eligible(noEmail) === false, 'no address is skipped');
  ok(wantsEmail(wantsAll, 'newJobMatches') === true && wantsEmail(base, 'newJobMatches') === false, 'email opt-in is strict: only true counts');

  // section A
  const tops = topMatches(wantsAll, pool);
  ok(tops.length >= 2 && tops.every((t) => /marketing/i.test(t.job.title)), 'matches: only in-field roles, not data-entry');
  ok(tops[0].score >= 55, 'matches: top clears the floor');

  // section B
  const gr = ghostRiskApplied(wantsAll, riskMap);
  ok(gr.length === 1 && gr[0].company === 'ShadyCo' && gr[0].reports === 3, 'ghost: flags only the applied company at/over GHOST_MIN');
  ok(!gr.some((g) => /GoodCo/i.test(g.company)), 'ghost: a single report does not flag');
  ok(ghostRiskApplied({ lists: { applied: [{ co: 'ShadyCo', when: now }] } }, riskMap).length === 1, 'ghost: works from applied list alone');

  // section C
  const rr = rateReminders(wantsAll, now);
  ok(rr.some((c) => c.company === 'GoodCo'), 'rate: nudges an applied-but-unrated company');
  ok(!rr.some((c) => c.company === 'RatedCo'), 'rate: never nudges an already-rated company');
  ok(!rr.some((c) => c.company === 'FreshCo'), 'rate: skips a too-fresh application');
  ok(!rr.some((c) => /Hiring Company/i.test(c.company)), 'rate: skips placeholder company names');

  // buildDigest respects per-section opt-in
  const dOnlyRate = buildDigest({ ...base, preferences: { companyRatingRemindersEmail: true } }, pool, riskMap, now);
  ok(dOnlyRate && !dOnlyRate.matches && !dOnlyRate.ghost && dOnlyRate.rate, 'buildDigest: only the opted-in section is included');
  ok(buildDigest(wantsNone, pool, riskMap, now) === null, 'buildDigest: no opt-in => nothing to send');
  const dAll = buildDigest(wantsAll, pool, riskMap, now);
  ok(dAll && dAll.matches && dAll.ghost && dAll.rate, 'buildDigest: all three when opted in and content exists');

  // email html
  const html = digestHtml('Aaliyah', dAll);
  ok(/Aaliyah/.test(html) && /% match/.test(html) && /ShadyCo/.test(html) && /GoodCo/.test(html), 'html renders all three sections');
  ok(/Turn it off anytime/.test(html) && /never sell your data/.test(html), 'html keeps the honest unsubscribe + no-sell lines');
  ok(!/undefined/.test(html), 'no undefined leaks into the email');
  ok(/Also email me/.test(html), 'html explains WHY they got it (the email opt-in)');
  const subj = subjectFor(dAll);
  ok(/new match/.test(subj) && /ghost-risk/.test(subj) && /rate/.test(subj), 'subject summarises the sections');

  // back-compat: array arg still renders matches-only
  ok(/% match/.test(digestHtml('Z', tops)), 'digestHtml back-compat: array arg = matches-only');

  console.log(`[cand-digest] self-test: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('[cand-digest] self-test PASSED');
}

const _isDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('candidate_digest.mjs');
if (process.argv.includes('--fixture')) fixture();
else if (_isDirect) main().catch((e) => { console.error('[cand-digest] failed:', e && e.message); process.exit(1); });
