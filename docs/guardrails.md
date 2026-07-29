# GhostProofJob — Guardrails, Rules & Testing Protocol

**Single source of truth.** Owner: Aaliyah (founder). Consolidated 2026-07-29 at v159.
Nothing in this file may be removed without the founder's explicit confirmation.
Frozen pre-consolidation copy: `docs/CLAUDE-v159-archive.md`.

> **The rule behind every other rule:** *assumption instead of verification* has caused
> every incident in this project's history. Verify, then claim.

---

## 0. Working discipline (founder-directed, 2026-07-29)

These exist because the same failure kept repeating: half-answers delivered confidently,
from a partial read.

**0.1 NO GUESSING, EVER.** If it has not been read or run, it is not known. "Probably",
"should be", "I believe" are not answers. Say "I have not checked" and then check.

**0.2 Read every relevant line before answering.** Full read/scan of the actual code,
config, docs, and history — not recall, not a summary, not a doc that may itself be stale.
Docs can be wrong: `release-policy.md` framing was compressed into a false flat claim twice
in one session (see 0.6).

**0.3 Never bypass a rule, guardrail, or testing protocol. Ask first.** If a step seems
unnecessary or slow, that is not authorisation to skip it — that is exactly how things get
missed and broken. Ask, get a yes, then proceed.

**0.4 Validate the instrument before reporting a negative.** A new probe's
"missing/broken/empty" reading proves nothing until that same probe returns a known-true
positive. Two false P0s came from skipping this:
- `window.resumeData` — top-level `const` is **never** a window property, so the guard was
  always falsy; reported as data loss when the résumé had loaded perfectly.
- `#view-stats` — that element does not exist; the 0-char reading was the selector, not a bug.
Every test asserting an absence needs a paired positive control.

**0.5 State the platform quota BEFORE building.** Not after the deploy fails.

**0.6 Do not flatten a nuanced source into a blunt claim.** Both of these were wrong:
- "the benchmark is v67" → it is **v143** (`release-policy.md`).
- "every version v20–v142 carries the sign-out data-loss bug" → the vulnerability was
  **latent** from v20 but only became **catastrophic at v137**. Before that, `cloudSync`
  wrote often enough that the cloud held a recent copy and sign-out/sign-in restored data
  normally — which matches the founder's lived experience. Quote sources; don't paraphrase
  them into something stronger.

**0.7 Report status honestly.** "Verified safe" (nothing broke) and "verified working"
(the fix does what it claims) are different claims. Never let the first imply the second.

---

## 1. Non-regression (founder rule #1, set 2026-07-03)

**1.1 A change must not break any existing feature, flow, link, or the UI.** (`TESTING.md`)

**1.2 INSERT-ONLY.** Add narrowly to what exists. Never rebuild, restructure or redesign
layout/UI/logic. Never rewrite or deprecate existing architecture without explicit
authorisation.

**1.3 Never regress a prior fix.** If a change unavoidably alters behaviour, disclose it
upfront and get sign-off before writing it.

**1.4 The benchmark is v143** — not v67, and not "the last version that worked". Every
build must hold the v143 floor.

---

## 2. Approval gates

**2.1 `[UI-REVIEW]`** — any change touching layout, a view, an overlay, z-index/stacking,
visual behaviour, **or a core process flow**: STOP, propose the approach, get explicit
approval **before writing code**. Not at push time.

**2.2 Change classes** (`docs/release-policy.md`)
- **Bug fix** — makes already-agreed behaviour correct. No new surface. Auto-approved once green.
- **Feature / behaviour change** — adds surface, changes a flow, alters layout or stacking,
  or changes how data is stored. Requires all five, then *ask and wait*:
  1. What it changes, in plain language
  2. Full impact audit — every feature touching this code, and why each still works
  3. The `[STATE-COVERAGE]` matrix
  4. Honest failure modes — not reassurance
  5. **The exact rollback command**

**2.3 Data-write changes are feature-class ALWAYS**, even when fixing a bug.
*"This class has caused every catastrophic incident so far."*

**2.4 Ask before:** editing the Cloudflare Worker · changing `firestore.rules` · consuming
any new quota · **deleting or renaming any existing file**.

**2.5 Full drop-in files** for every changed file — never snippets. (Snippets caused a
broken `Redirectresolver.js` merge.)

---

## 3. `[STATE-COVERAGE]` — required before code

Map and output the 4-quadrant matrix for every feature or fix:
1. Guest / logged-out · 2. Authenticated · 3. Interrupted / failed network · 4. Empty / missing data

Verify existing Playwright tests cover all four, or write the missing test **before** pushing.

---

## 4. `[FREE-TIER]` — $0 infrastructure budget

GPJ runs on free plans by design. The founder pays for the AI résumé helper and Claude —
nothing else. State the quota consumed and confirm headroom **before** adding any endpoint,
workflow, cron, bucket, or third-party service.

**Known ceilings**
| Limit | Value |
|---|---|
| Vercel Hobby serverless functions | **12 per deployment** — every `api/*.js` counts, *including non-handler helpers*. Broke deploys **twice**. Keep helpers in `.vercelignore`. |
| Firestore free tier | 50K reads/day. Trial credit covers overage only to **2026-09-19**. |
| Sitemap | 50,000 URLs per file |
| Firestore doc | 1 MiB |

Prefer designs that consume no per-user quota (static/CDN, pre-computed snapshots,
client-side compute) over per-request backend work.

---

## 5. The testing protocol

**5.1 Playwright runs after every code modification** — founder rule #2, 2026-07-03,
confirmed unchanged 2026-07-29. This is what has historically caught regressions and false
answers. Not per build — per edit.

**5.2 `npm run verify` is the gate.** As of 2026-07-29 it runs **full coverage**:

| Layer | What it covers |
|---|---|
| `benchmark` | the 8 steps below |
| `test:match` `test:growth` `test:email` `test:apply` `test:seo` `test:billing` | backend logic |
| `pool:check` | job-pool builder |
| `test:e2e:full` | **all Playwright projects** — chromium, mobile, authed, visual, recruiter |
| `test:rules` | Firestore security rules (needs Java; `verify:nojava` omits only this) |

*Before this date `verify` ran chromium only — guest desktop. Signed-in, mobile, recruiter
and visual were silently absent from the gate. Never narrow it again without asking.*

**5.3 Three-account coverage is mandatory:** new/guest · logged-in test account · recruiter.
A suite that self-skips is **not** coverage — see 5.6.

**5.4 The benchmark's 8 steps**
1. JS syntax on extracted inline script
2. **Boot harness — must print "RAN TO COMPLETION"** (catches TDZ crashes `node --check` cannot)
3. `<div>` open/close delta = 0
4. `index.html` ↔ `GhostProofJob.html` byte-identical
5. No duplicate DOM ids
6. Every `on*` handler resolves
7. Three version markers in sync (`APP_VERSION`, `build-stamp`, `CACHE_VERSION`)
8. Free-tier platform limits (function count, `vercel.json` schema, exact-case requires, sitemap cap)

**5.5 `--workers=2` is the documented stable setting.** The suite flakes under parallel load;
failures rotate and pass 3/3 in isolation. **Do not raise it to speed CI up.**

**5.6 A skipped suite is a RED flag, not a green one.** `recruiter.spec.js` self-skips when no
session is established, so it passed as a no-op for its entire life. Always read the skip
count, and treat any skip as unverified until explained.

**5.7 Never trust a piped exit code.** `... | tail` reports `tail`'s status. Capture the real
`$?` / `PIPESTATUS`.

**5.8 Poll for the real precondition; never a fixed `setTimeout`.** Fixed delays hide races.
Gate on the firebase **module** landing (it replaces `window.fb` and nulls `_recruiter`),
not on the inline script.

---

## 6. Release, branches & rollback

**6.1** There must always be one commit that can be redeployed and is known-good —
**verified by machine, not by anyone's memory.**

**6.2 Branches:** `main` = work in progress, may be broken · `stable` = every gate passed,
**advanced by CI only, never by hand.**

**6.3 `main` is wired to Vercel — pushing deploys to production.** Get explicit go-ahead.

**6.4 Rollback, three levels** — prefer (3): it is reversible and leaves an audit trail.
1. Redeploy `index.html` / `GhostProofJob.html` / `sw.js` from `stable` (**drag-and-drop only —
   pasting truncates the file**)
2. `git reset --hard origin/stable` + `git push --force-with-lease origin main`
3. `git revert <sha>` + `git push origin main`

**6.5 Say explicitly when a change needs a deploy** to take effect (rules, Worker, env).

---

## 7. Product honesty

**7.1** No misleading copy. Honest "jump to apply" only — auto-apply is architecturally
impossible (browser same-origin). No demo/sample data in live views. No Google scraping (ToS).

**7.2** Every AI feature must say when it fell back to templates and when live AI returned.

**7.3** No public hire claims until an aggregate view exists with real numbers.

**7.4 Honesty over optimism.** Say when something is impossible or unverifiable rather than
shipping a workaround or overclaiming a fix.

**7.5** Applications are always unlimited. Never paywall a must-have.

---

## 8. Deferred by founder instruction

- **D1 Firestore read-cost reduction** — deliberately LAST
- **Stripe live-payment verification** — last, until a real payment runs
- **Harvested-job indexing** — never, unless ATS-sourced via official APIs after legal review

---

## 9. Known-fatal technical gotchas

- **TDZ / boot order** — a top-level read before a `let`/`const` initialises throws and halts
  the ENTIRE script. `typeof x` does **not** save you. Verify with the boot harness.
- **`resumeData` is a `const` binding** — mutate properties, never reassign. Also therefore
  **not on `window`**.
- **Firestore rejects `undefined`** field values — `setDoc` throws.
- **Vercel filesystem is case-sensitive** — `firestoreWriter.js` / `redirectResolver.js` must
  match their `require` exactly or the module silently fails.
- **Never paste `index.html` into GitHub** — drag-upload only; pasting truncates it.
- **Bind to the data model, not the DOM.** `_currentTopJob()` is the source of truth for the
  swipe card. Stale `.job-card.top` reads caused wrong-job, recycle, and (v160) wrong-job-sent-
  to-the-AI bugs.
- **Harvester config lives in GitHub Actions Variables** — never hand-edit the `.py`.
- **Guard any snippet that must survive a full-file rewrite** (Speed Insights was silently lost).

---

## 10. Founder-only actions (cannot be done for you)

- [x] Firestore point-in-time recovery — **already enabled**
- [ ] Branch protection on `stable` (CI-only push, no force push)
- [ ] Branch protection on `main` (require `verify` to pass)
- [ ] Deploy `firestore.rules` (turns on the D1 pool + v148 interview fields)
- [ ] Walk account creation end to end — Claude cannot create accounts or enter passwords,
      so signup → profile write → first-run state has never been exercised by anyone
- [ ] Confirm the recruiter test account credentials (login currently times out — see task #7)
