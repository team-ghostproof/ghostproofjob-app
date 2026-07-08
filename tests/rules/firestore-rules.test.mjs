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
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT = 'gpj-rules-test';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // seed baseline with rules DISABLED
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'recruiters/recruiterA'), { company: 'Acme', isValidated: true, plan: 'free' });
    await setDoc(doc(db, 'recruiters/recruiterB'), { company: 'Globex', isValidated: true, plan: 'free' });
    await setDoc(doc(db, 'jobs/jobA'), { title: 'Ops', ownerUid: 'recruiterA', source: 'internal', isValidated: true });
    await setDoc(doc(db, 'jobs/jobB'), { title: 'Sales', ownerUid: 'recruiterB', source: 'internal', isValidated: true });
    await setDoc(doc(db, 'jobs/harvested1'), { title: 'Nurse', source: 'jobspy' });
    await setDoc(doc(db, 'profiles/candC'), { name: 'Cand C', contact: 'c@x.com' });
    await setDoc(doc(db, 'profiles/candD'), { name: 'Cand D', contact: 'd@x.com' });
    await setDoc(doc(db, 'jobs/jobA/applications/candC'), { status: 'applied' });
    await setDoc(doc(db, 'jobs/jobA/recommended_candidates/candC'), { score: 88 });
    await setDoc(doc(db, 'candidate_cards/candC'), { matchPct: 88, skills: ['ops'] });
    await setDoc(doc(db, 'match_tokens/candC'), { title: 'ops', skills: ['ops'] });
  });
});

after(async () => { if (env) await env.cleanup(); });

// auth contexts
const asRecruiterA = () => env.authenticatedContext('recruiterA', { email: 'a@acme.com' }).firestore();
const asRecruiterB = () => env.authenticatedContext('recruiterB', { email: 'b@globex.com' }).firestore();
const asCandC = () => env.authenticatedContext('candC', { email: 'c@x.com' }).firestore();
const asCandD = () => env.authenticatedContext('candD', { email: 'd@x.com' }).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

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

describe('appeals are admin-only', () => {
  test('recruiter CAN file an appeal they own', async () => {
    await assertSucceeds(setDoc(doc(asRecruiterA(), 'appeals/ap1'), { ownerUid: 'recruiterA', reason: 'not_applicant' }));
  });
  test('recruiter CANNOT read appeals (admin-only)', async () => {
    await assertFails(getDoc(doc(asRecruiterA(), 'appeals/ap1')));
  });
});
