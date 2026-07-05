# GhostProofJob — Master Audit Checklist & Roadmap

**Frontend benchmark:** v67 (verified: self-test 19/0 · JS clean · div delta 0 · mirror identical · boot harness runs to completion · 0 missing handlers · 0 real dup IDs)
**Current build:** v77 (built 2026-07-03). v77 = [STATE-COVERAGE] test suite (Q1–Q4) + last clip site removed (job card's own 2400 slice in buildBrowseExpanded). v76 (superseded pre-test by v77) was: v76 = B-DESC-CUT true fix (caps above harvester max — no client-side cut ever) + B-OPENCARD true fix (real job card stacks OVER the company card, z 350) + B-BENEFITS extraction broadened (harvester + aggregator) + F-TEST signed-in harness refined (TEST_USER_* env, tests/utils.js, .env.example). v75 live results: B-APPLY-CONFIRM ✓ confirmed, B-DEMO-FLAG ✓ confirmed; clipping + open-card re-opened → fixed here.
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
- [x] v85 — Small-bug sweep B2/B3/B5/B7 (2026-07-05): B2 + B3 were ALREADY implemented in renderBrowse (checklist predated the fixes) — now VERIFIED by state tests (Remote-only filtering; min-salary drops below-threshold posted salaries, keeps unknown for the toggle); B5 verified (`gpjApplyLocation` city-only pre-fill, tested); B7 FIXED (auth `<form>` wrapper — warning gone, password managers work, Enter submits; sandbox iframe drops allow-same-origin). Suite 62/62 ×2; §5 all-pass v85.
- [x] v84 — B-TEXT-CLIP site-wide (2026-07-05): dynamic popups (.modal-box 88vh + inner scroll + full wrap + visible scrollbar), whole-city location badges (`_locBadge`), word-boundary location pill, company-name wrap. Suite 56/56 ×2.
- [x] v83 — Scroll/clip/rater batch + F-JETT-FULL (2026-07-05, founder-directed): (a) B-SCROLL: pre-v81 descriptions (460 chars) never truly scrolled, so v81's full text exposed that ANY tap inside the expanded box collapsed it (read as "scrollbar gone") — expanded boxes now collapse ONLY via an explicit ▴ collapse bar, taps inside scroll/select freely, and the scrollbar is styled visible (Chrome overlay scrollbars are invisible on the dark theme); job-card summary got the same visible scrollbar. (b) B-MATCH-Z: match-insight modal 335→356 — it opened BEHIND the expanded job card (350); now stacks above it and closing returns to the still-open card; full title shown, wrapping, no 24-char slice. (c) F-RATER: `_realSkillTerm` stopword gate — the corpus miner surfaced high-frequency non-skills ("including") as suggestions AND graded the score against them; filtered before scoring + suggesting. (d) F-JETT-FULL (NEW, founder spec): "Improve My Whole Resume with Jett" under the rating — reads everything, rewrites summary + EVERY job's key duties anchored on the most recent role (internal-first, one AI call with map-back), skills dedupe/capitalize, never invents; consumes 1 Summary + 1 Key-Duties monthly rewrite ONLY when the AI actually contributed (local passes free, same rule as section buttons); re-rates immediately so the score reflects it. Suite 52/52 ×2; §5 all-pass v83.
- [x] v82 — F-AI/F-RATER/F-COVERLETTER client-side quality pass + legacy-doc dressing (2026-07-05): (a) `_aiJobContext` builds ONE labeled context (TARGET ROLE / COMPANY / POSTING ≤1500 chars) for every smart-match call — Match-to-Job previously sent a 200-char desc slice with no title/company (why 3 different roles produced near-identical résumés), the cover-letter AI escalation sent NO job context and NO anti-repetition, and Jett had no quality goals. Now: M2J sends full labeled context + posting-term keywords even when no new skills were added; cover letters send context + avoid-previous; Jett summary/duties carry explicit GOAL framing (ban filler, vary verbs, never invent facts). Worker prompt untouched (repo doesn't hold Worker source — jobContext/avoid are its supported passthroughs). (b) v82 legacy dressing: pre-v80 docs stored mid-word at the 3500 cap ("…within cl") may never re-harvest — cap-length descs without terminal punctuation now display trimmed to a whole word + ellipsis (the founder's OddDuck screenshot was this, NOT a v81 regression — the bullets in that same screenshot are F-STRUCT working). Tests: _aiJobContext unit (labels/cap/empty tiers) + legacy-dressing (dressed vs clean-ending untouched). Suite 46/46 ×2; §5 all-pass v82. FOUNDER VERIFY on live: (1) Match-to-Job against 2-3 different roles now yields visibly different rewrites; (2) this release is ALSO the live test of the v81 What's-New fix — both admin accounts should get the popup on next open.
- [x] v81 — Fake-remote + structured cards + What's-New race (2026-07-04, from asosa's v80 testing): (a) B-FAKE-REMOTE: sources flag HYBRID roles as remote (live proof: Parker & Sons "Hybrid… must be local to Tucson, AZ" with is_remote:true) — `_gpjHybridText`/`_gpjEffectiveRemote` demote body-contradicted remotes to Hybrid client-side (scoping + deck + work_setting/badge), and the harvester demotes at the source (selftest-covered); this kills the Browse "stragglers" that rode in on the remote-always rule with high match scores. (b) F-STRUCT (founder-requested): `_fmtJobText` renders postings the way the source wrote them — real bullets + bold section heads ("Job Responsibilities", "What's In It For Me?") — in the deck drawer, company job panel and expanded job card; mappers now preserve line structure. (c) B-WHATSNEW: the popup ran at boot BEFORE auth resolved → isAdmin false → version marked seen → admins never saw it; non-admins no longer write "seen", and the auth handler re-invokes once admin status is real (asosa/ksosa see notes again from the NEXT release; banner-on-fresh-navigation is correct behavior — a fresh visit already gets the newest build). (d) Benefits header "What's In It For Me" added (harvester + aggregator, 1:1). NOTE: old truncated docs ("There are 6") heal as the daily harvest re-writes them (merge:true). Suite 42/42 ×2; §5 all-pass v81.
- [x] v80 — Stale-client + pool-window batch (2026-07-04, from live v79 feedback; live site verified serving v79 while the founder's device showed pre-v75 behavior — the symptoms were a STUCK CLIENT + a real pool bug): (a) B-UPDATE-STUCK: version re-check on every tab focus + a direct no-store sw.js version probe (banner can never silently stop again); vercel.json now sends no-cache/must-revalidate for sw.js, index.html and /. (b) B-POOL-MERGE: fetchJobs MERGES region-tagged docs (≤800) with the wide newest-3000 — either-alone loses jobs (early-return pre-v74 missed broad-region locals; wide-only v74-v79 lost the metro when 11-20k national docs/day pushed it out of the newest window = "no Houston jobs"); deck + Browse pass regionKey again. Read cost +~800 docs/pool-build — log for D1. (c) Foreign remote (Remote, GB) excluded from US market/state scopes (`_gpjForeignRemote`, US-state-code-safe — tested IN≠India); (d) remote roles badge 🏠 Remote instead of HQ city (the "Temecula" confusion — it was remote); (e) harvester source truncation now word-boundary + ellipsis (the "…and comm" doc); selftest ALL PASS. Suite stabilized: setup neutralizes the SW controllerchange auto-reload + waits for the auth modal — 3× consecutive 40/40.
- [x] v79 — "Other regions" control (founder-approved, 2026-07-04): Browse scope PILL above results ("📍 Showing Houston, TX + Remote · Show other parts of TX →" → "🗺️ all of TX" → "🌎 all regions", with ← back at each step) — widening/narrowing re-scopes the CACHED raw pool client-side, zero extra Firestore reads, scope resets per new region; deck exhausted state now offers "Show roles from other parts of {State}" (`loadDeckSameState`, same-state non-metro roles, résumé-ranked) BEFORE the other-cities rung — every widening is an explicit tap. State tests: pill ladder (market/state/all/back with 0 refetch, honest tiers) + deck rung presence. Suite 40/40 (live authed). §5 all-pass v79. NOTE: a mid-build tooling failure truncated index.html — recovered cleanly from git HEAD + mirror per the documented recovery procedure; all writes to index.html are now atomic (temp + rename).
- [x] v78 — B-SARATOGA hard-scope + B-SALARY-CYCLE (2026-07-03): Browse anchors to the saved master location (`gpj_loc`) when its fields are blank — the national-pool leak that produced Saratoga rows AND the toggle's "random regions" (one root cause). New `_scopeBrowsePool`: local + genuine remote; zero local ⇒ remote-only ⇒ honest empty; the silent keep-wide-pool guard removed. State tests: scoping unit test + toggle route-counter test (0 Firestore hits, 2→1→2 rows). Suite 36/36 incl. LIVE authed sign-in (founder .env); §5 all-pass v78. Q2 quadrant fully activated this build (playwright.config.js now loads ./.env).
- [x] v77 — [STATE-COVERAGE] tests landed + LAST clip site removed (2026-07-03): writing the executable 4-quadrant matrix (tests/state-coverage.spec.js) exposed that `buildBrowseExpanded` — the expanded JOB CARD render — had its OWN hard `slice(0,2400)` on "Job Expectations & Summary", separate from the deck drawer (this is the card "Open Full Job Card"/Browse opens, i.e. almost certainly the clip the founder kept seeing). Now `cutWords(summary,4000)`, above the harvester's 3500 max. New suite: Q1 guest (desc never cut at harvester size / job card renders past 2400 / Open-Full-Job-Card stacks over company modal / empty fields never render "undefined"), Q3 failed-network (shell survives Firestore+Worker outage), Q4 empty-data (pool-seeded — honest empty states, no demo rows), Q2 authed (uncut render while signed in; activates with the TEST_USER_PASSWORD secret). Suite: 29 passed + 3 authed self-skipped; §5 benchmark all-pass at v77.
- [x] v76 — Live-feedback round 2 (2026-07-03): (a) B-DESC-CUT TRUE FIX: v75's 2400 cap still clipped (live proof: a 2600-char description) — caps now exceed the harvester's own 3500 DESC_CAP (desc 4000 / req 2000 / benefits 1200), so harvester data is never cut client-side; cutWords only fires on oversized legacy payloads. (b) B-OPENCARD TRUE FIX (founder-directed): "Open Full Job Card" now opens the REAL job card (Browse expanded view — same reuse pattern as openSavedJobCard: normalize into liveJobs, openBrowseExpanded) stacked OVER the company modal (browse-expand-modal z 340→350, above company 345, below vibe-review 360); closing it returns to the company card. (c) B-BENEFITS root cause CONFIRMED from the founder's live Firestore doc (DataAnnotation: `benefits:""` written, perks under "Advantages Of Contracting With Us") — BENE_HEADER/NEXT_SECTION broadened 1:1 in scripts/job_spy_harvester.py + api/jobs/publicAggregator.js (advantages / we offer / why join-work us / what's in it for you); harvester --selftest ALL PASS incl. two new advantages checks; live benefits appear after the NEXT harvest run. (d) F-TEST harness refined: UI-driven login in auth.setup.js (#auth-email/#auth-pass/#auth-primary-btn) + IndexedDB settle-wait, TEST_USER_EMAIL/TEST_USER_PASSWORD env (GPJ_TEST_* fallback), helpers moved to tests/utils.js, .env.example added.
- [x] v75 — Live-feedback batch (2026-07-03): (a) B-APPLY-CONFIRM (founder-directed): "View Full Posting" NO LONGER auto-records to Applied or advances the deck — only the explicit "Done — I Applied" confirmation (applyTabDone/sandboxDone) records; closing/tapping away returns to the same card (reverses the v73 auto-record). (b) B-DEMO-FLAG: "Report & hide" and ghost reports now require sign-in; reports can never be filed against placeholder company names ("Hiring Company" etc.), and a one-time scrub removes placeholder-keyed reports already stored (kills the fake "1 report" bleeding onto every company-less card). (c) B-DESC-CUT: `cutWords()` cuts desc/req/benefits on word boundaries with an ellipsis, and the drawer now receives the full 2400-char description the v63 expanded view was designed for (was a raw 460-char mid-word slice — the real cause of "Job Expectations & Summary" clipping). (d) B-OPENCARD: "Open Full Job Card" on company-card live openings now passes full job context (req/benefits) and scrolls the populated job panel (#cm-jobsummary) into view — the button looked dead because the panel mounted at the top of the same modal, off-screen.
- [x] v74 — B-DECK-POOL + B-THISROLE (LIVE-CONFIRMED 2026-07-03: self-test 19 pass / 0 fail, "3000 jobs read · 0 aggregator links", deck no unseen-recycle) (BUILT & BENCH-VERIFIED 2026-07-03: §5 all-pass — boot harness RAN TO COMPLETION, div delta 0, mirror byte-identical, 0 missing handlers, 0 dup ids, markers v74 in sync; Playwright 16/16. LIVE location/matching outcomes = founder gate on deploy.) (a) B-DECK-POOL: the deck now pulls the WIDE Firestore batch and scopes client-side by location TEXT + always-remote — the SAME catchment Browse has used since its identical v61 fix — so local high-match roles stored under broad `region` values (e.g. "United States") finally enter the deck; the client-side scoping + v73 role-first sort are untouched. (b) B-THISROLE: real job titles now flow through applyTopJob → applyVia → sandbox (`applyTopJob` was passing '' even though it had `j.t`); the display fallbacks ("this role"/"the company") are stripped at every Applied/Skipped/Responses write (`_realTitle`/`_realCo`); a one-time sweep in `archiveSweep` cleans existing phantom rows; cover letters read grammatically when a title/company is missing (no more "the this role position" / "Dear the hiring company Hiring Team"); stat rows fall back to "Role at <company>" instead of a blank title.
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

### [x] B-DECK-POOL · Deck pool ≠ Browse pool — FIXED v74 (deck pulls wide + scopes client-side, same catchment as Browse; LIVE verification pending)
**What it is:** the deck exhausted at ~45 jobs ("seen everything in your region") while Browse showed ~925 — and served LOW-match Operations (16–52%) while Browse held 98%-match Marketing/Account roles in the SAME market. The deck's server-side region-field query (`fb.fetchJobs(regionKey,3000)`) misses jobs stored with broad `region` values that Browse catches via client-side location-TEXT filtering, so the deck and Browse draw different pools.
**Fix:** make the deck draw the same catchment as Browse (metro + remote, matched on location TEXT, not just the region field), then apply the role-first sort; refill/broaden (metro → remote → same-state → statewide via the approved control) BEFORE the empty state. Partly mitigated v73 (remote always included). Needs live verification.

### [x] B-SARATOGA · COMPLETE v79 — hard-scope (v78) + the approved "other regions" control (v79): Browse scope pill (market → rest-of-state → all regions → back; client-side re-scope of the cached pool, zero refetch) + deck same-state rung (`loadDeckSameState`) before other-cities. Never widens on its own.
**Root cause (found v78):** `ensureBrowsePool` scoped by the BROWSE FORM fields only — blank fields (location saved in Settings) meant NO scoping, so the whole national pool rendered. Also the "keep the wide pool when nothing local matched" guard silently went national. v78: blank fields fall back to the saved master location (`gpj_loc`, the deck's anchor since v66) via the new testable `_scopeBrowsePool` (local + genuine remote; zero local ⇒ remote-only ⇒ honest empty; NEVER other-city on-site). Explicit city/state searches in the Browse fields still work; nationwide stays the explicit button. REMAINING: the approved "other regions" pill — placement proposal delivered, awaiting founder OK.

### [x] B-THISROLE · "this role" placeholder leaks into Applied + cover letters — FIXED v74 (real titles carried through the apply path; placeholders stripped at every list write; one-time cleanup of stored phantoms; grammatical letter fallbacks)
**What it is:** a missing job title falls back to the literal string "this role" — it appears as a phantom job in the Applied bucket ("this role · Serenity Healthcare · 34%") and inside the cover-letter prompt ("apply for the this role position"). Fix title resolution in the cover-letter / Match-to-Job / apply path so a real title is always used (or the item skipped); never the placeholder. Cross-ref F-COVERLETTER.

### [x] B-DESC-CUT · Description clipping — FIXED v75 (root cause: `mapFirestoreJob` raw-sliced desc at 460 chars mid-word; drawer now gets 2400 word-boundary chars + ellipsis; req/benefits and company-modal openings cut the same way)

### [~] B-BENEFITS · Benefits extraction — ROOT CAUSE CONFIRMED + FIXED v76; live confirm after next harvest
**Confirmed (2026-07-03, founder's Firestore doc):** the pipeline writes the field (`benefits:""` present on a fresh DataAnnotation doc) — the EXTRACTOR missed the posting's heading style ("Advantages Of Contracting With Us"). v76 broadens BENE_HEADER/NEXT_SECTION 1:1 in the harvester + publicAggregator (advantages…, we offer, why join/work us, what's in it for you); `--selftest` ALL PASS incl. two new advantages checks. NOTE: already-ingested docs keep `benefits:""` — new phrasings apply from the NEXT harvest run (doc_id merge:True will enrich re-harvested duplicates). Founder: after the next `job_harvest.yml` run, expand a fresh card (or re-check a doc) for populated benefits.

### [x] B-TEXT-CLIP · Site-wide "no incomplete text" — FIXED v84
**Audit result:** census found few real offenders (most card text already wraps; collapsed deck titles clamp by design and un-clamp when the card opens). Fixed: `.modal-box` is now DYNAMIC — max-height 88vh + inner scroll + `overflow-wrap:anywhere` + visible scrollbar, so every popup wraps long text in full and scrolls instead of clipping/overflowing (covers match card, company card, all dialogs); company-card name wraps; deck location badge `_locBadge` shows the whole city (never a mid-word slice) and Remote for remote; deck location pill word-boundary trims. Kept as intentional: self-test uid diagnostics, header chips (auth-chip/grace-pill), collapsed 2-line card titles. Guarded by tests (badge matrix + modal-box wrap/scroll-in-viewport).

### B-STUCK · Flagged card stuck in collapsed mode (won't expand)  ·  ETA v70  ·  HIGH
**What it is:** after flagging a (recycled) job, the top card won't expand on tap.
**Resolves:** every deck card expands.
**Plan:** likely tied to B-RECYCLE (the stuck card is the recycled one in a bad state) — investigate together. **REPRO NEEDED: does it happen only right after Report&hide, and is the deck near-empty then?**

### [x] B-SALARY-CYCLE · Salary toggle "random regions" — FIXED v78 (it WAS already a client-side filter; the "random regions" were the unscoped national pool it re-rendered — B-SARATOGA's hard-scope fix resolves it; guarded by a state test proving 0 Firestore requests on toggle and list subset/restore 2→1→2)

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

### [x] B2 · Work-style filter — VERIFIED WORKING v85 (renderBrowse filters on structured work_setting with text fallback; guarded by a state test: Remote selection shows only remote rows)
### [x] B3 · Salary controls — VERIFIED WORKING v85 (min-salary slider drops below-threshold posted salaries, keeps unknown-salary rows for the posted-salary toggle to handle; state-tested; posted-salary toggle proven pure client-side in v78)
### B4 · Browse sort + header dropdown clipping  ·  ETA v86  ·  [UI-REVIEW] for the dropdown clipping
### [x] B5 · Résumé City/State pre-fill — VERIFIED v85 (`gpjApplyLocation` fills Browse #f-location city-only + any mounted .pf-city/.pf-state; state-tested)
### [x] B6 · ATS write-path (filename case + resolver) — DONE v68 (Layer 2 Atsingest no-op left for later)
CONFIRMED: repo file is `Firestorewriter.js` but every `require('./firestoreWriter')` uses camelCase -> on Vercel (case-sensitive) all ATS writes silently fail. Also `regionalRouter` calls `resolver.resolve` (module exports `resolveLink`/`resolveBatch`) -> dead gap-fill path; `Atsingest` Layer 2 is a no-op. Backend only.
### [x] B7 · Console warnings — FIXED v85: auth email/password/button wrapped in a real `<form>` (kills the Chrome warning, enables password managers + Enter-to-submit, submission intercepted); sandbox iframe drops `allow-same-origin` (scripts+same-origin = escapable sandbox — the console warning; sites needing it hit X-Frame-Options and use the new-tab path anyway). State-tested.

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
### [~] F-TEST · Playwright: robust backend + intro capture remain  ·  SIGNED-IN HARNESS LANDED 2026-07-03 (pulled forward for [STATE-COVERAGE])
**Signed-in harness (2026-07-03):** `tests/auth.setup.js` signs in via the app's real `fb.signIn` path and saves storage state INCL. IndexedDB (where Firebase Auth lives; Playwright ≥1.51); `authed` project restores it and runs `tests/authed.spec.js`; creds come from `GPJ_TEST_EMAIL`/`GPJ_TEST_PASSWORD` env only (public repo — never hardcode). Without the secret, setup writes an empty state and authed tests SELF-SKIP (green for forks/PRs). **Founder action to activate quadrant 2 in CI: add repo secret `GPJ_TEST_PASSWORD` (Settings → Secrets and variables → Actions).** `mockNetworkFailure()`/`mockEmptyData()` helpers in smoke.spec.js cover quadrants 3–4 (note: Firestore uses WebChannel, so failure-abort is the high-fidelity Firestore simulation; '[]' bodies fit REST-shaped endpoints like the Worker).
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
- v74 (logic-only): B-DECK-POOL (deck draws Browse's catchment) + B-THISROLE (placeholder purge + letter grammar). LIVE-CONFIRMED.
- v75 (THIS BUILD, logic-only, from live v74 feedback): B-APPLY-CONFIRM + B-DEMO-FLAG + B-DESC-CUT + B-OPENCARD. No [UI-REVIEW] items.
- v76 (next): B-BENEFITS-VERIFY (live Firestore check) + B-SALARY-CYCLE + B-SARATOGA market hard-scope + the approved "other regions" control [UI-REVIEW]; then F-AI/F-RATER/F-COVERLETTER quality pass. F-CARD (true standalone job card from Skipped/company views) stays [UI-REVIEW]. Deck broaden-ladder prompt is [UI-REVIEW] — propose before coding.

## Go-forward process (agreed)
1. One grouped batch per version, insert-only, no regressions, optimized for mobile/iOS/Android/tablet/desktop.
2. Before any [UI-REVIEW] item: stop, propose, get OK, then code.
3. After each build: benchmark (self-test + boot harness + handler/div checks) + end-to-end pass, then deliver PDFs (this checklist + Feature Launch Doc if a feature was added), all code/files, implementation instructions, a your-side test checklist, and any screenshots I need before the next batch.
4. One clean, verified push per version; mirror identical; version markers bumped.
