# GhostProofJob — Launch Readiness

**Build:** v145 · **Updated:** 2026-07-21 · **Status:** NOT launch-ready — 2 blocking items open (P1-1 + P1-4 closed; P1-2 needs one founder data point; P1-3 deferred with D1)

How to read this: items are ordered by *what it costs the user if it ships broken*, not by
effort. A P0 destroys user data or makes the core promise false. A P1 makes a paid-for or
advertised feature not work. A P2 is friction. Anything marked **[UI-REVIEW]** needs your
sign-off on the approach before code is written.

---

## Verification status of v145 (committed `f894ad9`)

| Gate | Result |
|---|---|
| §4 benchmark | **GREEN** — RAN TO COMPLETION, div delta 0, mirror byte-identical, 0 dupe ids, every handler resolves, v145 markers in sync |
| Backend suites | **99/99** (match 41, growth 11, email 6, apply 5, seo 18, billing 18) |
| Firestore rules (emulator) | **120/120** — run locally this session on a portable Temurin 21 JRE, incl. 8 new EEO-isolation tests. Caught a real rule bug before push (see P1-4) |
| Playwright (all projects) | **462 passed**, 1 known parallel-load flake (screen-sizing matrix; 3/3 isolated, CI `retries:1` absorbs) |
| New coverage this arc | v143 ×11, v144 ×18, v145 ×12 (8 flow + 4 rules) |

> **Deploy before re-testing.** Everything marked "fixed in vNNN" is fixed in the committed
> code on `main`, not necessarily in the build you have open. `stable` tracks the last commit
> that passed the full CI gate.

---

## Verification audit — completed this session (the pass previously owed)

You asked me to confirm every fix landed and to do the exhaustive link/flow sweep I had
skipped. Both are done. What was checked and what genuinely can't be:

**Every fix landed (code, not memory).** All 13 fix markers from v143–v145 are present in
`index.html` **and** the byte-identical mirror, verified by grep count match. Rules changes
(`ghost_reports` self-update, `eeo_responses`) present. Release infra present: `serviceWorkers`
flake fix + `workers` in config, `release-policy.md`, `benchmark.mjs`, `verify.yml`, and the
`stable` branch exists on origin.

**Live interactive-element sweep.** Walked all four nav tabs in a real browser and checked
**1,620 rendered `on*` handlers** — **zero dead** (the only flags were `if(event.key…)`
false-positives, whose real calls exist). Every nav tab routes to its correct view. This is on
top of the benchmark's *static* handler audit, which parses the whole source (every template
string, including un-rendered modals) and also passes — so both rendered and unrendered handlers
are covered.

**AI features.** All entry functions exist and are wired to controls (`generateCoverLetter`,
`showAtsPreview`, `rateResume`, `jettFullImprove`, `downloadResume`, `downloadCoverLetter`). The
fallback/template layer — what runs when live AI is unavailable — is covered by many passing
tests (summary floor, cover-letter no-placeholder, `_leadWithVerb`, rater corpus, req-gaps,
double-verb repair).

**Genuinely NOT verifiable from here — stated plainly, not hidden behind green numbers:**
- **AI output *quality*** needs the live Cloudflare Worker + OpenAI. Only the offline fallback
  path is locally testable (and passes). Real model output is your live-test call.
- **Stripe live payments** — deferred with D1 by your instruction; the buttons/plan-caps exist.
- **Live Firestore data / reverse-match *outcome*** — needs prod; see P1-2, which still hinges
  on one line from your last Reverse Match run.

---

## P0 — Catastrophic (data loss / core promise false)

### ✅ P0-1 Sign-out deleted job history — **FIXED v143**
`authSignOut()` called `fb.signOut()` **first**, then wiped local data. Once sign-out
resolves `fb.current()` is null, so nothing could be flushed afterward. The code comment
promised the cloud would restore it; that only held if the cloud copy was already complete.
Yours was empty, so sign-out destroyed the last surviving copy.
**Fix:** flush while still authenticated, `await` it, wipe **only** on a confirmed write. A
failed flush keeps local data. *Verified with your exact 1 applied / 21 skipped.*

### ✅ P0-2 `lists` written as whole-document overwrite — **FIXED v143**
Any moment local `lists` was empty and the write fired, the cloud copy was destroyed. v137's
gate and v140 only narrowed the window. Now monotonic: local ∪ last-read-cloud; no cloud read
means the key is omitted; only an explicit reset shrinks a list.

### ✅ P0-3 Data-loss gate flapped on every auth callback — **FIXED v143**
Firebase re-fires `onAuthStateChanged` (token refresh, restored session); each fire slammed
the gate shut, silently dropping swipes. Now re-arms only on a real uid change.

### 🟡 P0-4 The history lost BEFORE PITR was enabled is unrecoverable
Your profile doc showed `lists` empty while `appliedToday: {n: 1}` — the counter recorded an
application whose list row was gone.
**PITR is enabled** (founder turned it on ~3 versions ago, after the loss). So going forward
there is a 7-day restore window; the data lost before that point has no restore path. v143
stops further loss. Nothing further is owed here.

---

## P1 — Blocking (advertised feature does not work)

### ✅ P1-1 Employer jobs were effectively invisible — **FIXED v144**
Shipped as approved: **(A)** relevance-gated pin, cap 3, `match` sort only, applied at the
deck's final sort (`applySwipeFilters`) — an off-field employer role is *not* pinned, because
that would be an ad. **(B)** description floor 20 → **250 chars** in both posting paths, with
existing listings grandfathered (the floor fires on edit only when the description changes),
plus a live strength meter reading the same fields `computeMatch` consumes.

> **Founder note:** your live posting is 26 characters and now scores **3%**. It will still
> serve, and you can still edit its salary/benefits/questions without rewriting it — but it
> will not clear the relevance gate to be pinned until you expand it. Expanding it is the
> single highest-value thing you can do for the employer side.

<details><summary>Original diagnosis (kept for the record)</summary>
Measured live: your GPJ posting sits at **position 1,498 of 2,127** in the deck; with your
résumé loaded it improves only to **~105**. Nobody swipes 105 cards. This is why no
application was ever created and why the recruiter side shows zero applicants — *the apply
plumbing is fine and was verified working; the card is simply unreachable.*

Root cause is a design flaw, not a bug: verified employer postings compete on equal footing
with 2,127 scraped listings and lose, because scraped ATS posts carry ~3,000-char descriptions
while your posting form accepted a **26-character** description (`"Manage marketing\nBudgeting"`),
which our own matcher scores at 61% against competitors' 85%.

**Proposed fix (needs your approval):**
- **A.** Pin verified internal jobs into the top N of an in-field deck — they are the product.
- **B.** Enforce a posting-quality floor (minimum description/requirements) with a live
  "your listing scores X%" meter on the post form.
</details>

### 🟠 P1-2 Reverse match returns nothing — **DIAGNOSED, blocked on one data point**
Ruled out in code: your profile has `discoverable: true` ✓ and `location: "Houston, TX"` ✓;
replaying the real scorer against the real job doc puts you **in scope** with a score of **~75**.
The scorer is not the blocker.

The pipeline had **zero observability** — a missing secret, an empty pool, and a genuine
no-match all produced the same silent green check (`runNightly.js` even exited 0 on a missing
credential). v143 makes it fail loudly, names which stage produced nothing, and writes
`admin_runs/reverse_match`.

**Founder action:** open the last Reverse Match run and read `[reverse-match] tokens: {...}`.
`tokensWritten: 0` → the pool never built. `≥1` with `totalRecs: 0` → downstream. That line ends it.

### 🟠 P1-3 Notification emails — DEFERRED with D1 (founder decision)
Toggles are labeled `· EMAIL NOT LIVE YET` and dimmed, so the UI is honest. `sendAutomatedEmail.js`
has the gate, suppression, footer and Resend wiring; only the triggers are missing. **Deferred by
decision this session:** the headline email, *New Job Matches*, needs a nightly job scanning all
users × jobs — exactly the read-heavy work the D1 instruction defers to last — and any live email
needs founder sign-off on copy + cadence. The two cheaper emails (Ghost Risk, Rating Reminders)
key off the user's own applied list and can be built dark when we pick this up. Sequenced after D1
rather than fighting the D1-defer instruction.

### ✅ P1-4 Full internal application + EEO — **FIXED v145**
Shipped as approved. The apply flow now collects a **minimal standard application** (work
authorization, sponsorship, contact prefilled from the résumé) that the hiring employer sees,
plus a **voluntary EEO block** (gender/race/veteran/disability, all defaulting to "decline")
stored where **no employer can ever read it**: `eeo_responses/{uid}/jobs/{jobId}`, read
admin-or-owner-only, `isRecruiter` deliberately absent. The EEO write is fire-and-forget — a
failed write can never masquerade as a failed application. Proven by the emulator: the recruiter
who **owns** the job and **can** read the application is **denied** the EEO row.
> Keyed by `uid` in the *path* rather than a flat `{uid}_{jobId}` id, so the security rule can
> verify the writer directly (rules can't split a compound id). Same data, enforceable.

---

## P2 — Friction / polish

| # | Item | Status |
|---|---|---|
| ✅ P2-1 | Desktop "Save this job" below the fold — `syncDeckHeight()` had one caller and never ran on paint or card advance | **Fixed v143** |
| ✅ P2-2 | Accordion left 333px of permanent dead space (measured mid-CSS-transition) | **Fixed v143** |
| ✅ P2-3 | One person could inflate a job's report count (random doc id per report) | **Fixed v143** |
| ✅ P2-4 | "N reported" badge unexplained | **Fixed v143** |
| 🟠 P2-5 | Browse filter panel → collapsed accordion | Approved, unbuilt **[UI-REVIEW]** |
| 🟠 P2-6 | Staffing agencies flood the deck (Robert Half = 3 *genuinely different* jobs, not a recycle bug — your flagging worked all 3 times). Needs an optional "hide all roles from this company" | Unbuilt **[UI-REVIEW]** |
| 🟢 P2-7 | Legacy employer job docs lack `region` (written correctly at post time since v118) | Self-heals on re-save |

---

## Deferred by founder instruction

- **D1 — Firestore read-cost** (~163K/24h). Explicitly last; trial covers cost to 2026-09-19.
- **Stripe live-payment verification** — tabled with D1.

---

## The exhaustive audit — now DONE (was owed)

The every-link/every-flow pass I previously said I had *not* done **has now been done** —
see "Verification audit" near the top. Summary: 13/13 fix markers present + mirror-consistent;
1,620 live handlers swept with zero dead; all nav routes correct; the static handler audit
covers every un-rendered template too; AI-feature functions all present and wired with a tested
fallback layer. The only things that remain unverifiable from here are the ones that inherently
require your live environment — AI output *quality* (needs the Worker), Stripe live payments
(deferred), and the reverse-match *outcome* (P1-2, one log line from you).

---

## Founder action list

1. ✅ ~~Enable Firestore point-in-time recovery~~ — **done**, enabled ~v140.
2. ✅ ~~Confirm the rules job is green in CI~~ — **green**; also run locally this session, 120/120.
3. **Deploy v145** (drag-and-drop `index.html` + `GhostProofJob.html` + `sw.js`; never paste).
4. **Read the Reverse Match run log line** (P1-2) — one line ends that investigation.
5. **Expand your live employer listing past 26 chars** — it now scores 3% and won't be pinned
   until it clears the relevance gate (P1-1). Highest-leverage thing for the employer side.
6. Live-test the AI output quality (cover letter, rater, ATS preview) — the one surface the
   automated gate can't reach.

---

## Release infrastructure — live as of 79713dc

- **`stable` branch exists** and is advanced by CI only, after all four gates pass.
  Redeploy from it at any time. See `docs/release-policy.md` for the three rollback levels.
- **Mass-flake class eliminated.** The suite was failing ~25 tests at random with
  `ReferenceError` on functions that plainly exist. Cause was the app reloading itself
  mid-test (service-worker `controllerchange`, and the desktop-breakpoint media query).
  Both reloads are correct for real users and were left alone; the tests stop racing them.
  Full suite now 437/438, 0 flaky.
