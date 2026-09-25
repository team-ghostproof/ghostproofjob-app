// Weekly candidate digest — the pure logic (per-toggle email opt-in, matching with the SHARED
// card scorer, ghost-risk on applied companies, rate reminders, honest batched HTML). No creds/network.
//
// v283 contract: email is a SEPARATE opt-in from the in-app bell. The three "Also email me"
// sub-toggles (preferences.*Email) DEFAULT OFF; the in-app toggles (preferences.newJobMatches etc.)
// drive the bell only and NEVER authorise email. This suite locks that split in.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligible, wantsEmail, contactable, emailOf, topMatches,
  riskMapFrom, ghostRiskApplied, rateReminders, buildDigest, subjectFor, digestHtml,
} from '../../scripts/candidate_digest.mjs';

const DAY = 86400000, now = Date.now();
const pool = [
  { title: 'Senior Lifecycle Marketing Manager', company: 'Talkiatry', location: 'Remote', is_remote: true, salary_min: 120000, description: 'Own lifecycle email campaigns, CRM, analytics, retention, segmentation.' },
  { title: 'Data Entry Clerk', company: 'Acme', location: 'Dallas, TX', description: 'Enter data into spreadsheets. Attention to detail.' },
  { title: 'Growth Marketing Manager', company: 'Northwind', location: 'Remote', is_remote: true, salary_min: 110000, description: 'Growth, lifecycle, retention, email, CRM, campaigns.' },
];
const resume = { title: 'Lifecycle Marketing Manager', skills: 'lifecycle, CRM, email, analytics, campaigns', jobs: [{ t: 'Marketing Manager', b: 'Ran lifecycle email + CRM' }] };
const applied = [
  { t: 'Ops Lead', co: 'ShadyCo', when: now - 5 * DAY },
  { t: 'Analyst', co: 'GoodCo', when: now - 5 * DAY },
  { t: 'PM', co: 'RatedCo', when: now - 5 * DAY },
  { t: 'Clerk', co: 'FreshCo', when: now - 1000 },
];
const base = { account: { first: 'Aaliyah' }, email: 'a@x.com', resume, lists: { applied }, vibeReviews: { RatedCo: [{ stars: 4 }] } };
const wantsAll = { ...base, preferences: { newJobMatchesEmail: true, ghostRiskAlertsEmail: true, companyRatingRemindersEmail: true } };
const riskMap = riskMapFrom([
  { companyKey: 'shadyco', reporterUid: 'u1', jobKey: 'ops-lead' },
  { companyKey: 'shadyco', reporterUid: 'u2', jobKey: 'ops-lead' },
  { companyKey: 'shadyco', reporterUid: 'u3', jobKey: 'analyst' },
  { companyKey: 'goodco', reporterUid: 'u1', jobKey: 'x' },
]);

describe('candidate digest — email is a separate opt-in (v283 split)', () => {
  test('email opt-in is strict: only the *Email sub-toggle (true) authorises email', () => {
    assert.equal(wantsEmail(wantsAll, 'newJobMatches'), true);
    assert.equal(wantsEmail(base, 'newJobMatches'), false, 'empty prefs never email');
    assert.equal(wantsEmail({ preferences: { newJobMatches: true } }, 'newJobMatches'), false, 'the IN-APP toggle does NOT authorise email');
    assert.equal(wantsEmail({ preferences: { newJobMatchesEmail: false } }, 'newJobMatches'), false, 'explicit false = no email');
  });

  test('eligibility: opted into ≥1 email section + contactable', () => {
    assert.equal(eligible(wantsAll), true);
    assert.equal(eligible(base), false, 'in-app defaults on, but no email opt-in → not eligible');
    assert.equal(eligible({ ...base, preferences: { newJobMatches: true, ghostRiskAlerts: true } }), false, 'in-app toggles on, email off → not eligible');
    assert.equal(eligible({ ...wantsAll, emailOptOut: true }), false, 'global opt-out is skipped');
    assert.equal(eligible({ ...wantsAll, email: '', resume: { ...resume, contact: '' } }), false, 'no address is skipped');
  });

  test('contactable = address AND not globally unsubscribed (canonical emailUnsub honored)', () => {
    assert.equal(contactable(wantsAll), true);
    assert.equal(contactable({ ...wantsAll, emailOptOut: true }), false, 'legacy emailOptOut');
    assert.equal(contactable({ ...wantsAll, emailUnsub: true }), false, 'canonical /api/unsubscribe flag beats every opt-in');
    assert.equal(contactable({ ...wantsAll, preferences: { ...wantsAll.preferences, emailUnsub: true } }), false, 'preferences.emailUnsub also honored');
    assert.equal(eligible({ ...wantsAll, emailUnsub: true }), false, 'a globally unsubscribed opt-in candidate is NOT eligible');
    assert.equal(contactable({ preferences: wantsAll.preferences, resume: {} }), false, 'no address');
  });

  test('emailOf extracts an address from resume.contact or profile.email', () => {
    assert.equal(emailOf({ resume: { contact: 'Jane Doe · jane@co.com · Houston' } }), 'jane@co.com');
    assert.equal(emailOf({ email: 'x@y.com' }), 'x@y.com');
    assert.equal(emailOf({ resume: {} }), '');
  });

  test('SECTION A matches — shared scorer, in-field only, ranked, floored', () => {
    const tops = topMatches(wantsAll, pool);
    assert.ok(tops.length >= 2, 'the two marketing roles match');
    assert.ok(tops.every((t) => /marketing/i.test(t.job.title)), 'the data-entry role never surfaces');
    assert.ok(tops[0].score >= 55, 'above the deck floor');
    assert.ok(tops[0].score >= tops[tops.length - 1].score, 'ranked high→low');
  });

  test('SECTION B ghost-risk — only APPLIED companies at/over the report threshold', () => {
    const gr = ghostRiskApplied(wantsAll, riskMap);
    assert.equal(gr.length, 1, 'only ShadyCo (3 reports) — GoodCo has just 1');
    assert.equal(gr[0].company, 'ShadyCo');
    assert.equal(gr[0].reports, 3);
    assert.equal(ghostRiskApplied({ lists: { applied: [{ co: 'Never-Applied-Elsewhere' }] } }, riskMap).length, 0, 'a flagged company you did NOT apply to is not surfaced');
  });

  test('SECTION C rate reminders — applied, unrated, aged; skips rated/fresh/placeholder', () => {
    const rr = rateReminders(wantsAll, now);
    assert.ok(rr.some((c) => c.company === 'GoodCo'), 'nudges an applied-but-unrated company');
    assert.ok(!rr.some((c) => c.company === 'RatedCo'), 'never nudges an already-rated company');
    assert.ok(!rr.some((c) => c.company === 'FreshCo'), 'skips a too-fresh application');
  });

  test('buildDigest respects per-section opt-in and returns null when nothing to send', () => {
    const onlyGhost = buildDigest({ ...base, preferences: { ghostRiskAlertsEmail: true } }, pool, riskMap, now);
    assert.ok(onlyGhost && onlyGhost.ghost && !onlyGhost.matches && !onlyGhost.rate, 'only the opted section is built');
    assert.equal(buildDigest(base, pool, riskMap, now), null, 'no opt-in → nothing to send');
    const all = buildDigest(wantsAll, pool, riskMap, now);
    assert.ok(all && all.matches && all.ghost && all.rate, 'all three when opted in with content');
  });

  test('batched email is honest — sections, unsubscribe line, no undefined; subject summarises', () => {
    const html = digestHtml('Aaliyah', buildDigest(wantsAll, pool, riskMap, now));
    assert.match(html, /Aaliyah/);
    assert.match(html, /% match/);
    assert.match(html, /ShadyCo/);
    assert.match(html, /GoodCo/);
    assert.match(html, /Turn it off anytime/, 'off/unsubscribe path present');
    assert.match(html, /never sell your data/);
    assert.match(html, /Also email me/, 'explains WHY they received it');
    assert.ok(!/undefined/.test(html), 'no undefined leaks into the email');
    const subj = subjectFor(buildDigest(wantsAll, pool, riskMap, now));
    assert.match(subj, /new match/);
    assert.match(subj, /ghost-risk/);
    assert.match(subj, /rate/);
  });

  test('digestHtml back-compat: an array arg renders matches-only', () => {
    assert.match(digestHtml('Z', topMatches(wantsAll, pool)), /% match/);
  });
});
