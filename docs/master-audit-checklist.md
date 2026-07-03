# GhostProofJob — Master Audit Checklist & Roadmap

**Frontend benchmark:** v67 (verified: self-test 19/0 · JS clean · div delta 0 · mirror identical · boot harness runs to completion · 0 missing handlers · 0 real dup IDs)
**Current build:** v73 (deployed). **v74 = next sprint** (Claude Code). v73 = deck Best-Match role-first + always-remote + apply→Applied.
**Updated:** 2026-07-03

## How to read this
- Status: [x] done & verified · [~] partial · [ ] not started
- [UI-REVIEW] = changes layout / a view / an overlay. I STOP and review the approach with you before writing that code.
- ETA = target version. Every build ends with: benchmark + end-to-end pass + PDF docs (this checklist + Feature Launch Doc if a new feature was added) + code/files + implementation instructions + a test checklist for you + any screenshots I need to review before the next batch.

---

## SECTION 1 — VERIFIED WORKING (v67 benchmark)
Known-good surface. Nothing below may regress it.
- [x] Boot / desktop grid / auth (fixed v67)
- [x] Swipe deck (3-card, swipe/skip/apply, unseen-only, shared seen-set)
- [x] Browse (lookup, keyword, region, dropdowns render, cached pool + filters)
- [x] Apply routing (ad-wall + anti-framing new-tab; sandbox retired)
- [x] Match-to-Job on cards
- [x] Resume Studio (upload/parse, LinkedIn import, Skills + repeatable Education + Licenses/Certs, PDF export)
- [x] Cover letters (job-aware, revisions, stored)
- [x] Ghost Reports / company drawer
- [x] Saved Jobs & Companies (local + Firestore)
- [x] Cross-device reset tombstone
- [x] Day counter / grace tiers
- [x] PWA (installable, versioned cache + refresh banner)
- [x] AI fair-use gating (caps by tier)

## SECTION 2 — COMPLETED FIXES
- [x] v73 — Deck fixes (VERIFIED 2026-07-03: apply→Applied recording confirmed live — the Applied bucket populates; remote-always-in-deck confirmed in code; role-first sort landed but its ordering effect is pending live confirm until B-DECK-POOL is fixed, since the pool itself was starving the deck of in-field roles): (a) the deck's "Best Match" now leads with the user's FIELD at the FINAL render sort (applySwipeFilters was re-sorting by raw match, which discarded v72's role ranking — that's why v72 didn't change the deck); (b) REMOTE jobs are now always included in the deck (were only added when local <8), surfacing remote + reducing early dead-ends; (c) B-APPLY-BUCKET: "View Full Posting" now records to Applied (deduped) + advances the deck.
- [x] v72 — B1 (role-first, CODE done; NEEDS your live confirmation): the swipe deck now leads with the user's field — a job earns the "primary" tier only if its title contains the résumé field word (marketing, pharmacy…), and the deck orders tier -> in-field -> score, so Marketing leads and off-field roles (Operations) only appear after in-field is exhausted. Graceful: no résumé/field => unchanged. Location scoping untouched. + Option A (B-DRAWER-COLLAPSE): the expanded drawer now fully closes on advance (removed the leftover #card-drawer.open), so the next card opens fresh.
- [x] v71 — B0 (stays-open): "View Full Posting"/apply now resolves the link at CLICK time from the data-model top job, so a drawer left open across a swipe still opens the current job. + F-FLAGMARK: flagged jobs show a red flag next to the ghost in the Skipped list. + B-REVIEW-Z: the company rating prompt (vibe-review) raised above the company modal so it no longer opens behind the card.
- [x] v70 — B-RECYCLE: flagging a job now records the CURRENT top job’s exact identity from the data model (not the DOM card, which could lag a card), so the flag key matches the deck jobKey and the job (e.g. Operations Manager @ Huntsman) stays hidden even after a reset. (Re-flag the job once post-v70 to overwrite the old mismatched key.)
- [x] v69 — B0 (wrong job on card): the expanded drawer + company view + "View Full Posting" now read the CURRENT top job from the data model (`_currentTopJob`), not the on-screen card element, so a card can never open the previously-flagged job's posting. (Re-expanding the next card now shows the correct job.)
- [x] v69 — B-NAN: community ghost reports no longer show "undefined NaNd ago" — a report stores a proper label + timestamp, and legacy reports render cleanly.
- [x] v68 — ATS write path revived: `Firestorewriter.js` -> `firestoreWriter.js` (case fix; was silently failing ALL ATS writes), rich fields (`description/requirements/benefits/salary_min-max/is_remote`) now carried through `regionalRouter.normalizedJob`, and `Redirectresolver.js` replaced by `redirectResolver.js` (matches the require + exposes the `resolve` alias; the old bare-function export was broken).
- [x] v68 — Playwright `screenshots.spec.js` crash fixed (describe-level `test.skip(testInfo...)` moved into `beforeEach`, where `testInfo` exists).
- [x] v67 — Boot crash (TDZ on `lists`) guarded; verified by mocked-browser boot harness.
- [x] v66 — Flagged-job recycle (durable local `gpj_expired` across all deck paths).
- [x] v66 — Deck<->Browse bleed (deck reads master `gpj_loc` + résumé role).
- [x] v66 — Salary-toggle resurrection (full hidden set in applySwipeFilters).
- [x] v66 — Region-exhausted UX + "load other cities" (loadDeckOtherCities).
- [x] v66 — Quick Start intro link (modal lifted to body).

---

## SECTION 3 — OUTSTANDING BUGS (priority order)

### [x] B0 · Card wrong apply URL — FIXED v69 (data-model binding) + v71 (click-time resolution for a drawer left open across a swipe).
What it is: on deck advance the title/company header updates but sub-elements (View-Full-Posting URL, Recent Company News, ghost data) keep the PREVIOUS card's values. Result: card shows "Operations Manager - Logixs Search" but "View Full Posting" opens the just-skipped CVS job and the news links say "CVS Health."
Resolves: users stop being sent to the wrong job; every card element reflects the current job.
Root cause (found): the expanded drawer / company-intel sub-elements are populated from a stale job reference, not refreshed on advance.
Plan (insert-only): bind View-Full-Posting + company-intel + ghost data to the current top job on every advance; clear stale values when a slot repaints. Logic only.

### [x] B-RECYCLE · Deck recycle — FIXED v70 (flag binds to data-model top job). User action: flag the recycling job once more post-deploy to overwrite the old key.
**What it is:** self-test now reports "Deck shows only unseen jobs — 1 already-seen card in deck." After a deck reset + flag, a seen/saved/flagged job slipped back into the deck. Same class as the original Huntsman recycle: a key-normalization mismatch means `_deckHiddenSet` doesn't recognize the job as already-acted-on.
**Resolves:** deck truly shows only unseen jobs; self-test green again.
**Plan:** need the specific recycled job (title/company) to pin the key mismatch; then normalize the deck jobKey against lists/saved/expired keys identically. Logic only. **REPRO NEEDED from you.**

### B-DECK-POOL · Deck pool ≠ Browse pool; deck dead-ends & misses high-match roles  ·  ETA v74  ·  HIGHEST
**What it is:** the deck exhausted at ~45 jobs ("seen everything in your region") while Browse showed ~925 — and served LOW-match Operations (16–52%) while Browse held 98%-match Marketing/Account roles in the SAME market. The deck's server-side region-field query (`fb.fetchJobs(regionKey,3000)`) misses jobs stored with broad `region` values that Browse catches via client-side location-TEXT filtering, so the deck and Browse draw different pools.
**Fix:** make the deck draw the same catchment as Browse (metro + remote, matched on location TEXT, not just the region field), then apply the role-first sort; refill/broaden (metro → remote → same-state → statewide via the approved control) BEFORE the empty state. Partly mitigated v73 (remote always included). Needs live verification.

### B-SARATOGA · Browse shows out-of-region jobs (e.g. Saratoga Springs, NY)  ·  ETA v74  ·  [UI-REVIEW] (control)
**What it is:** with location = Houston, Browse still surfaces out-of-region roles (Saratoga Springs, NY). Browse must hard-scope to the profile market by default and only widen via the approved "other regions" control (a pill; never widens on its own). Pairs with B-SALARY-CYCLE.

### B-THISROLE · "this role" placeholder leaks into Applied + cover letters  ·  ETA v74  ·  HIGH
**What it is:** a missing job title falls back to the literal string "this role" — it appears as a phantom job in the Applied bucket ("this role · Serenity Healthcare · 34%") and inside the cover-letter prompt ("apply for the this role position"). Fix title resolution in the cover-letter / Match-to-Job / apply path so a real title is always used (or the item skipped); never the placeholder. Cross-ref F-COVERLETTER.

### B-DESC-CUT · Card description cuts mid-word ("Job Re")  ·  ETA v74  ·  low
**What it is:** an expanded card's description ends mid-word. Check whether the harvested description is truncated at source vs a display slice; cut on a word boundary + ellipsis.

### B-STUCK · Flagged card stuck in collapsed mode (won't expand)  ·  ETA v70  ·  HIGH
**What it is:** after flagging a (recycled) job, the top card won't expand on tap.
**Resolves:** every deck card expands.
**Plan:** likely tied to B-RECYCLE (the stuck card is the recycled one in a bad state) — investigate together. **REPRO NEEDED: does it happen only right after Report&hide, and is the deck near-empty then?**

### B-SALARY-CYCLE · "Only show jobs with posted salary" toggle cycles random-region jobs  ·  ETA v70  ·  HIGH
**What it is:** toggling posted-salary on/off pulls NEW jobs in random regions (not scoped to Houston/remote). It does match résumé (Marketing + Sales/Account Exec) but ignores the market-scope flow.
**Resolves:** the salary toggle filters the EXISTING in-market pool instead of re-pulling out-of-region jobs.
**Plan:** make the toggle a pure client-side filter over the current scoped pool; never trigger a fresh out-of-region pull. Pairs with B1 (market scope). Logic only.

### [x] B-REVIEW-Z · Review opens behind card — FIXED v71 (vibe-review z-index 331 -> 360, above company modal 345).
**What it is:** the review prompt does open, but its scrim (z-index 9100) sits below the card/company modal (9600-9999), so the user can't see it until they close the card.
**Resolves:** the review prompt appears on top, immediately usable.
**Plan:** raise the review-modal stacking above the card/company modal (below top toasts). Layering touch -> quick [UI-REVIEW] before coding. Pairs with F-REVIEW.

### [~] B1 · Deck role + market matching — ROLE-FIRST done v72–v73; BLEND decision locked; market hard-scope remaining  ·  ETA v74
**Founder decision (LOCKED): BLEND.** The deck weighs BOTH the most-recent-role TITLE (`_resumeFieldWord`, e.g. "marketing") AND the strongest CONTENT match (`computeMatch`). Context: the test résumé's title ("Marketing Specialist") diverges from its Account/Operations content; both Marketing and Account scored 98% in Browse. Role-first sort landed v73; the remaining gap is the POOL (see B-DECK-POOL) + market hard-scope + the "other regions" control. Do NOT lead by title alone or content alone — blend them.
What it is: signed in as a Marketing Specialist the deck shows Operations/Manager (the deck only RANKS by role, never FILTERS); Browse doesn't hard-scope to market (surfaced Coatesville, PA above Houston with location = Houston). "Start Swiping Matched Jobs" from the résumé page correctly shows Marketing, proving the deck's default anchor is wrong.
Resolves: deck leads with the user's actual field/most-recent role; both surfaces stay in-market until the user opts out.
Your exact ladder spec: start at most-recent role/duties/skills/certs -> then auto-load other résumé matches -> when region exhausted, prompt to show other parts of the state -> then statewide -> location-first throughout.
Plan (insert-only): add a role-relevance gate to the deck's scoped pull (in-field first, off-field backfills only when exhausted, reusing existing field detection); hard-scope Browse to the profile market by default. Logic only, except: [UI-REVIEW] a Browse "show roles from other regions" control (review placement first).

### B-SKIP-APPLY · Apply (and Match/Cover) dead on Skipped jobs / company modal  ·  ETA v71 (tied to F-CARD)
**What it is:** opening a skipped job opens a COMPANY modal that shows a generic "Hiring Company" name and dead Apply / Match to Job / Cover Letter buttons (no job URL/context carried). Skipped rows should open the JOB card (per F-CARD).
**Resolves:** every button works; the correct job/company shows.
**Plan:** carry the job’s real url/company/context into the skipped-open path; render a JOB card (F-CARD) not a company card. [UI-REVIEW] with F-CARD.
What it is: opening a skipped job (e.g., Logixs Operations Manager) and tapping Apply does nothing.
Resolves: users can act on skipped jobs.
Plan: trace the skipped-view apply handler (likely tied to B0 stale binding + the Skipped view rendering company cards, see F-CARD). Logic.

### B-NAN · "undefined NaNd ago" / "UNDEFINED% - SUMMARY" on company/ghost card  ·  ETA v69
What it is: company/ghost-report card prints undefined values and NaN date math.
Resolves: clean, correct card text.
Plan: guard the fields + date formatting; when a report exists show a simple message (see F-GHOST). Logic.

### B2 · Work-style filter (Remote/Hybrid/On-site) not applied  ·  ETA v70  ·  logic only
### B3 · Salary controls (min-salary slider / posted-salary)  ·  ETA v70  ·  logic only
### B4 · Browse sort + header dropdown clipping  ·  ETA v70  ·  [UI-REVIEW] for the dropdown clipping
### B5 · Résumé City/State pre-fill (appears wired; verify on deploy)  ·  ETA v70
### [x] B6 · ATS write-path (filename case + resolver) — DONE v68 (Layer 2 Atsingest no-op left for later)
CONFIRMED: repo file is `Firestorewriter.js` but every `require('./firestoreWriter')` uses camelCase -> on Vercel (case-sensitive) all ATS writes silently fail. Also `regionalRouter` calls `resolver.resolve` (module exports `resolveLink`/`resolveBatch`) -> dead gap-fill path; `Atsingest` Layer 2 is a no-op. Backend only.
### B7 · Console warnings (password-not-in-form; leftover sandboxed iframe)  ·  ETA v71 · low

---

## SECTION 4 — OUTSTANDING FEATURES (priority order)

### [x] F-ATS · ATS rich-field pipeline — DONE v68
`publicAggregator` already parses description/requirements/responsibilities/benefits/salary; `regionalRouter.normalizedJob` strips them before the write. Extend it to carry them so ATS cards match JobSpy cards. Backend only.

### F-CARD · Universal job & company cards  ·  ETA v70  ·  [UI-REVIEW]
- One standard card everywhere = the Swipe card (collapsed = summary; expanded = all ATS fields), no clipping/incomplete titles.
- Skipped tab must render JOB cards (it currently shows COMPANY cards).
- Desktop: a Browse job expands to the SAME width as the expanded Swipe card so "Job Expectations & Summary" fits.
- Per-context behavior differences only (how apply/skip/"not interested" react in Browse vs Swipe) — same info everywhere.
- Company cards: universal; expanded view mirrors the job-card expanded view but with company data; expands to swipe-card size per device; includes Recent Company News ("Latest news about X", "X: hiring & layoff coverage") + Connect with Hiring Team (briefcase/x/building/web).

### F-ADDR · Résumé address + contact layout toggles  ·  ETA v70  ·  [UI-REVIEW]
- Show-address toggle (default off).
- Layout choice: stack phone + location under name/title, OR keep horizontal-with-email (current).
- Full address vs City, State only.
- All 3 toggles must populate, save, and reflect on download; must NOT break export, accent colors, headshot, or spacing. End-to-end export check.

### F-GHOST · Crowd-sourced ghost reporting  ·  ETA v70  ·  [UI-REVIEW] (badge/popup)
- Firestore-aggregated flag count.
- When someone opens a reported job, show a simple popup: "Another hunter has reported this job."
- A flagged job moves to the Skipped tab (never recycles); if the user later taps Apply on it, use the universal prompt to ask if the flag was a mistake -> remove/keep -> adjust the company/job ghost % to account for accidental flags.

### F-REVIEW · One unified review flow everywhere  ·  ETA v72  ·  [UI-REVIEW]
**What it is/does:** all company/job reviews should use the SAME prompt flow we already built for reviewing a job from the past-jobs section (the `review-modal`). Today the company card uses a different inline "Rate ★" + "Report this company." Unify so the platform is consistent and we stop rebuilding review UIs.
**Plan:** route the company-card rating/report action into the existing `review-modal` flow. Pairs with B-REVIEW-Z (stacking) and F-CARD (company card).

### [x] F-FLAGMARK · Red-flag on flagged Skipped rows — DONE v71.
**What it is/does:** when a user flags "no longer accepting," the job correctly moves to the Skipped tab — add a small red-flag emoji next to the ghost icon on that row so they can tell which ones THEY flagged.
**Plan:** in `renderStatList`, detect flagged entries (stage/reason = "No longer accepting applications") and prefix a flag marker. Tiny render tweak. Bundle with F-GHOST.

### F-COVERLETTER · AI cover-letter quality  ·  ETA v74 (with F-AI)
**What it is:** generated letters read "the this role position" (B-THISROLE placeholder) and force a résumé keyword (e.g. "Operations") onto the role. Fix the role-title fill; make the emphasis reflect the ACTUAL posting, not a résumé keyword.

### F-RATER · Resume Rater + "Match to Job" accuracy  ·  ETA v74
Verify the rater reads the WHOLE résumé and rates against job data professionally. NOTE (evidence): "Match to Job" produced near-identical résumés across 3 different target roles (HR Generalist / Ops Trainee / Sr Ops) — only light skill tweaks, no title/experience reframing; Jett summary rewrites read generic ("It's not great"). Strengthen role-tailoring (reframe summary + reorder/weight bullets toward the target posting) and rewrite specificity.
Verify it reads the WHOLE résumé (jobs/skills/roles/certs) and rates against live job data on a professional standard; provide word-count / improvement guidance grounded in strong real examples.

### F-ATSPREVIEW · ATS preview accuracy  ·  ETA v70
Verify the ATS preview shows the real machine-readable data the user will actually submit.

### F-AI · AI features / limits / persistence / safeguards  ·  ETA v71
**Quality note (2026-07-03, see F-RATER for evidence):** "Match to Job" outputs were near-identical across 3 different target roles and Jett summary rewrites read generic — strengthen role-tailoring + rewrite specificity as part of this item.
All AI features work; per-tier counting/limits enforce correctly; store data after each end-user rewrite so it can inform future résumés; safeguards active but not over-restrictive. Note: OpenAI-in-background runs via the Cloudflare Worker (the gcloud dependency was removed in a past build by changing how the system talks to it) — confirm Worker is the live path.

### F-WORDING · Site-wide wording / pricing / messaging sweep  ·  ETA v71
Consistent, transparent copy about features, limitations, pricing, and how GPJ helps.

### F-TPL · Five résumé template layouts  ·  ETA v72  ·  [UI-REVIEW]
### F-DESK · Desktop polish (Batch 4: footer, startup scroll, width parity, LinkedIn button)  ·  ETA v72  ·  [UI-REVIEW]
### F-LADDER · Same-state broaden rung (bundle w/ Firestore cost)  ·  ETA v72
### [~] F-TEST · Playwright: signed-in + robust backend + intro capture  ·  ETA v71  ·  SCREENSHOTS FIXED 2026-07-03
**Note:** screenshots FIXED 2026-07-03 (pushed, commit 6ed646e) — root cause: the beforeEach guard skipped unless the project was 'chromium', but the config runs the spec only in the 'visual' project, so all 4 captures always skipped. Guard now checks 'visual'; webServer command made portable (`python`, works on Windows dev + ubuntu CI). Verified 4/4 visual pass, 9 PNGs in ./screenshots, CI uploads the artifact. Remaining scope: signed-in coverage + robust backend + intro capture.
### F-BACK · Cloudflare Worker live-path confirm + email-routing 503 + contact-form reply confirm  ·  ETA v71

---

## SECTION 5 — DEFERRED (has runway)
### D1 · Firestore read-cost reduction  ·  ETA v72
~163K reads/24h (over 50K/day free tier). Runway: Blaze via Google Cloud Free Trial, $299.51 credit, valid to 2026-09-19 (~80 days). Fix functionality first, then cache the region pool per session, cap query sizes, skip re-fetch when inputs unchanged, paginate. Bundle with F-LADDER. No UI.

---

## SECTION 6 — ROADMAP BY VERSION
- v68 (THIS BUILD, backend-only): F-ATS + B6 — rename Firestorewriter.js -> firestoreWriter.js, carry rich fields through regionalRouter, add resolver alias. Zero frontend risk.
- v69 (frontend correctness): B0 (wrong-URL/partial-repaint), B1 (role/market ladder), B-SKIP-APPLY, B-NAN. Logic-only; one [UI-REVIEW] item (Browse other-regions control).
- v70: B2, B3, B4, B5, F-CARD, F-ADDR, F-GHOST, F-ATSPREVIEW. Several [UI-REVIEW].
- v71: F-RATER, F-AI, F-WORDING, F-TEST, F-BACK, B7.
- v72: F-TPL, F-DESK, F-LADDER, D1 (Firestore cost before trial ends), final end-to-end.

## Go-forward process (agreed)
1. One grouped batch per version, insert-only, no regressions, optimized for mobile/iOS/Android/tablet/desktop.
2. Before any [UI-REVIEW] item: stop, propose, get OK, then code.
3. After each build: benchmark (self-test + boot harness + handler/div checks) + end-to-end pass, then deliver PDFs (this checklist + Feature Launch Doc if a feature was added), all code/files, implementation instructions, a your-side test checklist, and any screenshots I need before the next batch.
4. One clean, verified push per version; mirror identical; version markers bumped.
