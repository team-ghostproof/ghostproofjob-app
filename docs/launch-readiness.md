# GhostProofJob — Launch Readiness

**Build:** v143 · **Updated:** 2026-07-21 · **Status:** NOT launch-ready — 1 catastrophic item open, 4 blocking

How to read this: items are ordered by *what it costs the user if it ships broken*, not by
effort. A P0 destroys user data or makes the core promise false. A P1 makes a paid-for or
advertised feature not work. A P2 is friction. Anything marked **[UI-REVIEW]** needs your
sign-off on the approach before code is written.

---

## Verification status of v143 (committed `709ca7d`, NOT yet deployed)

| Gate | Result |
|---|---|
| §4 benchmark | **GREEN** — RAN TO COMPLETION, div delta 0, mirror byte-identical, 0 dupe ids, handlers resolve, v143 markers in sync |
| Backend suites | **99/99** (match 41, growth 11, email 6, apply 5, seo 18, billing 18) |
| Playwright chromium | **214/214** |
| New coverage | 11 new `[STATE-COVERAGE]` tests |
| Firestore rules | **NOT VERIFIED LOCALLY** — no Java this session. `rules.yml` in CI is the arbiter |

> **You are currently running v142.** Everything below marked "fixed in v143" is fixed in
> the committed code, not in what you are testing. Deploy before re-testing.

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

### 🔴 P1-1 Employer jobs are effectively invisible — **OPEN** **[UI-REVIEW]**
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

### 🔴 P1-3 Notification emails — 3 of 4 toggles do nothing
Currently labeled `· EMAIL NOT LIVE YET` and dimmed, so the UI is honest, but New Job Matches /
Ghost Risk Alerts / Company Rating Reminders are unbuilt. `sendAutomatedEmail.js` already has
the gate, suppression, footer and Resend wiring — only the trigger is missing.

### 🔴 P1-4 Full internal application + EEO — approved, unbuilt **[UI-REVIEW]**
Must use a separate `eeo_responses/{uid}_{jobId}` collection with **no employer read access at
the rules level**, aggregate-only. Standard US application fields.

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

## Not yet done — stated plainly

You asked me to *"test every link, flow, function, process and feature."* **I have not done
that exhaustive pass.** What I did this session was targeted: I reproduced and fixed the
specific failures you reported, traced the internal-apply and reverse-match paths end to end
against live data, and ran the full automated suite. A genuine every-link/every-flow audit is
a separate piece of work and is the **next task** — I would rather say so than let the green
test numbers imply coverage they don't provide.

Specifically unaudited: every footer/nav link target, the résumé template/export paths, the
AI feature set (cover letter quality, rater, ATS preview — all still open from the older
roadmap), and the recruiter billing/plan-cap flows.

---

## Founder action list

1. ✅ ~~Enable Firestore point-in-time recovery~~ — **done**, enabled ~v140.
2. ✅ ~~Confirm the rules job is green in CI~~ — **green**, full gate passed on `79713dc`.
3. **Deploy v143** (drag-and-drop `index.html` + `GhostProofJob.html` + `sw.js`; never paste).
4. **Read the Reverse Match run log line** (P1-2) — one line ends that investigation.
5. Re-test the accordion + Save button **on desktop, on v143**.
6. Approve or reject the **P1-1 A+B** approach so employer jobs become reachable.

---

## Release infrastructure — live as of 79713dc

- **`stable` branch exists** and is advanced by CI only, after all four gates pass.
  Redeploy from it at any time. See `docs/release-policy.md` for the three rollback levels.
- **Mass-flake class eliminated.** The suite was failing ~25 tests at random with
  `ReferenceError` on functions that plainly exist. Cause was the app reloading itself
  mid-test (service-worker `controllerchange`, and the desktop-breakpoint media query).
  Both reloads are correct for real users and were left alone; the tests stop racing them.
  Full suite now 437/438, 0 flaky.
