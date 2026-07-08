# recruiter-tier.md — GhostProofJob Recruiter / Company Tier

> Operating manual for the B2B recruiter expansion. **Read `CLAUDE.md` first — every rule there still applies in full.**
> This tier is an **INSERT-ONLY addition**. It must never regress a single candidate-facing feature or prior fix.
> Companion to: `CLAUDE.md`, the Master Audit Checklist, and `GPJ_Recruiter_Tier_Master_Plan.pdf`.

---

## 0. Prime directives (inherited + tier-specific)

All `CLAUDE.md` §3 non-negotiables hold: INSERT-ONLY · full drop-in files (never snippets) · `[UI-REVIEW]` gate before any visual change · boot harness must print **"RAN TO COMPLETION"** · `<div>` delta 0 · `index.html` ↔ `GhostProofJob.html` byte-identical · three version markers in sync · honesty over optimism · no demo data live · Vercel is case-sensitive · drag-upload only.

**Tier-specific invariants — do not violate:**
1. **Candidate-first.** The recruiter tier exists to grow the job pool for job-seekers. Recruiter code must **never** add Firestore reads to, slow, or alter the candidate deck / Browse hot path. Prove this with a read-count check every matching build.
2. **Consent-gated, never sold.** Recruiters pay for posting volume + tooling — **never for candidate contact**. Contact is revealed only by candidate consent (applied / discovery-ON / accepted a reach-out). No paywall ever gates a contact field.
3. **Reviews are immutable to companies.** Companies can never edit or delete a candidate review/vibe. Appeals never delete a review (see §4).

---

## 1. Locked design decisions (founder-approved — treat as fixed)

- **Non-applicant visibility:** default not surfaced. Candidate opt-in toggle `discoverable` (OFF by default, revocable) → discoverable to *verified* recruiters with full card. The toggle opens discovery + contact permission; it **never auto-accepts a specific interview** (candidate still picks Interested/Not-interested per reach-out). Without consent, non-applicants surface anonymized (match % + skills only) or not at all.
- **Contact reveal:** recruiter sees contact iff `applied to this job` OR `discoverable == true` OR `accepted a reach-out`. Independent of the F-ADDR résumé "show phone" toggle.
- **Reverse matching:** multi-level (on job post/edit · nightly delta batch · on résumé update). **Local-market-scoped** to the job's market; remote job → remote pool. Backend/async only. Top-N (~50) per job. Uses a per-candidate match-token doc to keep reads low.
- **Verification (v1):** corporate-domain email verification (block free/burner) + `isValidated:false` hidden-until-verified + **manual admin spot-check for the first cohort** (reuse booster-queue + `isAdmin()`) + community-flag backstop. "Verified Employer" = domain-verified + admin-reviewed, stated honestly.
- **Reputation = two separate signals:** (1) Community Ghost Reports / Vibe reviews — subjective, company-immutable; (2) Responsiveness Rate — objective, % of applicants who got any response in N days (rejection counts; one response per applicant).
- **Internal apply:** jobs carry `source`. External (harvested) → route out via `applyVia()` as today. Internal (recruiter-posted) → write internal application record, notify recruiter, **no external redirect**. Verified-Employer green flag; ghost-risk heuristic must exclude verified internal jobs.
- **Calendar scheduling:** DEFERRED to Sprint R7. v1 outreach = Interested / Not-interested + consented contact reveal.
- **Pricing:** Free (2–3 jobs) · Growth (~$49–79/mo, ~10 jobs + Anti-Ghosting Badge) · Scale (~$149–199/mo, unlimited) · à-la-carte per-job. Numbers to validate; payment processor is Sprint R8.

---

## 2. Data model (all NEW — nothing today has a recruiter concept)

| Collection / field | Notes |
|---|---|
| `recruiters/{uid}` (or `role` on `profiles`) | company name, verified website, LinkedIn, team, hours/TZ, `role:'recruiter'`, `plan`, `isValidated`, availability (R7) |
| `companies/{companyId}` | canonical company record; Responsiveness Rate, Verified-Employer status, appeal decisions |
| `jobs/{jobId}` new fields | `source:'internal'`, `ownerUid`, `companyId`, `isValidated`, `status` (open/closed/filled), `market`; reuse existing job-card fields |
| `jobs/{jobId}/applications/{candidateUid}` | submitted résumé/cover-letter variant ref, status, timestamps |
| `jobs/{jobId}/recommended_candidates/{uid}` | score, matched/missing tokens, applied-flag — **backend-written only** |
| `profiles/{uid}` new field | `discoverable:false` + match-token cache (pre-extracted title/skill tokens) |
| `notifications/{uid}/items/{id}` | candidate inbound tray; opening auto-logs response → Responses + Responsiveness Rate |
| `appeals/{id}` | review appeal requests; admin-only read/write |
| `schedules/*` | availability/bookings/`.ics` — R7 framework only |

**Confirm against live code (Sprint R0):** exact `resumeData`/`profiles` field names, and whether the `gpj_optimized` tailored-variant shelf is keyed to `(candidateUid, jobId)`. If not, add that keying (small, candidate-side, insert-only) so "recruiter sees the résumé built for THIS job" works.

---

## 3. Firestore security rules (the enforcement layer — write these BEFORE the UI)

Current rules: no recruiter concept; `profiles/{userId}` is self-or-admin. Additions:

- Recruiter reads `jobs/{jobId}/applications/*` and `recommended_candidates/*` **only for jobs where `ownerUid == request.auth.uid`** — never arbitrary `profiles`.
- Candidate creates/reads **own** application only; no cross-candidate read.
- Recruiter-visible candidate data flows through a **curated projection doc** (match-token / candidate-card doc), never a raw `profiles` read; contact fields gated by §1 consent.
- `recommended_candidates` + match-token docs: `allow write: if false` for clients (backend Admin SDK writes — same pattern as `ai_sentence_cache` / `user_usage`).
- `appeals`: recruiter creates own; read/update `isAdmin()` only.
- `jobs` write: scoped opening so a recruiter writes **only their own** internal jobs; harvested jobs stay untouchable.

Ship a rules test matrix proving a recruiter cannot read another recruiter's applications or any raw candidate profile.

---

## 4. Review appeals — valid-reason enum (fixed)

Company files "Appeal Review" → admin queue only. **Approval never removes the review**: it stays visible, tagged "Appealed · GPJ Approved," shows reason + decision, and only then is excluded from the score. Denied appeals show "Company appealed; GPJ upheld."

Valid: (1) factually false vs records · (2) not a genuine applicant · (3) mistaken identity/wrong company · (4) prohibited content (harassment/hate/doxxing/PII/spam) · (5) duplicate/manipulation/brigading.
**Not valid:** "it's negative" / "we disagree" / "makes us look bad."

---

## 5. Asset reuse map (reverse-engineer, don't rebuild)

- `computeMatch` / `searchRankJobs` / `_resumeFieldWord` (BLEND) → inverted reverse-match engine (job → candidates).
- Universal job card / `openBrowseExpanded` (F-CARD) → candidate card structure.
- `vibe-review-modal` (z-360) + rate-ex flow → company reviews + appeal entry point.
- Existing modals + brand tokens (`#120F1D`/`#00F5A0`/`#B55FE6`/`#FF4D6A`) → job wizard, outreach editors, upgrade modals.
- Admin/booster queue + `isAdmin()` → verification + appeal queues.
- Resend + Cloudflare Worker (JWKS) + `user_usage` caps → outreach email, backend scoring, rate limits.
- Community ghost-report system → anti-junk backstop for internal jobs.
- Applied/Skipped/Responses + `renderStatList` → notification tray extends these.

---

## 6. Sprint plan (each ends with the §7 benchmark + PDFs + test checklist)

- **R-pre** Stabilize & verify the v96 benchmark (candidate-side; **gates R1+**). The recruiter tier reuses the job card, job data, company card, review flow, and AI — so these must be verified-live first:
  - **Checklist status reconciliation** — prove each Section-4 "done" item is actually live; the status boxes drifted from shipped work.
  - **Smart job-data gathering (root cause = harvester storage, NOT the card):** extract by section and **strip boilerplate before storing** (EEO/legal, generic "about us" fluff, apply instructions) — smaller docs AND sharper matching. **Sample live postings, then set generous per-section ceilings that rarely fire** (starting targets: desc ~10k · req ~3k · benefits ~2k · responsibilities ~3k); keep display caps above them; overflow tail covered by the existing *View Full Posting* link (never store the whole raw page). Directly improves reverse-match quality in R3.
  - **Backfill** stale docs (old small-cap / empty-benefits jobs heal only on re-harvest) — cost-aware, ties to D1.
  - **Requirements coverage** — fuller stored req text lets `_reqGaps` see requirements it loses to truncation; re-verify the chip.
  - **Benefits/bullets** render once data is stored (F-STRUCT shipped v81; gap is source data).
  - **Review/vibe dedup + company-card uniformity** `[UI-REVIEW]` — keep vibe stars, remove duplicate review control; company card = one format from every entry point (job card already uniform).
  - **F-ADDR address toggle** `[UI-REVIEW]` — show-address on/off (default off) · full vs city/state · layout; no export/spacing regression.
  - **Max Distance slider — remove now** (dead control on the text/metro model; no coordinates). Deferred to **F-GEO** (below).
  - **Smart-AI live verification** — every section's improve action returns a real result (Jett summary, key duties, Match-to-Job, cover letter).
  - Non-blocking candidate items (F-TPL, F-DESK, B4) stay in the normal candidate queue.
- **R0** Foundation + **test scaffolding** (BE, no frontend). Scaffolding-first — build the test plumbing that doesn't need UI BEFORE any feature code:
  - confirm build + refresh `CLAUDE.md`; document real schema + confirm `gpj_optimized` variant keying; recruiter data model; full drop-in security-rules file.
  - **Firestore emulator wired into CI** + `@firebase/rules-unit-testing` matrix: prove a recruiter cannot read another recruiter's applicants or any raw candidate profile, a candidate cannot read others' applications, and client writes to backend-only docs are rejected.
  - **Fixture/seed + teardown helpers** (test company, internal jobs, matched candidate) — **emulator only, zero live-data pollution** (respects "no demo data in live views").
  - **Backend match-path test skeleton** + rule: author the reverse-match scorer **in-repo so it is unit-testable**, not only in the opaque Worker.
  - Stub the recruiter Playwright project in `playwright.config.js`; document the CI secret for the authed-recruiter quadrant.
  - Multi-role state matrix written before any code. This sprint also closes the pre-existing **F-TEST** backend-coverage gap.
- **R1** Onboarding + verification: dual-role route `[UI-REVIEW]`; **recruiter auth harness** (mirrors `auth.setup.js`, signs in a test recruiter + saves session incl. IndexedDB — activates the authed-recruiter quadrant now that the route exists) (BE); company profile `[UI-REVIEW]`; domain-email check (BE); `isValidated` gate (BE); admin verify queue `[UI-REVIEW]`.
- **R2** Jobs + internal apply: creation wizard `[UI-REVIEW]`; CSV import `[UI-REVIEW]`; `applyVia()` source branch (FE); Verified-Employer flag + ghost-risk exclusion (FE); free-tier limit modal (FE); close/fill → notify applicants (BE).
- **R3** Reverse-match engine (BE): inverted scorer, local-scoped; match-token docs; 3 triggers; top-N writes; **candidate hot-path read-count unchanged** guard.
- **R4** Recruiter dashboard: dual-view `[UI-REVIEW]`; candidate card `[UI-REVIEW]`; 1-to-1 fit grid `[UI-REVIEW]`; privacy gates (FE); tailored-doc viewer (FE).
- **R5** Outreach + anti-ghosting: reach-out modal `[UI-REVIEW]`; rejection modal `[UI-REVIEW]`; "Not a Match" silent queue (FE); email + internal notify (BE); Responsiveness Rate + badge (BE); appeal flow `[UI-REVIEW]`.
- **R6** Candidate side: `discoverable` consent toggle `[UI-REVIEW]`; notification tray/dashboard `[UI-REVIEW]`; auto-response logging (BE); Interested/Not-interested handling (FE); transparency copy sweep (FE).
- **R7** Calendar (deferred): availability grid `[UI-REVIEW]`; slot picker + lock `[UI-REVIEW]`; `.ics` + dual email (BE).
- **R8** Billing: payment processor (BE); plan enforcement (FE); upgrade/cancel `[UI-REVIEW]`.
- **Deferred — candidate roadmap:** **F-GEO** — geolocation-backed distance filter. Add lat/long to user + job docs via a bundled US city-centroid table (free, offline, no API cost); haversine distance at scope; **re-enable the Max Distance slider** once it truly filters. Also sharpens recruiter local-market scoping (R3). Lands on a later candidate version, ideally alongside harvester work.

---

## 7. Per-build verification (extends CLAUDE.md §4)

Standard benchmark **plus multi-role**:
1. JS syntax → **boot harness "RAN TO COMPLETION"** → `<div>` delta 0 → mirror identical → handler audit → dup-ID → 3 markers → in-app self-test.
2. **Multi-role state matrix:** guest · authed-candidate · authed-recruiter · empty-data · network-fail. **Candidate quadrants: zero behavior change.**
3. Playwright: candidate suite stays 100% green (regression guard) + recruiter-role specs.
4. **Rules layer:** Firestore emulator + `@firebase/rules-unit-testing` matrix on every rules/data-model change — the boot harness does NOT exercise rules or the Worker, so this is the only real proof of privacy isolation.
5. **Backend match layer:** in-repo scorer unit tests over fixtures (local-scope · remote-scope · empty · applied-flag) whenever matching changes.
6. Matching builds: confirm candidate hot-path reads unchanged; log recruiter reads to D1.
7. One clean push · mirror identical · markers bumped · PDFs + test checklist shipped.

---

## 8. Copy / transparency sweep (required before any recruiter feature goes live)

Reword "your data powers your job search — nothing else": applying or turning on discovery makes your profile visible to that verified employer — **still never sold, never advertised**. Add plain-language consent-toggle copy (what "yes" does; revocable). New account-type language (candidate vs recruiter) across signup/pricing/About. Honest "Verified Employer" definition. Recruiter copy states contact is consent-gated, not purchasable.

---

## 9. Honest limitations to keep in copy + planning

Blaze trial credit ends **2026-09-19** — matching adds reads; D1 read-cost work must land by R3. Thin metro density → many jobs show few/zero matches (honest empty states). Verification reduces but can't eliminate junk. Matching is heuristic → "suggested fit," never a promise.
