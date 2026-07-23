'use strict';
/**
 * api/reachout-email.js — "an employer reached out" email to a candidate (v151).
 *
 * Fires when a verified recruiter sends a reach-out (index.html _sendReachOutModal).
 * Tells the candidate an employer is interested and to open the app to respond —
 * it does NOT reveal anything the app wouldn't (the candidate stays anonymous to the
 * recruiter until they accept; the company name is already non-secret).
 *
 * SAFETY:
 *  - Verifies the caller's Firebase ID token, reads the reachout doc server-side, and
 *    only sends when the token uid === the reachout's fromRecruiterUid. A recruiter can
 *    only notify a candidate they actually reached out to — never an arbitrary address.
 *  - The candidate's email is read server-side (admin SDK) purely to send; it is never
 *    returned to the recruiter. The candidate opted in (discoverable) = consent to be
 *    contacted, which is what allowed the reach-out in the first place.
 *  - Send-once per reachout; honors global suppression; carries the unsubscribe footer.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY (both already on Vercel).
 */

const CONTACT = 'GhostProofJob · Houston, TX · (281) 915-9482 · support@ghostproofjob.com';
const SITE = process.env.SITE_URL || 'https://ghostproofjob.com';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Pure, testable: the candidate-facing "an employer reached out" email.
 *  Deliberately anonymous-safe — reveals only the company + role, never contact. */
function buildReachoutEmail({ company, jobTitle, hasSlots, unsubUrl }) {
  const co = company ? esc(company) : 'An employer';
  const role = jobTitle ? esc(jobTitle) : 'a role';
  const cta = SITE.replace(/\/$/, '') + '/#reachouts';
  const html =
    '<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1b1526;max-width:560px">' +
    '<p style="font-size:18px;font-weight:800;margin:0 0 8px">💬 ' + co + ' reached out to you</p>' +
    '<p style="margin:0 0 12px">They’re interested in you for <b>' + role + '</b>' +
    (hasSlots ? ' and proposed interview times.' : '.') + '</p>' +
    '<p style="margin:0 0 16px">Open GhostProofJob to see the message and respond' +
    (hasSlots ? ' — pick a time that works, and your contact is shared only when you accept.' : '.') + '</p>' +
    '<p style="margin:0 0 20px"><a href="' + esc(cta) + '" style="background:#00c07f;color:#08210f;font-weight:800;text-decoration:none;border-radius:10px;padding:11px 18px;display:inline-block">View the message →</a></p>' +
    '<p style="font-size:13px;color:#5a5570;margin:0">You stay anonymous until you choose to respond. No employer can see your profile as contactable unless you opted in.</p>' +
    '<hr style="border:none;border-top:1px solid #e5e0ee;margin:24px 0 12px"/>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0 0 6px">' + esc(CONTACT) + '</p>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0">You’re getting this because an employer reached out through GhostProofJob. ' +
    '<a href="' + esc(unsubUrl || (SITE + '/api/unsubscribe')) + '" style="color:#8a85a0">Unsubscribe</a> anytime.</p>' +
    '</div>';
  // subject is plain text — RAW values (escaped entities would show literally)
  const subject = (company || 'An employer') + ' reached out about ' + (jobTitle || 'a role');
  return { subject, html };
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    const admin = require('firebase-admin');
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) { res.status(500).json({ error: 'config', detail: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel env' }); return; }
    let creds;
    try { creds = JSON.parse(svc); }
    catch (e) { res.status(500).json({ error: 'config', detail: 'FIREBASE_SERVICE_ACCOUNT is not valid JSON' }); return; }
    try { if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(creds) }); }
    catch (e) { res.status(500).json({ error: 'config', detail: 'firebase-admin rejected the service account: ' + (e && e.message || e) }); return; }
    const db = admin.firestore();

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { idToken, reachoutId } = body;
    if (!idToken) { res.status(401).json({ error: 'no token' }); return; }
    if (!reachoutId) { res.status(400).json({ error: 'no reachout' }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(String(idToken)); }
    catch (e) { res.status(401).json({ error: 'bad token' }); return; }
    const uid = decoded.uid;

    const ro = (await db.collection('reachouts').doc(String(reachoutId)).get()).data();
    if (!ro) { res.status(404).json({ ok: false, reason: 'no-reachout' }); return; }
    // authorization: only the SENDING recruiter, and only a genuine reach-out (not a rejection)
    if (ro.fromRecruiterUid !== uid) { res.status(403).json({ ok: false, reason: 'not-your-reachout' }); return; }
    if (ro.kind !== 'reachout') { res.status(200).json({ ok: false, reason: 'not-a-reachout' }); return; }

    // send-once per reachout
    const stampRef = db.collection('reachout_emails').doc(String(reachoutId));
    if ((await stampRef.get()).exists) { res.status(200).json({ ok: false, reason: 'already-sent' }); return; }

    // resolve the candidate's email server-side (never exposed to the recruiter).
    // Firebase Auth is the authoritative source; fall back to profile fields.
    const candProf = (await db.collection('profiles').doc(String(ro.toCandidateUid)).get()).data() || {};
    let candEmail = '';
    try { const u = await admin.auth().getUser(String(ro.toCandidateUid)); candEmail = (u && u.email) || ''; } catch (e) {}
    if (!candEmail) candEmail = candProf.email || (candProf.account && candProf.account.email) || (candProf.resume && candProf.resume.contact) || '';
    if (!candEmail) { res.status(200).json({ ok: false, reason: 'no-candidate-email' }); return; }

    const supp = (await db.collection('email_suppress').doc(String(ro.toCandidateUid)).get()).exists;
    if (supp || candProf.emailUnsub === true || (candProf.preferences && candProf.preferences.emailUnsub === true)) {
      res.status(200).json({ ok: false, reason: 'suppressed' }); return;
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) { res.status(200).json({ ok: false, reason: 'no-mailer' }); return; }

    const { subject, html } = buildReachoutEmail({
      company: ro.company, jobTitle: ro.jobTitle,
      hasSlots: Array.isArray(ro.proposedTimes) && ro.proposedTimes.length > 0,
      unsubUrl: SITE + '/api/unsubscribe?u=' + encodeURIComponent(String(ro.toCandidateUid)),
    });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'GhostProofJob <support@ghostproofjob.com>', reply_to: 'support@ghostproofjob.com', to: [candEmail], subject, html }),
    });
    if (r.ok) {
      try { await stampRef.set({ ts: Date.now(), reachoutId: String(reachoutId) }); } catch (e) {}
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ ok: false, reason: 'send-failed' });
    }
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
}

module.exports = handler;
module.exports.buildReachoutEmail = buildReachoutEmail;
