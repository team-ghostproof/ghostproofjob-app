// ============================================================================
// GhostProofJob — post-apply email tests (v128). Pure-JS, no network.
// Proves the encouragement email body is honest, escaped, and personalized;
// the handler is wired for suppression + a daily cap (verified in api/apply-email).
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mod = require('../../api/apply-email.js');
const { buildApplyEmail, DAILY_CAP } = mod;

describe('post-apply encouragement email — content', () => {
  test('personalizes with name/role/company/market and never invents stats', () => {
    const { subject, html } = buildApplyEmail({ firstName: 'Aaliyah', jobTitle: 'Marketing Manager', company: 'GPJ', market: 'Houston, TX', unsubUrl: 'https://x/u' });
    assert.match(html, /Nice work Aaliyah/);
    assert.match(html, /Marketing Manager/);
    assert.match(html, /at GPJ/);
    assert.match(html, /in Houston, TX/);
    assert.match(subject, /Marketing Manager/);
    // no fabricated numbers/percentages of any kind
    assert.doesNotMatch(html, /\d+\s*%/);
  });
  test('degrades gracefully with missing fields', () => {
    const { html } = buildApplyEmail({});
    assert.match(html, /you applied for <b>this role<\/b>/);
    assert.doesNotMatch(html, /undefined|null/);
  });
  test('escapes job-sourced text (no HTML injection from a posting)', () => {
    const { html } = buildApplyEmail({ jobTitle: '<script>alert(1)</script>', company: 'A&B <Corp>' });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /A&amp;B/);
  });
  test('always carries an unsubscribe link + the real contact footer (CAN-SPAM)', () => {
    const { html } = buildApplyEmail({ jobTitle: 'X', unsubUrl: 'https://ghostproofjob.com/api/unsubscribe?u=abc' });
    assert.match(html, /unsubscribe\?u=abc/);
    assert.match(html, /\(281\) 915-9482/);
    assert.match(html, /support@ghostproofjob\.com/);
  });
  test('a sane daily cap is exported', () => {
    assert.ok(DAILY_CAP >= 1 && DAILY_CAP <= 10);
  });
});
