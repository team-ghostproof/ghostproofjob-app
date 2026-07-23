// ============================================================================
// GhostProofJob — "an employer reached out" email tests (v151). Pure-JS.
// Proves the candidate is told an employer is interested WITHOUT leaking any
// contact (they stay anonymous until they respond), text is escaped, and every
// send carries the CAN-SPAM footer. Auth + send-once live in api/reachout-email.js.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildReachoutEmail } = require('../../api/reachout-email.js');

describe('reach-out email — content + privacy', () => {
  test('names the company + role and nudges to respond in-app', () => {
    const { subject, html } = buildReachoutEmail({ company: 'Acme Corp', jobTitle: 'Ops Lead', hasSlots: true, unsubUrl: 'https://x/u?u=cand1' });
    assert.match(subject, /Acme Corp reached out about Ops Lead/);
    assert.match(html, /Acme Corp reached out/);
    assert.match(html, /Ops Lead/);
    assert.match(html, /proposed interview times/);      // hasSlots hint
    assert.match(html, /View the message/);              // CTA into the app
  });
  test('stays ANONYMOUS — reveals no candidate contact, and reassures on privacy', () => {
    const { html } = buildReachoutEmail({ company: 'Acme', jobTitle: 'Ops' });
    // the only email address present is the support footer — never a candidate/recruiter one
    const withoutFooter = html.replace(/support@ghostproofjob\.com/g, '');
    assert.doesNotMatch(withoutFooter, /@/);
    assert.match(html, /anonymous until you/i);
  });
  test('no-slots variant omits the times hint', () => {
    const { html } = buildReachoutEmail({ company: 'Acme', jobTitle: 'Ops', hasSlots: false });
    assert.doesNotMatch(html, /proposed interview times/);
  });
  test('escapes company/role (no HTML injection from a posting)', () => {
    const { html } = buildReachoutEmail({ company: 'A&B <Corp>', jobTitle: '<script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /A&amp;B/);
  });
  test('always carries the unsubscribe + real contact footer (CAN-SPAM)', () => {
    const { html } = buildReachoutEmail({ company: 'Acme', jobTitle: 'Ops', unsubUrl: 'https://ghostproofjob.com/api/unsubscribe?u=abc' });
    assert.match(html, /unsubscribe\?u=abc/);
    assert.match(html, /\(281\) 915-9482/);
    assert.match(html, /support@ghostproofjob\.com/);
  });
  test('degrades gracefully with missing fields', () => {
    const { subject, html } = buildReachoutEmail({});
    assert.doesNotMatch(html, /undefined|null/);
    assert.doesNotMatch(subject, /undefined|null/);
    assert.match(html, /An employer reached out/);
  });
});
