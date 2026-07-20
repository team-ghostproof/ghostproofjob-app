// ============================================================================
// GhostProofJob — reverse-match scorer unit tests (R0 skeleton)
// Pure JS, no emulator — runs with `node --test`. Fixtures cover the four
// required cases: local-scope · remote-scope · empty pool · applied-flag.
// (recruiter-tier.md §7.5)
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reverseMatch, scoreCandidateForJob, inScope, sameMarket } = require('../../api/match/reverseMatch.js');
// v136: token builder + recommendation projection for the market regression
const { profileToToken } = require('../../api/match/buildMatchTokens.js');
const { buildRecommendations } = require('../../api/match/runReverseMatch.js');

const opsCandLocal = { uid: 'c1', title: 'Operations Specialist', skills: ['operations', 'inventory'], market: 'Houston, TX', is_remote: false };
const opsCandRemote = { uid: 'c2', title: 'Operations Manager', skills: ['operations', 'logistics'], market: 'Denver, CO', is_remote: true };
const mktCandFar = { uid: 'c3', title: 'Marketing Specialist', skills: ['marketing', 'campaigns'], market: 'Boston, MA', is_remote: false };
const opsCandApplied = { uid: 'c4', title: 'Operations Lead', skills: ['operations'], market: 'Houston, TX', is_remote: false, appliedJobIds: ['jobOps'] };

const localOpsJob = { id: 'jobOps', title: 'Operations Specialist', req: 'inventory operations experience', market: 'Houston, TX', is_remote: false };
const remoteOpsJob = { id: 'jobOpsR', title: 'Operations Specialist', req: 'inventory operations', market: 'United States', is_remote: true };

describe('scoring', () => {
  test('a same-field candidate scores higher than an off-field one', () => {
    const good = scoreCandidateForJob(localOpsJob, opsCandLocal).score;
    const bad = scoreCandidateForJob(localOpsJob, mktCandFar).score;
    assert.ok(good > bad, `ops(${good}) should beat marketing(${bad})`);
  });
  test('matched/missing reflect the job field words', () => {
    const r = scoreCandidateForJob(localOpsJob, opsCandLocal);
    assert.ok(r.matched.includes('operations'));
  });
});

describe('local scope', () => {
  test('on-site job includes same-market candidates, excludes far ones', () => {
    const res = reverseMatch(localOpsJob, [opsCandLocal, mktCandFar]);
    const uids = res.map((r) => r.uid);
    assert.ok(uids.includes('c1'), 'Houston candidate in scope');
    assert.ok(!uids.includes('c3'), 'Boston on-site candidate OUT of a Houston job');
  });
  test('sameMarket matches metro and state, not across states', () => {
    assert.equal(sameMarket('Houston, TX', 'Houston, TX'), true);
    assert.equal(sameMarket('Houston, TX', 'Dallas, TX'), true); // same state
    assert.equal(sameMarket('Houston, TX', 'Boston, MA'), false);
  });
});

describe('remote scope', () => {
  test('remote job pulls the whole pool (incl. other cities)', () => {
    const res = reverseMatch(remoteOpsJob, [opsCandLocal, opsCandRemote, mktCandFar]);
    assert.equal(res.length, 3, 'remote job scopes to everyone');
  });
  test('a remote-willing candidate is in scope for an on-site job', () => {
    assert.equal(inScope(localOpsJob, opsCandRemote), true);
  });
});

describe('empty pool', () => {
  test('empty pool returns []', () => {
    assert.deepEqual(reverseMatch(localOpsJob, []), []);
    assert.deepEqual(reverseMatch(localOpsJob, null), []);
  });
  test('a pool with no in-scope candidates returns []', () => {
    assert.deepEqual(reverseMatch(localOpsJob, [mktCandFar]), []);
  });
});

describe('applied flag', () => {
  test('applied candidates are flagged and sorted first', () => {
    const res = reverseMatch(localOpsJob, [opsCandLocal, opsCandApplied]);
    assert.equal(res[0].uid, 'c4', 'the applicant leads');
    assert.equal(res[0].applied, true);
    assert.equal(res.find((r) => r.uid === 'c1').applied, false);
  });
});

describe('top-N cap', () => {
  test('never returns more than topN', () => {
    const pool = Array.from({ length: 80 }, (_, i) => ({ uid: 'u' + i, title: 'Operations Specialist', skills: ['operations'], market: 'Houston, TX' }));
    assert.equal(reverseMatch(localOpsJob, pool, { topN: 50 }).length, 50);
  });
});

// ============================================================================
// v136 REGRESSION (founder live repro): asosa never matched her own "Marketing
// Manager" test job. Root cause: the app never wrote profile.location, so every
// token got market:'' and inScope() excluded EVERY candidate from EVERY on-site
// job. These lock both halves of the fix.
// ============================================================================
describe('v136: candidate market must reach the token (or nobody matches on-site)', () => {
  const asosa = {
    discoverable: true,
    resume: { title: 'Marketing Specialist', skills: 'Marketing · SEO · Campaigns', name: 'Aaliyah Sosa', contact: 'a@x.com' },
  };
  const gpjJob = { id: 'j1', title: 'Marketing Manager', req: 'marketing campaigns', desc: 'Run marketing.', market: 'Houston, TX', is_remote: false };

  test('THE BUG: a profile with no location yields an empty market and is filtered out', () => {
    const tok = profileToToken('u1', asosa);
    assert.equal(tok.market, '', 'reproduces the broken state');
    assert.equal(inScope(gpjJob, tok), false, 'empty market => excluded from every on-site job');
  });

  test('FIX A: profile.location (now written by cloudSync) puts her in scope and scores high', () => {
    const tok = profileToToken('u1', Object.assign({ location: 'Houston, TX' }, asosa));
    assert.equal(tok.market, 'Houston, TX');
    assert.equal(inScope(gpjJob, tok), true);
    const { score, matched } = scoreCandidateForJob(gpjJob, tok);
    assert.ok(score >= 70, 'shared field word "marketing" scores strongly, got ' + score);
    assert.ok(matched.includes('marketing'));
  });

  test('FIX B: a pre-fix profile still matches via the account address fallback', () => {
    const tok = profileToToken('u1', Object.assign({ account: { address: '5606 Willow Bend Ln, Houston, TX 77081' } }, asosa));
    assert.equal(tok.market, 'Houston, TX', 'existing users match without re-saving');
    assert.equal(inScope(gpjJob, tok), true);
  });

  test('an unknowable market stays empty — we never invent a location', () => {
    const tok = profileToToken('u1', Object.assign({ account: { address: 'no city here' } }, asosa));
    assert.equal(tok.market, '');
  });

  test('end-to-end: she appears in the job\'s recommendations once located', () => {
    const pool = [Object.assign({ uid: 'u1' }, profileToToken('u1', Object.assign({ location: 'Houston, TX' }, asosa)))];
    const recs = buildRecommendations(gpjJob, pool, []);
    assert.equal(recs.length, 1, 'she is recommended for her own test job');
    assert.equal(recs[0].uid, 'u1');
    assert.ok(recs[0].score >= 70);
  });
});
