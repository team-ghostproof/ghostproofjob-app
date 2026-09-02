// P1-3 weekly candidate digest — the pure logic (eligibility, email extraction, matching
// with the SHARED card scorer, and honest email HTML). No creds/network needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, emailOf, topMatches, digestHtml } from '../../scripts/candidate_digest.mjs';

describe('P1-3 candidate digest', () => {
  const pool = [
    { title: 'Senior Lifecycle Marketing Manager', company: 'Talkiatry', location: 'Remote', is_remote: true, salary_min: 120000, description: 'Own lifecycle email campaigns, CRM, analytics, retention, segmentation.' },
    { title: 'Data Entry Clerk', company: 'Acme', location: 'Dallas, TX', description: 'Enter data into spreadsheets. Attention to detail.' },
    { title: 'Growth Marketing Manager', company: 'Northwind', location: 'Remote', is_remote: true, salary_min: 110000, description: 'Growth, lifecycle, retention, email, CRM, campaigns.' },
  ];
  const cand = { account: { first: 'Aaliyah' }, email: 'a@x.com', preferences: {}, resume: { title: 'Lifecycle Marketing Manager', skills: 'lifecycle, CRM, email, analytics, campaigns', jobs: [{ t: 'Marketing Manager', b: 'Ran lifecycle email + CRM' }] } };

  test('consent + eligibility gates', () => {
    assert.equal(eligible(cand), true);
    assert.equal(eligible({ ...cand, preferences: { newJobMatches: false } }), false, 'toggle off is skipped');
    assert.equal(eligible({ ...cand, emailOptOut: true }), false, 'global opt-out is skipped');
    assert.equal(eligible({ ...cand, email: '', resume: { ...cand.resume, contact: '' } }), false, 'no email is skipped');
    assert.equal(eligible({ preferences: {}, resume: {} }), false, 'no résumé is skipped');
  });

  test('emailOf extracts an address from resume.contact or profile.email', () => {
    assert.equal(emailOf({ resume: { contact: 'Jane Doe · jane@co.com · Houston' } }), 'jane@co.com');
    assert.equal(emailOf({ email: 'x@y.com' }), 'x@y.com');
    assert.equal(emailOf({ resume: {} }), '');
  });

  test('matches use the shared card scorer — in-field only, ranked, floored', () => {
    const tops = topMatches(cand, pool);
    assert.ok(tops.length >= 2, 'the two marketing roles match');
    assert.ok(tops.every((t) => /marketing/i.test(t.job.title)), 'the data-entry role never surfaces');
    assert.ok(tops[0].score >= 55, 'above the deck floor');
    assert.ok(tops[0].score >= tops[tops.length - 1].score, 'ranked high→low');
  });

  test('digest email is honest — name, score, unsubscribe line, no undefined', () => {
    const html = digestHtml('Aaliyah', topMatches(cand, pool));
    assert.match(html, /Aaliyah/);
    assert.match(html, /% match/);
    assert.match(html, /Turn it off anytime/, 'off/unsubscribe path present');
    assert.match(html, /never sell your data/);
    assert.ok(!/undefined/.test(html), 'no undefined leaks into the email');
  });
});
