# CLAUDE.md — GhostProofJob (GPJ) Project Guide

> Operating manual for any Claude (Claude Code or chat) working on GhostProofJob.
> Read this fully before making changes. The rules here are non-negotiable.
> **Current build: v74** (B-DECK-POOL + B-THISROLE; live location confirm pending).

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
- **B-DESC-CUT:** deck description cuts mid-word ("Job Re") — check whether the harvested description is truncated at the source vs a display slice.
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

---

## 10. Working style

Direct, high-urgency, honesty over optimism. The user deploys via the GitHub web editor (no local execution in their flow) and validates each build with the in-app self-test + live testing, then reports bugs with screenshots. Build → verify (Section 4) → deliver full files + PDFs + test checklist → user deploys + confirms → iterate.
