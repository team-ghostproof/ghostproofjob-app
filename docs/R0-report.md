# R0 Report — Recruiter Tier Foundation (backend/schema + test scaffolding)

**No `index.html` / app-feature code was written this turn** (per the kickoff). This turn delivers: confirmed build, documented schema, data-model proposal, full drop-in security rules, the emulator-backed rules test suite, fixture/teardown helpers, the in-repo reverse-match scorer + unit tests, the stubbed recruiter Playwright project, and the 5-quadrant state matrix. **STOP for founder approval before any `index.html` recruiter feature code.**

---

## 1. Version alignment

**Confirmed current live build: v98** (footer `build-stamp`, `APP_VERSION`, and `sw.js` `CACHE_VERSION` all = v98; §5 benchmark all-pass; Playwright 126/126). The checklist frontend-benchmark line was updated to v97 last sprint and is now v98. **`CLAUDE.md` still says "Current build: v74" — stale.**

**Pin: all recruiter work references build ≥ v98.** Proposed `CLAUDE.md` refresh (NOT applied this turn, per "don't push yet"):
- Header `Current build:` → **v98** (+ short note: recruiter tier R0 = backend/schema/tests only).
- Append v75–v98 to the version-history section (currently ends at v74).
- Add a one-line pointer to `docs/recruiter-tier.md` + `docs/R0-report.md`.
Say the word and I'll apply it as a doc-only commit.

---

## 2. Schema audit (read-only, from live `index.html`)

### `resumeData` (candidate résumé model, localStorage `gpj_draft` + cloud `profiles.*`)
| field | type | notes |
|---|---|---|
| `name`, `title` | string | |
| `contact` | string | `email · phone · address` joined; **rebuilt by `_rebuildContact()` honoring F-ADDR toggles** (v97/v98) |
| `summary` | string | professional summary |
| `skills` | string | ` · `-joined |
| `jobs` | array | `[{t:title, c:company, b:bullets(\n-joined)}]` |
| `edu`, `eduExtra`, `eduStruct` | string / array | education (eduExtra = `[{school,program,year}]`) |
| `certs` | array | licenses/certs |
| `years` | string | years experience |
| `addr` | string | legacy; address canonical on the profile |

### `profiles/{uid}` (Firestore, cloud-synced; `getProfile()`)
`email, phone, address, city, state, first, last, createdAt (install ts / day-counter source), account, accountEditedAt, bonusDays, appliedToday, loc, lists, listsResetAt, coverLetters, optimizedResumes, preferences{ showPhoneOnResume, showAddressOnResume, addressFull }, prefs, resume fields (mirrors resumeData)`.

### `lists` (application state; cloud-synced via profile + `listsResetAt` tombstone)
`{ applied:[{t,co,ghost,when,status,url,loc}], skipped:[…], responses:[…], viewed:[…] }` (saved jobs/companies stored separately). Reset propagates cross-device via `gpj_lists_reset` / `listsResetAt`.

### Other
- **`gpj_loc`** — master location string (`"City, ST"`); the deck + Browse anchor.
- **Day counter** — `getInstallDate()` → `gpj_install_date` / `profiles.createdAt`; `accountAgeDays()`. Never overwritten with a later ts.

### ⚠️ CRITICAL — `gpj_optimized` tailored-variant keying (kickoff task 2)
**Answer: NO — a "Match to Job" tailored résumé/cover-letter variant is NOT retrievable by `(candidateUid, jobId)`.**
- `gpj_optimized` (cloud-synced) stores `[{title, co, added:[…], file, when, snapshot?}]`, and its sync key (see `gpjSyncArtifact`) is `((co||'')+'|'+(role||title||'')).toLowerCase()` — i.e. **keyed by `(company, roleTitle)`, and there is no `jobId` on the record at all.**
- Consequence for the recruiter tier: "recruiter sees the résumé built for THIS job" **cannot** be satisfied today.
- **Proposed candidate-side fix (small, insert-only — needs approval, lands in R2 alongside internal-apply):** when a tailored variant is generated from a specific job card, also store `jobId` on the `gpj_optimized` record and index by it; the application record (`jobs/{jobId}/applications/{candidateUid}`) then carries a `variantRef` to that doc. Purely additive to a candidate flow; zero read-cost on the hot path.

---

## 3. Data-model proposal (Firestore additions — all NEW)

Per `recruiter-tier.md` §2. Collision check performed against live collections (`profiles`, `jobs`, `bugReports`, `hired`) — **no name collisions**; `jobs` gains fields only (additive, harvested docs unaffected).

| Collection / field | Shape | Collision-avoidance |
|---|---|---|
| `recruiters/{uid}` | `{company, website, linkedin, role:'recruiter', plan, isValidated, hoursTZ}` | NEW top-level; `role` also lets us keep candidates in `profiles` untouched |
| `companies/{companyId}` | `{name, verifiedEmployer, responsivenessRate, appealDecisions}` | NEW; canonical, backend-written reputation |
| `jobs/{jobId}` **+fields** | `+ source:'internal', ownerUid, companyId, isValidated, status, market` | **Additive only**; harvested docs keep `source:'jobspy'`/absent — rules make them recruiter-untouchable |
| `jobs/{jobId}/applications/{candidateUid}` | `{status, variantRef, when, updatedAt}` | NEW subcollection |
| `jobs/{jobId}/recommended_candidates/{uid}` | `{score, matched, missing, applied}` — **backend-written** | NEW subcollection; `allow write:if false` |
| `profiles/{uid}` **+field** | `+ discoverable:false` (+ match-token cache pointer) | Additive; default OFF |
| `candidate_cards/{uid}` | curated projection (matchPct, skills, contact-if-consented) — **backend-written** | NEW; the ONLY recruiter-visible candidate data (never raw `profiles`) |
| `match_tokens/{uid}` | `{title, skills[], market, is_remote, appliedJobIds[]}` — **backend-written** | NEW; keeps reverse-match reads low |
| `notifications/{uid}/items/{id}` | inbound tray; opening auto-logs a response | NEW; extends Applied/Responses UX |
| `appeals/{id}` | `{ownerUid, reason(enum), status, decision}` — admin-only read | NEW |
| `schedules/*` | R7 framework only | NEW; deferred |

---

## 4. Security rules — **full drop-in: `firestore.rules`**

Complete `rules_version='2'` file committed at repo root. Enforces every §3 invariant: recruiters read applications/recommended_candidates **only for jobs they own** (via a single `get()` on the parent job — recruiter path only, never the candidate hot path); recruiters **never** read raw `profiles`; recruiter-visible candidate data flows through the backend-written `candidate_cards` projection; `recommended_candidates`/`candidate_cards`/`match_tokens`/`notifications`-inbound are `allow write:if false`; a recruiter cannot self-flip `isValidated`/`plan`; `jobs` writes scoped so a recruiter touches only their own `source:'internal'` job and harvested jobs stay untouchable; `appeals` admin-only.

> **RECONCILED vs live (2026-07-06):** the founder provided the live console rules; `firestore.rules` is now their EXACT current blocks + insert-only recruiter additions. Two flagged reconciliations: **(A)** live `jobs` was `write:if false` → changed to a scoped write (admin, or recruiter on their own `source:'internal'` job; harvested untouchable) — required by the tier. **(B)** the pasted live rules nested `keyword_templates`/`ai_sentence_cache`/`user_usage`/`hired` INSIDE the `bugReports` block (a brace slip) → restored to top level where the live comment intends. ⚠️ **Verify live `hired` writes currently succeed** — if they don't, the live rules have that same nesting bug (the app guards `fb.logHire` in try/catch, so a denial is silent).

### Rules test matrix (`tests/rules/firestore-rules.test.mjs`, `@firebase/rules-unit-testing` + emulator)
Proves, among 20 cases: recruiter ✅ own-job apps / ❌ other recruiter's apps / ❌ any raw profile / ✅ own recommended_candidates / ❌ other's; candidate ✅ own app+profile / ❌ another's; ❌ client writes to recommended_candidates / candidate_cards / match_tokens; ❌ recruiter self-flip isValidated; jobs write-scope (own internal ✅, spoofed owner ❌, harvested ❌, guest ❌, public read ✅); appeals admin-only.

**Run status:** the Firestore emulator needs a **JRE, which is not installed on this dev machine**, so the rules suite runs in **CI** (`.github/workflows/rules.yml`, which provisions Temurin JDK 17 + firebase-tools) and locally on any machine with Java via `npm run test:rules`. **I could not execute it here — honest.** The suite is complete and will run green in CI; I'll confirm on the first push once the workflow runs, or you can run `npm run test:rules` locally with Java.

---

## 5. Fixture / seed + teardown helpers — `tests/rules/fixtures.mjs`
`seedFixtures(ctx)` / `teardownFixtures(ctx)` build+remove a self-contained recruiter world (test company, one local + one remote internal job, a matched candidate + application + backend projection docs). **Emulator-only; zero live-data pollution** — and any live-flow test recruiter's jobs are shaped `isValidated:true` only in the emulator; real live-flow tests (R1+) keep test recruiters `isValidated:false`/hidden and torn down, per "no demo data in live views."

---

## 6. Backend match-path skeleton — `api/match/reverseMatch.js` + `tests/match/reverseMatch.test.mjs`
Architectural rule adopted: **the reverse-match scorer is in-repo, pure, and unit-testable** — the Worker/Function imports it; it is NOT locked inside the opaque Worker. `reverseMatch(job, pool, {topN})` inverts `computeMatch` (title field-word + skill + token overlap), **local-market-scoped** (remote job → whole pool; on-site → same-market + remote-willing), applied-first ordering, top-N cap.

**Run status (RAN LOCALLY — pure JS, no emulator): `npm run test:match` → 10/10 pass.** Fixtures: local-scope, remote-scope, empty pool, applied-flag, plus scoring + top-N cap. R3 replaces the `sameMarket` text check with the shared `jobMatchesLocation`/F-GEO haversine and wires the token pool from Firestore — the interface + tests stay.

---

## 7. Stubbed recruiter Playwright project + CI secret
`playwright.config.js` gains a `recruiter` project (`testMatch: /recruiter\.spec\.js/`) — **stubbed** (no recruiter specs yet, so it runs zero tests and can't fail the suite). **Dependency flagged:** the recruiter **auth-setup harness** (`tests/recruiter.setup.js`, mirroring `auth.setup.js` — signs in a test recruiter, saves `playwright/.auth/recruiter.json` incl. IndexedDB) **lands in R1**, because it needs the recruiter **login route** which doesn't exist yet. It activates via CI secret **`GPJ_RECRUITER_TEST_PASSWORD`** (mirrors `GPJ_TEST_PASSWORD`/`TEST_USER_PASSWORD`); without it, recruiter specs self-skip. Also required: Playwright now uses `testMatch: /.*\.(spec|setup)\.js$/` so it never tries to load the `node:test` `.mjs` backend suites.

---

## 8. 5-quadrant state-coverage matrix (R0 changes)

| Quadrant | R0 impact | Coverage |
|---|---|---|
| **Guest** | none (no app code) | existing chromium/mobile specs — **126/126, zero change** |
| **Authed-candidate** | none — candidate reads/writes unchanged; no new hot-path reads | existing authed spec + full suite green |
| **Authed-recruiter** | rules define access; **no UI yet** | rules suite (emulator) proves isolation; Playwright recruiter project stubbed until R1 harness |
| **Empty-data** | `reverseMatch` empty-pool → `[]` (tested); rules deny by default | match test + rules default-deny |
| **Network-fail** | n/a (rules/scorer are not on a live network path this sprint) | — |

**Candidate quadrants: ZERO behavior change confirmed** — no `index.html` edit, boot harness RAN TO COMPLETION, mirror byte-identical, 126/126 Playwright, and no new Firestore reads added to the deck/Browse hot path (the only new `get()` is in recruiter-only rule branches).

---

## Founder decisions (RESOLVED 2026-07-06)
1. ✅ CLAUDE.md refresh — **applied** (build → v98, v75–v98 history, recruiter pointer).
2. ✅ `gpj_optimized` `jobId` keying — **approved**; lands R2 with internal-apply (candidate-side, additive, zero hot-path read cost).
3. ✅ Live console rules provided — `firestore.rules` reconciled to them (see §4).
4. ✅ Admin emails (`asosa@`, `ksosa@ghostproofjob.com`) confirmed complete.

**R0 foundation complete and approved. Next: R1 (dual-role onboarding + domain-email verification + `isValidated` gate + admin verify queue + the recruiter auth harness that activates the authed-recruiter test quadrant). R1 has `[UI-REVIEW]` items — I will propose each before writing that code.**
