// ============================================================================
// GhostProofJob — R3 reverse-match pipeline tests (pure logic; no Firestore)
// `npm run test:match` includes this. Proves the consent model + projection.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { profileToToken } = require('../../api/match/buildMatchTokens.js');
const { buildRecommendations } = require('../../api/match/runReverseMatch.js');

describe('profileToToken — consent gate + extraction', () => {
  const base = {
    discoverable: true, location: 'Houston, TX', email: 'jane@x.com',
    resume: { name: 'Jane Doe', title: 'Operations Manager', skills: 'Logistics · Inventory · Excel', contact: 'jane@x.com · (713) 555-0100', jobs: [{ t: 'Operations Manager', c: 'Acme' }] },
  };
  test('a NON-discoverable profile yields NO token (opt-in required)', () => {
    assert.equal(profileToToken('u1', Object.assign({}, base, { discoverable: false })), null);
    assert.equal(profileToToken('u1', Object.assign({}, base, { discoverable: undefined })), null);
  });
  test('a discoverable profile extracts a compact token with contact (consented)', () => {
    const t = profileToToken('u1', base);
    assert.equal(t.uid, 'u1');
    assert.equal(t.title, 'Operations Manager');
    assert.deepEqual(t.skills, ['Logistics', 'Inventory', 'Excel']);
    assert.equal(t.market, 'Houston, TX');
    assert.equal(t.displayName, 'Jane Doe');
    assert.ok(t.contact.includes('jane@x.com'), 'contact rides along — discoverable == consent to contact');
  });
  test('a discoverable profile with no title AND no skills is skipped', () => {
    assert.equal(profileToToken('u2', { discoverable: true, resume: {} }), null);
  });
});

describe('buildRecommendations — scoping, ranking, consent projection', () => {
  const job = { id: 'jobX', title: 'Operations Manager', req: 'inventory logistics', desc: 'warehouse ops', market: 'Houston, TX', is_remote: false };
  const pool = [
    { uid: 'opsHou', title: 'Operations Manager', skills: ['logistics', 'inventory'], market: 'Houston, TX', displayName: 'Ops Hou', contact: 'ops@x.com' },
    { uid: 'mktHou', title: 'Marketing Specialist', skills: ['seo', 'content'], market: 'Houston, TX', displayName: 'Mkt Hou', contact: 'mkt@x.com' },
    { uid: 'opsBos', title: 'Operations Manager', skills: ['logistics'], market: 'Boston, MA', displayName: 'Ops Bos', contact: 'bos@x.com' },
  ];

  test('out-of-market on-site candidate is excluded; local ops ranks top', () => {
    const recs = buildRecommendations(job, pool, []);
    const uids = recs.map((r) => r.uid);
    assert.ok(!uids.includes('opsBos'), 'Boston candidate out of a Houston on-site job');
    assert.equal(recs[0].uid, 'opsHou', 'local ops manager ranks first');
    assert.ok(recs.find((r) => r.uid === 'opsHou').score > recs.find((r) => r.uid === 'mktHou').score, 'ops beats marketing for an ops job');
  });

  test('an opted-in candidate who also APPLIED is ranked first + flagged', () => {
    const recs = buildRecommendations(job, pool, ['mktHou']);
    assert.equal(recs[0].uid, 'mktHou', 'applied candidate floats to the top regardless of score');
    assert.equal(recs[0].applied, true);
  });

  test('every surfaced candidate carries name + contact (pool is discoverable-only)', () => {
    const recs = buildRecommendations(job, pool, []);
    recs.forEach((r) => {
      assert.ok(r.displayName, 'name present for a consented candidate');
      assert.ok(r.contact, 'contact present for a consented candidate');
      assert.ok(typeof r.score === 'number' && Array.isArray(r.matched));
    });
  });

  test('topN caps the result set', () => {
    const big = Array.from({ length: 80 }, (_, i) => ({ uid: 'u' + i, title: 'Operations Manager', skills: ['logistics'], market: 'Houston, TX', displayName: 'N' + i, contact: 'c' + i + '@x.com' }));
    const recs = buildRecommendations(job, big, [], { topN: 50 });
    assert.equal(recs.length, 50);
  });
});
