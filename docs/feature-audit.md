# GhostProofJob — Feature Audit: what each feature IS vs what it SHOULD BE

**Build:** v155 · **Date:** 2026-07-28 · **Purpose:** one shared definition of what every
feature is *for*, so we stop fixing symptoms without agreeing on the goal.

**Verification legend**
- **🔬 Deep** — read the implementation end-to-end this session, behaviour confirmed (often in a real browser).
- **🔎 Traced** — confirmed it exists, is wired to a control, and what it calls.
- **📋 Listed** — present and reachable; behaviour not yet audited. *These are honest unknowns.*

**Verdict legend** — ✅ does its job · 🟡 works but under-delivers · 🔴 gap vs intent · ⚪ unaudited

---

## A. The three "intelligence" features (founder-defined goals)

### A1 · Résumé Rater 🔬 🟡
**Intent (founder):** two-fold — rate against ATS/best-practice *and* against the jobs they want.

**Does today:** `score = (structure + coverage) ÷ max`.
- *Structure half:* contact complete · has summary · 6+ skills · 6+ bullets · ≥30% bullets with metrics · ≥40% bullets led by a strong action verb.
- *Coverage half:* % of terms mined from live postings that appear on the résumé (max 55 pts), shown as "biggest score gains available". 7-day cached yardstick (v119) so the score can't swing between visits.

**🔴 The gap:** it benchmarks `_recentTitle()` — **the job you already have, not the job you want.** A Marketing Specialist targeting Brand Manager is scored against Marketing Specialist postings. Match Preferences now hold target titles (v155) and are unused here.

**Should also check (missing best-practice):** résumé length, education section present, date gaps, bullet length, tense consistency. Spelling does not affect the score at all.

---

### A2 · Match to Job 🔬 🟡
**Intent:** tailor skills/verbiage/bullets toward a specific job — **without lying**.

**Does today:** computes overlap, lists terms in that role's corpus missing from the résumé, offers *"Add these with Jett"* which weaves **only genuinely true** terms into real bullets. Honesty guardrails are real and enforced: *"never invented"*, *"Real numbers must come from you."*

**🟡 The gap:** it tailors to the **role corpus** (what most postings for this title ask for), not to **that one posting's text**. Good generic tailoring; not the per-job tailoring the name implies. v152 already stores per-job `matchTerms` in the pool — built, and unused for this.

---

### A3 · Jett (résumé improver) 🔬 🟡
**Intent:** cleanup — spelling, real metrics, flow, no clutter, better bullets + summary.

**Does today:** rewrites the summary from real facts (`_summaryFacts`), rewrites every job's bullets, re-leads each with a strong action verb (`_leadWithVerb`), tidies skills (`_tidySkills`), and **elicits real metrics from the user** rather than inventing them (`openMetricsElicit`). Falls back to internal templates when AI is unavailable, and says so.

**🔴 The gap:** **spelling is effectively unreachable.** `resumeSpellCheck()` is good ("high-confidence, whole-word misspellings, never touches correct words") but has **exactly one caller** — inside `applyRealParse`, i.e. only at résumé *import*. Type a typo later and nothing catches it; "Improve My Whole Resume" does **not** spell-check; there is no button.

---

## B. Job discovery

| # | Feature | Does today | Should be | Verdict |
|---|---|---|---|---|
| B1 | **Swipe deck** 🔬 | Résumé-ranked deck; B1 field-word tier first, then match% + Match-Preference nudge (v155). Reads the pre-built pool (~6 reads, v152) with live fallback. | ✅ as intended | ✅ |
| B2 | **Browse** 🔬 | Search/filter/sort over the region pool; collapsible filters (v146); honours prefs + hidden companies. | ✅ | ✅ |
| B3 | **Match %** 🔬 | Résumé-vs-job overlap via shared `scoreCore` — identical number on candidate and recruiter sides (v146 convergence). | Should also use **education, certs** (stored, unused) and **inferred industry** | 🟡 |
| B4 | **Ghost Risk** 🔎 | Real signals only — community reports, verified-employer, staleness. Fabricated `hash(name)%70` removed in v119; shows "—" when unknown. | ✅ honest | ✅ |
| B5 | **Hide company** 🔬 | Mutes every role from one employer, brand-folded so spelling variants fold together. | ✅ | ✅ |
| B6 | **Report ghost job** 🔬 | Flags a posting; hides it for you; files a community report so others see "N reported". | ✅ *(2 bugs fixed v153)* | ✅ |
| B7 | **Saved jobs / companies** 📋 | Save + revisit. | Audit whether saves survive device switch | ⚪ |

---

## C. Applying

| # | Feature | Does today | Should be | Verdict |
|---|---|---|---|---|
| C1 | **External apply** 🔎 | Opens the real posting in a sandbox, confirm-only recording ("Done — I Applied"), fires an encouragement email. | ✅ honest — no fake auto-apply | ✅ |
| C2 | **Internal apply** 🔬 | Full in-app application: résumé snapshot + cover letter + work-auth/sponsorship + employer questions + voluntary EEO. | ✅ *(routing fixed v147)* | ✅ |
| C3 | **EEO** 🔬 | Separate collection, **no employer can read it**, proven by emulator tests. | ✅ | ✅ |
| C4 | **Withdraw / status** 🔎 | Withdraw an application; "Seen by employer / Delivered". | ✅ anti-ghosting both ways | ✅ |
| C5 | **Cover letter** 📋 | Generates a tailored letter, download/copy. | Verify quality + no unfilled placeholders (old F-COVERLETTER complaint) | ⚪ |
| C6 | **ATS Preview** 📋 | Shows how an ATS parses the résumé. | Confirm it reflects the **real** machine-readable output, not a mock | ⚪ |

---

## D. Two-way communication (v148)

| # | Feature | Does today | Verdict |
|---|---|---|---|
| D1 | **Reach-out** 🔬 | Recruiter messages a candidate; greyed "already contacted" state persists; candidate stays anonymous. | ✅ |
| D2 | **Interview scheduling** 🔬 | Up to 3 proposed slots + modality (in-person/virtual/phone) with address / link / phone. | ✅ |
| D3 | **Mutual contact exchange** 🔬 | Contact is shared **only when the candidate accepts** — that act is the consent. | ✅ privacy spine |
| D4 | **Two-way cancel** 🔬 | Either side cancels, optional reason, other side always told. | ✅ never ghosted |
| D5 | **Kind decline + appeal** 🔎 | Respectful decline instead of silence; candidate may appeal. | ✅ |
| D6 | **Delete messages** | ❌ **not built** — you approved *hide-for-me-only* (preserves the anti-ghosting record). | 🔴 |

---

## E. Data integrity (the class that caused every incident)

| # | Feature | State |
|---|---|---|
| E1 | **Cloud sync** 🔬 | Monotonic lists (v143) + strip-undefined (v153). ✅ |
| E2 | **Restore on login** 🔬 | Retries with backoff; a failed read never looks like an empty account (v149). ✅ |
| E3 | **Hidden/skipped memory** 🔬 | 🔴 **Capped at 60 items.** Skip ~60 more jobs and older flags fall off — jobs you removed come back. **This is the "my data regressed" root cause.** Fix = the Hide Ledger. |
| E4 | **Match Preferences** 🔬 | Now real (v154/v155) — persist, sync, and steer both surfaces. ✅ |
| E5 | **Offline actions** | 📋 unknown whether an action taken offline ever reaches the cloud. ⚪ |

---

## F. Employer product

| # | Feature | State |
|---|---|---|
| F1 | Company profile + team (owner/admin/standard, seats by plan) 🔎 | ✅ enforced in UI **and** rules |
| F2 | Post / edit / close a listing 🔎 | ✅ edit-in-place keeps applicants (v117) |
| F3 | Applicants → Candidate Card 🔎 | ✅ |
| F4 | Matched candidates (anonymous) 🔬 | ✅ + clickable "why this match" (v148) |
| F5 | Reviews + dispute-to-admin 🔎 | ✅ companies can never edit/delete a review |
| F6 | Anti-Ghosting Badge 🔎 | ✅ earned by actually responding |
| F7 | **Hire tracking** 🔎 | Captured, **not surfaced** — ⚠️ do not publicly claim hire numbers until an aggregate view exists |

---

## G. Growth / acquisition

| # | Feature | State |
|---|---|---|
| G1 | SEO city + company pages (250 companies) 🔬 | 🔴 **2 duplicate employer pages**; **312 of 313 URLs not indexed** by Google |
| G2 | Public résumé checker | ❌ not built — the highest-value SEO play |
| G3 | Job pages + JobPosting schema | ❌ not built — native-only, and gated on indexing improving |
| G4 | Referrals 📋 | Rules-gated (no self-referral) ⚪ |
| G5 | Lifecycle emails (Worker cron) 🔎 | ✅ live: welcome, day-7, tier changes, booster |
| G6 | Event emails (Vercel) 🔬 | ✅ apply, interview confirmed, employer reached out |
| G7 | Digest emails ×3 | ❌ not built (approved, cheap once the pool lands) |

---

## H. Platform / ops

| # | Item | State |
|---|---|---|
| H1 | Job pool (D1) 🔬 | ✅ built — ⚠️ **needs `firestore.rules` deployed** or it silently falls back |
| H2 | Harvester (LinkedIn + Indeed, daily) 🔬 | ✅ |
| H3 | Reverse match (nightly) 🔎 | 🟠 blocked on one founder log line |
| H4 | Benchmark + CI gates 🔬 | ✅ incl. free-tier quota guard |
| H5 | **Node 20 → 24** | 🔴 **Vercel builds FAIL from 2026-10-01** |
| H6 | Backup branch 🔬 | 🔴 383 commits behind; automation approved, unbuilt |
| H7 | Stripe billing 🔎 | Built + unit-tested; **live payment never verified** |

---

## The pattern worth naming

Three features are **built but unreachable or pointed at the wrong thing**:
- spell-check runs only at import (A3)
- the rater benchmarks the wrong role (A1)
- per-job `matchTerms` exist but Match-to-Job ignores them (A2)

That is the same failure mode as Match Preferences (built, saved, read by nothing) and
`hiddenCompanies` before v146. **The recurring bug isn't missing code — it's code that
was never connected to the thing it was built for.** Any new feature should ship with a
test proving the *consumer* actually reads it, not just that the producer writes it.
