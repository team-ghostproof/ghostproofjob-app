// ============================================================================
// Stripe webhook — entitlement grant/revoke logic.   npm run test:billing
//
// This is the money path: before it existed, a customer could pay and keep the
// paywall, and a cancellation never went back to free. These tests pin BOTH
// directions for BOTH sides of the marketplace, against a fake Firestore.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleEvent, KEYS } = require('../../api/stripe-webhook.js');

/** minimal in-memory stand-in for the admin Firestore surface we use */
function fakeDb(seed = {}) {
  const data = JSON.parse(JSON.stringify(seed));
  return {
    _data: data,
    collection(c) {
      data[c] = data[c] || {};
      return {
        doc(id) {
          return {
            async get() { return { exists: !!data[c][id], data: () => data[c][id] }; },
            async set(v, opts) {
              data[c][id] = (opts && opts.merge) ? Object.assign({}, data[c][id] || {}, v) : v;
            },
          };
        },
      };
    },
  };
}

const session = (ref, over = {}) => ({
  type: 'checkout.session.completed',
  data: { object: Object.assign({ client_reference_id: ref, customer: 'cus_1' }, over) },
});

describe('checkout.session.completed — grants the right thing to the right account', () => {
  test('candidate LIFETIME: tier=life, no expiry, and it is a profiles write', async () => {
    const fs = fakeDb();
    const r = await handleEvent(fs, session('uidA__life'));
    assert.equal(r.ok, true);
    assert.equal(fs._data.profiles.uidA.tier, 'life');
    assert.equal(fs._data.profiles.uidA.paidUntil, null, 'a lifetime pass never expires');
    assert.equal(fs._data.profiles.uidA.stripeCustomerId, 'cus_1');
  });
  test('recruiter PRO: writes plan on the RECRUITER doc, not the profile', async () => {
    const fs = fakeDb();
    await handleEvent(fs, session('r1__pro'));
    assert.equal(fs._data.recruiters.r1.plan, 'pro');
    assert.ok(!fs._data.profiles || !fs._data.profiles.r1, 'a recruiter plan must not land on profiles');
  });
  test('recruiter PREMIUM maps to premium', async () => {
    const fs = fakeDb();
    await handleEvent(fs, session('r2__premium'));
    assert.equal(fs._data.recruiters.r2.plan, 'premium');
  });
  test('the reference is Stripe-LEGAL: [A-Za-z0-9_-] only — a colon would be rejected', async () => {
    // Stripe payment links only accept alphanumerics/dash/underscore in
    // client_reference_id. A colon separator would be dropped and a paying customer
    // would get nothing — so the format itself is pinned here.
    const ref = 'uidA__life';
    assert.match(ref, /^[A-Za-z0-9_-]+$/, 'reference must be Stripe-legal');
    const fs = fakeDb();
    assert.equal((await handleEvent(fs, session('uidA:life'))).ok, false, 'a colon form must never be honoured');
  });
  test('a uid containing "_" still parses (we split on the LAST "__")', async () => {
    const fs = fakeDb();
    await handleEvent(fs, session('weird_uid__life'));
    assert.equal(fs._data.profiles['weird_uid'].tier, 'life');
  });
  test('a customer -> user mapping is stored so later subscription events resolve', async () => {
    const fs = fakeDb();
    await handleEvent(fs, session('uidA__month'));
    assert.deepEqual(
      { uid: fs._data.stripe_customers.cus_1.uid, kind: fs._data.stripe_customers.cus_1.kind, key: fs._data.stripe_customers.cus_1.key },
      { uid: 'uidA', kind: 'candidate', key: 'month' }
    );
  });
  test('an unusable/absent client_reference_id grants NOTHING (never guess)', async () => {
    const fs = fakeDb();
    assert.equal((await handleEvent(fs, session(''))).ok, false);
    assert.equal((await handleEvent(fs, session('uidA__bogus'))).ok, false, 'unknown product key');
    assert.equal((await handleEvent(fs, session('uidAlife'))).ok, false, 'no separator');
    assert.deepEqual(fs._data.profiles || {}, {});
  });
});

describe('cancel / non-payment — auto-downgrade to free (both sides)', () => {
  const seeded = () => fakeDb({
    stripe_customers: { cus_1: { uid: 'uidA', kind: 'candidate', key: 'month' }, cus_2: { uid: 'r1', kind: 'recruiter', key: 'pro' } },
    profiles: { uidA: { tier: 'month', paidUntil: Date.now() + 8.64e7 } },
    recruiters: { r1: { plan: 'pro', planUntil: Date.now() + 8.64e7 } },
  });
  test('subscription.deleted -> candidate back to free', async () => {
    const fs = seeded();
    await handleEvent(fs, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    assert.equal(fs._data.profiles.uidA.tier, 'free');
    assert.equal(fs._data.profiles.uidA.paidUntil, null);
  });
  test('subscription.deleted -> recruiter back to free', async () => {
    const fs = seeded();
    await handleEvent(fs, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_2' } } });
    assert.equal(fs._data.recruiters.r1.plan, 'free');
  });
  test('invoice.payment_failed -> back to free', async () => {
    const fs = seeded();
    await handleEvent(fs, { type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
    assert.equal(fs._data.profiles.uidA.tier, 'free');
  });
  test('subscription.updated to canceled/unpaid -> free; still active -> keeps the plan + new period end', async () => {
    let fs = seeded();
    await handleEvent(fs, { type: 'customer.subscription.updated', data: { object: { customer: 'cus_2', status: 'canceled' } } });
    assert.equal(fs._data.recruiters.r1.plan, 'free');

    fs = seeded();
    const end = Math.floor(Date.now() / 1000) + 2592000;
    await handleEvent(fs, { type: 'customer.subscription.updated', data: { object: { customer: 'cus_2', status: 'active', current_period_end: end } } });
    assert.equal(fs._data.recruiters.r1.plan, 'pro', 'an active renewal must not downgrade');
    assert.equal(fs._data.recruiters.r1.planUntil, end * 1000, 'the entitlement window rolls forward');
  });
  test('REFUND of a LIFETIME pass revokes it (the only revoke signal — no sub to cancel)', async () => {
    const fs = fakeDb({
      stripe_customers: { cus_3: { uid: 'uidL', kind: 'candidate', key: 'life' } },
      profiles: { uidL: { tier: 'life', paidUntil: null } },
    });
    await handleEvent(fs, { type: 'charge.refunded', data: { object: { customer: 'cus_3', refunded: true } } });
    assert.equal(fs._data.profiles.uidL.tier, 'free', 'a refunded lifetime pass must not stay unlimited forever');
  });
  test('REFUND on the recruiter side revokes the plan too', async () => {
    const fs = seeded();
    await handleEvent(fs, { type: 'charge.refunded', data: { object: { customer: 'cus_2', refunded: true } } });
    assert.equal(fs._data.recruiters.r1.plan, 'free');
  });
  test('a PARTIAL refund is left alone (they still paid)', async () => {
    const fs = seeded();
    const r = await handleEvent(fs, { type: 'charge.refunded', data: { object: { customer: 'cus_1', refunded: false } } });
    assert.equal(r.ignored, 'partial_refund');
    assert.equal(fs._data.profiles.uidA.tier, 'month', 'untouched');
  });
  test('a CHARGEBACK (dispute) revokes access', async () => {
    const fs = seeded();
    await handleEvent(fs, { type: 'charge.dispute.created', data: { object: { customer: 'cus_1' } } });
    assert.equal(fs._data.profiles.uidA.tier, 'free');
  });
  test('an event for an UNKNOWN customer changes nothing', async () => {
    const fs = seeded();
    const r = await handleEvent(fs, { type: 'customer.subscription.deleted', data: { object: { customer: 'cus_nope' } } });
    assert.equal(r.ok, false);
    assert.equal(fs._data.profiles.uidA.tier, 'month', 'untouched');
  });
  test('unrelated events are ignored safely', async () => {
    const fs = seeded();
    const r = await handleEvent(fs, { type: 'customer.created', data: { object: {} } });
    assert.equal(r.ok, true);
    assert.equal(r.ignored, 'customer.created');
    assert.equal(fs._data.profiles.uidA.tier, 'month', 'nothing touched');
  });
});

describe('the key map covers exactly the four things we sell', () => {
  test('life/month are candidate, premium/pro are recruiter', () => {
    assert.equal(KEYS.life.kind, 'candidate');
    assert.equal(KEYS.month.kind, 'candidate');
    assert.equal(KEYS.premium.kind, 'recruiter');
    assert.equal(KEYS.pro.kind, 'recruiter');
    assert.equal(KEYS.life.recurring, false, 'lifetime is one-time');
    assert.equal(KEYS.month.recurring && KEYS.premium.recurring && KEYS.pro.recurring, true);
  });
});
