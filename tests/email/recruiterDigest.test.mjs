// Weekly employer digest — pure logic (per-toggle email opt-in, section builders from real
// data, honest responsiveness metric, batched HTML). No creds/network.
//
// v286 contract: email is a SEPARATE opt-in from the in-app bell. The four "Also email me"
// sub-toggles (preferences.rec*Email) DEFAULT OFF; the in-app toggles drive the bell only and
// NEVER authorise email. This suite locks that split in.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligible, wantsEmail, contactable, emailOf, companyName,
  rolesSection, responsesSection, interviewsSection, reviewsSection, responsivenessLine,
  buildDigest, subjectFor, digestHtml, sampleSections,
} from '../../scripts/recruiter_digest.mjs';

const now = Date.now(), DAY = 86400000;
const roles = [
  { title: 'Ops Coordinator', isValidated: true, filled: false, applicants: 8 },
  { title: 'Old Role', isValidated: true, filled: true, applicants: 3 },
  { title: 'Draft Role', isValidated: false, filled: false, applicants: 1 },
];
const reachouts = [
  { status: 'interested', candidateName: 'A', jobTitle: 'Ops Coordinator', acceptedTs: now + 2 * DAY, acceptedTime: 'Tue' },
  { status: 'reschedule-requested', candidateName: 'B', jobTitle: 'Ops Coordinator' },
  { status: 'sent', candidateName: 'C' },
];
const prefs = { recNewApplicantsEmail: true, recResponsesEmail: true, recInterviewsEmail: true, recReviewsEmail: true };
const rec = { uid: 'r1', company: 'Brightline Logistics', email: 'hr@brightline.com', preferences: prefs };
const data = { roles, reachouts, replyCount: 6, ghostCount: 3, rating: 38 };

describe('employer digest — email is a separate opt-in (v286 split)', () => {
  test('email opt-in is strict: only the rec*Email sub-toggle authorises email', () => {
    assert.equal(wantsEmail(prefs, 'recNewApplicants'), true);
    assert.equal(wantsEmail({}, 'recNewApplicants'), false);
    assert.equal(wantsEmail({ recNewApplicants: true }, 'recNewApplicants'), false, 'the IN-APP toggle does NOT authorise email');
  });

  test('eligibility: opted into >=1 email section + contactable; canonical unsubscribe wins', () => {
    assert.equal(eligible(rec), true);
    assert.equal(eligible({ ...rec, preferences: {} }), false, 'no email opt-in → not eligible');
    assert.equal(eligible({ ...rec, preferences: { recNewApplicants: true } }), false, 'in-app toggle on, email off → not eligible');
    assert.equal(eligible({ ...rec, emailUnsub: true }), false, 'emailUnsub beats every opt-in');
    assert.equal(eligible({ ...rec, email: '' }), false, 'no address → not eligible');
    assert.equal(contactable({ ...rec, preferences: { ...prefs, emailUnsub: true } }), false, 'preferences.emailUnsub honored');
  });

  test('emailOf + companyName extract safely', () => {
    assert.equal(emailOf({ email: 'HR@Co.com' }), 'hr@co.com');
    assert.equal(emailOf({}), '');
    assert.equal(companyName({ company: 'Acme' }), 'Acme');
    assert.equal(companyName({}), 'your company');
  });

  test('section builders use only real data, correctly filtered', () => {
    const rs = rolesSection(roles);
    assert.equal(rs.openCount, 1, 'only open + validated roles');
    assert.equal(rs.total, 8, 'summed applicants');
    const resp = responsesSection(reachouts);
    assert.equal(resp.length, 2, 'A + B responded; C (sent) excluded');
    assert.ok(!resp.some((r) => r.who === 'C'));
    const iv = interviewsSection(reachouts, now);
    assert.equal(iv.length, 1, 'only confirmed interviews within 7 days');
    assert.equal(reviewsSection(0), null, 'no reports → null');
    assert.equal(reviewsSection(3, 38).reports, 3);
  });

  test('responsiveness = reply count, badge at 5+ (matches the app metric), honest', () => {
    assert.equal(responsivenessLine(6).earned, true);
    assert.equal(responsivenessLine(2).earned, false);
    assert.equal(responsivenessLine(0).count, 0);
    assert.match(responsivenessLine(6).text, /Anti-Ghosting Badge earned/);
  });

  test('buildDigest respects per-section opt-in; null when nothing to send', () => {
    const d = buildDigest(rec, data, now);
    assert.ok(d && d.roles && d.responses && d.interviews && d.reviews && d.responsiveness);
    assert.equal(buildDigest({ ...rec, preferences: {} }, data, now), null);
    const only = buildDigest({ ...rec, preferences: { recReviewsEmail: true } }, data, now);
    assert.ok(only && only.reviews && !only.roles && !only.responses, 'only opted section built');
  });

  test('batched email is honest — company, sections, no-sell + off lines, no undefined; subject summarises', () => {
    const html = digestHtml('Brightline Logistics', buildDigest(rec, data, now));
    assert.match(html, /Brightline Logistics/);
    assert.match(html, /Ops Coordinator/);
    assert.match(html, /Anti-Ghosting/);
    assert.match(html, /never sell candidate contact/);
    assert.match(html, /Turn it off anytime/);
    assert.ok(!/undefined/.test(html));
    const subj = subjectFor(buildDigest(rec, data, now), 'Brightline Logistics');
    assert.match(subj, /applicant/);
    assert.match(subj, /awaiting/);
  });

  test('sampleSections renders a full representative digest', () => {
    assert.match(digestHtml('X', sampleSections()), /Operations Coordinator/);
  });
});
