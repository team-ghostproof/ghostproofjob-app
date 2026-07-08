// ============================================================================
// GhostProofJob — recruiter test fixtures (R0)
// Reusable seed/teardown for emulator-backed tests. EMULATOR ONLY — never point
// this at a live project. Respects "no demo data in live views": any live-flow
// test recruiter's jobs stay isValidated:false and are torn down.
// ============================================================================
import { doc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';

// A self-contained recruiter world: one company, two internal jobs, one matched
// candidate + application + backend projection docs.
export const FIXTURE = {
  recruiterUid: 'fx_recruiterA',
  recruiterEmail: 'a@fixture-acme.com',
  companyId: 'fx_acme',
  candidateUid: 'fx_candC',
  jobs: {
    local: { id: 'fx_jobLocal', title: 'Operations Specialist', market: 'Houston, TX', is_remote: false },
    remote: { id: 'fx_jobRemote', title: 'Marketing Manager', market: 'United States', is_remote: true },
  },
};

/** Seed the fixture world with rules DISABLED (backend-shaped writes). */
export async function seedFixtures(ctx) {
  const db = ctx.firestore();
  const f = FIXTURE;
  await setDoc(doc(db, `recruiters/${f.recruiterUid}`), {
    company: 'Acme (fixture)', isValidated: true, plan: 'free', role: 'recruiter',
  });
  await setDoc(doc(db, `companies/${f.companyId}`), {
    name: 'Acme (fixture)', verifiedEmployer: true, responsivenessRate: null,
  });
  for (const j of Object.values(f.jobs)) {
    await setDoc(doc(db, `jobs/${j.id}`), {
      title: j.title, ownerUid: f.recruiterUid, companyId: f.companyId,
      source: 'internal', status: 'open', isValidated: true, market: j.market, is_remote: j.is_remote,
    });
  }
  await setDoc(doc(db, `profiles/${f.candidateUid}`), { name: 'Cand C', contact: 'c@fixture.com', discoverable: false });
  await setDoc(doc(db, `jobs/${f.jobs.local.id}/applications/${f.candidateUid}`), { status: 'applied', when: Date.now() });
  await setDoc(doc(db, `jobs/${f.jobs.local.id}/recommended_candidates/${f.candidateUid}`), { score: 82, applied: true });
  await setDoc(doc(db, `candidate_cards/${f.candidateUid}`), { matchPct: 82, skills: ['operations'], contactRevealed: true });
  await setDoc(doc(db, `match_tokens/${f.candidateUid}`), { title: 'operations specialist', skills: ['operations', 'inventory'] });
}

/** Remove everything the fixtures created (idempotent). */
export async function teardownFixtures(ctx) {
  const db = ctx.firestore();
  const f = FIXTURE;
  const rm = (p) => deleteDoc(doc(db, p)).catch(() => {});
  // subcollections first
  for (const j of Object.values(f.jobs)) {
    const apps = await getDocs(collection(db, `jobs/${j.id}/applications`)).catch(() => ({ forEach: () => {} }));
    apps.forEach && apps.forEach((d) => rm(`jobs/${j.id}/applications/${d.id}`));
    const recs = await getDocs(collection(db, `jobs/${j.id}/recommended_candidates`)).catch(() => ({ forEach: () => {} }));
    recs.forEach && recs.forEach((d) => rm(`jobs/${j.id}/recommended_candidates/${d.id}`));
    await rm(`jobs/${j.id}`);
  }
  await rm(`recruiters/${f.recruiterUid}`);
  await rm(`companies/${f.companyId}`);
  await rm(`profiles/${f.candidateUid}`);
  await rm(`candidate_cards/${f.candidateUid}`);
  await rm(`match_tokens/${f.candidateUid}`);
}
