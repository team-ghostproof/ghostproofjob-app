// ============================================================================
// GhostProofJob — recruiter domain-check unit tests (R1)
// Pure JS, no emulator — `node --test`. Proves free/consumer + disposable email
// domains are blocked and real company domains pass.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkRecruiterEmail, rejectionMessage } = require('../../api/recruiter/domainCheck.js');

describe('free / consumer providers are blocked', () => {
  for (const e of ['a@gmail.com', 'b@yahoo.com', 'c@outlook.com', 'd@hotmail.com', 'e@icloud.com', 'f@aol.com', 'g@proton.me']) {
    test(`${e} rejected as free_provider`, () => {
      const r = checkRecruiterEmail(e);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'free_provider');
    });
  }
});

describe('disposable / burner domains are blocked', () => {
  for (const e of ['x@mailinator.com', 'y@10minutemail.com', 'z@guerrillamail.com', 'q@yopmail.com', 'w@trashmail.com']) {
    test(`${e} rejected as disposable`, () => {
      const r = checkRecruiterEmail(e);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'disposable');
    });
  }
});

describe('real company domains pass', () => {
  for (const e of ['jane@stripe.com', 'hr@carollo.com', 'talent@idiq.com', 'recruiter@acme-corp.io', 'j.doe@sub.company.co.uk']) {
    test(`${e} accepted as corporate`, () => {
      const r = checkRecruiterEmail(e);
      assert.equal(r.ok, true, `${e} -> ${r.reason}`);
      assert.equal(r.reason, 'corporate');
    });
  }
});

describe('invalid input', () => {
  test('empty / malformed rejected', () => {
    assert.equal(checkRecruiterEmail('').reason, 'invalid');
    assert.equal(checkRecruiterEmail('not-an-email').reason, 'invalid');
    assert.equal(checkRecruiterEmail('a@localhost').reason, 'invalid');
  });
  test('rejectionMessage returns guidance per reason', () => {
    assert.match(rejectionMessage('free_provider'), /company email/i);
    assert.match(rejectionMessage('disposable'), /temporary|disposable/i);
    assert.match(rejectionMessage('invalid'), /valid company email/i);
  });
});
