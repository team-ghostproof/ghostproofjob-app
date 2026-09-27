// scripts/recruiter_digest.mjs — WEEKLY EMPLOYER DIGEST (batched, per-toggle opt-in).
//
// The sending half of the v285 recruiter notification panel. ONE weekly email per employer,
// assembled from up to four sections — each gated by its OWN "Also email me" sub-toggle
// (v285), which DEFAULTS OFF, so nothing is emailed for a section the recruiter did not opt into:
//   • Roles & applicants     → preferences.recNewApplicantsEmail === true
//   • Awaiting your response → preferences.recResponsesEmail === true
//   • Upcoming interviews    → preferences.recInterviewsEmail === true
//   • Reviews & disputes     → preferences.recReviewsEmail === true
// Every digest also carries the employer's Anti-Ghosting responsiveness line (reply count,
// the SAME metric the app shows — badge at 5+), because that is the whole point of GPJ.
//
// HONEST: every number is computed from real Firestore data (applicant counts, reach-out
// statuses, ghost reports) — never fabricated. ALSO HONOURS emailOptOut / emailUnsub
// (canonical) + appends the shared CAN-SPAM footer.
//
// [FREE-TIER]: bounded reads — recruiters (≤ CAP), and per recruiter: their jobs (≤200) +
// a server-side count per role + their reach-outs (≤200) + one memoized ghost count + their
// profile prefs. Early on this is a handful of reads. Resend free tier 100/day (SEND_CAP).
//
// GO-LIVE GATE (default = DRY-RUN): does ALL the real work but sends ONLY a preview to the
// founder (DIGEST_TEST_EMAIL), never a real employer. Set DIGEST_LIVE=1 to send for real.
//
// Self-test (offline, no creds/network): `node scripts/recruiter_digest.mjs --fixture`.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withUnsubFooter, isSuppressed } = require('../api/notifications/sendAutomatedEmail.js');

const BADGE_AT = 5;   // Anti-Ghosting Badge threshold (matches renderResponsiveness in the app)

export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function emailOf(rec) {
  const raw = String((rec && (rec.email || rec.contactEmail)) || (rec && rec.profile && rec.profile.email) || '');
  const m = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}
export function companyName(rec) { return String((rec && (rec.company || rec.companyName)) || 'your company'); }

/* ---- per-section email opt-in (the v285 sub-toggles; ALL default OFF) ---- */
export function wantsEmail(prefs, key) { return !!(prefs && prefs[key + 'Email'] === true); }
export function contactable(rec) {
  if (!rec) return false;
  if (rec.emailOptOut === true) return false;
  if (isSuppressed(rec) || isSuppressed({ preferences: rec.preferences })) return false;
  return !!emailOf(rec);
}
export function eligible(rec) {
  if (!contactable(rec)) return false;
  const p = (rec && rec.preferences) || {};
  return wantsEmail(p, 'recNewApplicants') || wantsEmail(p, 'recResponses') || wantsEmail(p, 'recInterviews') || wantsEmail(p, 'recReviews');
}

/* ---- pure section builders (take already-fetched data; no I/O so they unit-test) ---- */
/** roles: [{title, applicants, filled, isValidated}] -> open roles with their applicant counts */
export function rolesSection(roles) {
  const open = (roles || []).filter((r) => r && r.isValidated && !r.filled);
  const rows = open.map((r) => ({ title: String(r.title || 'Role'), applicants: Number(r.applicants || 0) }));
  const total = rows.reduce((a, r) => a + r.applicants, 0);
  return { roles: rows, total, openCount: rows.length };
}
/** reachouts: [{status, candidateName, jobTitle}] -> candidates who responded and need action */
export function responsesSection(reachouts) {
  const need = (reachouts || []).filter((r) => r && ['interested', 'appealed', 'reschedule-requested'].includes(r.status));
  return need.map((r) => ({
    who: String(r.candidateName || 'A candidate'),
    role: String(r.jobTitle || ''),
    status: r.status,
    label: r.status === 'interested' ? 'is interested' : (r.status === 'appealed' ? 'appealed your decline' : 'asked to reschedule'),
  }));
}
/** upcoming confirmed interviews within `days` */
export function interviewsSection(reachouts, now = Date.now(), days = 7) {
  const end = now + days * 86400000;
  return (reachouts || [])
    .filter((r) => r && r.status === 'interested' && typeof r.acceptedTs === 'number' && r.acceptedTs > now && r.acceptedTs < end)
    .map((r) => ({ who: String(r.candidateName || 'A candidate'), role: String(r.jobTitle || ''), when: String(r.acceptedTime || '') }))
    .sort((a, b) => 0);
}
/** reviews: honest count + optional rating (communityGhost %) */
export function reviewsSection(ghostCount, rating) {
  const n = Number(ghostCount || 0);
  if (!n) return null;
  return { reports: n, rating: (rating == null ? null : Number(rating)) };
}
/** the Anti-Ghosting responsiveness line — reply COUNT, the same metric the app shows */
export function responsivenessLine(replyCount) {
  const n = Number(replyCount || 0);
  if (n >= BADGE_AT) return { earned: true, count: n, text: `🛡️ Anti-Ghosting Badge earned — you've replied to ${n} candidates. Responsive employers stand out to hunters.` };
  if (n > 0) return { earned: false, count: n, text: `🛡️ You've replied to ${n} candidate${n === 1 ? '' : 's'}. Reply to ${BADGE_AT - n} more to earn the Anti-Ghosting Badge.` };
  return { earned: false, count: 0, text: `🛡️ Reply to candidates (even a kind decline) to earn the Anti-Ghosting Badge — on GhostProofJob, not ghosting is the whole point.` };
}

/** assemble the sections a recruiter opted into AND that have content. null => nothing to send. */
export function buildDigest(rec, data, now = Date.now()) {
  if (!contactable(rec)) return null;
  const p = (rec && rec.preferences) || {};
  const out = {};
  if (wantsEmail(p, 'recNewApplicants')) { const s = rolesSection(data.roles); if (s.openCount) out.roles = s; }
  if (wantsEmail(p, 'recResponses')) { const s = responsesSection(data.reachouts); if (s.length) out.responses = s; }
  if (wantsEmail(p, 'recInterviews')) { const s = interviewsSection(data.reachouts, now); if (s.length) out.interviews = s; }
  if (wantsEmail(p, 'recReviews')) { const s = reviewsSection(data.ghostCount, data.rating); if (s) out.reviews = s; }
  if (!out.roles && !out.responses && !out.interviews && !out.reviews) return null;
  out.responsiveness = responsivenessLine(data.replyCount);   // always included when we send
  return out;
}
export function subjectFor(sections, company) {
  const parts = [];
  if (sections.roles) parts.push(`${sections.roles.total} applicant${sections.roles.total === 1 ? '' : 's'} across ${sections.roles.openCount} role${sections.roles.openCount === 1 ? '' : 's'}`);
  if (sections.responses) parts.push(`${sections.responses.length} awaiting your reply`);
  if (sections.interviews) parts.push('upcoming interviews');
  if (sections.reviews) parts.push('review activity');
  return `[GhostProofJob] ${esc(company)} — weekly update: ` + (parts.join(' · ') || 'your hiring at a glance');
}

export function digestHtml(company, sections) {
  const blocks = [];
  if (sections.responsiveness) {
    const c = sections.responsiveness.earned ? '#0B8A5E' : '#6E2599';
    blocks.push(`<div style="background:#f4f1fb;border-radius:12px;padding:11px 13px;margin:0 0 14px;font-size:13px;color:${c};">${esc(sections.responsiveness.text)}</div>`);
  }
  if (sections.roles) {
    const rows = sections.roles.roles.map((r) => `<tr><td style="padding:7px 0;border-bottom:1px solid #eee;font-size:13px;color:#120F1D;">${esc(r.title)}</td><td style="padding:7px 0;border-bottom:1px solid #eee;text-align:right;font-size:13px;color:#0B8A5E;font-weight:700;">${r.applicants} applicant${r.applicants === 1 ? '' : 's'}</td></tr>`).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:18px 0 6px;">🧑‍💼 Your open roles</h2><table style="width:100%;border-collapse:collapse;">${rows}</table><p style="text-align:center;margin:12px 0;"><a href="https://ghostproofjob.com/#browse" style="background:#00C880;color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:10px;display:inline-block;">Review applicants →</a></p>`);
  }
  if (sections.responses) {
    const rows = sections.responses.map((r) => `<li style="margin:5px 0;font-size:13px;color:#333;"><b style="color:#120F1D;">${esc(r.who)}</b> ${esc(r.label)}${r.role ? ' <span style="color:#666;">(' + esc(r.role) + ')</span>' : ''}</li>`).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:18px 0 6px;">💬 Awaiting your response</h2><ul style="margin:0 0 6px;padding-left:18px;">${rows}</ul><p style="font-size:12px;color:#666;">A quick reply — even a kind decline — keeps your Anti-Ghosting score healthy.</p>`);
  }
  if (sections.interviews) {
    const rows = sections.interviews.map((r) => `<li style="margin:5px 0;font-size:13px;color:#333;"><b style="color:#120F1D;">${esc(r.who)}</b>${r.role ? ' — ' + esc(r.role) : ''}${r.when ? ' <span style="color:#666;">· ' + esc(r.when) + '</span>' : ''}</li>`).join('');
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:18px 0 6px;">📅 Upcoming interviews</h2><ul style="margin:0 0 6px;padding-left:18px;">${rows}</ul>`);
  }
  if (sections.reviews) {
    const rt = sections.reviews.rating == null ? '' : ` · ghost-risk ${sections.reviews.rating}%`;
    blocks.push(`<h2 style="font-size:15px;color:#120F1D;margin:18px 0 6px;">⭐ Review activity</h2><p style="font-size:13px;color:#333;">${sections.reviews.reports} community report${sections.reviews.reports === 1 ? '' : 's'} for ${esc(company)}${rt}. You can dispute anything inaccurate from your Reviews tab.</p>`);
  }
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#120F1D;">`
    + `<p style="font-size:15px;">Hi ${esc(company)} team,</p>`
    + `<p style="font-size:14px;line-height:1.6;">Here's your weekly hiring snapshot on GhostProofJob:</p>`
    + blocks.join('')
    + `<hr style="border:none;border-top:1px solid #eee;margin:18px 0;">`
    + `<p style="font-size:11px;color:#999;line-height:1.6;">You get this because you turned on "Also email me" for one or more employer alerts in Settings → Notifications. Turn it off anytime. We never sell candidate contact — on any plan.</p>`
    + `<p style="font-size:12px;color:#666;">— GhostProofJob</p></div>`;
}

/* ---- Firestore + Resend I/O (live run only) ---- */
async function sendEmail(key, to, subject, html) {
  if (!key) { console.log('[rec-digest] (no RESEND_API_KEY) would send to', to, '·', subject); return true; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'GhostProofJob <no-reply@ghostproofjob.com>', to: [to], subject, html }),
  });
  if (!res.ok) console.log('[rec-digest] resend', res.status, await res.text());
  return res.ok;
}
async function gatherRecruiter(db, rec) {
  const uid = rec.uid || rec.id;
  const data = { roles: [], reachouts: [], replyCount: 0, ghostCount: 0, rating: null };
  try {
    const jsnap = await db.collection('jobs').where('ownerUid', '==', uid).limit(200).get();
    for (const d of jsnap.docs) {
      const j = d.data() || {};
      let applicants = 0;
      try { const c = await d.ref.collection('applications').count().get(); applicants = c.data().count || 0; } catch (e) {}
      data.roles.push({ title: j.title, filled: !!j.filled, isValidated: j.isValidated === true, applicants });
    }
  } catch (e) {}
  try {
    const rsnap = await db.collection('reachouts').where('fromRecruiterUid', '==', uid).limit(200).get();
    rsnap.forEach((d) => data.reachouts.push(d.data() || {}));
    data.replyCount = data.reachouts.length;
  } catch (e) {}
  try {
    if (rec.company) {
      const g = await db.collection('ghost_reports').where('companyKey', '==', String(rec.company).toLowerCase().replace(/\s+/g, ' ').trim()).limit(200).get();
      const pairs = new Set(); g.forEach((d) => { const v = d.data() || {}; if (v.reporterUid) pairs.add(v.reporterUid + '|' + (v.jobKey || '')); });
      data.ghostCount = pairs.size;
    }
  } catch (e) {}
  return data;
}

async function main() {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  const key = process.env.RESEND_API_KEY;
  const LIVE = process.env.DIGEST_LIVE === '1';
  const TEST_EMAIL = process.env.DIGEST_TEST_EMAIL || 'asosa@ghostproofjob.com';
  const REC_CAP = Number(process.env.DIGEST_RECRUITER_CAP || 200);
  const SEND_CAP = Number(process.env.DIGEST_SEND_CAP || 90);
  if (!svc) { console.log('[rec-digest] no FIREBASE_SERVICE_ACCOUNT — skip'); return; }
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  const db = admin.firestore();

  let recs = [];
  try { const s = await db.collection('recruiters').where('isValidated', '==', true).limit(REC_CAP).get(); s.forEach((d) => recs.push(Object.assign({ uid: d.id }, d.data() || {}))); } catch (e) {}
  console.log('[rec-digest] validated employers:', recs.length, '· mode:', LIVE ? 'LIVE (real employers)' : 'DRY-RUN (founder preview only)');

  const now = Date.now();
  let elig = 0, sent = 0, previewHtml = '', previewTo = '', previewSubj = '';
  for (const rec of recs) {
    // recruiter notification prefs live on profiles/{uid} (where v285 setNotifPref saves them)
    try { const ps = await db.collection('profiles').doc(rec.uid).get(); const pd = ps.exists ? (ps.data() || {}) : {}; rec.preferences = pd.preferences || rec.preferences || {}; if (!rec.email && pd.email) rec.email = pd.email; if (pd.emailUnsub === true) rec.emailUnsub = true; } catch (e) {}
    if (!eligible(rec)) continue;
    const data = await gatherRecruiter(db, rec);
    // rating (communityGhost %) — optional; left null server-side (no cheap source), count is enough
    const sections = buildDigest(rec, data, now);
    if (!sections) continue;
    elig++;
    const company = companyName(rec);
    const html = withUnsubFooter(digestHtml(company, sections), { uid: rec.uid, email: emailOf(rec) });
    const subject = subjectFor(sections, company);
    if (LIVE) {
      if (sent >= SEND_CAP) { console.log('[rec-digest] SEND_CAP reached — stopping'); break; }
      if (await sendEmail(key, emailOf(rec), subject, html)) sent++;
    } else if (!previewHtml) { previewHtml = html; previewTo = emailOf(rec); previewSubj = subject; }
  }
  console.log(`[rec-digest] eligible: ${elig} · sent: ${sent}`);
  if (!LIVE) {
    const s = sampleSections();
    const summary = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">`
      + `<p style="font-size:14px;"><b>Employer digest — DRY RUN.</b> No employer was emailed.</p>`
      + `<ul style="font-size:13px;color:#333;"><li><b>${elig}</b> employer(s) eligible (opted into ≥1 email section, address, not unsubscribed, ≥1 section with content)</li></ul>`
      + (previewHtml
          ? `<p style="font-size:13px;">A <b>real</b> sample that <b>would</b> have gone to <code>${esc(previewTo)}</code> — subject: <code>${esc(previewSubj)}</code>:</p><hr>${previewHtml}`
          : `<p style="font-size:13px;color:#999;">No <b>real</b> employer is eligible yet — the opt-in gate working (nobody has turned on an "Also email me" sub-toggle). Below is a <b>SAMPLE</b> so you can see the format.</p>`)
      + `<hr><p style="font-size:13px;margin:14px 0 4px;"><b>SAMPLE — representative data</b> (not a real employer):</p>`
      + `<p style="font-size:12px;color:#666;">Subject: <code>${esc(subjectFor(s, 'Brightline Logistics'))}</code></p>`
      + withUnsubFooter(digestHtml('Brightline Logistics', s), { uid: 'sample', email: 'sample@employer.com' })
      + `<hr><p style="font-size:12px;color:#666;">To go live: set <code>DIGEST_LIVE=1</code> on the workflow. — GhostProofJob</p></div>`;
    await sendEmail(key, TEST_EMAIL, `[GPJ] Employer digest DRY RUN — ${elig} eligible`, summary);
    console.log('[rec-digest] dry-run preview sent to', TEST_EMAIL);
  }
}

/** representative, fully-populated digest so the dry-run always shows the format */
export function sampleSections() {
  return {
    responsiveness: responsivenessLine(6),
    roles: rolesSection([
      { title: 'Operations Coordinator', isValidated: true, filled: false, applicants: 12 },
      { title: 'Logistics Analyst', isValidated: true, filled: false, applicants: 5 },
    ]),
    responses: responsesSection([
      { status: 'interested', candidateName: 'Jordan P.', jobTitle: 'Operations Coordinator' },
      { status: 'reschedule-requested', candidateName: 'Sam R.', jobTitle: 'Logistics Analyst' },
    ]),
    interviews: interviewsSection([
      { status: 'interested', candidateName: 'Jordan P.', jobTitle: 'Operations Coordinator', acceptedTs: Date.now() + 2 * 86400000, acceptedTime: 'Tue 10:00am' },
    ], Date.now()),
    reviews: reviewsSection(3, 38),
  };
}

/* ---- offline self-test (no creds, no network) ---- */
function fixture() {
  const now = Date.now(), DAY = 86400000;
  const roles = [
    { title: 'Ops Coordinator', isValidated: true, filled: false, applicants: 8 },
    { title: 'Old Role', isValidated: true, filled: true, applicants: 3 },     // filled -> excluded
    { title: 'Draft Role', isValidated: false, filled: false, applicants: 1 }, // unvalidated -> excluded
  ];
  const reachouts = [
    { status: 'interested', candidateName: 'A', jobTitle: 'Ops Coordinator', acceptedTs: now + 2 * DAY, acceptedTime: 'Tue' },
    { status: 'reschedule-requested', candidateName: 'B', jobTitle: 'Ops Coordinator' },
    { status: 'sent', candidateName: 'C' },                                   // no response yet -> not "awaiting"
    { status: 'interested', candidateName: 'D', acceptedTs: now + 30 * DAY }, // interview too far out
  ];
  const prefs = { recNewApplicantsEmail: true, recResponsesEmail: true, recInterviewsEmail: true, recReviewsEmail: true };
  const rec = { uid: 'r1', company: 'Brightline Logistics', email: 'hr@brightline.com', preferences: prefs };
  const data = { roles, reachouts, replyCount: 6, ghostCount: 3, rating: 38 };

  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

  ok(wantsEmail(prefs, 'recNewApplicants') === true && wantsEmail({}, 'recNewApplicants') === false, 'email opt-in is strict (only *Email===true)');
  ok(eligible(rec) === true, 'opted-in employer with address is eligible');
  ok(eligible({ ...rec, preferences: {} }) === false, 'no email opt-in => not eligible (in-app toggles never email)');
  ok(eligible({ ...rec, preferences: { recNewApplicants: true } }) === false, 'the in-app toggle does NOT authorise email');
  ok(eligible({ ...rec, emailUnsub: true }) === false, 'canonical unsubscribe beats every opt-in');
  ok(eligible({ ...rec, email: '' }) === false, 'no address => not eligible');

  const rs = rolesSection(roles);
  ok(rs.openCount === 1 && rs.total === 8, 'rolesSection: only open+validated roles, summed applicants');
  const resp = responsesSection(reachouts);
  ok(resp.length === 3 && !resp.some((r) => r.who === 'C'), 'responsesSection: only candidates who responded (interested/appealed/reschedule), not "sent"');
  const iv = interviewsSection(reachouts, now);
  ok(iv.length === 1 && iv[0].who === 'A', 'interviewsSection: only confirmed interviews within 7 days');
  ok(reviewsSection(0) === null && reviewsSection(3, 38).reports === 3, 'reviewsSection: null when no reports; count when present');
  ok(responsivenessLine(6).earned === true && responsivenessLine(2).earned === false && responsivenessLine(0).count === 0, 'responsivenessLine: badge at 5+, honest counts');

  const d = buildDigest(rec, data, now);
  ok(d && d.roles && d.responses && d.interviews && d.reviews && d.responsiveness, 'buildDigest: all opted sections + responsiveness');
  ok(buildDigest({ ...rec, preferences: {} }, data, now) === null, 'buildDigest: no opt-in => nothing to send');
  const only = buildDigest({ ...rec, preferences: { recReviewsEmail: true } }, data, now);
  ok(only && only.reviews && !only.roles && !only.responses, 'buildDigest: only the opted section is built');

  const html = digestHtml('Brightline Logistics', d);
  ok(/Brightline Logistics/.test(html) && /Ops Coordinator/.test(html) && /Anti-Ghosting/.test(html), 'html renders company + roles + responsiveness');
  ok(/never sell candidate contact/.test(html) && /Turn it off anytime/.test(html), 'html keeps the honest no-sell + off lines');
  ok(!/undefined/.test(html), 'no undefined leaks into the email');
  const subj = subjectFor(d, 'Brightline Logistics');
  ok(/applicant/.test(subj) && /awaiting/.test(subj), 'subject summarises the sections');
  ok(/Ops Coordinator|Operations Coordinator/.test(digestHtml('X', sampleSections())), 'sampleSections renders a full digest');

  console.log(`[rec-digest] self-test: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log('[rec-digest] self-test PASSED');
}

const _isDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('recruiter_digest.mjs');
if (process.argv.includes('--fixture')) fixture();
else if (_isDirect) main().catch((e) => { console.error('[rec-digest] failed:', e && e.message); process.exit(1); });
