# PROJECT HISTORY AND TRACKER

> **GhostProofJob (GPJ)** — living historical record + forward tracker.
> Compiled 2026-08-26 at the close of a ~30-day build/live-test sprint (app at **v246**, `CACHE_VERSION = gpj-v246`).
> This file is the single hand-off document for a fresh context window. It summarizes what the product IS,
> the non-negotiable engineering policies, and everything still open (features, bugs, tests).
> **Authoritative companions:** `CLAUDE.md` (operating manual), `docs/sprint-roadmap.md` (per-build checklists),
> `docs/launch-plan-aug2026.md` (launch sequencing), `BUILD_HISTORY.md` (one line per shipped build).

---

## 1. THE FOUNDATION

### Original goal & core vision
**GhostProofJob** is an ethical, **free-until-hired** job-search PWA at **ghostproofjob.com**. Its mission: surface
*verified* real jobs, flag likely **"ghost jobs"** (postings that are stale, fake, or where employers ghost applicants),
and tailor résumés/cover letters per role — with **radical honesty** as the brand's defining value. **No ads. No data
selling. Ever.** The founder's north star: a hunter's entire job search should be able to cost **$0**.

- **Founder:** Aaliyah (Houston, TX; marketing + account-management background).
- **Tagline / pillars:** **Build · Optimize · Apply.**
- **Test account:** `asosa@ghostproofjob.com`, uid `3xt4GgdG` (Hyper-Drive trial).

### Target audience
Individual job seekers ("hunters") — especially people who can't afford paid job tools — plus a **second, employer/recruiter
side** (a two-sided marketplace). The recruiter product is a **reskin, not a second app**: `_gpjRecruiterMode()` + a
`.rec-mode` class repaint the same 6 tabs by account role, so candidate views can never regress. **Candidate-first invariant:**
recruiter Firestore reads fire ONLY when the account is a recruiter (Playwright-proven).

### Theme / brand
- **Midnight Plum** `#120F1D` (background), **Digital Mint Green** `#00F5A0` (success/actions), **Cyber Purple** `#B55FE6`
  (nav/accents), **Danger** `#FF4D6A`. Ghost mascot. Gradient mint→cyber wordmark.
- **Light mode** is opt-in (dark stays default) via `:root[data-theme="light"]` token swaps; every design must work in both.

### Pricing model (always honest, never a hard paywall)
- **Applications are ALWAYS unlimited.**
- **AI-powered actions:** unlimited Day 1–45 (**Hyper-Drive**) → 50/day Day 46–90 (**Core Search**) → 30/day Day 91+
  (**Base Camp**) — always free. Optional support: tip jar + low-cost monthly / lifetime. No paywalled "must-have."
- **Booster:** users can request +30 days of unlimited access anytime (approved personally, never punitive).

### Honesty rules (product-level, non-negotiable)
- **Auto-apply is architecturally impossible** (browser same-origin security) — all copy is honest "jump to apply," never auto-apply claims.
- **No Google scraping** (ToS). **No demo/sample/fabricated data in live views** — every number must be real or shown as "—".
- We **link out** to external reviews (Google/Glassdoor); we never scrape or display their star ratings.

### Core features
- **Swipe deck** (Tinder-style): swipe right = apply, left = skip; the **hero job card** shows an animated **Match % ring**,
  compact salary, location, a **Ghost-Risk %**, requirement **gaps**, a Green/Red flag, and expand-to-full-posting drawer.
- **Browse** (list view of the same universal card).
- **Ghosts tab:** community ghost-risk intelligence — search any company, "from you & your hunt" reported companies,
  "around your hunt" companies, community reports, honest "—" when no data.
- **Résumé Studio:** upload/parse (PDF/DOCX/TXT or LinkedIn), ATS-safe builder, **5 export templates** (Classic ATS,
  Modern Split, Minimal, Corporate Grid, Creative Accent), address/headshot/spacing toggles.
- **AI (Jett):** **Match-to-Job** (tailor résumé to a posting), **Cover Letter**, **Improve My Whole Resume**, a
  **Résumé Strength rater** (two honest labelled scores: writing quality + role fit).
- **Company view:** logo, ghost-risk, community reports, open roles, recent news, connect-with-hiring-team links, reviews links.
- **Employer/recruiter product:** onboarding (corporate-email gate), post/edit roles, applicant review, reverse-match
  candidate cards (anonymous), messaging/outreach, plan tiers, team seats, Anti-Ghosting Badge.
- **Public, zero-AI, zero-read tools:** `/resume-checker.html` (free Résumé Strength Checker) and the `/resources/` SEO engine.
- **Lifecycle emails** (Resend) + notifications centre + password recovery + gamification (streak / weekly goal, encouraging, never punitive).

### Primary workflows
1. **Build:** upload/parse résumé → ATS-safe profile.
2. **Optimize:** each job shows Match % + Ghost-Risk %; Match-to-Job tailors the résumé toward that posting.
3. **Apply:** swipe/Browse → jump straight to the employer (never an aggregator ad-wall); confirm "Done — I Applied."
4. **Location/role flow (spec):** start at the most-recent role/market → exhaust in-market → broaden within state → statewide/other cities. Remote always included.

---

## 2. SYSTEM ARCHITECTURE & NON-NEGOTIABLE SAFETY POLICIES

### Tech stack
- **Frontend:** the ENTIRE app is a single file — **`index.html`** (~18k+ lines, ~800 KB): HTML + inline CSS + inline JS.
  **`GhostProofJob.html`** is a **byte-identical mirror** that must stay identical every build (recovery asset).
  **`sw.js`** = service worker holding `CACHE_VERSION = 'gpj-vNN'` (drives PWA cache-busting).
- **Database / Auth:** **Firebase Firestore + Firebase Auth**, projectId `ghostproofjob-app`, collection `jobs`.
  Billing = **Blaze via Google Cloud Free Trial** ($299.51 credit, **valid to 2026-09-19**; ~$12–20 spent so far).
  Free tier ceilings: **50,000 reads/day, 20,000 writes/day**.
- **Backend / serverless:** **Vercel Hobby** serverless functions in `api/` (Greenhouse/Lever ATS parsers,
  `firestoreWriter.js`, `regionalRouter.js`, `redirectResolver.js`, `salaryParser`, `stripe-webhook.js`,
  `unsubscribe`, recruiter `domainCheck.js`, `admin_digest`). **Hard limit: 12 functions per deployment** (helper
  modules count too — non-handlers live in `.vercelignore`).
- **AI Worker:** **Cloudflare Worker** (`worker/worker.js`, `ghostproofjob-worker.ghostproofjob.workers.dev`) runs OpenAI
  **gpt-4o-mini** via a JWKS-verified Firebase token. Endpoints: `/smart-match` (résumé/summary/cover tailoring),
  `/resolve`, `/contact`, `/welcome`, `/email/*`, daily cron (lifecycle emails). **Cloudflare is source-of-truth and does
  NOT auto-deploy from the repo** — `worker/worker.js` is a reviewable mirror; edits must be pasted into the live Worker + redeployed.
- **Hosting / deploy:** **GitHub** (public repo, for free Actions minutes) → **Vercel** (auto-deploys on push). The founder
  historically also deploys `index.html` via GitHub "Add file → Upload files" **drag-and-drop only** (pasting the ~800 KB
  file truncates it — a recurring historical failure).
- **Email:** **Resend** (transactional + lifecycle).
- **Harvester:** Python **JobSpy** (`scripts/job_spy_harvester.py`) via GitHub Action `job_harvest.yml` (config lives in
  GitHub Actions **Variables**, never hand-edited in the `.py`). Writes most live `jobs` data.
- **Data pipeline / cost (D1):** `scripts/build_job_pool.mjs` writes a trimmed **`job_pools`** preview snapshot (streams +
  trims + flushes by an 8MiB byte budget). This cut deck reads from **~3,800 → ~6 per load**. Full postings **lazy-load**
  on card open via `fb.getJobFull` (one guarded read).
- **Workflows (GitHub Actions):** `verify.yml` (benchmark + full suite, daily + on push), `e2e.yml`, `job_harvest.yml`,
  `reverse_match.yml`, `rules.yml`, `seo_refresh.yml` (weekly city/company pages + sitemap — LIVE), `resources_refresh.yml`
  (every-other-day article publisher — **now LIVE** as of v243 go-live), `weekly_content.yml` (social-draft artifact).

### 🔴 CL / CI RED STATUS — blocking, never a "flake"
**Any RED continuous-integration or test status is a BLOCKING FAILURE and can NEVER be bypassed by calling it a "flake."**
A red run is **stop-and-fix at the ROOT CAUSE**. This was hardened this sprint after the **v156 rater** intermittently
failed in CI under parallel load: the fix was NOT to retry or dismiss it, but to find the real race (the Firebase module
lands after the inline script and its signed-out auth callback blanks `resumeData`) and make the test **deterministic**
(re-seed state synchronously in-evaluate). Precedents also caught real regressions this sprint (the v210 read-cost invariant
tripped by an over-broad truncation heuristic; the v142 deck-height bound broken by the intentionally taller A7 tiles) —
each was root-caused and re-verified green, never waved off.

### Isolated / sandboxed testing (policy going forward)
**All changes must be written and verified in an isolated test environment BEFORE they land in the main working files.**
- **Current reality (to formalize):** GPJ has historically edited `index.html` directly on `main` and relied on the full
  gate + backup branches (`backup/pre-ui-overhaul-*`, `origin/stable`, `origin/production-backup-safe`) as the safety net.
  Local verification runs against a `python -m http.server` copy + standalone Playwright scripts before any push.
- **The rule to adopt:** use an **isolated branch/worktree** per change, run the full Matrix Gate there, and only merge to
  the working files once green — so `main` (and the deployed file) never carries un-gated work. **`[STATE-COVERAGE]`**
  discipline stands: before writing code, map the 4-quadrant state matrix (Guest / Authenticated / Interrupted-network /
  Empty-data) and add a Playwright test for any uncovered state.

### The Matrix Gate (required before every commit)
Run and pass **all** of the following — no skips:
1. **§4 Benchmark** (`node scripts/benchmark.mjs` → "BENCHMARK GREEN"): JS syntax, **boot harness** ("RAN TO COMPLETION",
   reaches `buildDesktopGrid` — catches TDZ/boot crashes `node --check` misses), `<div>` open/close delta = 0, **mirror
   byte-identical** (`index.html` == `GhostProofJob.html`), no duplicate DOM ids, `on*` handler audit, **three version
   markers in sync** (`APP_VERSION`, `<span id="build-stamp">`, `sw.js CACHE_VERSION`), free-tier limits (≤12 Vercel
   functions, case-exact `require`s, sitemap ≤50k URLs).
2. **8 backend suites** (each exit 0): `test:match`, `test:growth`, `test:email`, `test:apply`, `test:seo`, `test:billing`,
   `test:resources`, plus **`pool:check`**. (`test:rules` = Firestore-rules emulator, 108/108, runnable locally with a portable JRE.)
3. **Multi-dimensional Playwright** (`--project=chromium --project=mobile --workers=2`, ~860 tests, ~16 min): must cover
   **all pages/views, Light + Dark themes, logged-in + logged-out, desktop + mobile (device emulation), orientation, and
   platforms.** Result must be **0 failed, 0 flaky.**
4. **In-app self-test** (the founder runs it live, 19+ checks) — green = benchmark validated on real data.
- **Recovery note:** an emptied `index.html` silently passes naive checks — always `wc -l index.html` first; the mirror is the recovery asset.
- **Version bump:** `PYTHONIOENCODING=utf-8 python bump_version.py --set N --note "…"` bumps all markers + appends to
  `BUILD_HISTORY.md`; then `cp index.html GhostProofJob.html` to re-sync the mirror.

### Live-site post-deployment check (policy — to be automated)
**After every deploy, Playwright must run against the LIVE production URL (ghostproofjob.com)**, not just a local server, to
verify **external APIs (Cloudflare Worker `/smart-match`, Firestore reads/writes), environment variables/secrets, and live
server health.** This policy exists because of a real incident this sprint: **the live site was found running several builds
BEHIND the repo** — the founder's screenshots showed already-fixed bugs (doubled ghost %, clipped salary) because the deployed
`index.html` was stale. The local gate cannot catch a stale deploy or a broken live env var; only a live-URL smoke run can.
**Status: not yet automated — a `verify.yml`/`e2e.yml` job that runs a Playwright smoke against the production URL after
deploy is a REQUIRED next step (see §4).** No live-data outcomes (real match %, location scoping, harvester logos, AI reframe
quality) can be verified from the build sandbox — those require the founder's live testing.

### Working style / delivery contract
INSERT-ONLY (never rebuild/restructure); **`[UI-REVIEW]` gate** (mockup + explicit approval before any layout/view/z-index
change); full drop-in files (never snippets); every change works on mobile/iOS/Android/tablet/desktop; no misleading copy;
never break a prior fix; honesty over optimism (say when something is architecturally impossible or unverifiable). Each build
ships updated docs/checklist + your-side test steps + screenshots for review.

---

## 3. 30-DAY FEATURE & BUG QUEUE

> Legend: **[BUILD]** net-new · **[VERIFY]** built but needs confirmation · **[DEPLOY]** blocked on deploy/redeploy ·
> **[DECISION]** needs founder input · **[UI-REVIEW]** needs a mockup + approval before code.

### 3A. Pending / incomplete FEATURES

**Sprint C — the "Wow" pass (design maturity)**
- **C4 · Motion & delight** **[BUILD][UI-REVIEW]** — swipe spring/touch-drag physics, count-up stats, streak flame, extend
  Apply/Hired celebrations. Employer side stays calm; respect `prefers-reduced-motion`; never block the core action.
- **C5 · Skeleton loaders + mascot empty/first-run states** **[BUILD][UI]** — cheapest "feels fast + finished" upgrade;
  ghost-led empty states; kill blank flashes on live-data load.
- **C6 · Signed-out home hero + honest social-proof bar** **[BUILD][UI-REVIEW]** — the first thing a new user sees; muted
  looping demo swipe; aggregate numbers ONLY when real. Ties to F-GHOST data.

**Sprint B — Trust the Intelligence (verify + harden the core value)**
- **AI résumé tailoring — continue tuning** **[VERIFY][DECISION]** — the reframe engine now WORKS (targets the role) and was
  **hard-capped (v246) to reframe only 2–3 bullets** after it over-stuffed "marketing" onto most bullets. **Needs a live
  re-run after the Worker redeploy** to confirm natural output; iterate on the prompt if needed. (gpt-4o-mini is a weak model
  — consider a stronger model or a client-side over-stuff guard if tuning plateaus.)
- **Match-to-Job — retitle + before→after** **[BUILD]** (was queued as "v247"): retitle the exported résumé headline to the
  target role (honest/conservative — a Specialist→Coordinator/Associate is fair; do NOT inflate to VP); show a **before→after
  Match %** framed honestly ("now leads with the role's language," not a vanity % bump).
- **Cover-letter / AI quality** **[VERIFY]** (F-AI, F-COVERLETTER) — full end-to-end verification; fix any unfilled phrasing /
  forced emphasis; confirm honest fallback labelling + per-tier counts/limits + safeguards not over-restrictive.
- **Rater + ATS-preview verification** **[VERIFY]** (F-RATER, F-ATSPREVIEW) — confirm the rater reads the whole résumé, scores
  on the stable 7-day corpus yardstick, two honest labelled scores; ATS preview shows the real machine-readable data.
- **Match % honesty** **[BUILD][DECISION]** — the on-card Match % is a keyword-overlap score and reads **over-generous** (98%
  for a weak fit). Tighten `computeMatch` generosity so it isn't always in the 90s.
- **Site-wide wording / pricing consistency sweep** **[VERIFY]** (F-WORDING) — one honest pricing + messaging story everywhere
  (app + static pages + Resources + checker).

**Sprint D — Signature features** (AUDIT 2026-08-24: mostly already built → verify)
- **D2 · Full Inbox tab** **[BUILD][UI-REVIEW]** — the ONE net-new Sprint D build (founder: important). Replace the interim
  per-message dismiss (v196) with a real inbox: anti-ghosting record + employer messages + candidate side in one place.
  **Founder wants this in the launch window.**
- **D1 · F-GHOST aggregated flag counts** **[VERIFY]** — `fileGhostReport` + `_paintJobReportBadge` ("N hunters reported this",
  cached count aggregation) already ship; verify aggregation with real community volume + the "another hunter reported" popup.
- **D3 · 5 résumé templates** **[VERIFY]** — already built (Export Template Studio); verify each exports cleanly (accent/
  headshot/spacing/address toggles intact, no export break).
- **D4 · Broaden-location flow + "other regions" control** **[VERIFY]** — Browse widen pill + deck other-cities already ship;
  live-verify the same-state→statewide→other-cities ladder + folds in B-SALARY-CYCLE (client-side salary filter) + B-SARATOGA hard-scope.

**Sprint E — Growth & Cost**
- **E2 · D1 read-cost reduction (FINISH before 2026-09-19)** **[BUILD]** — biggest sink already cut (the `job_pools` pool).
  Remaining: session-cache the Browse/company-view reads, cap query sizes, paginate. Must sit inside the free tier
  (50k reads/20k writes/day) after the trial ends. **Budget cap ≈ $20 total.**
- **E1 · Resources cron** **[DONE]** — the every-other-day article publisher is now LIVE (v243 go-live). Monitor output.
- **E3 · F-TEST hardening / signed-in CI** **[BUILD]** — add authed Playwright coverage in CI + the **live-URL post-deploy
  smoke** (see §2); Playwright screenshots.

**Company real-data (cross-cutting)**
- **Company logo/website from the apply-URL domain** **[BUILD]** (was queued as "v244 idea") — when a job's "View Full Posting"
  points to the employer's OWN domain (e.g. `jobs.geisinger.org` → `geisinger.org`), **derive the domain from that URL** for
  the logo (icon service) + a real Website button. Free, no scraping, ToS-safe. Fixes Geisinger's missing logo + the
  Website-button-goes-to-Google issue. (Social handles / page scraping = OUT of scope: ToS + cost.) Note: v240 already
  captures `company_url` from the harvester + curated a big-brand domain map; this extends it to derive from the apply URL.
- **Harvester long-tail logos** **[DEPLOY/WAIT]** — v240 captures `company_url` → `companyWebsite`; logos/website links populate
  automatically as the pool self-heals (~8 days). No action; verify on a live harvest.

**Ghost-page intuitiveness pass** **[BUILD][UI][DECISION]** (the founder's flagged batch — needs input)
- Replace the Ghosts-page header stat tiles (currently the honest "Free / 0 ads" from v242) with messaging that **community
  scores grow as our community adds honest ratings** — better fits the page context.
- "AROUND YOUR HUNT" companies show "hiring near your search" but **have no open roles when tapped** ("none found in the live
  feed") — misleading; fix or relabel.
- Decide whether **companies whose job you flagged as "no longer accepting"** should surface in your hunt at all (currently a
  ghost report puts them in "From you & your hunt").
- Honest empty states throughout ("a report is logged — a community % appears once there's enough signal").

**On hold / awaiting decision**
- **Button *word* vs *icon* centering** (10px, site-wide) **[DECISION]** — on hold per founder; A (keep icon, pin left) vs B
  (drop icon). Remind after Sprint C.
- **Ghost-% placement** **[DECISION]** — v245 hid the card-face ghost tile (kept the drawer one). Reversible in 2 CSS lines if
  the founder prefers the at-a-glance card-face one instead.

### 3B. Open BUGS / glitches / edge cases

- **Live site behind the repo (DEPLOY)** — ghostproofjob.com was running a stale `index.html`; v244–v246 fixes (truncation,
  ghost de-dup, salary compaction) are in the repo but not necessarily live. **Establish a reliable deploy + a live-URL smoke
  so this never recurs.** Several "still broken" reports are very likely "already fixed, not deployed."
- **Geisinger job description truncation** — a card summary ended "…external…". Display renders (Browse modal + swipe drawer)
  now **fetch the full posting when the preview ends in an ellipsis** (v244). If a specific posting is STILL cut after
  deploying the latest `index.html`, that job was **stored truncated at harvest** (source-scrape cut, well under all display
  caps) — self-heals on re-harvest; needs confirmation from the live Firestore doc (unverifiable from the sandbox).
- **AI reframe over-stuffing** — the tailoring appended "marketing/communication" to too many bullets; **hard-capped (v246)**;
  needs a live re-run to confirm it's natural now.
- **Match % over-generous (98%)** — keyword-overlap score reads too high for weak fits (see Match-% honesty above).
- **"hiring near your search" companies with no open roles** — see Ghost-page pass.
- **Company logos missing for direct-hosted employers** (e.g. Geisinger) — no stored domain; fixed generally by the
  apply-URL-domain feature above.
- **Ghost-page header messaging** — the honest "Free / 0 ads" placeholder doesn't fit the ghost context (founder wants
  community-scores-coming copy).
- **Cannot verify live-data outcomes from the sandbox** — real match %, location scoping, harvester logo tail, and AI reframe
  quality require the founder's live testing (build → deploy → self-test → report).
- **Firebase-module test race (harness gotcha)** — the firebase module lands after the inline script and nulls
  `_recruiter`/blanks `resumeData`; tests must gate on the module landing (or re-seed state synchronously) or they flake.
  Documented; keep applying the pattern to any new test that stubs `fb`/`resumeData`.

---

## 4. PENDING TEST CHECKLIST (planned, not yet written/completed)

> Every new feature/fix must add `[STATE-COVERAGE]` Playwright tests (Guest / Authenticated / Interrupted-network /
> Empty-data) and pass the full Matrix Gate. The items below are the tests we've *planned or implied* but have NOT yet written.

**Infrastructure / policy tests**
- [ ] **Live-URL post-deploy smoke** (NEW POLICY, highest priority) — a Playwright job that runs against **ghostproofjob.com**
      after deploy: home loads, deck fetches from live Firestore, `/smart-match` Worker responds (auth-gated), critical env
      vars/secrets present, no console errors. Catches stale deploys + broken live envs the local gate can't see.
- [ ] **Signed-in CI (E3)** — authed Playwright project running in GitHub Actions (currently authed tests run locally only).
- [ ] **Deploy-freshness assertion** — a check that the deployed `APP_VERSION`/`CACHE_VERSION` matches the repo HEAD.

**Feature tests to write**
- [ ] **Match-to-Job retitle + before→after** — headline retargets to the role (conservative, no inflation); before/after
      Match % renders and is framed honestly.
- [ ] **Company-domain-from-apply-URL** — `_gpjEmployerFromUrl`-style derivation of the company domain from a direct-employer
      apply URL (e.g. `jobs.geisinger.org` → `geisinger.org`) → logo + Website button resolve; aggregator/ATS hosts excluded.
- [ ] **Ghost-page intuitiveness** — honest empty-state copy; "hiring near your search" companies with zero live roles are
      relabeled/hidden; reported-company surfacing behaves per the chosen decision; no `null%` in ANY ghost render.
- [ ] **5-template export verification** — each of the 5 templates exports cleanly with accent/headshot/spacing/address
      toggles, no export break, both themes.
- [ ] **Broaden-location flow (D4)** — same-state → statewide → other-cities ladder; the "other regions" pill never widens on
      its own; salary toggle is a pure client-side filter (B-SALARY-CYCLE); market hard-scope (B-SARATOGA).
- [ ] **Match % honesty** — `computeMatch` no longer returns inflated 90s for weak/out-of-field fits; cross-field cap holds.
- [ ] **Full Inbox tab (D2)** — new tab renders; anti-ghosting records + employer + candidate messages; guest/empty states;
      recruiter-mode isolation (candidate-first invariant — zero recruiter reads for a pure candidate).
- [ ] **C4 motion** — respects `prefers-reduced-motion`; animations never block the core swipe/apply; employer side calm.
- [ ] **C5 skeletons / empty states** — skeletons on live-data load; mascot empty/first-run states; no layout shift on fill.
- [ ] **C6 signed-out hero** — guest vs authed rendering; social-proof numbers shown ONLY when real; light/dark; mobile.

**Verification passes (mostly manual/live — AI output can't be unit-tested)**
- [ ] **AI reframe quality (live)** — re-run Match-to-Job on real jobs (Geisinger + Indeed) after the Worker redeploy; confirm
      the reframe touches only 2–3 bullets and reads natural; capture PDFs for before/after review.
- [ ] **Cover-letter quality (live)** — verify no unfilled phrasing/forced emphasis; honest fallback labelling; per-tier caps.
- [ ] **Rater / ATS-preview (live)** — reads the whole résumé; stable yardstick; two honest scores; real ATS data shown.
- [ ] **D1 read-cost (E2)** — measure live reads after adding Browse/company-view caching + pagination; confirm inside free tier.

**Regression guards already GREEN this sprint (keep them passing — do not weaken)**
- v156 rater determinism · v210 "live docs never re-fetch" read-cost invariant · v142 deck-height (accounts for taller A7
  tiles) · v225/v239 wide-viewport card+rail centering · v240 brand-domain/no-guessed-domain · v244 idealtraits employer +
  ghost `null%`→`—` · v245 ghost-% de-dup + centered gap · v246 compact salary (`$60–150K/yr`, hourly stays plain).

---

*End of tracker. Fresh-context resume order: (1) confirm the live deploy is current (app + worker), (2) live-verify the AI
reframe + truncation, (3) finish Sprint C (C4/C5/C6) + build D2 Inbox, (4) Sprint B verification passes, (5) E2 read-cost
before 2026-09-19. Every build: `[UI-REVIEW]` where needed → isolated verify → full Matrix Gate → live-URL smoke → deploy.*
