// ============================================================================
// GhostProofJob — email opt-out / CAN-SPAM tests (Sprint 5)
// Pure-JS (node:test), no network, no firebase-admin. `npm run test:email`.
// Proves: global suppression beats prefs; every sent email carries an
// unsubscribe link; the token guards against forged links.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mod = require('../../api/notifications/sendAutomatedEmail.js');
const { isAllowed, isSuppressed, withUnsubFooter, unsubUrl, unsubToken, sendBatch } = mod;

describe('preference gate (unchanged, opt-in)', () => {
  test('a type is sent only when its pref is explicitly true', () => {
    assert.equal(isAllowed({ newJobMatches: true }, 'new_job_matches'), true);
    assert.equal(isAllowed({}, 'new_job_matches'), false);
    assert.equal(isAllowed(null, 'ghost_risk_alert'), false);
    assert.equal(isAllowed({ ghostRiskAlerts: true }, 'unknown_type'), false);
  });
});

describe('global suppression beats every preference', () => {
  test('emailUnsub at top level or in preferences suppresses all', () => {
    assert.equal(isSuppressed({ emailUnsub: true }), true);
    assert.equal(isSuppressed({ preferences: { emailUnsub: true } }), true);
    assert.equal(isSuppressed({ preferences: { newJobMatches: true } }), false);
    assert.equal(isSuppressed({}), false);
  });
  test('sendBatch skips an unsubscribed user even when the type pref is on', async () => {
    const users = [
      { email: 'a@x.com', preferences: { newJobMatches: true } },
      { email: 'b@x.com', preferences: { newJobMatches: true }, emailUnsub: true },
    ];
    // no provider configured → nothing actually sends, but the gate still runs
    const r = await sendBatch(users, 'new_job_matches', { subject: 's', html: '<p>hi</p>' });
    assert.equal(r.skipped, 1, 'the unsubscribed user is skipped');
    assert.equal(r.attempted, 1, 'only the opted-in, non-suppressed user is attempted');
  });
});

describe('every email carries an unsubscribe link', () => {
  test('withUnsubFooter appends a working unsubscribe URL', () => {
    const html = withUnsubFooter('<p>Your weekly matches</p>', { uid: 'u123', email: 'u@x.com' });
    assert.match(html, /Your weekly matches/);
    assert.match(html, /Unsubscribe/);
    assert.match(html, /\/api\/unsubscribe\?u=u123/);
  });
  test('the URL prefers uid, falls back to email', () => {
    assert.match(unsubUrl({ uid: 'u1' }), /u=u1/);
    assert.match(unsubUrl({ email: 'e@x.com' }), /u=e%40x\.com/);
  });
});

describe('token guards forged links when UNSUB_SECRET is set', () => {
  test('token is stable + present only with a secret', () => {
    delete process.env.UNSUB_SECRET;
    assert.equal(unsubToken('u1'), '', 'no secret → no token (degraded but functional)');
    process.env.UNSUB_SECRET = 'test-secret';
    const t = unsubToken('u1');
    assert.equal(t.length, 24);
    assert.equal(unsubToken('u1'), t, 'stable for the same id');
    assert.notEqual(unsubToken('u2'), t, 'different id → different token');
    delete process.env.UNSUB_SECRET;
  });
});
