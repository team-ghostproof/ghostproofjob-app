'use strict';
/**
 * api/interview-email.js — interview-confirmed email to BOTH parties (v151).
 *
 * Fires when a candidate ACCEPTS a proposed interview (time + modality) — the same
 * moment the two sides exchange contact in-app (see index.html _confirmAcceptInterview).
 * Emails the candidate AND the recruiter the confirmed logistics + each other's
 * contact, so the interview can actually happen off-platform.
 *
 * SAFETY (why emailing the recruiter — a second party — is legitimate here):
 *  - Verifies the caller's Firebase ID token, and reads the reachout doc server-side.
 *  - Only sends when the token uid === the reachout's toCandidateUid AND the status
 *    is a real accepted interview. So a caller can only trigger the confirmation for
 *    an interview THEY accepted — never spray arbitrary addresses.
 *  - The recruiter address comes from the reachout doc the recruiter themselves
 *    wrote (recruiterContact.email), not from caller input.
 *  - Send-once per reachout (interview_emails/{reachoutId}) so a double-confirm or a
 *    retry can't inbox-flood either party.
 *  - Honors the global suppression flag; every send carries the unsubscribe footer.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY (both already on Vercel).
 */

const CONTACT = 'GhostProofJob · Houston, TX · (281) 915-9482 · support@ghostproofjob.com';
const SITE = process.env.SITE_URL || 'https://ghostproofjob.com';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Human line for the chosen interview modality + its detail (mirrors the in-app copy). */
function modalityLine(modality, details) {
  details = details || {};
  if (modality === 'inperson') return '🏢 In person — ' + (details.address ? esc(details.address) : 'address to be confirmed');
  if (modality === 'virtual') return '💻 Virtual — ' + (details.link ? ('<a href="' + esc(details.link) + '" style="color:#6b3fa0">' + esc(details.link) + '</a>') : 'meeting link to be confirmed');
  if (modality === 'phone') {
    const who = details.whoCalls === 'candidate' ? 'you call them' : 'they call you';
    return '📞 Phone — ' + (details.phone ? esc(details.phone) : 'number to be confirmed') + ' (' + who + ')';
  }
  return '';
}

/** Pure, testable: build the interview-confirmed email for one party.
 *  @param party 'candidate' | 'recruiter'
 *  @param other the OTHER party's contact { name, email, phone } (revealed on accept) */
function buildInterviewEmail({ party, company, jobTitle, acceptedTime, modality, details, other, unsubUrl }) {
  const co = company ? esc(company) : 'the employer';
  const role = jobTitle ? esc(jobTitle) : 'the role';
  const oc = other || {};
  const forCandidate = party !== 'recruiter';
  const heading = forCandidate
    ? ('Your interview with ' + co + ' is confirmed')
    : ((esc(oc.name || 'A candidate')) + ' confirmed your interview for ' + role);
  const contactWho = forCandidate ? ('Your contact at ' + co) : 'Candidate contact';
  const contactBlock =
    '<div style="background:#f4f1fb;border-radius:10px;padding:12px 14px;margin:14px 0">' +
    '<div style="font-weight:700;color:#1b1526;margin-bottom:4px">' + contactWho + '</div>' +   /* already escaped */
    (oc.name ? '<div>' + esc(oc.name) + '</div>' : '') +
    (oc.email ? '<div><a href="mailto:' + esc(oc.email) + '" style="color:#6b3fa0">' + esc(oc.email) + '</a></div>' : '') +
    (oc.phone ? '<div><a href="tel:' + esc(oc.phone) + '" style="color:#6b3fa0">' + esc(oc.phone) + '</a></div>' : '') +
    (!oc.email && !oc.phone ? '<div style="color:#8a85a0">Contact will appear in the app.</div>' : '') +
    '</div>';   /* contactWho already contains escaped `co`; inserted below without re-escaping */
  const ml = modalityLine(modality, details);
  const html =
    '<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1b1526;max-width:560px">' +
    '<p style="font-size:18px;font-weight:800;margin:0 0 8px">📅 ' + heading + '</p>' +   /* heading already escaped */
    '<p style="margin:0 0 12px">' + (forCandidate ? ('Role: <b>' + role + '</b>') : ('At <b>' + co + '</b>')) + '</p>' +
    '<div style="border:1px solid #e5e0ee;border-radius:10px;padding:12px 14px">' +
    (acceptedTime ? '<div style="font-weight:700">🕒 ' + esc(acceptedTime) + '</div>' : '') +
    (ml ? '<div style="margin-top:6px">' + ml + '</div>' : '') +
    '</div>' +
    contactBlock +
    '<p style="margin:12px 0 0">' + (forCandidate
      ? 'Reach out to confirm any details, and good luck. 💪'
      : 'They shared their contact by accepting — you can reach them directly to finalize.') + '</p>' +
    '<hr style="border:none;border-top:1px solid #e5e0ee;margin:24px 0 12px"/>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0 0 6px">' + esc(CONTACT) + '</p>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0">You’re getting this because you confirmed an interview through GhostProofJob. ' +
    '<a href="' + esc(unsubUrl || (SITE + '/api/unsubscribe')) + '" style="color:#8a85a0">Unsubscribe</a> anytime.</p>' +
    '</div>';
  // subject is plain text — use RAW values (escaped entities would show literally)
  const coRaw = company || 'the employer';
  const roleRaw = jobTitle || 'the role';
  const subject = forCandidate
    ? ('Interview confirmed — ' + coRaw + (acceptedTime ? (' · ' + acceptedTime) : ''))
    : ((oc.name ? (oc.name + ' ') : 'A candidate ') + 'confirmed — ' + roleRaw + (acceptedTime ? (' · ' + acceptedTime) : ''));
  return { subject, html };
}

async function sendResend(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'GhostProofJob <support@ghostproofjob.com>', reply_to: 'support@ghostproofjob.com', to: [to], subject, html }),
  });
  return r.ok;
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
    const candidateEmail = decoded.email;

    const ro = (await db.collection('reachouts').doc(String(reachoutId)).get()).data();
    if (!ro) { res.status(404).json({ ok: false, reason: 'no-reachout' }); return; }
    // authorization: only the candidate ON this reachout, and only a real accepted interview
    if (ro.toCandidateUid !== uid) { res.status(403).json({ ok: false, reason: 'not-your-interview' }); return; }
    if (ro.status !== 'interested' || !(ro.acceptedTime || ro.chosenModality)) {
      res.status(200).json({ ok: false, reason: 'not-accepted' }); return;
    }

    // send-once per reachout (a re-confirm / retry must not double-send)
    const stampRef = db.collection('interview_emails').doc(String(reachoutId));
    if ((await stampRef.get()).exists) { res.status(200).json({ ok: false, reason: 'already-sent' }); return; }

    const key = process.env.RESEND_API_KEY;
    if (!key) { res.status(200).json({ ok: false, reason: 'no-mailer' }); return; }

    const company = ro.company || '';
    const jobTitle = ro.jobTitle || '';
    const acceptedTime = ro.acceptedTime || '';
    const modality = ro.chosenModality || '';
    const details = ro.interviewDetails || {};
    const candidateContact = ro.candidateContact || {};
    const recruiterContact = ro.recruiterContact || {};

    let sentAny = false;

    // → candidate (their own token email; honor their suppression)
    if (candidateEmail) {
      const prof = (await db.collection('profiles').doc(uid).get()).data() || {};
      const supp = (await db.collection('email_suppress').doc(uid).get()).exists;
      const suppressed = supp || prof.emailUnsub === true || (prof.preferences && prof.preferences.emailUnsub === true);
      if (!suppressed) {
        const { subject, html } = buildInterviewEmail({ party: 'candidate', company, jobTitle, acceptedTime, modality, details, other: recruiterContact, unsubUrl: SITE + '/api/unsubscribe?u=' + encodeURIComponent(uid) });
        if (await sendResend(key, candidateEmail, subject, html)) sentAny = true;
      }
    }

    // → recruiter (address from the reachout doc the recruiter wrote; honor suppression by email)
    if (recruiterContact.email) {
      const rEmail = String(recruiterContact.email);
      const rsupp = (await db.collection('email_suppress').doc(rEmail).get()).exists;
      if (!rsupp) {
        const { subject, html } = buildInterviewEmail({ party: 'recruiter', company, jobTitle, acceptedTime, modality, details, other: candidateContact, unsubUrl: SITE + '/api/unsubscribe?u=' + encodeURIComponent(rEmail) });
        if (await sendResend(key, rEmail, subject, html)) sentAny = true;
      }
    }

    try { await stampRef.set({ ts: Date.now(), reachoutId: String(reachoutId) }); } catch (e) {}
    res.status(200).json({ ok: sentAny });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
}

module.exports = handler;
module.exports.buildInterviewEmail = buildInterviewEmail;
module.exports.modalityLine = modalityLine;
