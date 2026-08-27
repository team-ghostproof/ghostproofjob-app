// ============================================================================
// GhostProofJob — v146 P-MATCH: shared bidirectional scorer + convergence.
// Proves the founder-caught bug is closed: the candidate side and the recruiter
// side now produce the SAME match number for the SAME (résumé, job) pair, and the
// reverse side finally scores against the candidate's DUTIES, not just title+skills.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scoreMatch } = require('../../api/match/scoreCore.js');
const { profileToToken } = require('../../api/match/buildMatchTokens.js');
const { scoreCandidateForJob } = require('../../api/match/reverseMatch.js');

// A realistic marketing candidate — title diverges from strongest content, exactly
// the founder's résumé shape (title "Marketing Specialist", ops/marketing duties).
const resume = {
  title: 'Marketing Manager',
  jobs: [
    { t: 'Marketing Manager', b: 'Owned demand generation across paid, email and lifecycle. Ran the content calendar and managed a marketing budget. Partnered with sales on pipeline.' },
    { t: 'Marketing Coordinator', b: 'Built campaign reporting, managed social media and brand content, coordinated events.' },
  ],
  skills: 'demand generation, HubSpot, content marketing, campaign strategy, budgeting, analytics',
  summary: 'Marketing leader with 6 years running B2B campaigns end to end.',
};
const job = {
  title: 'Marketing Manager',
  desc: 'We are hiring a Marketing Manager to own demand generation, the content calendar, and a marketing budget. Partner with sales on pipeline. HubSpot experience preferred.',
  req: 'Five years B2B marketing, HubSpot, budget ownership.',
};

// how the CANDIDATE side scores it (computeMatch's inputs → scoreCore)
const forward = scoreMatch(
  { title: resume.title, roles: resume.jobs, skills: resume.skills, summary: resume.summary },
  { title: job.title, desc: `${job.desc} ${job.req}` },
).score;

describe('v146 P-MATCH — one scorer, same number both directions', () => {
  test('the shared scorer rates a strong pair highly', () => {
    assert.ok(forward >= 80, `strong pair should score high, got ${forward}`);
  });

  test('CONVERGENCE: recruiter score == candidate score for the same pair', () => {
    const token = profileToToken('u1', { discoverable: true, resume });
    assert.ok(token, 'discoverable résumé yields a token');
    const reverse = scoreCandidateForJob(job, token).score;
    // identical: both sides now run scoreCore over the same enriched résumé data.
    assert.equal(reverse, forward, `recruiter ${reverse} must equal candidate ${forward} — the whole point`);
  });

  test('the token now carries DUTIES + summary (not title+skills only)', () => {
    const token = profileToToken('u1', { discoverable: true, resume });
    assert.ok(Array.isArray(token.roles) && token.roles.length >= 1, 'roles/duties carried');
    assert.ok(token.roles[0].b && token.roles[0].b.length > 0, 'duty bullets carried');
    assert.equal(typeof token.summary, 'string');
  });

  test('duties MATTER: a résumé whose match lives in the bullets still scores', () => {
    // title is generic; the real signal ("logistics", "warehouse") is only in duties.
    const dutiesResume = {
      title: 'Team Lead',
      jobs: [{ t: 'Operations Team Lead', b: 'Ran daily warehouse logistics, inventory accuracy, and vendor scheduling for a multi-site operation.' }],
      skills: 'logistics, inventory, scheduling',
      summary: '',
    };
    const logisticsJob = { title: 'Logistics Coordinator', desc: 'Own warehouse logistics, inventory and vendor scheduling.' };
    const withDuties = scoreMatch(
      { title: dutiesResume.title, roles: dutiesResume.jobs, skills: dutiesResume.skills, summary: '' },
      logisticsJob,
    ).score;
    const titleOnly = scoreMatch(
      { title: dutiesResume.title, roles: [], skills: [], summary: '' },
      logisticsJob,
    ).score;
    assert.ok(withDuties > titleOnly, `duties must add signal (${withDuties} vs title-only ${titleOnly})`);
  });

  test('an unrelated pair scores low both ways', () => {
    const nurseJob = { title: 'Registered Nurse', desc: 'Provide patient care in an acute setting; RN license required.' };
    const fwd = scoreMatch({ title: resume.title, roles: resume.jobs, skills: resume.skills, summary: resume.summary }, nurseJob).score;
    const token = profileToToken('u1', { discoverable: true, resume });
    const rev = scoreCandidateForJob(nurseJob, token).score;
    assert.ok(fwd <= 40, `off-field should be low, got ${fwd}`);
    assert.equal(fwd, rev, 'still agree on a weak pair');
  });
});

// N2 (v250) — the score must DISCRIMINATE, not clamp at 98 for every in-field job.
describe('N2: match score is de-saturated (discriminates by depth)', () => {
  const cand = {
    title: 'Marketing Specialist',
    roles: [
      { t: 'Marketing Specialist', b: 'managed campaigns, email marketing, analytics, content, social media, seo, reporting, stakeholder management' },
      { t: 'Account Manager', b: 'client relationships, retention' },
    ],
    skills: ['marketing', 'campaigns', 'email marketing', 'analytics', 'content', 'seo', 'social media', 'reporting', 'crm', 'stakeholder management'],
    summary: 'Marketing specialist with campaign and analytics experience.',
  };
  const strong = scoreMatch(cand, { title: 'Senior Marketing Manager', desc: 'Lead marketing strategy, campaigns, email marketing, analytics, content, seo, social media, reporting, demand generation, stakeholder management, crm.' }).score;
  const thin = scoreMatch(cand, { title: 'Marketing Specialist', desc: 'Support marketing efforts.' }).score;
  const partial = scoreMatch(cand, { title: 'Communications Coordinator', desc: 'Write content, manage social media, some analytics and reporting.' }).score;
  const outField = scoreMatch(cand, { title: 'Software Engineer', desc: 'Build backend services in Java, Kubernetes, distributed systems, APIs.' }).score;

  test('a strong, deep match scores high (88-98) — not everything does', () => {
    assert.ok(strong >= 88 && strong <= 98, `strong should be 88-98, got ${strong}`);
  });
  test('an in-field but THIN match no longer saturates at ~98', () => {
    assert.ok(thin < strong && thin <= 90, `thin (${thin}) should be below strong (${strong}) and <=90`);
  });
  test('a partial/adjacent match spreads well below strong', () => {
    assert.ok(partial < 70 && partial < thin, `partial (${partial}) should be <70 and below thin (${thin})`);
  });
  test('an out-of-field match stays low (capped)', () => {
    assert.ok(outField <= 40, `out-of-field (${outField}) should be <=40`);
  });
  test('the ordering is monotonic: strong > thin > partial > out', () => {
    assert.ok(strong > thin && thin > partial && partial > outField, `expected strong>${thin}>${partial}>${outField}`);
  });
});
