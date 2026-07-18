// ============================================================================
// GhostProofJob — Firestore Security Rules test suite (R0)
// Proves the recruiter-tier isolation invariants against firestore.rules using
// the Firestore emulator. The boot harness does NOT exercise rules — this is the
// only real proof of privacy isolation (recruiter-tier.md §7.4).
//
// RUN:  npm run test:rules
//   (starts the Firestore emulator; needs Java + firebase-tools. Runs in CI via
//    .github/workflows/rules.yml. Local Windows dev without Java: run in CI.)
// ============================================================================
import { test, before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';

const PROJECT = 'gpj-rules-test';
let env;

// Seed the baseline fixtures with rules DISABLED. Called once at startup AND before
// every test — tests mutate shared docs (jobC admin-approval, ro1/roRej responses,
// etc.), so without a per-test reset one describe's writes leak into the next and
// cause false failures (this is what silently broke CI from v102 onward).
async function seedBaseline() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'recruiters/recruiterA'), { company: 'Acme', domain: 'acme.com', isValidated: true, plan: 'free' });
    await setDoc(doc(db, 'recruiters/recruiterB'), { company: 'Globex', domain: 'globex.com', isValidated: true, plan: 'free' });
    await setDoc(doc(db, 'recruiters/recruiterPending'), { company: 'NewCo', domain: 'newco.com', isValidated: false, plan: 'free' });   // v101a #2: awaiting the admin queue; v101b Sprint 3: unverified recruiter for projection-gate tests
    // v112 team: a STANDARD member at acme.com + a pending invite. recruiterA is a
    // LEGACY owner doc (no companyId/role) on purpose — it must still count as admin.
    await setDoc(doc(db, 'recruiters/standardS'), { company: 'Acme', domain: 'acme.com', companyId: 'acme.com', role: 'standard', isValidated: true, plan: 'free' });
    await setDoc(doc(db, 'company_invites/inv1'), { companyId: 'acme.com', company: 'Acme', email: 'newhire@acme.com', role: 'standard', invitedBy: 'recruiterA', status: 'pending', ts: 1, inheritValidated: true, plan: 'free' });
    try { await deleteDoc(doc(db, 'recruiters/newHireU')); } catch (e) { /* fresh each test */ }
    try { await deleteDoc(doc(db, 'recruiters/strangerU')); } catch (e) { /* fresh each test */ }
    await setDoc(doc(db, 'companies/acme.com'), { name: 'Acme', domain: 'acme.com', verifiedEmployer: false });
    await setDoc(doc(db, 'jobs/jobA'), { title: 'Ops', ownerUid: 'recruiterA', source: 'internal', isValidated: true });
    await setDoc(doc(db, 'jobs/jobB'), { title: 'Sales', ownerUid: 'recruiterB', source: 'internal', isValidated: true });
    // v101b Sprint 3: a DRAFT internal job (unvalidated) to test the self-verify lock
    await setDoc(doc(db, 'jobs/jobC'), { title: 'Draft', ownerUid: 'recruiterA', source: 'internal', isValidated: false, companyId: 'acme.com' });
    // R9-D: a LIVE internal job (active:true) owned by recruiterA, to test close/deactivate
    await setDoc(doc(db, 'jobs/jobLive'), { title: 'Live Role', ownerUid: 'recruiterA', source: 'internal', isValidated: true, active: true, companyId: 'acme.com' });
    // v101b Sprint 3: an existing anonymous hired doc for read tests
    await setDoc(doc(db, 'hired/h1'), { roleKey: 'ops', titleRaw: 'Ops', skills: ['ops'], region: 'TX', ts: 1 });
    await setDoc(doc(db, 'jobs/harvested1'), { title: 'Nurse', source: 'jobspy' });
    await setDoc(doc(db, 'profiles/candC'), { name: 'Cand C', contact: 'c@x.com' });
    await setDoc(doc(db, 'profiles/candD'), { name: 'Cand D', contact: 'd@x.com' });
    await setDoc(doc(db, 'jobs/jobA/applications/candC'), { status: 'applied' });
    await setDoc(doc(db, 'jobs/jobA/recommended_candidates/candC'), { score: 88 });
    await setDoc(doc(db, 'candidate_cards/candC'), { matchPct: 88, skills: ['ops'] });
    await setDoc(doc(db, 'match_tokens/candC'), { title: 'ops', skills: ['ops'] });   // candC is DISCOVERABLE (token exists) + applied to jobA
    await setDoc(doc(db, 'reachouts/ro1'), { fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'reachout', status: 'sent', ts: 1 });
    await setDoc(doc(db, 'reachouts/roRej'), { fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'rejection', status: 'sent', ts: 1 });
    // referral docs start ABSENT each test (they're keyed by the invitee uid, so a
    // prior test's create would otherwise turn the next "create" into an update).
    try { await deleteDoc(doc(db, 'referrals/candC')); } catch (e) { /* not present */ }
    try { await deleteDoc(doc(db, 'referrals/candD')); } catch (e) { /* not present */ }
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  await seedBaseline();
});

// Per-test reset: OVERWRITE the baseline docs back to their seeded state before each
// test, so a test that mutates a shared seeded doc (e.g. admin approving jobC, or a
// candidate responding to ro1/roRej) can't leak into a later test. We deliberately do
// NOT clearFirestore() — a few describes (F-GHOST gr1) intentionally create a doc in
// one test and assert its immutability/readability in the next, which a wipe would
// turn into an allowed create and break. Re-seeding is idempotent and touches only
// baseline docs, leaving those intentional cross-test creations intact.
beforeEach(async () => {
  await seedBaseline();
});

after(async () => { if (env) await env.cleanup(); });

// auth contexts
const asRecruiterA = () => env.authenticatedContext('recruiterA', { email: 'a@acme.com' }).firestore();
const asRecruiterB = () => env.authenticatedContext('recruiterB', { email: 'b@globex.com' }).firestore();
const asRecruiterPending = () => env.authenticatedContext('recruiterPending', { email: 'p@newco.com' }).firestore();   // v101b Sprint 3: exists but isValidated:false
const asStandard = () => env.authenticatedContext('standardS', { email: 's@acme.com' }).firestore();                   // v112: standard teammate
const asNewHire = () => env.authenticatedContext('newHireU', { email: 'newhire@acme.com' }).firestore();               // v112: the invited address
const asStranger = () => env.authenticatedContext('strangerU', { email: 'x@evil.com' }).firestore();                   // v112: not invited
const asCandC = () => env.authenticatedContext('candC', { email: 'c@x.com' }).firestore();
const asCandD = () => env.authenticatedContext('candD', { email: 'd@x.com' }).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();
const asAdmin = () => env.authenticatedContext('adminUser', { email: 'asosa@ghostproofjob.com' }).firestore();   // v101a #2

describe('recruiter isolation', () => {
  test('recruiter CAN read applications for their OWN job', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'jobs/jobA/applications/candC')));
  });
  test('recruiter CANNOT read another recruiter\'s job applications', async () => {
    await assertFails(getDoc(doc(asRecruiterB(), 'jobs/jobA/applications/candC')));
  });
  test('recruiter CANNOT read a raw candidate profile', async () => {
    await assertFails(getDoc(doc(asRecruiterA(), 'profiles/candC')));
  });
  test('recruiter CAN read their own job\'s recommended_candidates', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'jobs/jobA/recommended_candidates/candC')));
  });
  test('recruiter CANNOT read another recruiter\'s recommended_candidates', async () => {
    await assertFails(getDoc(doc(asRecruiterB(), 'jobs/jobA/recommended_candidates/candC')));
  });
  test('recruiter CAN read the curated candidate_cards projection', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'candidate_cards/candC')));
  });
});

describe('candidate isolation', () => {
  test('candidate CAN read their own application', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'jobs/jobA/applications/candC')));
  });
  test('candidate CANNOT read another candidate\'s application', async () => {
    await assertFails(getDoc(doc(asCandD(), 'jobs/jobA/applications/candC')));
  });
  test('candidate CAN read their own profile', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'profiles/candC')));
  });
  test('candidate CANNOT read another candidate\'s profile', async () => {
    await assertFails(getDoc(doc(asCandD(), 'profiles/candC')));
  });
});

// v101a #2 (founder live repro: `adminPendingRecruiters Missing or insufficient
// permissions`): the EXACT query the admin Employer Verification Queue runs must
// succeed for an admin and fail for everyone else. The repo rules already grant
// it — the live console was running the pre-R0 rules (no recruiters block at
// all → default deny), so the real fix is DEPLOYING firestore.rules; these
// cases prove the deployed file behaves correctly.
describe('admin verification queue (v101a #2)', () => {
  const pendingQ = (db) => query(collection(db, 'recruiters'), where('isValidated', '==', false), limit(100));
  test('ADMIN can run the pending-recruiters queue query', async () => {
    const snap = await assertSucceeds(getDocs(pendingQ(asAdmin())));
    assert.equal(snap.size, 1, 'the seeded pending recruiter is returned');
  });
  test('a CANDIDATE cannot list recruiters', async () => {
    await assertFails(getDocs(pendingQ(asCandC())));
  });
  test('a RECRUITER cannot list other recruiters (own doc get only)', async () => {
    await assertFails(getDocs(pendingQ(asRecruiterA())));
  });
  test('a GUEST cannot list recruiters', async () => {
    await assertFails(getDocs(pendingQ(asGuest())));
  });
  test('ADMIN can read a recruiter doc directly (verify/reject target)', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'recruiters/recruiterPending')));
  });
  test('ADMIN can read companies (queue shows company records)', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'companies/acme.com')));
  });
});

describe('backend-only docs reject client writes', () => {
  test('client CANNOT write recommended_candidates', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobA/recommended_candidates/candC'), { score: 99 }));
  });
  test('client CANNOT write candidate_cards', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'candidate_cards/candC'), { matchPct: 1 }));
  });
  test('client CANNOT write match_tokens', async () => {
    await assertFails(setDoc(doc(asCandC(), 'match_tokens/candC'), { title: 'hack' }));
  });
  test('recruiter CANNOT self-flip isValidated', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'recruiters/recruiterA'), { company: 'Acme', isValidated: true, plan: 'scale' }));
  });
});

describe('jobs write scope', () => {
  test('recruiter CAN create their own internal job', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'jobs/newJobA'), { title: 'New', ownerUid: 'recruiterA', source: 'internal' }));
  });
  test('recruiter CANNOT create a job owned by someone else', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/spoof'), { title: 'X', ownerUid: 'recruiterB', source: 'internal' }));
  });
  test('recruiter CANNOT edit a harvested job', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/harvested1'), { title: 'tampered' }));
  });
  test('guest CANNOT create a job', async () => {
    await assertFails(setDoc(doc(asGuest(), 'jobs/guestJob'), { title: 'X', source: 'internal' }));
  });
  test('anyone CAN read the public job pool (candidate deck)', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'jobs/harvested1')));
  });
});

describe('R2-B — internal jobs are created HIDDEN, verified only by admin', () => {
  test('recruiter CAN create an internal job with active:false + isValidated:false', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'jobs/r2new'), { title: 'Ops', ownerUid: 'recruiterA', source: 'internal', active: false, isValidated: false }));
  });
  test('recruiter CANNOT create a job pre-activated (active:true)', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/r2active'), { title: 'Ops', ownerUid: 'recruiterA', source: 'internal', active: true, isValidated: false }));
  });
  test('recruiter CANNOT create a job pre-validated (isValidated:true)', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/r2val'), { title: 'Ops', ownerUid: 'recruiterA', source: 'internal', active: false, isValidated: true }));
  });
  test('recruiter CANNOT self-activate their draft job (active false->true)', async () => {
    // jobC seeded { ownerUid: recruiterA, source: internal, isValidated: false } (no active -> defaults false)
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), { title: 'Draft', ownerUid: 'recruiterA', source: 'internal', isValidated: false, companyId: 'acme.com', active: true }));
  });
  test('R9-D: owner CAN close a live role (active true->false) but NOT self-activate (false->true)', async () => {
    // close a live role
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'jobs/jobLive'), { title: 'Live Role', ownerUid: 'recruiterA', source: 'internal', isValidated: true, active: false, filled: true, companyId: 'acme.com' }));
    // cannot flip a draft live (self-activate)
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), { title: 'Draft', ownerUid: 'recruiterA', source: 'internal', isValidated: false, companyId: 'acme.com', active: true }));
  });
  test('ADMIN CAN approve a job -> active:true + isValidated:true', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'jobs/jobC'), { title: 'Draft', ownerUid: 'recruiterA', source: 'internal', isValidated: true, companyId: 'acme.com', active: true }));
  });
});

describe('appeals are admin-only', () => {
  test('recruiter CAN file an appeal they own', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'appeals/ap1'), { ownerUid: 'recruiterA', reason: 'not_applicant' }));
  });
  test('recruiter CANNOT read appeals (admin-only)', async () => {
    await assertFails(getDoc(doc(asRecruiterA(), 'appeals/ap1')));
  });
});

// ============================================================================
// v101b Sprint 3 — RULES HARDENING (pre-recruiter-R2 security)
// ============================================================================

describe('Sprint 3 — companies scoped write', () => {
  test('recruiter CAN create/update ONLY their own-domain company (verifiedEmployer:false)', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'companies/acme.com'), { name: 'Acme Renamed', domain: 'acme.com', verifiedEmployer: false }));
  });
  test('a PENDING (unverified) recruiter CAN still create their company at signup', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterPending(), 'companies/newco.com'), { name: 'NewCo', domain: 'newco.com', verifiedEmployer: false }));
  });
  test('recruiter CANNOT self-set verifiedEmployer:true', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'companies/acme.com'), { name: 'Acme', domain: 'acme.com', verifiedEmployer: true }));
  });
  test('recruiter CANNOT write another company than their domain', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'companies/globex.com'), { name: 'Spoof', domain: 'globex.com', verifiedEmployer: false }));
  });
  test('a candidate CANNOT write any company', async () => {
    await assertFails(setDoc(doc(asCandC(), 'companies/anything.com'), { name: 'X', verifiedEmployer: false }));
  });
  test('ADMIN can write any company incl. verifiedEmployer:true', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'companies/acme.com'), { name: 'Acme', domain: 'acme.com', verifiedEmployer: true }));
  });
  test('anyone CAN read a company record (public)', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'companies/acme.com')));
  });
});

describe('Sprint 3 — recruiter cannot self-verify / re-owner their job', () => {
  const draft = (over) => Object.assign({ title: 'Draft', ownerUid: 'recruiterA', source: 'internal', isValidated: false, companyId: 'acme.com' }, over);
  test('owner-recruiter CAN edit their draft job content (immutables unchanged)', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'jobs/jobC'), draft({ title: 'Edited Title' })));
  });
  test('owner-recruiter CANNOT flip isValidated true', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), draft({ isValidated: true })));
  });
  test('owner-recruiter CANNOT change ownerUid', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), draft({ ownerUid: 'recruiterB' })));
  });
  test('owner-recruiter CANNOT change source', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), draft({ source: 'jobspy' })));
  });
  test('owner-recruiter CANNOT change companyId', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'jobs/jobC'), draft({ companyId: 'other.com' })));
  });
  test('ADMIN CAN verify a job (set isValidated:true)', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'jobs/jobC'), draft({ isValidated: true })));
  });
});

describe('Sprint 3 — candidate projections require a VERIFIED recruiter', () => {
  test('UNVERIFIED recruiter CANNOT read candidate_cards', async () => {
    await assertFails(getDoc(doc(asRecruiterPending(), 'candidate_cards/candC')));
  });
  test('VERIFIED recruiter CAN read candidate_cards', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'candidate_cards/candC')));
  });
  test('UNVERIFIED recruiter CANNOT read match_tokens', async () => {
    await assertFails(getDoc(doc(asRecruiterPending(), 'match_tokens/candC')));
  });
  test('VERIFIED recruiter CAN read match_tokens', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'match_tokens/candC')));
  });
  test('the candidate CAN still read their OWN match_tokens', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'match_tokens/candC')));
  });
  test('UNVERIFIED recruiter CANNOT read recommended_candidates', async () => {
    await assertFails(getDoc(doc(asRecruiterPending(), 'jobs/jobA/recommended_candidates/candC')));
  });
  test('VERIFIED owner-recruiter CAN read their job recommended_candidates', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'jobs/jobA/recommended_candidates/candC')));
  });
  test('VERIFIED recruiter who is NOT the owner CANNOT read recommended_candidates', async () => {
    await assertFails(getDoc(doc(asRecruiterB(), 'jobs/jobA/recommended_candidates/candC')));
  });
});

describe('Sprint 3 — hired pool is anonymous (no PII)', () => {
  test('signed-in user CAN create an anonymous hired doc', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'hired/n1'), { roleKey: 'nurse', titleRaw: 'RN', skills: ['triage'], region: 'TX', ts: 2 }));
  });
  test('a hired doc carrying an email is REJECTED', async () => {
    await assertFails(setDoc(doc(asCandC(), 'hired/n2'), { roleKey: 'nurse', email: 'c@x.com', ts: 3 }));
  });
  test('a hired doc carrying a name is REJECTED', async () => {
    await assertFails(setDoc(doc(asCandC(), 'hired/n3'), { roleKey: 'nurse', name: 'Cand C', ts: 4 }));
  });
  test('a hired doc carrying uid/contact/phone is REJECTED', async () => {
    await assertFails(setDoc(doc(asCandC(), 'hired/n4'), { roleKey: 'nurse', uid: 'candC', ts: 5 }));
  });
  test('signed-in user CAN read the aggregate pool', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'hired/h1')));
  });
  test('a GUEST cannot create or read hired', async () => {
    await assertFails(setDoc(doc(asGuest(), 'hired/g1'), { roleKey: 'x', ts: 6 }));
    await assertFails(getDoc(doc(asGuest(), 'hired/h1')));
  });
});

describe('F-GHOST — cross-user ghost reports (shape-locked, no free-text)', () => {
  const ok = { company: 'Vaporware Staffing', companyKey: 'vaporware staffing', stage: 'After applying', ts: 1, reporterUid: 'candC' };
  test('signed-in user CAN file a shape-valid report as themselves', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'ghost_reports/gr1'), ok));
  });
  test('a report with a free-text comment key is REJECTED (no defamation stored)', async () => {
    await assertFails(setDoc(doc(asCandC(), 'ghost_reports/gr2'), Object.assign({}, ok, { comment: 'they are a scam' })));
  });
  test('a report spoofing another reporterUid is REJECTED', async () => {
    await assertFails(setDoc(doc(asCandC(), 'ghost_reports/gr3'), Object.assign({}, ok, { reporterUid: 'candD' })));
  });
  test('a GUEST cannot file a report', async () => {
    await assertFails(setDoc(doc(asGuest(), 'ghost_reports/gr4'), ok));
  });
  test('signed-in user CAN read (for the count aggregation)', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'ghost_reports/gr1')));
  });
  test('reports are immutable — no update or delete', async () => {
    await assertFails(setDoc(doc(asCandC(), 'ghost_reports/gr1'), Object.assign({}, ok, { stage: 'edited' })));
    await assertFails(deleteDoc(doc(asCandC(), 'ghost_reports/gr1')));
  });
});

describe('R5 — outreach is consent-gated + anti-ghost audited', () => {
  const ro = (over) => Object.assign({ fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'reachout', status: 'sent', ts: 2 }, over);
  test('VERIFIED recruiter CAN reach a DISCOVERABLE/applied candidate for their job', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'reachouts/r2new'), ro()));
  });
  test('VERIFIED recruiter can send a REJECTION to an applicant (anti-ghosting)', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'reachouts/r2rej'), ro({ kind: 'rejection' })));
  });
  test('recruiter CANNOT reach a candidate who is neither discoverable nor applied', async () => {
    // candD has a profile but NO match_token and NO application
    await assertFails(setDoc(doc(asRecruiterA(), 'reachouts/r2bad'), ro({ toCandidateUid: 'candD' })));
  });
  test('an UNVERIFIED recruiter CANNOT reach out', async () => {
    await assertFails(setDoc(doc(asRecruiterPending(), 'reachouts/r2unv'), ro({ fromRecruiterUid: 'recruiterPending' })));
  });
  test('cannot spoof the sender or create pre-answered', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'reachouts/r2spoof'), ro({ fromRecruiterUid: 'recruiterB' })));
    await assertFails(setDoc(doc(asRecruiterA(), 'reachouts/r2pre'), ro({ status: 'interested' })));
  });
  test('the recipient candidate CAN read + respond (status only); others cannot read', async () => {
    await assertSucceeds(getDoc(doc(asCandC(), 'reachouts/ro1')));
    await assertSucceeds(setDoc(doc(asCandC(), 'reachouts/ro1'), ro({ status: 'interested', respondedAt: 3 }), { merge: true }));
    await assertFails(getDoc(doc(asCandD(), 'reachouts/ro1')));
  });
  test('the candidate CANNOT rewrite the sender/job, and NO ONE deletes (audit)', async () => {
    await assertFails(setDoc(doc(asCandC(), 'reachouts/ro1'), { fromRecruiterUid: 'candC', toCandidateUid: 'candC', jobId: 'jobA', kind: 'reachout', status: 'interested', ts: 1 }));
    await assertFails(deleteDoc(doc(asCandC(), 'reachouts/ro1')));
    await assertFails(deleteDoc(doc(asRecruiterA(), 'reachouts/ro1')));
  });
  // R7: accepting a proposed interview slot
  test('R7: recipient CAN accept a proposed interview slot (acceptedTime), bounded', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'reachouts/ro1'), ro({ status: 'interested', acceptedTime: 'Tue 2pm CT', respondedAt: 3 }), { merge: true }));
    await assertFails(setDoc(doc(asCandC(), 'reachouts/ro1'), ro({ status: 'interested', acceptedTime: 'x'.repeat(300) }), { merge: true }));
  });
  // R5 appeal: only against a rejection, bounded, and only by the recipient
  test('R5 appeal: recipient CAN appeal a REJECTION but NOT a plain reach-out', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'reachouts/roRej'), { fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'rejection', status: 'appealed', appealMessage: 'Please reconsider — I have the exact ATS stack.', appealedAt: 4 }, { merge: true }));
    // appealing a non-rejection reach-out is rejected by rules
    await assertFails(setDoc(doc(asCandC(), 'reachouts/ro1'), ro({ status: 'appealed', appealMessage: 'reconsider' }), { merge: true }));
  });
  test('R5 appeal: an over-long appeal message is rejected', async () => {
    await assertFails(setDoc(doc(asCandC(), 'reachouts/roRej'), { fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'rejection', status: 'appealed', appealMessage: 'x'.repeat(500) }, { merge: true }));
  });
  test('R5 appeal: a non-recipient cannot appeal on a candidate’s behalf', async () => {
    await assertFails(setDoc(doc(asCandD(), 'reachouts/roRej'), { fromRecruiterUid: 'recruiterA', toCandidateUid: 'candC', jobId: 'jobA', kind: 'rejection', status: 'appealed', appealMessage: 'let me in' }, { merge: true }));
  });
});

describe('v113 SECURITY — a user cannot buy themselves a tier for free', () => {
  // profiles allowed the owner to write ANY field, and isPaid() reads profiles.tier —
  // so a user could simply write tier:'life' and unlock the paywall. Entitlement +
  // money fields are now backend-only (Stripe webhook uses the admin SDK).
  test('a user CANNOT self-grant a paid tier on create or update', async () => {
    await assertFails(setDoc(doc(asCandD(), 'profiles/candD'), { name: 'D', tier: 'life' }));
    await assertFails(setDoc(doc(asCandC(), 'profiles/candC'), { tier: 'life' }, { merge: true }));
    await assertFails(setDoc(doc(asCandC(), 'profiles/candC'), { tier: 'month' }, { merge: true }));
  });
  test('a user CANNOT self-extend paidUntil or self-grant booster days', async () => {
    await assertFails(setDoc(doc(asCandC(), 'profiles/candC'), { paidUntil: Date.now() + 9e9 }, { merge: true }));
    await assertFails(setDoc(doc(asCandC(), 'profiles/candC'), { bonusDays: 999 }, { merge: true }));
    await assertFails(setDoc(doc(asCandC(), 'profiles/candC'), { stripeCustomerId: 'cus_hack' }, { merge: true }));
  });
  test('normal profile edits still work (name, prefs, discoverable, booster REQUEST)', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'profiles/candC'), { name: 'Cand C', discoverable: true, pending_boost: true }, { merge: true }));
  });
  test('an ADMIN can still grant a tier (the manual path), and the user can still delete their profile', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'profiles/candC'), { tier: 'life' }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(asCandD(), 'profiles/candD')));
  });
});

describe('v112 SECURITY — recruiter create cannot self-escalate', () => {
  // Pre-v112 `allow create` had NO field restrictions, so a crafted create could
  // self-set isValidated:true and gain verified-recruiter powers (candidate data!).
  const base = (over) => Object.assign({ company: 'Evil', domain: 'evil.com', plan: 'free', isValidated: false }, over);
  test('a crafted create CANNOT self-verify (the hole this closed)', async () => {
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ isValidated: true })));
  });
  test('a crafted create CANNOT self-assign a paid plan', async () => {
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ plan: 'pro' })));
  });
  test('a crafted create CANNOT claim ANOTHER company’s domain (would grant companies/{domain} writes)', async () => {
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ domain: 'acme.com', companyId: 'acme.com' })));
  });
  test('a crafted create CANNOT self-create as admin or standard (only invites grant roles)', async () => {
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ role: 'admin' })));
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ role: 'standard' })));
  });
  test('an HONEST employer signup still works (own domain, unverified, free, owner)', async () => {
    await assertSucceeds(setDoc(doc(asStranger(), 'recruiters/strangerU'), base({ domain: 'evil.com', companyId: 'evil.com', role: 'owner' })));
  });
  test('a teammate CANNOT self-escalate their role on update', async () => {
    await assertFails(setDoc(doc(asStandard(), 'recruiters/standardS'), { role: 'admin' }, { merge: true }));
    await assertFails(setDoc(doc(asStandard(), 'recruiters/standardS'), { isValidated: true, plan: 'pro' }, { merge: true }));
  });
  test('a teammate CANNOT re-point their companyId at another company', async () => {
    await assertFails(setDoc(doc(asStandard(), 'recruiters/standardS'), { companyId: 'globex.com' }, { merge: true }));
  });
});

describe('v112 company team — invites are the only grant', () => {
  const inv = (over) => Object.assign({ companyId: 'acme.com', company: 'Acme', email: 'newhire@acme.com', role: 'standard', invitedBy: 'recruiterA', status: 'pending', ts: 2 }, over);
  test('a company admin (legacy owner doc) CAN invite; a STANDARD teammate cannot', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'company_invites/i2'), inv()));
    await assertFails(setDoc(doc(asStandard(), 'company_invites/i3'), Object.assign(inv(), { invitedBy: 'standardS' })));
  });
  test('an UNVERIFIED recruiter cannot invite, and nobody can invite into ANOTHER company', async () => {
    await assertFails(setDoc(doc(asRecruiterPending(), 'company_invites/i4'), Object.assign(inv(), { invitedBy: 'recruiterPending' })));
    await assertFails(setDoc(doc(asRecruiterB(), 'company_invites/i5'), Object.assign(inv(), { invitedBy: 'recruiterB' })));   // recruiterB is globex.com
  });
  test('an invite can never grant OWNER, and cannot be pre-accepted', async () => {
    await assertFails(setDoc(doc(asRecruiterA(), 'company_invites/i6'), inv({ role: 'owner' })));
    await assertFails(setDoc(doc(asRecruiterA(), 'company_invites/i7'), inv({ status: 'accepted' })));
  });
  test('ONLY the invited address may accept — a stranger with the link cannot', async () => {
    await assertFails(setDoc(doc(asStranger(), 'company_invites/inv1'), { email: 'newhire@acme.com', companyId: 'acme.com', role: 'standard', status: 'accepted' }, { merge: true }));
    await assertSucceeds(setDoc(doc(asNewHire(), 'company_invites/inv1'), { email: 'newhire@acme.com', companyId: 'acme.com', role: 'standard', status: 'accepted' }, { merge: true }));
  });
  test('the invited teammate CAN claim exactly the seat they were given', async () => {
    await assertSucceeds(setDoc(doc(asNewHire(), 'recruiters/newHireU'), {
      company: 'Acme', companyId: 'acme.com', role: 'standard', plan: 'free',
      isValidated: true, inviteId: 'inv1', domain: 'acme.com',
    }));
  });
  test('the invited teammate CANNOT upgrade the seat they were given', async () => {
    const claim = (over) => Object.assign({ company: 'Acme', companyId: 'acme.com', role: 'standard', plan: 'free', isValidated: true, inviteId: 'inv1', domain: 'acme.com' }, over);
    await assertFails(setDoc(doc(asNewHire(), 'recruiters/newHireU'), claim({ role: 'admin' })));      // invite said standard
    await assertFails(setDoc(doc(asNewHire(), 'recruiters/newHireU'), claim({ plan: 'pro' })));        // invite said free
    await assertFails(setDoc(doc(asNewHire(), 'recruiters/newHireU'), claim({ companyId: 'globex.com' })));
  });
  test('a stranger CANNOT redeem someone else’s invite id', async () => {
    await assertFails(setDoc(doc(asStranger(), 'recruiters/strangerU'), {
      company: 'Acme', companyId: 'acme.com', role: 'standard', plan: 'free', isValidated: true, inviteId: 'inv1', domain: 'evil.com',
    }));
  });
  test('company INFO is admin-scoped: admin can write it, a standard teammate cannot', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'companies/acme.com'), { name: 'Acme Renamed', verifiedEmployer: false }, { merge: true }));
    await assertFails(setDoc(doc(asStandard(), 'companies/acme.com'), { name: 'Standard Was Here', verifiedEmployer: false }, { merge: true }));
  });
  test('teammates can see each other; an outside recruiter cannot', async () => {
    await assertSucceeds(getDoc(doc(asRecruiterA(), 'recruiters/standardS')));
    await assertFails(getDoc(doc(asRecruiterB(), 'recruiters/standardS')));
  });
});

describe('Referral engine — invitee-owned, no self-referral', () => {
  const rec = (over) => Object.assign({ referrerCode: 'candD', inviteeUid: 'candC', onboarded: false, ts: 2 }, over);
  test('a new invitee CAN record who referred them (their own uid doc)', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'referrals/candC'), rec()));
  });
  test('you CANNOT refer yourself', async () => {
    await assertFails(setDoc(doc(asCandC(), 'referrals/candC'), rec({ referrerCode: 'candC' })));
  });
  test('you CANNOT create a referral doc under someone else’s uid', async () => {
    await assertFails(setDoc(doc(asCandC(), 'referrals/candD'), rec({ inviteeUid: 'candD' })));
  });
  test('a referral cannot be created pre-onboarded (must earn the reward)', async () => {
    await assertFails(setDoc(doc(asCandC(), 'referrals/candC'), rec({ onboarded: true })));
  });
  test('the invitee CAN flip their own referral to onboarded, but NOT change the referrer', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'referrals/candC'), rec()));                                   // create first
    await assertSucceeds(setDoc(doc(asCandC(), 'referrals/candC'), rec({ onboarded: true }), { merge: true }));
    await assertFails(setDoc(doc(asCandC(), 'referrals/candC'), rec({ referrerCode: 'candX', onboarded: true }), { merge: true }));
  });
  test('the referrer CAN read referrals bearing their code; others cannot; no deletes', async () => {
    await assertSucceeds(setDoc(doc(asCandC(), 'referrals/candC'), rec()));   // candC referred by candD
    await assertSucceeds(getDoc(doc(asCandD(), 'referrals/candC')));          // candD is the referrerCode
    await assertFails(getDoc(doc(asRecruiterB(), 'referrals/candC')));
    await assertFails(deleteDoc(doc(asCandC(), 'referrals/candC')));
  });
});

// ============================================================================
// v123: account deletion — a user may delete their OWN docs, nobody else's.
// Self-contained fixtures (unique ids) so the shared-seed baseline is untouched.
// ============================================================================
describe('v123: delete-my-account — own docs only', () => {
  test('a user deletes their OWN profile + recruiter doc; strangers/teammates cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const dbx = ctx.firestore();   // ONE call — a second ctx.firestore() re-applies settings and throws
      await setDoc(doc(dbx, 'profiles/delme1'), { name: 'X' });
      await setDoc(doc(dbx, 'recruiters/delrec1'), { company: 'DelCo', companyId: 'delco.com', isValidated: true, role: 'standard' });
      await setDoc(doc(dbx, 'recruiters/delrec2'), { company: 'DelCo', companyId: 'delco.com', isValidated: true, role: 'owner' });
    });
    await assertFails(deleteDoc(doc(env.authenticatedContext('stranger9').firestore(), 'profiles/delme1')));
    await assertSucceeds(deleteDoc(doc(env.authenticatedContext('delme1').firestore(), 'profiles/delme1')));
    await assertFails(deleteDoc(doc(env.authenticatedContext('delrec2').firestore(), 'recruiters/delrec1')));
    await assertSucceeds(deleteDoc(doc(env.authenticatedContext('delrec1').firestore(), 'recruiters/delrec1')));
  });
});
