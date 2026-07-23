// ============================================================================
// GhostProofJob — interview-confirmed email tests (v151). Pure-JS, no network.
// Proves both parties get the confirmed logistics + each other's contact, that
// job/company text is escaped, and every send carries the CAN-SPAM footer. The
// handler's auth + send-once are enforced in api/interview-email.js (server).
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildInterviewEmail, modalityLine } = require('../../api/interview-email.js');

describe('interview email — the candidate copy', () => {
  const { subject, html } = buildInterviewEmail({
    party: 'candidate', company: 'Acme Corp', jobTitle: 'Ops Lead', acceptedTime: 'Tue Aug 4 · 2pm CT',
    modality: 'virtual', details: { link: 'https://zoom.us/j/9' }, other: { name: 'Dana Lee', email: 'dana@acme.com' },
    unsubUrl: 'https://ghostproofjob.com/api/unsubscribe?u=cand1',
  });
  test('confirms the time + reveals the RECRUITER contact (mutual exchange)', () => {
    assert.match(subject, /Interview confirmed — Acme Corp/);
    assert.match(html, /Tue Aug 4 · 2pm CT/);
    assert.match(html, /zoom\.us\/j\/9/);
    assert.match(html, /dana@acme\.com/);
    assert.match(html, /Dana Lee/);
  });
  test('carries the unsubscribe + real contact footer (CAN-SPAM)', () => {
    assert.match(html, /unsubscribe\?u=cand1/);
    assert.match(html, /\(281\) 915-9482/);
    assert.match(html, /support@ghostproofjob\.com/);
  });
});

describe('interview email — the recruiter copy', () => {
  const { subject, html } = buildInterviewEmail({
    party: 'recruiter', company: 'Acme Corp', jobTitle: 'Ops Lead', acceptedTime: 'Tue 2pm',
    modality: 'phone', details: { phone: '281-555-0100', whoCalls: 'recruiter' },
    other: { name: 'Aaliyah S', email: 'a@cand.com', phone: '555-0000' }, unsubUrl: 'https://x/u',
  });
  test('names the candidate + reveals THEIR contact (they shared it by accepting)', () => {
    assert.match(subject, /Aaliyah S confirmed — Ops Lead/);
    assert.match(html, /a@cand\.com/);
    assert.match(html, /555-0000/);
  });
  test('phone modality states who calls whom', () => {
    assert.match(html, /281-555-0100/);
    assert.match(html, /they call you/);
  });
});

describe('interview email — safety + robustness', () => {
  test('escapes company/role/name text (no HTML injection)', () => {
    const { html } = buildInterviewEmail({ party: 'candidate', company: 'A&B <Corp>', jobTitle: '<script>alert(1)</script>', other: { name: '<b>x</b>' } });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /A&amp;B/);
  });
  test('degrades gracefully with missing fields (no undefined/null leaks)', () => {
    const { subject, html } = buildInterviewEmail({ party: 'candidate' });
    assert.doesNotMatch(html, /undefined|null/);
    assert.doesNotMatch(subject, /undefined|null/);
    assert.match(html, /the employer/);
  });
  test('modalityLine renders each modality, empty when none', () => {
    assert.match(modalityLine('inperson', { address: '100 Main St' }), /In person/);
    assert.match(modalityLine('inperson', { address: '100 Main St' }), /100 Main St/);
    assert.match(modalityLine('virtual', { link: 'https://m/x' }), /Virtual/);
    assert.match(modalityLine('phone', { phone: '5', whoCalls: 'candidate' }), /you call them/);
    assert.equal(modalityLine('', {}), '');
  });
});
