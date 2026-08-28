# GhostProofJob — OUTSTANDING INDEX (single reference sheet)

> **Purpose:** the ONE place to see every open item by its ID, its status, and where the
> detail lives — plus a step-by-step manual-test checklist the founder runs. Check items off
> (`- [ ]` → `- [x]`) as we complete them.
> **Current live build: v254** (`CACHE_VERSION = gpj-v254`; live == repo, verified 2026-08-28).
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
  - [ ] **E2-3 · Session-memoize ghost counters** (`countJobReports`/`countGhostReports` read <=200 docs each; the job counter fires on every card paint).
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
- [ ] **N3 · Ghost-page empty-state copy.** `[UI][DECISION]` Replace bare "—" with "a report is logged; a
  community % appears once there's enough signal"; relabel "hiring near your search" companies that have **zero
  live roles** when tapped. (Same as the roadmap "Ghost-page intuitiveness pass".)
- [ ] **N4 · Mobile tap targets < 44px.** `[UI-REVIEW]` Sign In (28px), Support Us (28px), Match to Job (30px),
  Cover Letter (30px), filter chips (29px) are below the 44px iOS / 48dp Android minimum. Padding-only fix;
  add a mobile Playwright assertion (primary buttons ≥44px tall).
- [x] **N5 · Cross-surface brand-purple mismatch.** ✅ SHIPPED v248 — App light `--cyber` = `#7C3AED` but Resources pages
  (`resources/index.html`) use `#7A3CA8`. Unify (folds into F-WORDING/B3).
- [x] **N6 · "Resume Optimizer" label appears twice** ✅ SHIPPED v248 — in Résumé Studio (collapsed header + expanded block reuse
  the same title). Minor copy/polish.
- [x] **N7 · Repo cruft** ✅ DONE (removed v248) — deleted the stray empty `ran` file and `${OUT}v246_salary_tiles.png` (leaked shell
  var in a filename) at repo root. (Trivial; "ask before deleting" — confirm.)
- [ ] **N8 · Automate the live-URL post-deploy smoke** (= E3 below) — the local gate can't catch a stale deploy.
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
- [ ] **B1 · Cover-letter / AI quality** (F-AI, F-COVERLETTER) — verify end-to-end now the Worker is redeployed;
  fix any unfilled phrasing ("the this role position") / forced emphasis; confirm honest fallback labels +
  per-tier caps. Live-quality is a founder gate (Worker prompt is outside the repo).
- [ ] **B2 · Rater + ATS-preview** (F-RATER, F-ATSPREVIEW) — confirm the rater reads the WHOLE résumé, scores on
  the stable 7-day corpus, two honest labelled scores; confirm the ATS preview shows the REAL parsed data
  (never audited — launch-readiness open Q3).
- [x] **B2b · Match %-honesty** (= N2) — ✅ SHIPPED v250; awaiting founder live-verification of the new distribution.
- [ ] **B3 · Site-wide wording / pricing consistency sweep** (F-WORDING) — one honest story everywhere (app +
  static + Resources + checker); folds in N5 brand-purple unify.
- [ ] **B-misc · Spell-check reachability** — `resumeSpellCheck()` runs only at import; "Improve My Whole Resume"
  doesn't spell-check and there's no button (feature-audit A3). Decide: wire it into Jett / add a button.

### Sprint C — The Wow Pass (all `[UI-REVIEW]`; C1/C2/C3 shipped)
- [ ] **C4 · Motion & delight (applicant only)** — swipe spring/touch-drag physics, count-up stats, streak flame,
  extend Apply/Hired celebrations. Employer side stays calm; respect `prefers-reduced-motion`; never block the core action.
- [ ] **C5 · Skeleton loaders + mascot empty/first-run states** — cheapest "feels fast + finished"; kill blank flashes.
- [ ] **C6 · Signed-out home hero** — 📐 **INTERACTIVE MOCKUP DELIVERED (theme-aware, real logo, responsive) — awaiting founder approval to build.** first thing a new user sees; muted looping demo
  swipe; aggregate numbers ONLY when real (ties to F-GHOST data).

### Sprint D — Signature Features (3 of 4 already built → VERIFY; D2 is the one build)
- [x] **D2 · Full Inbox tab** `[UI-REVIEW]` — ✅ **SHIPPED v254 (2026-08-28), live-verified.** A real full-tab
  Inbox that surfaces every message/event in one place (Messages / Interviews / Responses / Applicants /
  Matches / Reviews / Admin / Account), replacing the interim per-message dismiss (v196). Reuses the
  notification data layer (`window._notifs` via `_gpjNotifLoad`) → **ZERO extra Firestore reads** beyond the
  bell; each row routes via `notifGo()` to the live reply / interview-picker / rate / candidate-card control
  (no duplicated UI = no regression). Both roles (both titled "Inbox"), both themes, mobile + desktop.
  Entry: desktop rail + "📬 Open full Inbox →" in the bell dropdown — **no mobile bottom-nav layout change.**
  Browser-verified guest/populated × dark/light × mobile/desktop; 4 new `[STATE-COVERAGE]` tests (882/882 both projects).
  Follow-ups (future, not blocking): inline reply/slot-pick without leaving the tab; "Add to Google Calendar"
  + reschedule/cancel; employer applicant cards + next-steps/rejection actions (all currently reachable via the row → its live control).
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
- [ ] **Company logo/website from the apply-URL domain** `[BUILD]` — derive the employer domain from a
  direct-employer "View Full Posting" URL (e.g. `jobs.geisinger.org`→`geisinger.org`) for the logo + a real
  Website button; exclude aggregator/ATS hosts (shares the N1 blocklist). Fixes Geisinger's missing logo.
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
- [ ] **P1-3 / G7 · Digest emails ×3** — approved, unbuilt (cheap now the pool is live).
- [ ] **P1-7 / F7 · Hire data captured but not surfaced** — do NOT publicly claim hire numbers until an aggregate view exists.
- [ ] **P2-5 · Offline queue** — an action taken offline may never reach the cloud (unknown/unbuilt).
- [ ] **P2-6 · "My Data" audit view** — let users see what's stored (unbuilt).
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
- [ ] **Ghost-% placement** — v245 hid the card-face tile (kept the drawer one). Reversible in 2 CSS lines if you prefer at-a-glance on the card face.
- [ ] **N3 Ghost-page decisions** — (a) do flagged companies still surface in your hunt? (b) exact "hiring near your search" relabel/hide rule.

---

## 7. 🧪 MANUAL TEST CHECKLIST — step-by-step (founder runs these)

> Run on a **real device**, **logged in** unless noted, and check **both dark + light** (profile menu → theme toggle)
> and **desktop + mobile** (resize the window / open on a phone). Hard-refresh first so you're on the latest build.

### T0 · Confirm you're on the current build (do this first, every deploy)
- [ ] Open `ghostproofjob.com`. In the browser console type `APP_VERSION` (or check "What's New") → it should read **v254**
  (or the version we just shipped). If it's older, you're on a **stale/cached deploy** — hard-refresh (Ctrl/Cmd-Shift-R) or re-upload `index.html`.

### T1 · In-app Self-Test (the fastest health check — 19+ checks)
- [ ] Profile chip (top-right "Aaliyah") → **Run Self-Test** → wait for it to finish → **every row green**.
  Any red = tell me the row name; that's a real failure, not a flake.

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

### T4 · Ghost-page intuitiveness (the N3 fix — after we ship it)
- [ ] **Ghosts** → companies with no community data show the honest "**a community % appears once there's enough
  signal**" line, not a bare "—" with no context. Tap a "hiring near your search" company → it either shows real
  open roles or is honestly relabeled (no dead "none found" surprise).

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
