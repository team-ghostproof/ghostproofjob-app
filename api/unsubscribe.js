'use strict';
/**
 * api/unsubscribe.js — the one-click opt-out endpoint every automated email
 * links to (Sprint 5, CAN-SPAM). A GET immediately sets the suppression flag
 * (one-click compliant), then renders a confirmation page with optional reason
 * buttons. A POST records the reason. No auth required — the link IS the intent;
 * an optional HMAC token (UNSUB_SECRET) stops a link being forged for another
 * address.
 *
 * Writes:  email_suppress/{id} = { unsub:true, reason, ts }   (canonical gate)
 *          profiles/{id}.emailUnsub = true                    (when id is a uid)
 * Both systems (this repo's sendAutomatedEmail + the Cloudflare Worker) must
 * consult the suppression before sending — see api/notifications README.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT (same secret as the harvester), UNSUB_SECRET (optional)
 */
const crypto = require('crypto');

function verifyToken(id, t) {
  const secret = process.env.UNSUB_SECRET;
  if (!secret) return true;                 // no secret configured → accept (degraded)
  if (!t) return false;
  const expect = crypto.createHmac('sha256', secret).update(String(id || '')).digest('hex').slice(0, 24);
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expect)); } catch (e) { return false; }
}

function db() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  }
  return admin.firestore();
}

async function suppress(id, reason) {
  const fs = db();
  const safeReason = String(reason || '').slice(0, 40).replace(/[^a-z_ ]/gi, '');
  await fs.collection('email_suppress').doc(String(id)).set({ unsub: true, reason: safeReason, ts: Date.now() }, { merge: true });
  // if the id is a profile uid, mirror the flag so sendAutomatedEmail's user.emailUnsub gate fires
  try {
    const p = fs.collection('profiles').doc(String(id));
    if ((await p.get()).exists) await p.set({ emailUnsub: true, emailUnsubReason: safeReason, emailUnsubAt: Date.now() }, { merge: true });
  } catch (e) { /* not a uid — the email_suppress doc is the gate */ }
}

function page(bodyHtml) {
  return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Unsubscribed — GhostProofJob</title>' +
    '<div style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1b1526">' +
    '<div style="font-size:30px">👻💚</div>' + bodyHtml + '</div>';
}

module.exports = async function handler(req, res) {
  const q = (req && req.query) || {};
  const id = q.u || q.email || '';
  const method = (req && req.method) || 'GET';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id) { res.statusCode = 400; return res.end(page('<h2>Missing link</h2><p>This unsubscribe link is incomplete. Manage email in the app under Settings → Notifications.</p>')); }
  if (!verifyToken(id, q.t)) { res.statusCode = 403; return res.end(page('<h2>Link expired</h2><p>Please use the unsubscribe link from a recent email, or turn off notifications in Settings.</p>')); }

  try {
    await suppress(id, method === 'POST' ? ((req.body && req.body.reason) || q.reason) : q.reason);
  } catch (e) {
    console.error('[unsubscribe]', e && e.message);
    res.statusCode = 500;
    return res.end(page('<h2>Something went wrong</h2><p>We couldn’t process that just now. You can turn off all emails in the app under Settings → Notifications.</p>'));
  }

  if (method === 'POST') return res.end(page('<h2>Thanks — noted.</h2><p>You’re unsubscribed from automated emails. You can re-enable them anytime in Settings → Notifications.</p>'));

  const base = '/api/unsubscribe?u=' + encodeURIComponent(id) + (q.t ? ('&t=' + encodeURIComponent(q.t)) : '');
  const btn = (r, label) => '<form method="POST" action="' + base + '" style="display:inline"><input type="hidden" name="reason" value="' + r + '"><button style="font:14px -apple-system,Arial,sans-serif;background:#f1edf9;border:1px solid #e4def0;border-radius:9px;padding:9px 12px;margin:4px 6px 0 0;cursor:pointer;color:#1b1526">' + label + '</button></form>';
  return res.end(page(
    '<h2>You’re unsubscribed.</h2>' +
    '<p>You won’t get automated emails from GhostProofJob anymore. Applying, browsing, and everything in the app keeps working — and you can re-enable emails anytime in <b>Settings → Notifications</b>.</p>' +
    '<p style="color:#6a6382;margin-top:22px">Mind sharing why? (optional)</p>' +
    btn('got_hired', '🎉 I got hired') + btn('not_using', 'Not using it') + btn('too_many', 'Too many emails') + btn('other', 'Other')
  ));
};
