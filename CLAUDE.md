# CLAUDE.md — GhostProofJob (GPJ) Project Guide

> Operating manual for any Claude (Claude Code or chat) working on GhostProofJob.
> Read this fully before making changes. The rules here are non-negotiable.
> **Current build: v122** (Playwright 341 tests — full-suite runs green with rare singleton parallel-load flakes that pass 3/3 isolated · Firestore rules emulator 103/103 · backend suites 84/84 · §4 benchmark green).
> GPJ is now a **two-sided marketplace**: the candidate product plus a full employer/recruiter product.
> **The recruiter side is a RESKIN, not a second app** — `_gpjRecruiterMode()` + a `.rec-mode` class + per-view
> `.rec-panel`s repaint the same 6 tabs by account role, so candidate views are never touched and cannot regress.
> **Candidate-first invariant:** recruiter doc reads fire ONLY when the account is a recruiter (Playwright-proven).
> **D1 (Firestore read-cost) is deliberately LAST** by founder instruction — finish and test the product first,
> so there is less read/write left to optimize. Recruiter tier docs: `docs/recruiter-tier.md`, `docs/R0-report.md`;
> billing: `docs/stripe-setup.md`; living status: `docs/master-audit-checklist.md` (+ the two generated PDFs).

---

## 1. What this project is

**GhostProofJob (GPJ)** — an ethical, free-until-hired job-search PWA at **ghostproofjob.com**.
Mission: surface *verified* roles, flag likely "ghost jobs," and tailor résumés/cover letters per role. No ads. No data selling. Ever.

- **Founder:** Aaliyah (Houston, TX; background in marketing + account management).
- **Test account:** `asosa@ghostproofjob.com`, uid `3xt4GgdG`, Hyper-Drive trial.
- **Tagline:** Build · Optimize · Apply.
- **Brand:** Midnight Plum `#120F1D` (bg), Digital Mint Green `#00F5A0` (success/actions), Cyber Purple `#B55FE6` (nav/accents), danger `#FF4D6A`. Ghost mascot.
- **Pricing:** Applications are ALWAYS unlimited. AI-powered actions: unlimited Day 1–45 (Hyper-Drive), then 50/day Day 46–90 (Core Search), then 30/day Day 91+ (Base Camp) — always free. Optional support: tip jar + low-cost monthly / lifetime. No paywalled "must-have" features.
- **Honesty rule:** Auto-apply is architecturally impossible (browser same-origin security). All copy reflects honest "jump to apply." No Google scraping (ToS). No demo/sample data in live views.

---

## 2. Architecture

### Frontend (the whole app is one file)
- **`index.html`** (~11k lines, ~784 KB) — the ENTIRE app: HTML + CSS + inline JS in one file.
- **`GhostProofJob.html`** — an EXACT byte-identical mirror of `index.html`. Must stay identical every build.
- **`sw.js`** — service worker; holds `CACHE_VERSION = 'gpj-vNN'`.

### Hosting / deploy
- **GitHub** (public repo — public for free Actions minutes) → **Vercel** (hosting).
- Deploy = GitHub "Add file → Upload files" via **drag-and-drop ONLY**. **Pasting truncates the 784 KB file** (recurring historical failure). One clean, verified push per version.

### Data / backend
- **Firebase Firestore + Auth** — projectId `ghostproofjob-app`, collection `jobs`. Billing: **Blaze via Google Cloud Free Trial** ($299.51 credit, valid to 2026-09-19). Read volume ~163K/24h (over the 50K/day free tier; cost-reduction deferred while the trial covers it).
- **Cloudflare Worker** — `ghostproofjob-worker.ghostproofjob.workers.dev/smart-match`. Runs OpenAI **gpt-4o-mini** via a JWKS-verified Firebase token. **This is the live AI path.** (The old gcloud dependency was removed by changing how the system talks to OpenAI — do not reintroduce a gcloud requirement.)
- **Vercel serverless functions** in `api/jobs/`:
  - `publicAggregator` — parses ATS jobs (Greenhouse/Lever): description, requirements, benefits, salary.
  - `firestoreWriter.js` — writes jobs to Firestore. **Filename MUST be exactly `firestoreWriter.js`** (lowercase f, uppercase W) to match `require('./firestoreWriter')`. Vercel's filesystem is case-sensitive; a mismatched name (e.g. `Firestorewriter.js`) makes the require throw and **silently fails ALL ATS writes**.
  - `regionalRouter.js` — fallback hierarchy; `normalizedJob()` must CARRY the rich fields (`description/requirements/benefits/salary_min/max/is_remote`), not strip them.
  - `redirectResolver.js` — resolves aggregator links (Jooble/Adzuna). Filename must match the `require('./redirectResolver')`; exports include a `resolve` alias of `resolveLink`.
  - `salaryParser`, `Atsingest`.
- **Resend** — transactional email delivery.
- **Python JobSpy harvester** — `scripts/job_spy_harvester.py`, GitHub Actions workflow `job_harvest.yml`. **Configure via GitHub Actions Variables ONLY — never hand-edit the `.py`.** This writes most of the live `jobs` data (source `indeed`, etc.) with full fields.
- **Playwright CI** — `tests/smoke.spec.js`, `tests/screenshots.spec.js`, workflow `e2e.yml`, plus `playwright.config.js`, `package.json`.

---

## 3. NON-NEGOTIABLE RULES (do not break these)

1. **INSERT-ONLY.** Never rebuild, restructure, or redesign layout/UI/logic. Add narrowly; do not regress any prior fix or working feature.
2. **`[UI-REVIEW]` gate.** ANY change touching layout, a view, an overlay, z-index/stacking, or visual behavior → **STOP, propose the approach, get explicit approval BEFORE writing code.**
3. **Full drop-in files.** Deliver the COMPLETE file for every file you change — never snippets. (Snippets caused a broken `Redirectresolver.js` merge; surgical instructions get mis-merged.)
4. **All platforms.** Every change must work on mobile, iOS, Android, tablet, and desktop.
5. **No misleading copy.** Honest "jump to apply" only; no auto-apply claims; no demo data in live views; no Google scraping.
6. **Never break existing features or prior fixes.** If a change unavoidably alters behavior, disclose it upfront and get sign-off.
7. **Every build ships:** updated PDFs (Master Audit Checklist + Feature Launch Doc *if* a new user-facing feature was added) + full drop-in files + implementation instructions + a your-side test checklist + any screenshots needed for review.
8. **Honesty over optimism.** Say when something is architecturally impossible or unverifiable rather than shipping a workaround or overclaiming a fix.
9. **[STATE-COVERAGE] Matrix Generation.** Before writing a single line of code for any new feature or bug fix, you must mentally map out and explicitly output a 4-quadrant state matrix checking how the change behaves across: 1) Guest/Logged-out, 2) Authenticated, 3) Interrupted/Failed network, and 4) Empty/Missing data states. You must explicitly verify that the existing Playwright tests cover these 4 states, or you must write a new Playwright test targeting the uncovered state before pushing the code.

---

## 4. Verification / benchmark (run BEFORE delivering any build)

`node --check` catches syntax only — it does NOT catch runtime/temporal-dead-zone (TDZ) errors. Use the full checklist:

1. **JS syntax:** extract inline `<script>` blocks → `node --check`.
2. **Boot harness (the gold check):** run the whole inline script in a mocked browser (`document`/`window`/`localStorage`/`matchMedia` via Proxy stubs; mock `URL.createObjectURL`). It must print **"RAN TO COMPLETION"** and reach `buildDesktopGrid`. This reproduces boot crashes (e.g. the v66/v67 TDZ) that `node --check` misses.
3. **`<div>` balance:** open/close delta = 0.
4. **Mirror:** `diff index.html GhostProofJob.html` → identical.
5. **Handler audit:** no `on*` handler references an undefined function (ignore DOM/string-method false positives like `.slice`, `.contains`).
6. **Duplicate DOM IDs:** none.
7. **Three version markers bumped in sync:** `APP_VERSION` in `index.html`, `<span id="build-stamp">` in `index.html` (+ mirror), and `CACHE_VERSION = 'gpj-vNN'` in `sw.js`. (Helper: `bump_version.py --set N --note "..."`.)
8. **In-app self-test:** the user runs it live (19+ checks). Green = benchmark validated.

**Recovery:** an emptied `index.html` silently passes naive checks — always `wc -l index.html` first. `GhostProofJob.html` is the recovery asset.

---

## 5. Critical gotchas (hard-won)

- **TDZ / boot order:** a top-level call that runs before a `let`/`const` initializes throws "Cannot access X before initialization" and halts the ENTIRE script (breaks desktop mode, auth, live jobs). Guard early reads in `try/catch`; verify with the boot harness. `typeof x` does NOT save you (it throws for a TDZ `let`).
- **Vercel case-sensitivity:** `firestoreWriter.js` / `redirectResolver.js` must match their `require` exactly, or the module silently fails.
- **Paste truncation:** never paste the 784 KB `index.html` into GitHub — drag-upload only.
- **Lone-surrogate emoji** in Python string writes crash the file (leaves it empty) — use real Unicode code points or literal JS escape text.
- **Harvester config** lives in GitHub Actions Variables — never edit the `.py` directly.
- **Bind to the data model, not the DOM:** `_currentTopJob()` (the data-model `vis[0]`, same job the card face paints) is the source of truth for the swipe card. Bind apply / drawer / company view / flag to it — a stale DOM `.job-card.top` read caused wrong-job and recycle bugs.
- **Key normalization must match everywhere:** `jobKey()` and `gpjExpiredKey()` both use `(title|company).toLowerCase().replace(/\s+/g,' ').trim()`. A flagged job recycles if the stored key ≠ the deck's `jobKey` (e.g. "Operations Manager" vs "Sr. Operations Manager").
- **Pool vs. sort are separate problems:** ranking upstream (`searchRankJobs`) is ineffective if a downstream step re-sorts. The deck's FINAL sort is `applySwipeFilters` (`sorters.match`); fix ordering THERE.
- **Cloud-anchored state:** day counter and applied/skipped/saved lists must not rely on per-device `localStorage` alone (cross-device via `listsResetAt` tombstone + cloudSync).
- **No internet in the Claude chat sandbox:** live Firestore data, matching scores, and location-scoping OUTCOMES cannot be verified there — those require the user's live testing (build → deploy → self-test → report). In Claude Code with local/network access, prefer actually running things.

---

## 6. Key code landmarks (by function — line numbers drift)

- `_fetchLiveMarketJobs` — deck fetch. `fb.fetchJobs(regionKey, 3000)` → filter `jobMatchesLocation` → `scoped`; **always** concatenates genuine remote jobs; builds `jobsQueue`; calls `searchRankJobs`, then `applySwipeFilters`.
- `searchRankJobs` — scores + tiers jobs (`primary` ≥55 / `broader` 36–54 / `weak`). B1: `primary` requires an in-field title match (`_resumeFieldWord`); sorts tier → `_infield` → score.
- `_resumeFieldWord` — first non-generic word of `resumeData.title` (the user's field, e.g. "marketing"). Returns '' when absent (graceful fallback).
- `applySwipeFilters` — **the deck's FINAL render sort/filter.** `sorters.match` (default) leads with in-field (title contains field word) then match %. Excludes `_deckHiddenSet`.
- `_deckHiddenSet` — seen-set (`seenJobKeys`) ∪ `gpj_expired` (durable de-recycle backstop).
- `_currentTopJob` — data-model top deck job (`vis[0]`).
- `applyTopJob` — deck "View Full Posting"/apply: resolves URL at click time from `_currentTopJob`, records to Applied (deduped), advances the deck.
- `reportExpiredFromCard` → `reportExpired` — flag "no longer accepting"; binds to `_currentTopJob`; writes `{stage,when,reason,ts}` to `gpj_expired` + `lists.skipped`.
- `reloadDeckFromQueue` — repaints 3 cards from `vis`; fully collapses the drawer on advance.
- `hydrateDrawer` — expanded drawer content, bound to `_currentTopJob`.
- `recordSwipe` — right→`lists.applied` (deduped), left→`lists.skipped` (deduped); does NOT splice `jobsQueue`.
- `renderStatList` — Applied/Skipped/Responses/Viewed rows; 🚩 next to 👻 on flagged rows.
- Others: `computeMatch`, `jobMatchesLocation`, `nearestMetro`, `mapFirestoreJob`, `ensureBrowsePool`/`refreshBrowse`, `openCompanyView`/`openCardCompanyProfile`, `loadDeckOtherCities`, `showDeckExhausted`, the `vibe-review-modal` (z-index 360, above company modal 345).

---

## 7. ACTIVE LOCATION BUGS (top priority; all need LIVE verification)

- **B-DECK-POOL — FIXED v74 (live verify pending):** root cause was the deck's region-keyed server query (`fb.fetchJobs(regionKey,3000)`) returning early with only region-tagged docs, missing local roles stored under broad `region` values that Browse catches via client-side location-TEXT filtering (Browse got this identical fix in v61). v74: the deck pulls wide (`fb.fetchJobs('',3000)`) and scopes client-side — same catchment as Browse. Remaining (v75+): the broaden LADDER prompt (same-state → statewide, [UI-REVIEW]) + Firestore-read cost.
- **B-SALARY-CYCLE:** toggling "Only show jobs with posted salary" re-pulls jobs from random regions. It should be a pure client-side filter over the in-market pool — a symptom of the Browse pool not being hard-scoped.
- **B-SARATOGA / market hard-scope:** Browse shows out-of-region jobs (e.g. Saratoga Springs, NY) with location = Houston. Browse must hard-scope to the profile market by default and only widen via the control below.
- **"Other regions" control (APPROVED, not yet built — `[UI-REVIEW]`):** a single pill — Browse: "Showing [City] only · Show other regions"; deck: "Show roles from other parts of [State] →" then "statewide/other cities". Never widens on its own. Reuses `loadDeckOtherCities`.
- **B1 remaining:** role-first ordering done (v73). **Matching = BLEND (founder-locked): weigh most-recent-role TITLE (`_resumeFieldWord`) AND strongest CONTENT match (`computeMatch`).** The test résumé's title ("Marketing Specialist") diverges from its Account/Operations content — both scored 98% in Browse — so blend, don't pick one. Remaining: pool reconciliation (B-DECK-POOL) + market hard-scope + "other regions" control.

**Intended location/role flow (spec):** start at the user's most-recent role/duties/skills/certs, in their market first → exhaust in-market → auto-load other résumé-based matches → prompt to broaden within their state → then statewide/other cities. Remote is always valid and always included.

---

## 8. Other outstanding items (roadmap)

- **F-CARD `[UI-REVIEW]`:** one universal card everywhere = the swipe card (collapsed summary → expanded full ATS fields, no clipping). Skipped tab must render JOB cards (not company cards). Desktop Browse expands to swipe-card width. Company cards uniform, with Recent Company News + "Connect with Hiring Team" social buttons. Includes **B-SKIP-APPLY** (Apply/Match/Cover dead on skipped jobs; generic "Hiring Company").
- **F-REVIEW `[UI-REVIEW]`:** route ALL company/job reviews through the existing past-jobs `rate-ex` review flow (consistency).
- **F-ADDR `[UI-REVIEW]`:** address show/hide toggle (default off) + stacked-vs-horizontal contact layout + full-address-vs-city/state. All toggles must save + reflect on export without breaking export, accent colors, headshot, or spacing.
- **F-GHOST:** Firestore-aggregated flag count + "Another hunter has reported this job" popup.
- **F-COVERLETTER / F-AI:** fix cover-letter quality (unfilled "the this role position"; forced "Operations" emphasis). Verify all AI features work, count/limit per tier, store data after each rewrite for future résumés, safeguards active but not over-restrictive.
- **F-RATER:** verify the résumé rater reads the whole résumé and rates against job data on a professional standard.
- **F-ATSPREVIEW:** verify the ATS preview shows the real machine-readable data.
- **F-WORDING:** site-wide pricing/messaging consistency + transparency sweep.
- **F-TPL `[UI-REVIEW]`:** five résumé template layouts.
- **F-DESK `[UI-REVIEW]`:** desktop polish (footer, startup scroll, width parity, LinkedIn button).
- **F-TEST:** Playwright screenshots not generating (v68 `screenshots.spec.js` moved `test.skip` into `beforeEach`; re-verify config); add more robust BACKEND coverage; signed-in CI.
- **B-DESC-CUT: RESOLVED v100.** It was a display slice after all — the deck's inline mapper (not `mapFirestoreJob`) sliced desc at 460 raw with no req/benefits/summary. Fixed to the v97 ceilings; remaining truncated LIVE data self-heals via harvester turnover by ~2026-07-14.
- **D1 (deferred):** Firestore read-cost reduction (~163K/24h) — cache the region pool per session, cap query sizes, paginate. Trial covers cost until 2026-09-19.

---

## 9. Version history

- **v66** — deck sources location from the saved master (`gpj_loc`); durable de-recycle (`_deckHiddenSet` = seen ∪ `gpj_expired`); region-exhausted UX + "load other cities".
- **v67** — CRITICAL boot-crash fix (TDZ reading `lists` before init); boot harness introduced.
- **v68** — ATS backend: `firestoreWriter.js` case fix (was silently failing all ATS writes), `regionalRouter.normalizedJob` field carry-through, `redirectResolver.js` rename + `resolve` alias; Playwright `screenshots.spec.js` `test.skip` fix.
- **v69** — B0 wrong-job (drawer/company view bind to `_currentTopJob`); B-NAN ("undefined NaNd ago" — report `{stage,when}` + legacy tolerance).
- **v70** — B-RECYCLE (`reportExpiredFromCard` binds to `_currentTopJob`, so the flag key matches the deck exactly).
- **v71** — B0 stays-open (`applyTopJob` resolves the link at click time); F-FLAGMARK (🚩 on flagged Skipped rows); B-REVIEW-Z (`vibe-review-modal` z-index 331→360).
- **v72** — B1 role-first tagging in `searchRankJobs` (in-field gate + tier→infield→score); drawer collapse-on-advance (removed leftover `#card-drawer.open`).
- **v73** — B1 real fix at the deck's final sort (`applySwipeFilters.sorters.match` leads in-field then match); remote jobs ALWAYS included in the deck; "View Full Posting" records to Applied (deduped) + advances.
- **v74** — B-DECK-POOL (deck pulls wide + scopes client-side by location text — the same catchment Browse has used since v61 — so broad-region local roles finally enter the deck); B-THISROLE (real titles carried through applyTopJob→applyVia→sandbox; `_realTitle`/`_realCo` strip display placeholders at every Applied/Skipped/Responses write; one-time phantom-row cleanup in `archiveSweep`; grammatical cover-letter fallbacks; stat-row title fallback).
- **v75–v79** — v75 confirm-only apply (View Full Posting no longer auto-records; only "Done—I Applied") + B-DEMO-FLAG (sign-in gated reports, placeholder-report scrub) + B-DESC-CUT (word-boundary dressing) + B-OPENCARD; v76 B-DECK-POOL merge + B-THISROLE finish; v77 [STATE-COVERAGE] test suite; v78 B-SARATOGA market hard-scope + B-SALARY-CYCLE; v79 "other regions" pill (Browse) + deck same-state rung.
- **v80–v85** — v80 region+wide pool MERGE + iOS update probe + foreign-remote guard; v81 fake-remote (hybrid) demotion + F-STRUCT structured cards + What's-New auth-race fix; v82 AI labeled job context; v83 scroll-region fix + match-insight z + rater stopword gate + F-JETT-FULL (whole-résumé improve); v84 B-TEXT-CLIP (dynamic popups, whole-city badges); v85 B2/B3/B5 verified + B7 console warnings (auth `<form>`, sandbox `allow-same-origin` dropped).
- **v86–v92** — v86 B-DESC-CUT final (requirements dressing) + D1 phase 1 (fetchJobs session cache); v87 rater trust (stable corpus yardstick, keyword preservation) + B-SKIP-APPLY core; v88 comma-dressing + Jett true-rewrite + pre-rewrite résumé snapshot; v89 render-layer sanitize (strip raw markdown); v90 F-REQMATCH (Requirements Check) + admin unlimited AI; v91 F-CARD unification; v92 Jett verb engine + junk-skill whitelist + years-vs-age.
- **v93–v98** — v93 bullet-fragment clipping + Requirements-Check reads education + location no-regression; v94 F-REVIEW unified review flow; v95 city-anchored fake-remote loophole (IDIQ/Temecula); v96 MATCH-TRUTH (match modal shows real overlap, not echoed skills) + iOS PWA auto-update + admin popup — **CONFIRMED benchmark**; v97 Sprint R-pre (harvester boilerplate-strip + generous ceilings, F-ADDR toggles, review dedup, Max-Distance removal + F-GEO, self-test fix); v98 R-pre live fixes (apply-flow z-index above job card, F-ADDR City/State extraction + export). **Recruiter tier R0** = backend rules + emulator test suite + in-repo reverse-match scorer + scaffolding (no app code).
- **v99** — **Recruiter tier R1 (frontend)**: Employers nav tab + footer link (approved entry points); new `#view-employer` company-profile view; recruiter auth modal with a live corporate-email gate (mirrors `api/recruiter/domainCheck.js` — free/disposable/invalid rejected); `createRecruiter`/`saveCompany`/`loadRecruiter`/`adminPendingRecruiters`/`adminVerifyRecruiter` on `fb`; admin **Employer Verification Queue** (`renderVerifyQueue`/`adminDecideRecruiter`) reusing the booster-queue pattern. **Candidate-first invariant** enforced: recruiter doc reads fire ONLY when `gpj_role==='recruiter'` — proven by a Playwright test asserting zero recruiter reads during candidate browse/swipe/auth. **BUGFIX**: the recruiter auth-restore wrapper was dead code (installed before the base `gpjAuthChanged` existed, then clobbered by the candidate handler's bare reassignment) — relocated to chain LAST via `_gpjRecruiterAuthApply`. Playwright 126/126 candidate (zero regression) + 4 new v99 recruiter guest tests + recruiter auth harness (`tests/recruiter.setup.js`, self-skips without `GPJ_RECRUITER_TEST_PASSWORD`).
- **v100** — smart-data FINISH (the two pieces v97 missed + a truncation-site audit): (a) **B-DESC-CUT true root, deck**: the deck's INLINE mapper in `_fetchLiveMarketJobs` (predates `mapFirestoreJob`'s v76–v97 cap work) still did `desc.slice(0,460)` raw — the literal "Job Re" mid-word cut — and carried NO `req`/`benefits`/`summary`, so `hydrateDrawer`'s Job Expectations ran on a 460-char stub while Browse showed full text. Now mirrors `mapFirestoreJob` exactly (cleanMd + cutWords 11000/4000/2500 + cap-window force-dress) and carries all four fields → the deck drawer finally renders Requirements + Benefits sections. (b) `loadCompanyJobs` BOTH cmJobsCache paths raised (was 460/600/no-benefits and 1200/800/600) + Lever/Ashby ATS rows (was `descriptionPlain.slice(0,460)`) → v97 ceilings, so Open Full Job Card shows full text from every path. (c) Full-file audit of `cutWords(`/`.slice(0,` on job text: remaining sub-4000 slices are intentional (AI-context caps ~1500, remote-detection scan windows 4000, inline-onclick param guards, saved-jobs localStorage rows 300 — quota tradeoff, live-pool fallback covers display). (d) Backfill decision: pre-v97 docs' truncated tails were never stored — only re-harvest restores them; deterministic sha1 doc IDs + `merge=True` + `STALE_DAYS=8` prune mean the pool fully self-heals ~8 days after v97 (by ~2026-07-14) at ZERO extra cost — no scripted backfill run (a per-doc re-scrape of ~100k source pages would risk scraper blocking for text turnover restores free). 2 new state tests (deck mapper full fields + drawer sections; company-card caps). Playwright 130/130 ×2.
- **v101** — stabilize & verify (all browser-verified before+after, `docs/v101-screens/`): #1 pool dedupe `_gpjDedupePool` (title|co|CITY; broad twins fold into city siblings; richer desc wins) at deck+Browse+other-cities — the sha1(region)-keyed doc twins bug; #2 stat lists newest→oldest in place; #3 `#match2job-modal` z 346→357; #4 `_gpjPositiveRemote` window 4000→16000 + field/territory phrasing (Medtronic fixture; IDIQ protection intact); #5 F-ADDR single-builder (`syncProfileToResume` delegates to `_rebuildContact`, live-field fallback, stale `addressFormat` key retired); #7 `_leadWithVerb` never double-verbs (past/gerund leads detected); #8 `_summaryFacts()` feeds real years/roles/verbatim scope into both summary prompts (2–3 sentences); #9 `_tidySkills` paren-mashup split + word-set dedupe + title-drop + cap 15. 8 new tests; 146/146 ×2.

- **v102–v108** — Sprint R2/R3/R4 + R-pre finish: recruiter onboarding fork (corporate-domain gate) + admin verify queue; job posting + admin review; internal apply (**apply snapshots a bounded résumé + cover letter = consent to share**); candidate `discoverable` opt-in (default OFF); nightly reverse-match GitHub Action (bounded reads); matched-candidate cards (anonymous, never sold); F-GEO distance filter (offline centroids + haversine, ZERO extra reads); Referral engine (rules-gated: no self-referral, no farming); AI honesty (every AI button says when it fell back to templates **and when live AI returns**); Worker `mode:summary` + JWKS.
- **v109–v110** — **R9 recruiter full view**: all 6 tabs reskin by role with real functionality; fixed the desktop "For Employers" bug (root cause: `buildDesktopGrid` never moved `#view-employer` into `#desk-main` → it rendered outside the clipped grid, so the button did nothing); Reviews view + dispute-to-admin; R5–R8 (outreach + Anti-Ghosting Badge, candidate tray, interview slots, plan caps).
- **v111–v113** — recruiter chrome (company name + 🏢 in the chip, plan replaces "Support Us", tier replaces the day counter, employer-correct footer); **company team** (contacts, email-bound invites that redeem a seat on first sign-in, owner/admin/standard); **two recruiter security holes closed**; v113 fixed a repaint race where `refreshGraceDisplays()` painted "Day X/45" over the recruiter plan — **fixed at the source** (role-aware early return), not by patching the caller.
- **v114–v116** — **billing automation, both sides.** The app always READ entitlement correctly but **nothing ever wrote it** — a paying customer kept the paywall, and a cancelled plan never dropped to free. `api/stripe-webhook.js` closes the loop: checkout grants; cancel / non-payment / **full refund** / chargeback revoke to free (a partial refund is deliberately ignored). Belt-and-braces: a lapsed `paidUntil` reads as free even if a webhook is missed. v115 fixed a real bug before it shipped — Stripe only accepts `[A-Za-z0-9_-]` in `client_reference_id`, so the `uid:key` colon would have been dropped and **every paying customer granted nothing** (now `uid__key`, split on the LAST `__`). v116: notification centre (bell + unread badge, reuses existing data = no new reads, click-through to the right tab).
- **v117** — **Listings edit + verified fill-source.** (a) A posted role could only be deleted and re-posted, which **threw away its applicants**; the same form now edits in place (`recEditJob`/`fb.updateRecruiterJob`), and the 5-role seat cap does NOT fire on an edit. (b) Real bug found while testing: `renderRecListings()` rebuilds the WHOLE panel **including the form**, so any repaint mid-edit (tab switch, a late applicant count) silently blanked unsaved typing and stranded `_editingJobId` — an empty form still secretly in "save" mode. `_recSnapJobForm`/`_recRepaintEditForm` now carry an edit across a rebuild, preferring unsaved typing over the stored copy. (c) Closing a role captures **how** it was filled (GPJ / elsewhere / cancelled); a GPJ hire logs an anonymous aggregate proof-point via `fb.logHire` — "filled elsewhere" deliberately does NOT count as our hire. **Data is captured but not yet surfaced — do not make public hire claims until an aggregate view exists with real numbers.**
- **v118–v122** — founder live-test sprint, all live-verified against prod data. **v118**: employer jobs can never be buried (dedicated internal-jobs query merged into fetchJobs + `region` at post time); discoverable + contact **preferences rehydrate on sign-in** (top-level profile fields were saved but never restored — the toggle-reset class of bug); City/State fallback; **rater corpus in-field gate** (any-word title match let every "*Specialist" posting pollute the benchmark — the 50-vs-96 score swings); metric-bullet variant bank; optimizer zero-state copy; Years/Education = optional boosters. **v119**: **ghost-risk honesty** — `ghostRiskFor` was `8+hash(name)%70` (fabricated %); now community reports / verified-employer ✅ / real signals only / "—" when no data; deck no longer hides merely-VIEWED jobs (only applied/skipped/saved leave the pool); numbered Browse pagination + real scroll-to-top; 7-day persisted rater yardstick; employer own-links on job cards; forecast rows click through to Browse; PageSpeed quick wins (meta description, preconnects, brand PNGs 744→65KB, vercel.json security+cache headers). **v120**: City/State can never be minted from a street ("…Willow Bend Ln" → "Bend, LN" bug — state token now validated against the real state list); Benefits + up to 5 custom application questions per listing (asked at apply, shown on the Candidate Card); company logo upload (data-URL on the company doc, lazy-loaded — never snapshotted onto job docs); admin pending-approval bell + nightly email digest (`scripts/admin_digest.mjs`, needs RESEND_API_KEY secret). **v121**: candidate withdrawal + "Seen by employer/Delivered" status (anti-ghosting both ways); "How did you hear about us?" attribution on both signups (persisted once, never overwritten); honest duplicate-apply guard (original date kept, re-send blocked with the truth). **v122**: **password recovery** — before this a forgotten password was a PERMANENT lockout (no reset path existed); one-tap Firebase reset email on both auth modals.

### Test-harness gotcha (cost hours in v117 — read this)
The firebase **module** (`index.html:42`) executes AFTER the main inline script and **assigns `window.fb` wholesale**, then wires `onAuthStateChanged` → the signed-out callback **nulls `window._recruiter`**. Any test that stubs `fb`/`_recruiter` after merely waiting for a function to exist gets its stubs silently replaced mid-test → flaky `Cannot read properties of null`. **Gate on the module, not the script:**
```js
await page.waitForFunction(() => window.fb === null || (window.fb && typeof window.fb.fileGhostReport === 'function'));
await page.waitForTimeout(500);              // let the signed-out auth callback fire
window._gpjRecruiterAuthApply = () => {};    // then keep a late callback off the fixture
```
The old fixed `waitForTimeout(2000)` was absorbing this by accident. Fixed delays hide races — poll for the real precondition.


---

## 10. Working style

Direct, high-urgency, honesty over optimism. The user deploys via the GitHub web editor (no local execution in their flow) and validates each build with the in-app self-test + live testing, then reports bugs with screenshots. Build → verify (Section 4) → deliver full files + PDFs + test checklist → user deploys + confirms → iterate.
