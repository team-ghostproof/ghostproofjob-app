'use strict';
/**
 * api/stripe-webhook.js — the missing half of the payment flow.
 *
 * BEFORE THIS: the app READ entitlement correctly (profiles/{uid}.tier ->
 * localStorage -> isPaid(), on every device) but NOTHING ever WROTE it except a
 * manual admin grant. So a real customer could pay through a Stripe payment link
 * and keep the paywall, and a cancelled/failed subscription never went back to free.
 *
 * THIS ENDPOINT closes that loop for BOTH sides:
 *   checkout.session.completed            -> grant the tier/plan (+ paidUntil)
 *   customer.subscription.updated         -> keep paidUntil in sync / downgrade if canceled
 *   customer.subscription.deleted         -> back to free
 *   invoice.payment_failed                -> back to free
 *
 * WHO PAID? The app appends `client_reference_id=<uid>:<key>` to every checkout URL
 * (see openCheckout / openRecruiterCheckout), so we never have to guess from an email.
 * A `stripe_customers/{customerId}` mapping doc is written on first payment so later
 * subscription events resolve to the same user with ONE doc read (D1-friendly).
 *
 * Writes use firebase-admin (service account), which bypasses security rules — that is
 * deliberate: `tier`/`plan`/`paidUntil` are backend-only by rule (a client that could
 * write them could self-grant paid access for free).
 *
 * ENV (Vercel): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIREBASE_SERVICE_ACCOUNT
 * Vercel must NOT parse the body — we need the raw bytes for signature verification.
 */

module.exports.config = { api: { bodyParser: false } };

const KEYS = {
  // candidate
  life: { kind: 'candidate', tier: 'life', recurring: false },
  month: { kind: 'candidate', tier: 'month', recurring: true },
  // recruiter
  premium: { kind: 'recruiter', plan: 'premium', recurring: true },
  pro: { kind: 'recruiter', plan: 'pro', recurring: true },
};

function db() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!svc) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
  }
  return admin.firestore();
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** grant/revoke on the right doc for the right side of the marketplace */
async function applyEntitlement(fs, { uid, kind, tier, plan, paidUntil, customerId }) {
  if (!uid) return false;
  if (kind === 'recruiter') {
    await fs.collection('recruiters').doc(uid).set(
      Object.assign({ plan: plan || 'free', planUntil: paidUntil || null },
        customerId ? { stripeCustomerId: customerId } : {}),
      { merge: true }
    );
  } else {
    await fs.collection('profiles').doc(uid).set(
      Object.assign({ tier: tier || 'free', paidUntil: paidUntil || null },
        customerId ? { stripeCustomerId: customerId } : {}),
      { merge: true }
    );
  }
  return true;
}

/** resolve a Stripe customer back to our user (one doc read, written on first payment) */
async function lookupCustomer(fs, customerId) {
  if (!customerId) return null;
  const s = await fs.collection('stripe_customers').doc(String(customerId)).get();
  return s.exists ? s.data() : null;
}

async function handleEvent(fs, event) {
  const o = event.data && event.data.object ? event.data.object : {};

  if (event.type === 'checkout.session.completed') {
    // client_reference_id = "<uid>__<key>" (key = life|month|premium|pro).
    // NOT a colon: Stripe payment links only accept [A-Za-z0-9_-] here and would
    // reject/drop the reference, leaving a paying customer with nothing. Split on the
    // LAST '__' so a uid is never mis-parsed.
    const ref = String(o.client_reference_id || '');
    const i = ref.lastIndexOf('__');
    const uid = i > 0 ? ref.slice(0, i) : '';
    const key = i > 0 ? ref.slice(i + 2) : '';
    const map = KEYS[key];
    if (!uid || !map) {
      console.warn('[stripe] unusable client_reference_id:', ref);
      return { ok: false, reason: 'no_reference' };
    }
    const customerId = o.customer ? String(o.customer) : '';
    // subscriptions carry their period end; a lifetime pass never expires
    let paidUntil = null;
    if (map.recurring) {
      paidUntil = o.expires_at ? o.expires_at * 1000 : null;
      if (o.subscription && process.env.STRIPE_SECRET_KEY) {
        try {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const sub = await stripe.subscriptions.retrieve(String(o.subscription));
          if (sub && sub.current_period_end) paidUntil = sub.current_period_end * 1000;
        } catch (e) { console.warn('[stripe] sub lookup', e && e.message); }
      }
    }
    if (customerId) {
      await fs.collection('stripe_customers').doc(customerId).set(
        { uid, kind: map.kind, key, ts: Date.now() }, { merge: true }
      );
    }
    await applyEntitlement(fs, { uid, kind: map.kind, tier: map.tier, plan: map.plan, paidUntil, customerId });
    console.log('[stripe] granted', key, 'to', uid);
    return { ok: true, granted: key, uid };
  }

  if (event.type === 'customer.subscription.updated') {
    const c = await lookupCustomer(fs, o.customer);
    if (!c) return { ok: false, reason: 'unknown_customer' };
    const dead = ['canceled', 'unpaid', 'incomplete_expired'].indexOf(String(o.status)) >= 0;
    const map = KEYS[c.key] || {};
    await applyEntitlement(fs, {
      uid: c.uid, kind: c.kind,
      tier: dead ? 'free' : map.tier,
      plan: dead ? 'free' : map.plan,
      paidUntil: dead ? null : (o.current_period_end ? o.current_period_end * 1000 : null),
    });
    return { ok: true, status: o.status, uid: c.uid };
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    const c = await lookupCustomer(fs, o.customer);
    if (!c) return { ok: false, reason: 'unknown_customer' };
    // they cancelled or the payment failed -> straight back to free, both sides
    await applyEntitlement(fs, { uid: c.uid, kind: c.kind, tier: 'free', plan: 'free', paidUntil: null });
    console.log('[stripe] downgraded', c.uid, 'via', event.type);
    return { ok: true, downgraded: c.uid };
  }

  return { ok: true, ignored: event.type };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) { res.statusCode = 500; return res.end('stripe env not configured'); }

  let event;
  try {
    const stripe = require('stripe')(key);
    const buf = await rawBody(req);
    // signature verification is what makes this endpoint safe to expose publicly:
    // without it, anyone could POST a fake "you paid" event and grant themselves a tier.
    event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.warn('[stripe] bad signature:', e && e.message);
    res.statusCode = 400;
    return res.end('signature verification failed');
  }

  try {
    const out = await handleEvent(db(), event);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[stripe] handler', e && e.message);
    res.statusCode = 500;   // let Stripe retry
    return res.end('handler error');
  }
};

module.exports.handleEvent = handleEvent;
module.exports.applyEntitlement = applyEntitlement;
module.exports.KEYS = KEYS;
