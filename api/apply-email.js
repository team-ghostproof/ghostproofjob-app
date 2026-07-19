'use strict';
/**
 * api/apply-email.js — post-apply encouragement email (v128, founder-approved).
 *
 * Fires ONLY on a CONFIRMED apply ("Done — I Applied" / internal apply success),
 * never on a raw swipe. Sends market/role tips + follow-up timing + good luck.
 *
 * SAFETY:
 *  - Verifies the caller's Firebase ID token, so a user can only trigger their
 *    OWN email (no spraying arbitrary addresses).
 *  - Honors the GLOBAL suppression flag (email_suppress / profiles.emailUnsub) —
 *    the same gate every other automated email respects.
 *  - Server-side rate cap: max 5 apply-emails per user per rolling 24h (a busy
 *    day of applying doesn't become an inbox flood). The client also caps
 *    1-per-job, but the server is the real limit.
 *  - CAN-SPAM: every send carries the unsubscribe + contact footer.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY (both already on Vercel).
 */

const CONTACT = 'GhostProofJob · Houston, TX · (281) 915-9482 · support@ghostproofjob.com';
const SITE = process.env.SITE_URL || 'https://ghostproofjob.com';
const DAILY_CAP = 5;

/** Pure, testable: build the encouragement email body. No fabricated stats. */
function buildApplyEmail({ firstName, jobTitle, company, market, unsubUrl }) {
  const who = (firstName && String(firstName).trim()) ? (' ' + String(firstName).trim()) : '';
  const role = jobTitle ? String(jobTitle).slice(0, 120) : 'this role';
  const at = company ? (' at ' + String(company).slice(0, 120)) : '';
  const where = market ? (' in ' + String(market).slice(0, 80)) : '';
  const tips = [
    'Give it a week, then send one short, specific follow-up — reference something from the posting.',
    'Keep applying while you wait: momentum beats waiting on any single role.',
    'If they ghost past two weeks, that’s data — flag it on GhostProofJob so the next hunter knows.',
  ];
  const html =
    '<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1b1526;max-width:560px">' +
    '<p>Nice work' + who + ' — you applied for <b>' + esc(role) + '</b>' + esc(at) + esc(where) + '. Here’s how to make it count:</p>' +
    '<ul>' + tips.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
    '<p>You’ve got this. 💪</p>' +
    '<hr style="border:none;border-top:1px solid #e5e0ee;margin:24px 0 12px"/>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0 0 6px">' + esc(CONTACT) + '</p>' +
    '<p style="font-size:12px;color:#8a85a0;margin:0">You’re getting this because you applied through GhostProofJob. ' +
    '<a href="' + esc(unsubUrl || (SITE + '/api/unsubscribe')) + '" style="color:#8a85a0">Unsubscribe</a> anytime.</p>' +
    '</div>';
  const subject = 'You applied for ' + role + at + ' — next steps + good luck 🍀';
  return { subject, html };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    const admin = require('firebase-admin');
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) { res.status(500).json({ error: 'not configured' }); return; }
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
    const db = admin.firestore();

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { idToken, jobTitle, company, market } = body;
    if (!idToken) { res.status(401).json({ error: 'no token' }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(String(idToken)); }
    catch (e) { res.status(401).json({ error: 'bad token' }); return; }
    const uid = decoded.uid;
    const email = decoded.email;
    if (!email) { res.status(200).json({ ok: false, reason: 'no-email' }); return; }

    // suppression gate
    const prof = (await db.collection('profiles').doc(uid).get()).data() || {};
    const supp = (await db.collection('email_suppress').doc(uid).get()).exists;
    if (supp || prof.emailUnsub === true || (prof.preferences && prof.preferences.emailUnsub === true)) {
      res.status(200).json({ ok: false, reason: 'suppressed' }); return;
    }

    // rolling 24h cap
    const since = Date.now() - 24 * 3600 * 1000;
    const recent = await db.collection('apply_emails').where('uid', '==', uid).where('ts', '>=', since).get();
    if (recent.size >= DAILY_CAP) { res.status(200).json({ ok: false, reason: 'daily-cap' }); return; }

    const key = process.env.RESEND_API_KEY;
    if (!key) { res.status(200).json({ ok: false, reason: 'no-mailer' }); return; }

    const unsubUrl = SITE + '/api/unsubscribe?u=' + encodeURIComponent(uid);
    const { subject, html } = buildApplyEmail({ firstName: prof.first || prof.firstName, jobTitle, company, market, unsubUrl });

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      // v132: NOT "no-reply" (Resend Insights) + replies reach a monitored inbox
      body: JSON.stringify({ from: 'GhostProofJob <support@ghostproofjob.com>', reply_to: 'support@ghostproofjob.com', to: [email], subject, html }),
    });
    if (r.ok) {
      try { await db.collection('apply_emails').add({ uid, ts: Date.now() }); } catch (e) {}
      res.status(200).json({ ok: true });
    } else {
      res.status(200).json({ ok: false, reason: 'send-failed' });
    }
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
}

module.exports = handler;
module.exports.buildApplyEmail = buildApplyEmail;
module.exports.DAILY_CAP = DAILY_CAP;
