# GhostProofJob — Launch Readiness

**Build:** v157 · **Updated:** 2026-07-28 · **Status:** **NOT launch-ready — 1 dated blocker, 2 data-integrity blockers**
**Overall: 7.5 / 10** — the product is broad and genuinely works; what's unfinished is *durability, cost, and reach*.

> **v155–v157 shipped since the last revision:** Match Preferences now steer BOTH surfaces
> (weighted, not absolute) · the Résumé Rater is genuinely two-fold and benchmarks the role
> you WANT · Match-to-Job tailors a COPY (master never mutated), rewrites the summary toward
> the posting, and stores a restorable version.

How to read this: ordered by **what it costs the user if it ships broken**, not by effort.
**P0** destroys data or makes the core promise false · **P1** breaks an advertised feature ·
**P2** is friction. **[UI-REVIEW]** = your sign-off on the approach *before code is written*.
**[WRITE]** = a data-write change, which `release-policy.md` treats as feature-class **always**.

---

## Verified state of v157 (measured, not recalled)

| Gate | Result |
|---|---|
| §4 benchmark | **GREEN** — RAN TO COMPLETION · div delta 0 · mirror byte-identical · 0 dupe ids · every handler resolves · v157 markers in sync · free-tier limits pass (6/12 functions) |
| Backend suites | **117 pass / 0 fail** (match 46 · email 19 · seo 18 · billing 18 · growth 11 · apply 5) |
| Firestore rules (emulator) | **127 / 127** |
| Playwright | **526 collected** across 7 files · **262 pass / 0 fail** on chromium `state-coverage` |
| App size | 16,624 lines · 1.27 MB · mirror identical |
| Code surface | **713** top-level functions · **42** localStorage keys · **86** `fb.*` methods · **12** Firestore collections |

**Known flake:** the suite flakes under parallel load; failures rotate and pass in isolation.
Proven pre-existing by A/B against the prior commit. CI `retries:1` absorbs it.

---

## Full-build study — reconciling the roadmap against the code (2026-07-28)

The founder asked for a complete cross-reference of the original roadmap against what
actually exists, with no assumptions. This is what that found.

### The roadmap itself has stale layers
`master-audit-checklist.md` has a v128 header but an inner section still reads
*"Current build: v77 · Updated 2026-07-03"*. **Status markers there cannot be trusted on
their own** — several items shown as open were finished versions ago:

| Item | Roadmap says | Code says |
|---|---|---|
| **F-TPL** — five résumé templates | open | ✅ all 5 exist (classic, corpgrid, creative, minimal, split) |
| **F-LADDER** — same-state broaden rung | open | ✅ live (`loadDeckSameState`, referenced as a string) |
| **F-GEO** — distance filter | deferred | ✅ v106 (`_haversineMiles`, offline centroids) |
| **F-ADDR** — address toggles | open | ✅ v97/v98 |
| **F-GHOST** — crowd ghost reporting | open | ✅ v141 job-level reports |
| **F-ATSPREVIEW** | open | ⚪ present — output accuracy never audited |

### Corrections to my own earlier claims
| I reported | Verified reality |
|---|---|
| Match-to-Job tailors to the role corpus, not the posting | **False** — it already sent the full posting via `_aiJobContext` |
| "Tailoring costs 2 credits" | **Misleading** — budgets are *per section*; the cover letter is a separate counter |
| SEO regeneration needs credentials | **False** — the generator reads public data unauthenticated |
| `worker/worker.js` was a needed mirror | **False** — root `index.js` already was one (now removed) |
| `scoreAgainstRole` is a duplicate-definition bug | **False** — two different parent scopes, intentional |

Each was answerable with one command. The cause was sampling the code and reporting the
hypothesis as a finding.

### Dead code — 10 functions with zero references
`recMarkFilled` · `clCapTxt` · `showNextRateEx` · `teardownNote` · `toggleCLOffers` ·
`loadMoreLive` · `openCompanyJob` · `saveDeckLocation` · `openCardCompanyProfile` ·
`maybeConfirmEducation`

⚠️ `openCardCompanyProfile` is documented in CLAUDE.md §6 as a live landmark but has no
callers — either the docs are stale or a feature is unreachable. **Not yet determined.**

> Method note: the first analyzer run reported **22** dead functions. Three false-positive
> classes had to be fixed first — functions called via `.apply()`, referenced as values in
> a dispatch map, or passed as **strings** to a handler builder. Real number: 10. The tool
> was validated against known-live functions before its output was trusted.

### The recurring failure mode, named
Three features are built, correct, and **not connected to what they were built for**:
spell-check (runs only at résumé import), the rater's role benchmark (fixed in v156), and
per-job `matchTerms` (stored in v152, still unused by Match-to-Job). Same shape as Match
Preferences (saved, read by nothing) before v154 and `hiddenCompanies` before v146.
**Every new feature should ship with a test proving its CONSUMER reads it**, not merely
that its producer writes it.

---

## Scorecard

| Dimension | Score | Why |
|---|---|---|
| Core candidate flow | **9 / 10** | Swipe, Browse, apply, résumé, cover letters, ATS preview all work end to end |
| Employer / recruiter flow | **8.5 / 10** | Full 6-tab reskin, posting, applicants, interviews, plans — but hire data is captured and never surfaced |
| Release safety | **9 / 10** | Benchmark + 4 CI gates + `stable` promotion + free-tier guard. Backup branch still manual |
| Legal / compliance | **8 / 10** | CAN-SPAM, EEO isolation, consent-gated contact all solid. Ghost-risk trade-libel exposure is managed, not eliminated |
| Matching quality | **8 / 10** | One shared scorer both sides (v146) · prefs steer both surfaces (v155) · rater is two-fold and targets the role you want (v156). Still ignores education/certs and can't infer industry |
| Email & notifications | **7 / 10** | Lifecycle + interview + reach-out live. The three digest toggles still say "NOT LIVE YET" |
| **Data durability** | **5 / 10** | v153 fixed a total silent sync failure — but the **60-item cap** still ages out your history |
| **Cost / scale (D1)** | **5 / 10** | Pool foundation shipped, unusable until rules are deployed. Rater still costs 1,200 reads/mine |
| **SEO / growth** | **3 / 10** | 316 of 317 pages **not indexed**. The strategy isn't working yet |
| **Infrastructure currency** | **2 / 10** | **Node 20 breaks every deploy in 65 days** |

---

## P0 — Blocking

### 🔴 P0-1 Node 20 deprecation — **all Vercel deploys fail on 2026-10-01 (65 days)**
`package.json` pins `"engines": { "node": "20" }`; Vercel warns on every build that deployments
created on/after 2026-10-01 **will fail**. Local dev is already on v24, so the runtime is
compatible — this is a config bump plus a re-verify, not a migration. Cheap now, an emergency later.

### 🔴 P0-2 Flagged/skipped jobs age out after 60 — history still regresses **[WRITE]**
`_gpjMonotonicLists` and the restore both `slice(0, 60)`. Every list — applied, skipped, viewed —
keeps only the 60 most recent. **A job you flagged reappears once you act on ~60 more**, on any
device, regardless of correct keys or a healthy sync. This is the structural half of the
"jobs I removed keep coming back" report; v153 fixed the other two halves.
**Plan:** a **Hide Ledger** — compact keys only (~40 bytes vs ~200/row), ~5,000 entries in one
Firestore doc, 1 read/session, union-merge, cloud as source of truth. Display lists keep their cap.

### 🔴 P0-3 The D1 pool is built but **switched off**
`job_pools` returns `permission-denied` — the v152 rule is committed but not deployed.
The app degrades safely to live queries, so nothing is broken; you simply get **none** of the
~500× read saving. **Founder action: one rules deploy.**

---

## P1 — Advertised feature doesn't work

| # | Item | State |
|---|---|---|
| 🟠 **P1-1** | **Rater still costs 1,200 reads per mine** — blocks a zero-read public tool | D1-2, unbuilt |
| 🟠 **P1-2** | **Reverse match returns nothing** — needs one line from your run log | Blocked on you since v145 |
| 🟠 **P1-3** | **Digest emails ×3** still labeled "EMAIL NOT LIVE YET" | Approved, unbuilt |
| 🟠 **P1-4** | **Matching ignores education, certs, and can't infer industry** | Approved, unbuilt |
| 🟠 **P1-5** | **Your employer listing is 26 chars → scores 3%** and won't clear the pin gate | Founder action |
| 🟠 **P1-6** | **Message delete** (hide-for-me, both sides) | Approved, unbuilt |
| 🟠 **P1-7** | **Hire data captured but never surfaced** — do not claim publicly until it is | Open since v117 |

---

## P2 — Friction, growth, hygiene

| # | Item | State |
|---|---|---|
| 🟡 **P2-1** | **312 pages "Discovered — not indexed"**, 1 indexed. More pages will NOT fix this | Strategy change needed |
| 🟡 **P2-2** | **Duplicate company pages** — generator doesn't fold name variants like the app's `_coKey` | Root-caused, unbuilt |
| 🟡 **P2-3** | **Public resume checker** `/tools/resume-checker` — the real growth lever | Approved, blocked on P1-1 |
| 🟡 **P2-4** | **Native-only job pages + JobPosting schema** | Approved, **hold** until indexing improves |
| 🟡 **P2-5** | **Offline queue** — an action taken offline may never reach the cloud | Unbuilt |
| 🟡 **P2-6** | **"My Data" audit view** — let users see what's stored | Unbuilt |
| 🟡 **P2-7** | **Backup branch 383 commits stale** — auto-update on green | Approved, unbuilt |
| 🟡 **P2-8** | **Speed Insights was merged then silently lost** in a full-file rewrite | Needs re-add + guard |
| 🟡 **P2-9** | Confirm **SPF/DKIM/DMARC** for Resend on the Vercel-managed DNS | Unverified |
| 🟢 **P2-10** | Dead files: `manifest.json` (unreferenced), `frontend/Swipecardquery.js` | Ask before deleting |

---

## Sprint plan — batched so each pass fixes one *theme*

### Sprint A — "Nothing regresses, nothing expires" (P0)
**Node 24 bump + Hide Ledger + rules deploy.** Grouped because all three are durability/infra and
share one verification pass. The Node bump re-runs every gate anyway — so do the riskiest
data-write change (Ledger) behind that same full re-verify.
*Also folds in:* P2-5 offline queue and P2-7 backup automation — same theme, same test surface.

### Sprint B — "Matching tells the truth" (P1)
**Static rater corpus (D1-2) + `rateCore.js` extraction + education/certs/inferred industry.**
One theme: the scoring engine. Extracting `rateCore` and changing the corpus touch the same code,
so do them together and guard with the existing convergence test so the recruiter side can't drift.
*Unblocks:* the public resume checker.

### Sprint C — "Reach" (P2 growth)
**Public resume checker + SEO duplicate fold + fold guard.** The checker is the authority-building
lever; the dedupe removes a live negative signal. Both are static, zero-read, zero new functions.
**Job pages stay parked** until indexing actually improves.

### Sprint D — "Close the loop"
**Digests ×3 + message delete + "My Data" view + hire aggregate.** All user-visible communication
and transparency, all cheap once the pool is live.

### Sprint E — "Prove the money works"
**Stripe live-payment verification.** Last, as instructed.

---

## Guardrails log — mistakes made, and what now prevents them

| # | What happened | Prevention now in place |
|---|---|---|
| 1 | Added 2 API endpoints → **13/12 functions, every deploy failed** (2nd time) | Benchmark **[8]** fails the build over 12 |
| 2 | Put `_comment_*` in `vercel.json` → **schema rejected**, deploy failed | Benchmark **[8]** validates top-level keys |
| 3 | `require('./atsIngest')` vs `Atsingest.js` — dormant case bug | Benchmark **[8]** checks exact-case requires |
| 4 | Reported "green" from a piped command — **`tail` masked the exit code** | Always capture the real `$?` |
| 5 | Fixed `setTimeout` waits → **race passed on chromium, failed on mobile** | Poll for the precondition; `syncOnce()` helper |
| 6 | Shipped v152–v154 as bug fixes — they were **data-write = feature class** | Full 5-part approval + rollback command, every time |
| 7 | Added `worker/worker.js` without noticing root `index.js` already existed | Check for an existing home before adding one |
| 8 | Claimed I needed credentials for SEO regen — **untrue** | Verify before asserting a limitation |
| 9 | Wrote rules, never flagged they were **undeployed** | Say explicitly when a change needs a deploy |
| 10 | Speed Insights merged, then **silently erased** by a full-file rewrite | Guard any snippet that must survive rewrites |

**The pattern:** every one was *assumption instead of verification*. The standing rule is now
verify-then-claim, and state the platform quota **before** building.

---

## Founder action list

1. **Deploy `firestore.rules`** — turns on the D1 pool (and the v148 interview fields). One paste.
2. **Read the Reverse Match log line** (P1-2) — ends a blocker open since v145.
3. **Expand the employer listing past 26 chars** — highest-leverage single edit for the employer side.
4. **Decide:** Hide Ledger ceiling (5,000?) · "My Data" view this pass or later · re-add Speed Insights.
5. **Confirm** SPF/DKIM/DMARC exist for Resend on the Vercel DNS.

---

## Deferred by instruction

- **Stripe live-payment verification** — last.
- **Job-page programmatic SEO** — parked until indexing improves; native-only when it resumes.
- **Harvested-job indexing** — never, unless ATS-sourced via official APIs after a legal skim.

---

## Open questions — things I could NOT determine from the code

These are genuine unknowns. I am not guessing at them.

1. **`openCardCompanyProfile`** — CLAUDE.md §6 lists it as a live landmark, but it has
   zero callers. Was "open the company profile from a job card" ever wired to a control,
   or did it get orphaned in a rewrite?
2. **`toggleCLOffers`, `showNextRateEx`, `maybeConfirmEducation`, `saveDeckLocation`,
   `loadMoreLive`, `openCompanyJob`, `recMarkFilled`** — deliberately retired, or lost?
   (`recMarkFilled` is interesting: the employer audit lists "Mark filled" as ✅ working,
   yet this function is unreferenced — so either another function does it, or the audit
   is stale.)
3. **ATS Preview** — has its output ever been compared against a real ATS parse? The
   roadmap item F-ATSPREVIEW says "verify the preview shows the real machine-readable
   data" and I can find no evidence that check was ever done.
4. **Cover-letter quality** — the original F-COVERLETTER complaint was unfilled
   placeholders ("the this role position") and a forced Operations emphasis. Fixed, or
   still present in live output?
5. **Reverse match** — still blocked on one line from a run log (P1-2 since v145).

