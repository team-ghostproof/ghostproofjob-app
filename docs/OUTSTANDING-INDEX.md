# GhostProofJob — OUTSTANDING INDEX (single reference sheet)

> **Purpose:** the ONE place to see every open item by its ID, its status, and where the
> detail lives — plus a step-by-step manual-test checklist the founder runs. Check items off
> (`- [ ]` → `- [x]`) as we complete them.
> **Current live build: v277** (`CACHE_VERSION = gpj-v277`; live == repo, verified 2026-09-02). Sprint v270→v276, all **live-verified**. v270 C4 desktop drag/header/rail-leak · v271 footer/logo/candidate-toast/ghost-% chip · v272 **N24** Applicants clickable counters · v273 **N28** mobile recruiter pipeline · v274 notification-toggle honesty (default ON to match in-app behaviour) · v275 **P2-6 My Data** (real transparency view + real JSON export replacing the fake, live-verified with real data) + phone optional at signup · v276 **Role Fit unified to the card engine** (median of computeMatch across a live-posting sample — Role Fit went 100→72 to match the ~77% cards, live-verified, computeMatch called 40×). **N8 post-deploy smoke shipped.** N27 (reverse-match) verified running. **Full candidate-side + AI live-tested in the founder's session** (deck/ghost-chip/rater/Match-to-Job/Cover-Letter/Jett — all work + honest, zero fabrication). Read-cost is a non-issue (~$0.09/day; founder to set a $5 Firebase cap). **v277** (gating): (A) req-pill honesty — the swipe card no longer shows "✓ No gaps" on a clipped/unhydrated posting (only after the full text is seen); (B) SEO — JSON-LD structured data on the homepage + résumé checker; (C) SEO — 3 cornerstone evergreen "ghost job" article templates added to the Resources engine. **P1-3 candidate email digest SHIPPED (dry-run gated)** — makes the "email later" toggles real. **GTM one-pager PDF** for sharing with users: `docs/GhostProofJob-Overview.pdf` (regen: `python scripts/build_gtm_pdf.py`). **SEO status: ~6/10 — strong technical foundations + live content engine, but early (needs backlinks + content volume + time). #1 lever = backlinks (get the free checker + "ghost job" angle into communities).** **GROWTH WAVE 1 shipped (2026-09-02, no app-version bump — checker + resources engine only, index.html byte-unchanged):** (1) **Checker share loop** — `resume-checker.html` now offers, after a score, a **Download score card** (branded PNG rendered client-side via `<canvas>` — score + brand only, NEVER résumé text/PII), **Copy link** (`?ref=share` backlink), and a native **Share** button on mobile (`navigator.share`). 100% static, 0 functions, 0 reads, nothing stored. Live-verified desktop+mobile; +1 [STATE-COVERAGE] test (all 4 quadrants). (2) **Cornerstone wave 2** — 5 more evergreen high-intent article templates in `build_resources.mjs` (`ghost-interview`, `ghost-follow-up`, `resume-ats`, `cover-letter-real`, `find-responsive-employers`) — enter the rotation automatically, publish one-per-run. All 9 resources tests green.
> **Companions:** `sprint-roadmap.md` (per-item detail), `BUILD_HISTORY.md` (per-build log),
> `guardrails.md` (rules), `feature-audit.md` + `launch-readiness.md` (older P0/P1/P2 study).
> **Maintained by hand each change** (the roadmap is auto-noted by `bump_version.py`; this sheet is curated).

---

## 0. THE RULES WE WORK UNDER (self-contained — never bypass)

- **🔴 CL / CI RED = BLOCKING.** Any red CI/test status is a blocking failure, **never** a "flake."
  A red run is **stop-and-fix at the root cause** (precedent: v156 rater race made deterministic, not retried).
- **INSERT-ONLY.** Add narrowly; never rebuild/restructure/redesign working code or layout.
- **`[UI-REVIEW]` gate.** ANY change to layout / a view / an overlay / z-index / visual behavior / a core
  flow → STOP, propose the approach + mockup, get explicit approval **before writing code**.
- **`[STATE-COVERAGE]` before code.** Map the 4 quadrants — Guest · Authenticated · Interrupted-network ·
  Empty-data — and add a Playwright test for any uncovered state.
- **Data-write changes are feature-class ALWAYS** (5-part approval + exact rollback), even fixing a bug.
- **Ask before:** editing the Cloudflare Worker · changing `firestore.rules` · consuming new quota ·
  deleting/renaming any file.
- **The Matrix Gate (no skips), every change:** (1) `node scripts/benchmark.mjs` → **BENCHMARK GREEN**
  (JS syntax · boot harness "RAN TO COMPLETION" · `<div>` delta 0 · mirror byte-identical · no dup DOM ids ·
  `on*` audit · 3 version markers in sync · ≤12 Vercel functions · case-exact requires · sitemap ≤50k) →
  (2) 8 backend suites + `pool:check` + rules emulator (Java/CI) → (3) full Playwright chromium+mobile,
  all pages × light+dark × in/out × desktop/mobile × orientation, **0 failed / 0 flaky** → (4) founder in-app self-test.
- **Live post-deploy check.** After every deploy, verify the LIVE url (`ghostproofjob.com`) is the new build
  (`APP_VERSION`/`build-stamp` == repo) — the local gate can't catch a stale deploy (it happened once).
- **Honesty over optimism.** No fabricated data (`—` when not real); honest "jump to apply" (auto-apply is
  impossible); no scraping; every AI action says when it fell back to templates AND when live AI returned.
- **Full drop-in files** for every changed file — never snippets. **`--workers=2`** Playwright (never raise).
- **Deploy flow:** `main` auto-deploys to Vercel — **get explicit go-ahead before pushing.** Rollback prefers
  `git revert <sha>`. `index.html` re-uploads are **drag-and-drop only** (pasting truncates the ~1.5MB file).

---

## 1. ⏰ THE ONLY HARD DEADLINE — Firebase credit clock

- [ ] **E2 · D1 read-cost reduction — MUST land before 2026-09-19 (Firebase Blaze trial credit expiry).**
  Screenshot 2026-08-27: **$274.43 credit left · 23 days.** After it lapses, usage over the **free tier
  (50K reads + 20K writes/day)** bills the card. Biggest sink already cut (`job_pools` pool: deck reads
  ~3,800→~6). **Remaining:** session-cache Browse + company-view reads, cap query sizes, paginate; check
  reverse-match nightly + Ghosts read volume. Founder budget cap ~ $20 total.
  **Read-cost audit DONE 2026-08-27 -> `docs/E2-read-cost-audit.md`.** Ranked fixes (read-path only; no `[UI-REVIEW]`; each ships a state-coverage test):
  - [x] **E2-1 · Live-fallback caps → 1,500 · ✅ SHIPPED v248 (live)** (freshness ADMIN indicator deferred = [UI-REVIEW]) — removes the surprise-bill tail risk (a stale pool makes every fetch a 3,000-8,000-doc live read). **Do first.**
  - [x] **E2-2 · Company view read cost** ✅ **NO BUILD NEEDED — audit corrected 2026-08-27.** The company view already uses the pool-cached `fetchJobs`; the "≤800 reads" I flagged was actually `fb.mineHires` (rater path, reads the small `hired` collection, self-limiting). Residual cache-thrash on company-view open folds into **E2-4** below.
  - [x] **E2-3 · Session-memoize ghost counters** ✅ **SHIPPED v259 (live).** `countGhostReports` (recruiter Reviews tab + the notif loader, which fires on every bell/inbox open) now goes through `_gpjCountGhostReports` — a 5-min TTL cache, collapsing repeat reads of the same company to one per window. The high-volume candidate counter (`countJobReports`, per card paint) was **already** cached via `_jobReportCache`. Read-path only; 1 new state test.
  - [x] **E2-4 · Two-slot session cache + 30-min TTL** ✅ **SHIPPED v251 (live)** (region + nationwide both cached on roomy devices; low-mem keeps 1 slot per the v139 OOM fix).
  - [ ] **E2-5 · Cache the per-fetch internal-jobs query** (`limit(300)` on every `fetchJobs`; minor until the employer side grows).
- [ ] **Founder step:** screenshot **Firebase console -> Firestore -> Usage** (reads/day + trend) — tells us if we're already under 50K.
- [ ] **Founder safety net:** set a Firebase **budget alert/cap** (Billing -> Budgets & alerts) so nothing surprises you.
- [x] **E2-P · Stale-job PRUNE — FIXED (founder-approved).** ✅ **SHIPPED (harvester; effective next 05:00 UTC run).**
  Now runs on EVERY normal (non-stacking) harvest (was a ~never-hit "verify day"); queries ONLY stale docs
  (`ingestedAt < cutoff`, fail-safe — any error → 0 deletes, never touches fresh jobs); STALE_DAYS default 8→**14**
  (wide margin so a live job merely missing from a rotation window isn't pruned; wrongly-pruned live jobs also
  self-heal — re-harvested next cycle). **⚠️ Founder: check the next harvest log's `PRUNED N stale jobs` line is
  sane. Rollback: `git revert` the harvester commit.** _(5-part: what=run-every-run + cutoff-query + 14d; impact=dead
  listings finally clear; states=healthy/error(no-op)/stacking(skip); failure=fail-safe no-op; rollback=git revert.)_
- [ ] ~~E2-P (orig)~~ `[BUILD][FEATURE-CLASS: data-delete]`.
  The harvester HAS a prune (`prune_stale_jobs`, STALE_DAYS=8, deletes by `ingestedAt`), but it only runs on a
  "verify day" (`cycle_day==7`) AND **not** during STACKING mode — and recent stacking runs (pool build #61) plus
  the Usage screenshot (**Deletes = 0/7 days**) say it hasn't fired. Design risk: the ~205K-job pool may not be
  re-scraped within 8 days, so a live job could be wrongly pruned. **Proposed fix (needs founder sign-off + rollback):**
  run the prune every non-stacking harvest; set STALE_DAYS to safely exceed the real coverage-lap time; consider
  `active:false` marking before hard-delete. **Founder step:** open the latest Daily Job Harvest run → paste the
  `cycle_day=… verify=… pruned=…` line (or authorize `gh`) to confirm. Detail: `docs/E2-read-cost-audit.md` context.

---

## 2. NEW — found in the 2026-08-27 live audit (not yet in the roadmap)

- [ ] **N24 · Recruiter "Applicants" page — top counters not clickable + unclear flow** `[UI-REVIEW]` (founder
  live-test 2026-08-31). The 4 tiles (Applicants / Replies sent / Interviews / Active roles) are static counts you
  can't click to drill into; with 0 roles the page just says "post one under Listings." **Proposed:** make each tile
  filter/scroll to its list; clarify the empty state ("post a role → applicants land here"); tap-role → applicants →
  candidate card (the intended flow). Needs a recruiter login to live-test (see §5).
- [x] **N23 · Recruiter "Listing strength" is shallow (char-count feel)** — ✅ **SHIPPED v269 (2026-08-31), live.**
  New `_recCoherence` heuristic (distinct function words + real word shapes − monster tokens; no dictionary/read/
  network) gates `_recListingScore`: keyboard-mash/placeholder caps low + the tip becomes "write a real, readable
  description"; a short-but-genuine listing is unaffected. Founder's gibberish 38% → ≤20%. State test both projects.
  _Original:_ Today it scores length + presence of requirements/benefits/salary (a gibberish body still scored 38%). **Proposed:**
  score real quality signals — a genuine title, sentence/keyword coherence (not keyboard-mash), a salary RANGE,
  distinct requirements + benefits sections, reasonable length band — and give concrete "add X" tips. Honesty: never
  reward gibberish. (Candidate-facing match already ignores junk; this is the employer-side authoring aid.)
- [x] **N24 · Recruiter Applicants page — clickable counters + flow clarity** `[UI-REVIEW]` — ✅ **SHIPPED v272 (2026-09-01),
  live-verified in the recruiter session.** The 4 metric tiles are now tap-to-drill filters: **Applicants**→expand all pipelines ·
  **Replies sent**→your sent reach-outs · **Interviews**→scheduled interviews (with the candidate's post-accept contact) ·
  **Active roles**→the roles list. Active tile highlights mint + a clear-filter chip names the view; re-tap clears. Also gives
  reach-out RESPONSES a persistent home on the page (Interviews/Replies), next to the pipeline — closes the "where do replies go"
  loop **without** touching the shared Inbox render. Added a 3-step "How this page works" empty state + a "Post your first role"
  CTA, and a clearer "N applicants ▾" role affordance. **Zero new reads** (one `loadSentReachouts` powers Replies + Interviews +
  both drill-ins, dropping the old `countMyReachouts` call). Live-verified: the Replies-sent counter surfaced the founder's real
  sent reach-out (previously unreachable). 1 new state test + v204 metrics test updated.
  **Follow-up option (not built):** mirror responses into the Inbox tab too, if the founder wants them there as well.
- [x] **N27 · Reverse-match IS running** ✅ **VERIFIED 2026-09-01 (founder screenshots).** `FIREBASE_SERVICE_ACCOUNT` secret is
  set (3 months); the nightly **Reverse Match #51 ran Success** (2m18s). Earlier "it may write nothing" concern was stale — the
  pipeline is wired and executing. Remaining nuance: "Success" ≠ proven writes, and the founder's account has **0 live roles**, so
  an empty **Candidates** tab right now is EXPECTED (nothing to match). True confirmation = post a verified role + a discoverable
  candidate, then check after the next nightly. (Housekeeping done same day: bumped `actions/checkout`+`setup-node` v4→v5 across all
  workflows to clear the Node 20 deprecation warning that run showed.)
- [ ] **N28 · Mobile pipeline layout — founder decision** 🟡 `[UI-REVIEW]` — the applicant pipeline is a 6-column horizontal-scroll
  kanban (Applied→Reviewed→Interview→Offer→Hired→Closed). Great on desktop; on a phone it's a lot of sideways scrolling. Decide:
  keep the kanban, or collapse to a single list. ✅ **SHIPPED v273 (2026-09-01), live-verified on a phone viewport in BOTH themes.**
  On `!body.desk`, `_recRenderKanban` early-returns to `_recRenderPipelineMobile`: the 6 stages render as **stacked, collapsible
  sections** (tap a header to fold), each candidate row keeping the move-stage dropdown + 💬 Reach out / 💌 Decline + tap-to-open +
  ☑ bulk-select. No horizontal scroll; larger touch targets; brand-token colours → auto light/dark. **Desktop kanban is
  byte-unchanged** (guaranteed by the early-return — the kanban code isn't touched). Live proof: rendered a stub pipeline at 375px
  in light AND dark. 1 new state test; full suite 928/928.
- [x] **N25 · Recruiter-side candidate-leak cleanup** — ✅ **SHIPPED v271 (2026-08-31); live-verified in the recruiter session (2026-09-01).**
  Three founder-repro leaks where candidate surfaces bled onto the recruiter side: **(a)** the candidate streak/goal/market/Jett
  **desktop rail** painted in the recruiter "Candidates" view (CSS specificity — the rail's `display:flex` (2,3,1) out-specified
  the rec-mode hide (0,3,0); added a (3,5,1) override) — *shipped v270*; **(b)** the console **footer** was shoved 324px left in
  rec-mode by the candidate-rail reservation (added a rec-mode footer rule, no rail padding); **(c)** candidate deck **toasts**
  ("Pulling live market jobs…", "N fresh jobs match your resume") fired on the recruiter side (gated `_fetchLiveMarketJobs` +
  `maybeAlertNewMatches` to candidate-only). 3 state tests.
- [x] **N26 · Company logo lost after save + refresh** — ✅ **SHIPPED v271 (2026-08-31); live-verified in the recruiter session (2026-09-01) — the Company form shows the real logo after a fresh reload.** The logo was
  saved (to the company doc) but every recruiter rehydrate reads the *recruiter* doc, which never carried it → refresh dropped it
  to the 🏢 emoji. Now rehydrate pulls the logo back from the company doc (1 recruiter-only read, candidate-first invariant intact)
  and repaints the Company form; also carried on the recruiter doc going forward (zero-read fast path). 1 state test (module-race-safe).
- [x] **N22 · Logo uniformity across pages** — ✅ **SHIPPED v267 (2026-08-31), live.** Resources logo was 26px + no
  glow → 30px + mint `.ghost-glow` (generator + 6 existing articles); résumé-checker header/footer normalized to the
  same mint glow. Glow uses `var(--mint)` so it adapts light/dark. Favicon already uniform (N19). SEO pages carry the
  favicon only (no on-page logo by design — flag if you want one added).
- [x] **N21 · Hero secondary CTA was a dead-end** — ✅ **SHIPPED v267 (2026-08-31), live.** "Jump straight to swiping"
  (empty deck + can't apply/save for a logged-out visitor) → "🔍 Try the free résumé checker →" (real no-account value).
- [x] **N20 · Service-worker update errors spamming the diagnostics log** — ✅ **FIXED v263 (2026-08-31), live.**
  Diagnostics showed `Failed to update a ServiceWorker … unknown error when fetching the script` ×20 (v254).
  `reg.update()` returns a promise but the 3 calls were in synchronous `try/catch` (can't catch async rejection),
  so a transient `sw.js` miss during a Vercel deploy became an unhandled rejection the v125 reporter logged.
  Caught each `reg.update()` promise + drop benign SW update/register noise in `_gpjReportErr`. **Not user-facing**
  (the SW keeps serving the cached app). The **`www.` variant** (v239, 5d ago) is the stale SW on the
  un-redirected `www` host → resolved by **N14** (www→apex redirect, founder/infra). 1 new state test.
- [x] **N19 · Favicon = the transparent ghost + mint glow, on every page** — ✅ **SHIPPED v260–v262 (2026-08-30), live.** The
  browser-tab icon was the OLD logo (dark navy rounded-square, dated Jul 3) — it predated the Aug 20
  transparent-ghost upgrade (`assets/logo-mark.png`); and `resume-checker.html` + every resources article
  declared NO favicon at all. `scripts/build_icons.py` regenerates all brand icons from `logo-mark.png`
  (favicon-32/icon-192/icon-512 transparent; apple-touch + maskable on Midnight Plum for iOS/Android home
  screens) + a multi-size `favicon.ico`; favicon `<link>`s added to the checker, all 6 resources pages, and the
  resources generator template. **v261 refinement (founder):** the on-page logo carries a soft mint `.ghost-glow`
  (`filter:drop-shadow(0 0 6px var(--mint))`, both themes) that the flat favicon lacked, so the transparent white
  ghost washed out on light browser-tab chrome — the glow is now baked into the icon PNGs (blurred mint halo
  behind the ghost, inset for room), legible on light + dark. **v262 refinement (founder):** the tab ghost looked
  small — the source has a big transparent margin — so `build_icons.py` now trims the source to its opaque bbox and
  fits the ghost to ~92% of the frame (aspect-preserving); cache-buster now `?v=4`. **Founder note:** hard-refresh
  to see the new tab icon immediately; SEO city pages point at the same (now-updated) asset and refresh as their cache expires.
- [x] **N15 · Job text "looks truncated/incomplete" — FIXED.** ✅ **SHIPPED v253 (live).** `_gpjDedupText` in the drawer removes
  repeated content (a posting that repeats its overview/EEO — Gordian — or echoes the Benefits list at the desc tail — Wiza —
  no longer looks cut mid-phrase). Applied to Expectations / More / Benefits.
- [x] **N16 · Undisclosed-employer / scam jobs filtered — SHIPPED v253 (live).** ✅ `_gpjIsJunkJob` hides empty/"Hiring Company"/
  "Confidential" employers + scam-signal postings (crypto pay + Telegram shifts + sub-min-wage) from the deck + Browse; fail-safe.
  **⚠️ Watch for false hides of legit "confidential" listings** (per the founder-approved "ship + watch" plan); optional targeted
  company-backfill later only if needed. _Original detail:_ (founder repro 2026-08-28:
  an Indeed "Marketing Agent – Dropper" 1-day-old posting — Telegram dept, USDC/Binance pay, $1.55/hr, hidden employer =
  a classic recruitment scam). Root: harvester stores no company → mapper falls back to "Hiring Company" (index.html:5895/9652);
  `_gpjEmployerFromUrl` can't recover it from an aggregator (indeed.com) URL. **Mission conflict: GPJ surfaces "verified real
  jobs, flag ghost jobs" — it should NOT show these.** **Fix (needs founder DECISION):** (A) client-side HIDE undisclosed-employer
  jobs (company empty/"Hiring Company"/"Confidential") from deck+Browse · (B) relabel "Company not disclosed" + demote + high
  ghost-risk · (C) both + a scam-signal flag (crypto-pay + Telegram + below-min-wage). Rec: **A + C's scam flag.** Awaiting founder pick.


- [x] **N11 · Harvest was failing → RESOLVED.** ✅ 8/25 was a transient Google-side blip (`400 Invalid database id`);
  the 2026-08-27 manual re-run **succeeded**, and I **pinned the Firestore write stack** (`requirements.txt`:
  firestore 2.29.0 / api-core 2.34.0 / grpcio 1.83.0 / protobuf 7.36.0 / auth 2.57.0 …) to the exact working set so
  a transitive bump can never silently break writes again. Takes effect next harvest (or trigger a manual run to confirm).
- [x] **N13 · Circular company/job logo + unified 💼 default** ✅ **SHIPPED v249 (live).** All logos circular; one default (💼).
- [ ] ~~N13 (orig)~~ `[UI-REVIEW]` (founder-requested; bundled with N1).
  Make all company/job logos **circular**; use **one** consistent no-logo default (today it's inconsistent: 💼 job card /
  🏢 company / 🧑 person). Founder to pick the default: **(A)** ghost 👻 in a circle · **(B)** brand-gradient monogram ·
  **(C)** 🏢. Build together with N1 (aggregator-host blocklist) so wrong logos fall back to the chosen circular default.
- [ ] **N14 · `www.ghostproofjob.com` does not redirect to the apex** `[FOUNDER/INFRA]` (found via the N9 Diagnostics tool).
  www returns 200 as a **separate origin** → its own Service Worker + cache, so www users can lag on an old build (a v239
  SW-update error showed up there) + an SEO duplicate signal. Fix: **Vercel → Domains → set `ghostproofjob.com` primary**
  (auto-redirects www), or a `vercel.json` www→apex 301. The clustered apex SW-update errors are benign (update-check
  blips during the v247→v248 rollout; `sw.js` serves 200 correctly).
- [ ] ~~**🔴 N11 · P0 — Daily Job Harvest is FAILING (jobs going stale).**~~ `[BUILD][INFRA][data-write]`
  Run #76 (8/25) crashed: `google.api_core.exceptions.InvalidArgument: 400 Invalid database id (default)` at
  `batch.commit()`; today's run was **cancelled at the 60-min timeout**. Root structure confirmed: `init_firestore`
  is correct, but the **google dependency stack is UNPINNED** — `firebase-admin==6.5.0` (2024) now auto-pulls
  `google-cloud-firestore 2.29.0` + `google-api-core 2.34.0`, so the runner's deps drift daily. (The routing-header
  paren-encoding I first suspected is normal/old — a red herring.) **Cannot confirm transient-vs-persistent from the
  sandbox** (no backend creds; local Python is 3.14, runner is 3.12). **Plan:** (A) **manual re-run now** (free,
  definitive) → tells us if it recurs; (B) **pin the google stack** in `requirements.txt` regardless (stops silent
  drift) — verified by the CI run; (C) **timeout hardening** (a hung commit-retry can't eat 60 min); (D) **failure
  notification** (see N12). Impact: no fresh jobs since ~8/24 → pool content ages; the app may drift to the live-query
  read-path (explains reads at 32K). **Consequence for E2-P prune:** even on 8/25's verify-day the prune never ran —
  the harvest crashed before reaching it.
- [x] **N12 · Failure alerting on the daily harvest.** `[BUILD][INFRA]` **✅ SHIPPED (job_harvest.yml `if: failure()` → opens/comments a `harvest-failure` GitHub issue; GitHub emails you).** Caveat: a step-crash triggers it; a job TIMEOUT/cancel does not (GitHub's native run-failure email covers that) — a scheduled **watchdog** workflow is the fuller follow-up (proposed). **Extended to the reverse-match / SEO / resources crons (v248 batch).** Original: nothing told the founder (or Claude) when a
  cron workflow fails — it died quietly for days. **Fix:** add an `if: failure()` step to `job_harvest.yml` (+ the
  other crons) that emails via the existing **Resend** wiring (and/or opens a GitHub issue) with the failing step +
  error. Native, no inbox scraping. Optionally a daily pool-freshness health check (builtAt < 36h).

- [x] **N1 · Wrong company logo (LinkedIn/Indeed glyph) — FIXED.** ✅ **SHIPPED v249 (live).** `_gpjLogoDomain` now blocks job-board/aggregator/ATS/social hosts → wrong-brand icons fall back to the default. `[UI-REVIEW]` · HIGH-visibility, honesty.
  On the **swipe card** AND the **Ghosts company list** (both themes), companies sourced from LinkedIn show
  the LinkedIn logo, because `companyWebsite` = a `linkedin.com/company/...` URL and `_gpjLogoDomain`
  (index.html ~14985) has **no job-board/aggregator host exclusion**. **Fix:** blocklist linkedin/indeed/
  glassdoor/ziprecruiter/monster/greenhouse/lever/ashbyhq/myworkdayjobs/icims/google/bing → return `''` →
  falls to the brand-map → existing **💼 / 🏢 placeholder**. Single-point fix; add a state-coverage test.
- [x] **N2 · "98% Match" on every card — FIXED.** ✅ **SHIPPED v250 (live).** De-saturated `_gpjScoreMatch`/`scoreCore.js` into capped IN-FIELD (~68) + DEPTH (~28) components; new spread strong 96 / exact-thin 83 / partial 41 / out 22. **Founder: live-verify the new % distribution on your deck (caps are tunable).** Original: over-generous score — Murray/Dow/
  Conroe/Houston Methodist all read 98% while the relevance chips read 12%/26%/8%. Same-field over-generosity
  was never tightened (v212/v216 fixed cross-level + messaging only). **Fix:** tighten `computeMatch`/`scoreCore`
  generosity so a weak in-field fit isn't in the 90s. (This IS the Sprint-B "Match %-honesty" item.)
- [x] **N3 · Ghost-page (empty-state + flagged-companies).** ✅ **SHIPPED v257 (2026-08-28), live.** Founder
  decisions from the live audit: **(a)** a company you FLAG (file a ghost report on, or confirm ghosted you) is
  now **removed from your hunt** — its roles leave the deck + Browse via the undoable `hideCompanyRoles`
  (Settings → Hidden companies). **(b)** the "Around your hunt" cards' bare **"—"** now reads **"no reports yet"**
  with an explanatory tooltip (community ghost-risk shows once enough hunters report). "Hiring near your search"
  is sourced from the live pool, so it only shows companies that genuinely have live roles (accurate). 2 new
  `[STATE-COVERAGE]` tests. **Deferred (founder, on hold):** ghost-% card-face placement + button icon/word centering.
- [x] **N4 · Mobile tap targets < 44px.** ✅ **SHIPPED v264 (2026-08-31), founder-approved, live.** A scoped
  `@media(max-width:1023px)` block grows the tap HEIGHT (min-height + vertical centering) on Sign In, Support Us,
  the bell, Match to Job + Cover Letter, and the `.quick-chip` filter chips → 44–46px (chips 38px). No change to
  colors/labels/layout; desktop untouched; **the ghost logo is NOT touched** (founder asked — a Playwright test
  asserts the logo stays in the header at ~34px while the chips measure ≥44px on mobile). 902/902 both projects.
- [x] **N5 · Cross-surface brand-purple mismatch.** ✅ SHIPPED v248 — App light `--cyber` = `#7C3AED` but Resources pages
  (`resources/index.html`) use `#7A3CA8`. Unify (folds into F-WORDING/B3).
- [x] **N6 · "Resume Optimizer" label appears twice** ✅ SHIPPED v248 — in Résumé Studio (collapsed header + expanded block reuse
  the same title). Minor copy/polish.
- [x] **N7 · Repo cruft** ✅ DONE (removed v248) — deleted the stray empty `ran` file and `${OUT}v246_salary_tiles.png` (leaked shell
  var in a filename) at repo root. (Trivial; "ask before deleting" — confirm.)
- [x] **N8 · Automate the live-URL post-deploy smoke** (= E3) — ✅ **SHIPPED 2026-09-01.** `.github/workflows/post_deploy_smoke.yml`
  + `scripts/post_deploy_smoke.mjs` (`npm run smoke:live`): after a push that changes the app (path-filtered to
  `index.html`/`GhostProofJob.html`/`sw.js`), it polls the live URL until it serves THIS commit's `APP_VERSION` with a valid
  shell (up to 10 min), else the run goes red — catching a stale/failed/paste-truncated deploy the local §4 gate can't see.
  Both pass + fail paths validated locally against the live site. Zero secrets, zero cost beyond a public GET; independent of
  the verify.yml gate and promote-stable.
- [x] **N9 · Admin Diagnostics — readable Bug & Error report** `[UI-REVIEW][BUILD]` · founder-requested.
  **✅ SHIPPED v247 (2026-08-27) · live-verified.** Benchmark GREEN · 8 backend suites · Playwright **866/0/0** ·
  both-theme visual proof. Deployed to production (ghostproofjob.com == v247). **Founder: run test T12 on your admin account.**
  Today the admin panel shows only the 🐞 24h client-error COUNT (`adminLoadErrCount`), and the actual data
  lives where the founder can't easily read it: `client_errors` docs `{msg,src,line,ua,v,ts}` (admin-read;
  auto-captured from `window.onerror`/`unhandledrejection`) are only viewable in the **Firebase console**, and
  user `bugReports` (their text + a 10-line `consoleTrail` + context) are delivered to **support@ghostproofjob.com**
  (Worker `/contact` always sends to support) and stored in Firestore `bugReports` — see N10 re: the reply-to.
  **Build:** an admin-only "🔬 Diagnostics" report under the existing admin panel that lists BOTH —
  (a) **client errors grouped/deduped by `msg|src|line`** with occurrence count, latest time, app version, browser;
  (b) **user bug reports** (description + console trail + timestamp) — each in plain, readable language, plus a
  **"Copy report" button** so the founder can paste it straight back here to resolve.
  **No rules change needed** (both collections are already admin-read). **[FREE-TIER]:** admin-only, manual-trigger,
  **capped** (e.g. last 100 errors + last 50 reports) → a bounded handful of reads only when opened, never on the
  candidate hot path — consistent with the existing count-only design. **[STATE-COVERAGE]:** admin (renders) ·
  non-admin (hidden/denied) · empty (honest "no errors/reports in range") · read-fail (message, never blank).
- [x] **N10 · Bug-report reply-to is a dead inbox.** `[BUG]` **✅ SHIPPED v247 (live).** The bug-report send (`index.html:15826`) set the
  Worker `/contact` payload `email:'bugs@ghostproofjob.com'` — **`bugs@` is not an active mailbox.** The report
  itself IS delivered (Worker always sends **to `support@`**; it's also written to Firestore `bugReports`), but
  `email` becomes the **reply-to**, so replying to a bug-report email bounces. **Fix:** set the reply-to to the
  **signed-in reporter's email when available, else `support@ghostproofjob.com`** — never the dead `bugs@`.
  One-line, non-visual, no Worker/rules change. Good to fold into the N9 build.

---

## 3. OPEN WORK BY SPRINT (Sprint A is ✅ complete)

### Sprint B — Trust the Intelligence (verify + harden the core value)
- [x] **B1 · Cover-letter / AI quality** (F-AI, F-COVERLETTER) — ✅ **FIXED v265 (2026-08-31), live.** The three
  founder-repro bugs are gone (Talkiatry live-test): no "put the Excel I bring to work" (generic tools filtered),
  no "emphasizes marketing and design" (whole-word themes + title-word drop; "design"←"designed" false-positive
  killed), and it now quotes the RECENT Salesforce/CRM bullet, not a 2014 one (recency boost). Brand nouns keep
  caps ("Salesforce"). New state test runs the real résumé+job and asserts all three. Live-quality remains a
  founder gate (Worker prompt is outside the repo). **Was: 🔴 DIAGNOSED 2026-08-31 via founder live-test
  (Talkiatry "Senior Lifecycle Marketing Manager", real résumé + cover letter). THREE compounding bugs in
  `tailorCoverLetter` (index.html ~9116):** **(A)** p3 built `'the '+skillsTop+' I bring'` and `skillsTop`
  resolved to a generic tool skill → **"put the Excel I bring to work where outcomes matter"** (embarrassing;
  generic tool skills like Excel/Word/PowerPoint must never lead, and the phrasing only reads for phrase-skills).
  **(B)** `lead` themes were generic/vacuous — **"Your posting emphasizes marketing and design"** ("marketing"
  is vacuous for a marketing role; "design" isn't in a lifecycle role). **(C)** the quoted bullet matched the
  generic word "marketing" → surfaced the OLDEST, off-domain bullet ("directed marketing … four-state territory",
  a 2014 sports-training GM role) instead of the on-target lifecycle content that's literally in the summary.
  **Fix plan (next build):** generic-skill blocklist + phrase-guard for the p3 lead; drop vacuous/self-evident
  themes (the role's own noun) and prefer distinctive multi-word terms; bias bullet pick toward recent +
  quantified + on-domain. Add a state test asserting the Talkiatry case never emits "the Excel I bring" / "and
  design". Live-quality still a founder gate (Worker prompt is outside the repo).
- [ ] **B2 · Rater + ATS-preview** (F-RATER, F-ATSPREVIEW) — confirm the rater reads the WHOLE résumé, scores on
  the stable 7-day corpus, two honest labelled scores; confirm the ATS preview shows the REAL parsed data
  (never audited — launch-readiness open Q3).
- [x] **B2b · Match %-honesty** (= N2) — ✅ SHIPPED v250; awaiting founder live-verification of the new distribution.
- [~] **B3 · Site-wide wording / pricing consistency sweep** (F-WORDING) — one honest story everywhere (app +
  static + Resources + checker); folds in N5 brand-purple unify. **N18 slice DONE v255:** the misleading
  "Free until you're hired" (implied you pay after being hired) reframed to **"Always free"** — **app side DONE
  (v255 + v258):** footer promise (+ JS twins), swipe status, pricing lines, the Ghosts-page stat, the Support-Us
  menu header, and the SEO hub page. **Remaining:** the generated SEO *city* pages still use the old phrase
  (generator template — separate change); N5 brand-purple unify; a final pricing/tier pass across Resources + checker.
- [ ] **B-misc · Spell-check reachability** — `resumeSpellCheck()` runs only at import; "Improve My Whole Resume"
  doesn't spell-check and there's no button (feature-audit A3). Decide: wire it into Jett / add a button.

### Sprint C — The Wow Pass (all `[UI-REVIEW]`; C1/C2/C3 shipped)
- [x] **C4 · Motion & delight (applicant only)** — ✅ **SHIPPED v270 (2026-08-31), live.** The bulk shipped earlier
  (v208 streak/weekly-goal/Apply+Hired celebration bursts, v209 touch-drag physics + haptics + undo pill, v241/C3
  animated match-ring count-up); v270 completes the **desktop half** — mouse users can now drag-swipe the top card
  (mirrors the touch handlers) with tap-vs-drag disambiguation (`#card-deck[data-gpj-dragged]` so a drag never also
  toggles the drawer), a self-disabling guard once any touch is seen, and reduced-motion snap-back. Core swipe intact
  (tap-to-drawer, ❤/🚫, apply/skip record, undo all covered). 1 state test. **Touch drag-feel still worth a founder
  spot-check on a real phone (tests can't judge "feel").**
- [x] **C5 · Skeleton loaders + mascot empty/first-run states** — ✅ **SHIPPED v266 (2026-08-31), live.** `#deck-skeleton`
  shimmer shows only during an active deck fetch with no card yet (never flickers over existing cards), hides when
  real cards paint or the deck resolves to the (pre-existing) mascot empty state. Reduced-motion → static tint. 1 state test.
- [x] **C6 · Signed-out home hero** — ✅ **SHIPPED v255 (2026-08-28), browser-verified.** A self-contained
  full-screen signed-out landing (`#gpj-hero`) — the first paint for new logged-out visitors: rotating headline,
  value pillars (Build/Optimize/Apply/Simplify), muted looping demo swipe, honest proof (no fabricated numbers —
  aggregate stats stay omitted until F-GHOST has real volume), real theme-adaptive logo, both themes, responsive.
  **Additive/INSERT-ONLY:** shows only when logged out via the SAME gate the onboarding modal used (skipped for
  `ngj_returning`, hidden on sign-in); the app sits intact behind it; the legacy onboarding modal is neutralized.
  Rendered in the initial HTML so crawlers read real marketing copy (SEO). Auth modal (z340) layers above the
  hero (z335). Verified guest first-visit × dark/light × mobile/desktop; 4 new `[STATE-COVERAGE]` tests.

### Sprint D — Signature Features (3 of 4 already built → VERIFY; D2 is the one build)
- [x] **D2 · Full Inbox tab** `[UI-REVIEW]` — ✅ **SHIPPED v254 (2026-08-28), live-verified.** A real full-tab
  Inbox that surfaces every message/event in one place (Messages / Interviews / Responses / Applicants /
  Matches / Reviews / Admin / Account), replacing the interim per-message dismiss (v196). Reuses the
  notification data layer (`window._notifs` via `_gpjNotifLoad`) → **ZERO extra Firestore reads** beyond the
  bell; each row routes via `notifGo()` to the live reply / interview-picker / rate / candidate-card control
  (no duplicated UI = no regression). Both roles (both titled "Inbox"), both themes, mobile + desktop.
  Entry: desktop rail + "📬 Open full Inbox →" in the bell dropdown — **no mobile bottom-nav layout change.**
  Browser-verified guest/populated × dark/light × mobile/desktop; 4 new `[STATE-COVERAGE]` tests (882/882 both projects).
  **v268 REBUILD (founder live-test: "clicking a message just takes me back to Settings"):** candidate messages
  now **EXPAND INLINE** in the Inbox with their real actions (accept / pick a slot / appeal / reschedule / cancel /
  dismiss), reusing the same global action fns — no more bounce to Settings; the 🔔 bell routes candidate messages
  into the Inbox too; `_notifCandidate` caches the full reach-out objects (zero extra reads). 908/908 both projects.
  Follow-ups (future, not blocking): "Add to Google Calendar" + employer applicant cards + next-steps/rejection actions.
- [ ] **D1 · F-GHOST aggregated flag counts** — VERIFY the count aggregates with real volume + the "another hunter
  reported this" popup surfaces everywhere.
- [ ] **D3 · 5 résumé templates** — VERIFY each exports cleanly (accent/headshot/spacing/address toggles intact).
- [ ] **D4 · Broaden-location flow + "other regions" control** — VERIFY the same-state→statewide→other-cities
  ladder + B-SALARY-CYCLE (client-side salary filter) + B-SARATOGA hard-scope.

### Sprint E — Growth & Cost
- [ ] **E2 · D1 read-cost reduction** — see §1 (the deadline).
- [ ] **E3 · F-TEST hardening / signed-in CI + live-URL post-deploy smoke** (= N8) — authed Playwright in CI +
  a Playwright job against the production URL (home loads, deck fetches, `/smart-match` responds, `APP_VERSION`==HEAD).
- [x] **E1 · Resources cron GO-LIVE** — ✅ LIVE (v243 go-live; every-other-day publisher). Monitor output.

### Company real-data (cross-cutting)
- [x] **N17 · Company logo from the apply-URL domain** — ✅ **SHIPPED v256 (2026-08-28), live.** When a role's
  "View Full Posting" points at the employer's OWN domain, the logo is derived from it
  (`careers.geisinger.org`→`geisinger.org` favicon), wired into both the swipe-card logo and the shared
  `_gpjLogoHtml` chain (after stored-website + curated brand map). New `_gpjRegDomain` (ccTLD-aware) +
  `_gpjLogoDomainFromUrl`; the N1 blocklist gained ~30 aggregator/ATS/redirect hosts (jooble, adzuna, ADP,
  Taleo, workday, …) so a job board's mark is never shown for the real employer. 1 new `[STATE-COVERAGE]` test.
  **Remaining (small):** surface a real "Website" button on the company card from the same derived domain.
- [ ] **Harvester long-tail logos** — `company_url`→`companyWebsite` (v240) populates as the pool self-heals (~8 days). Verify on a live harvest.

---

## 4. CARRIED-OVER P1/P2 (from the v157 launch-readiness study — de-duplicated)

**Resolved since v157 (verify live, then keep checked):**
- [x] Node 20→24 (P0-1) — `engines:"24"` + all workflows on 24. ✅
- [x] Hide Ledger 60-cap (P0-2) — v186 (~5,000 keys, cloud-synced). ✅
- [x] Matching ignores education/certs (P1-4) — v187. ✅
- [x] Rater benchmarks wrong role (feat-audit A1) — v156 targets the wanted role. ✅
- [x] Public résumé checker (P2-3) — shipped `/resume-checker.html` (zero-read, static). ✅
- [x] Message hide-for-me (P1-6/D6) — v196 per-message dismiss. ✅

**Still open:**
- [ ] **P1-2 · Reverse match returns nothing** — blocked on the `FIREBASE_SERVICE_ACCOUNT` secret / one run-log
  line (open since v145). **Founder action.**
- [x] **P1-3 · Candidate matches email digest** — ✅ **SHIPPED 2026-09-01 (DRY-RUN gated).** `scripts/candidate_digest.mjs` +
  `.github/workflows/candidate_digest.yml` (`npm run digest:candidates` · `digest:check` fixture): reads the D1 pool + a bounded
  batch of profiles, scores every pool job against each résumé with the SHARED `api/match/scoreCore` (the exact card engine → the
  email matches the app), and emails each candidate their top new matches. Honors `newJobMatches` + `emailOptOut`; SEND_CAP guards
  Resend's 100/day. **GO-LIVE GATE:** default DRY-RUN (emails only a founder preview, never a real candidate); weekly cron commented
  + `DIGEST_LIVE` unset until the founder runs the dry-run, reviews, and enables both. offline self-test + 4 email-suite tests (23/23).
  Ghost-risk + rating-reminder sections are the fast follow into the same weekly email once matches is live. (This makes the v274
  "email later" toggles real.)
- [ ] **P1-7 / F7 · Hire data captured but not surfaced** — do NOT publicly claim hire numbers until an aggregate view exists.
- [ ] **P2-5 · Offline queue** — an action taken offline may never reach the cloud (unknown/unbuilt).
- [x] **P2-6 · "My Data" audit view** — ✅ **SHIPPED v275 (2026-09-01), live-verified with real data.** New collapsible Settings section
  showing everything stored (Account / Résumé / Preferences / Activity / Local), labeled by where it lives + what's shared, with the
  no-selling promise, a **real client-side JSON export** (replaced the old fake "check your email" toast) + Delete. Responsive + themed.
- [ ] **P2-7 · Backup branch auto-update on green** — the deep backup branch is far behind (intentional fallback); automation approved, unbuilt.
- [ ] **P2-8 · Speed Insights re-add + guard** — was merged then silently lost in a full-file rewrite.
- [ ] **P2-10 · Dead files** — `manifest.json` (unreferenced; note `manifest.webmanifest` is the live one) +
  `frontend/Swipecardquery.js`. **Ask before deleting.**
- [ ] **SEO (P2-1/P2-2 / G1)** — 312 templated pages "discovered, not indexed" (crawl reality, PARKED, not a bug);
  duplicate company pages — generator doesn't fold name variants like the app's `_coKey`.
- [ ] **Dead-code / orphan audit** — `openCardCompanyProfile` (CLAUDE.md §6 landmark, zero callers) +
  ~9 other unreferenced fns; confirm retired vs. lost.

---

## 5. FOUNDER MANUAL ACTIONS (external consoles — I can't do these; confirm status)

- [x] Deploy latest **Cloudflare Worker** — ✅ done (latest deployed 2026-08-26/27, founder-confirmed).
- [x] Firestore **point-in-time recovery** — ✅ enabled.
- [ ] **Confirm `firestore.rules` is deployed** — D1 pool reads it live (tracker says LIVE); confirm the console shows current rules.
- [ ] **DMARC** TXT record for Resend + confirm **SPF/DKIM** green (P2-9). `_dmarc` TXT: `v=DMARC1; p=none; rua=mailto:support@ghostproofjob.com; fo=1`.
- [ ] Confirm Worker emails use `support@` (not `noreply@`) — if the latest Worker deploy included it, check this off.
- [ ] **Branch protection** on `main` (require `verify`) + `stable` (CI-only push, no force).
- [ ] **Set a Firebase budget alert/cap** (the credit-clock safety net — §1).
- [ ] Resolve the **Cloudflare vs Vercel DNS** confusion (guidance only — I won't change DNS): decide the domain
  stays on **Vercel DNS** (avoids moving nameservers to Cloudflare / its paid tiers). The Worker runs on
  `*.workers.dev` and does NOT need the apex domain.
- [ ] **`FIREBASE_SERVICE_ACCOUNT` GitHub secret** — set it (unblocks reverse-match P1-2).
- [ ] **Expand the employer test listing past 26 chars** (P1-5) — so it clears the listing-strength pin gate.
- [ ] **Walk account creation end-to-end** (signup → profile write → first-run) — never exercised by anyone.
- [ ] **Confirm the recruiter test-account login** (was timing out).

---

## 6. PARKED DECISIONS (need a founder call)

- [ ] **Button *word* vs *icon* centering** (10px, site-wide) — A: keep icon, pin left · B: drop icon. On hold; remind after Sprint C.
- [x] **Ghost-% placement** — ✅ **RESOLVED + SHIPPED v271 (2026-08-31), mockup approved (`scratchpad/ghost-chip-mockup.html`).**
  Reversed the v245 de-dup hide: the card-face community ghost-risk pill is now SHOWN whenever it has a value
  (`.s-ghost:not(:empty)` — 👻 N% / 👻 — / ✅ Verified, color-coded, real-data-only per v119), sitting in the Match group
  and reading as tappable (opens the drawer's full community breakdown, which is kept). Empty pre-fill state stays hidden.
  v245 dedup test updated to assert the reversal + a new state test (populated shows / empty hidden / verified ✅).
- [x] **N3 Ghost-page decisions** — ✅ RESOLVED + SHIPPED v257: (a) flagged companies **do not** surface in your hunt (auto-hidden, undoable); (b) "hiring near your search" is live-pool-sourced (accurate). Deferred: ghost-% placement, button centering.

---

## 7. 🧪 MANUAL TEST CHECKLIST — step-by-step (founder runs these)

> Run on a **real device**, **logged in** unless noted, and check **both dark + light** (profile menu → theme toggle)
> and **desktop + mobile** (resize the window / open on a phone). Hard-refresh first so you're on the latest build.

### T0 · Confirm you're on the current build (do this first, every deploy)
- [ ] Open `ghostproofjob.com`. In the browser console type `APP_VERSION` (or check "What's New") → it should read **v269**
  (or the version we just shipped). If it's older, you're on a **stale/cached deploy** — hard-refresh (Ctrl/Cmd-Shift-R) or re-upload `index.html`.

### T1 · In-app Self-Test (the fastest health check — 19+ checks)
- [ ] Profile chip (top-right "Aaliyah") → **Run Self-Test** → wait for it to finish → **every row green**.
  Any red = tell me the row name; that's a real failure, not a flake.

### T-C6 · Signed-out home hero (SHIPPED v255 — test in a logged-OUT / private window)
- [ ] Open `ghostproofjob.com` in a **private/incognito window** (so you're a fresh, logged-out visitor). You should
  land on the **hero landing page** — big headline "Get answered, not ghosted." that **rotates** through 3 lines,
  value pillars, a looping demo card, and a green **"Always free"** pill. Check **dark + light** (🌓 top-right) and **phone + desktop**.
- [ ] **"Jump straight to swiping"** → the hero disappears and you're in the app deck. Refresh → it does **not** come
  back (you're now a returning visitor). **"Sign in"** / **"Get started"** → the login/signup box opens **on top** of the hero.
- [ ] Sign in → the hero is gone. Existing (already-signed-in) sessions should **never** see the hero.

### T-D2 · Full Inbox tab (SHIPPED v254 — test this build)
- [ ] **Desktop:** the left rail now has **✉️ Inbox** (between Ghosts and Account/Profile). Click it → you land on
  the Inbox. **Mobile:** tap the **🔔 bell** (top-right) → **📬 Open full Inbox →** at the bottom of the dropdown.
- [ ] If you have any real messages/interviews/matches, they appear **grouped** (Messages / Interviews / Responses /
  etc.), newest first, with an **unread purple tint + dot**; if not, you see an honest "**Nothing here yet**" note.
- [ ] Tap a row → it takes you to the **live control** for that item (the reply box / interview picker / rating /
  candidate card) and marks it **read**. Come back to Inbox → the dot is gone and the "unread" count drops.
- [ ] **Mark all read** clears every dot. Check **both dark + light** and **phone + desktop** — spacing stays clean,
  and the **mobile bottom nav is unchanged** (still Swipe / Browse / Resume / Ghosts / Employers).

### T2 · Company logos (the N1 fix — after we ship it)
- [ ] **Swipe** a few cards + open **Ghosts** → company logos are either the **real company logo** or the
  **💼/🏢 placeholder** — **never the blue LinkedIn "in" logo** on a non-LinkedIn company. Check dark + light.

### T3 · Match % honesty (the N2 fix — after we ship it)
- [ ] **Browse** your list → the green **"Match"** badge is **not 98% on every card**; a weak/out-of-field role
  reads a believable lower number. Open a strong match and a weak one → the numbers differ sensibly.

### T4 · Ghost-page (the N3 fix — SHIPPED v257)
- [ ] **Ghosts** → companies with no community data show **"no reports yet"** (not a bare "—") in the "Around your
  hunt" cards. Companies under "hiring near your search" come from your live search, so they genuinely have roles.
- [ ] **Flag a company** (file a ghost report on it, or answer "yes, they ghosted me" in the monthly check) → you
  see "…is hidden from your hunt". **Swipe/Browse** → that company's roles no longer appear. **Settings → Hidden
  companies** → the company is listed with an **Unhide** that brings its roles back. Check dark + light.

### T5 · Mobile tap targets (the N4 fix — after we ship it)
- [ ] On a **phone**: Sign In, Support Us, **🎯 Match to Job**, **✨ Cover Letter**, and the filter chips are
  **easy to tap** (comfortably thumb-sized, ~44px tall) — none feel like a thin sliver.

### T6 · Résumé tailoring / AI quality (B1 — needs the Worker deployed, which it is)
- [ ] **Résumé** → open a real job → **🎯 Match to Job** → the reframe touches **only 2–3 bullets**, reads
  natural (NOT "marketing" stuffed onto every line), and **never invents** a metric/employer/title. **Send me the PDF.**
- [ ] **✨ Cover Letter** on the same job → no unfilled phrasing ("the this role position"); it names real strengths;
  if live AI wasn't reachable it **says so** (honest fallback banner).

### T7 · Rater + ATS preview (B2)
- [ ] **Résumé** → **Rate My Résumé** → two honest labelled scores (writing quality + role fit); the score doesn't
  swing wildly between visits. **ATS preview** → what it shows matches your real résumé content (name, titles, skills).

### T8 · 5 template exports (D3)
- [ ] **Export Template Studio** → try each of the **5 templates** (Classic ATS / Modern Split / Minimal /
  Corporate Grid / Creative Accent) → each downloads a clean PDF; toggling accent / headshot / spacing / address
  doesn't break the layout. Check one in dark and one in light.

### T9 · Broaden-location ladder (D4)
- [ ] **Browse** → the "Show other parts of [State] → / Show all regions →" pill widens **only when you tap it**
  (never on its own). The "Only jobs with posted salary" toggle **filters in place** (doesn't re-pull random regions).

### T10 · Both-theme + device sweep (every build)
- [ ] Walk **Swipe · Browse · Résumé · Ghosts · Account** in **dark**, then **light** → colors match the brand
  (Midnight Plum / Mint / Cyber Purple), text is readable, nothing off-center or clipped. Repeat on **mobile**.

### T11 · Deploy proof (after each deploy)
- [ ] Re-run **T0** on the live site + re-run **T1 Self-Test** → confirms the deploy is live and healthy, not stale.

### T12 · Admin Diagnostics report (the N9 build — after we ship it)
- [ ] On your admin account: **Settings → admin panel → 🔬 Diagnostics** → you see a **readable list** of recent
  client errors (grouped, with counts + which browser + which build) AND user bug reports (their words + console
  trail) — not just the 🐞 count. Tap **Copy report** → paste it here so I can resolve the specific issues.
  _Until this ships, view client errors in the Firebase console (`client_errors`) and bug reports in your **support@** inbox or Firestore `bugReports`._

---

## 8. How we work each item (the loop)
`[UI-REVIEW]` mockup + approval (if visual) → `[STATE-COVERAGE]` matrix + test → INSERT-ONLY build (full files) →
**full Matrix Gate, no skips** → visual proof (before/after, both themes) → you approve → I push (with your go-ahead)
→ **live-URL post-deploy check** → update this index + `sprint-roadmap.md` + `BUILD_HISTORY.md`.

_Last updated: 2026-08-27 · against live build v246._
