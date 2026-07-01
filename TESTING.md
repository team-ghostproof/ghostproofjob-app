# GhostProofJob — Engineering Standard & Testing

## The standard (applies to EVERY change, no exceptions)
1. **Insert-only.** Add to what exists; do not rebuild or redesign working code.
2. **No regressions.** A change must not break any existing feature, flow, link, or the UI.
3. **Verify before shipping.** Static checks + the in-app Self-Test + the Playwright
   suite must all be green.

## Three layers of protection (all free)

### 1. Static checks (run on every bundle)
- `node --check` on the extracted inline JS (never ship a parse error)
- `<div>` open/close delta must be 0 (single-file structural integrity)
- `index.html` ↔ `GhostProofJob.html` mirror diff (must be identical)
- `python3 -m py_compile job_spy_harvester.py` + `--selftest`

### 2. In-app Self-Test (⚙️ → Self-Test → Run, on a real device)
Runtime assertions on the live account: reset-propagation, full-region Browse
search, shared seen-set, deck-shows-only-unseen, experience-level wiring, AI
rewrite variation.

### 3. Playwright (CI, browser-level — this folder)
Runs automatically on every push via `.github/workflows/e2e.yml`.

**Smoke / regression** (`tests/smoke.spec.js`) — no Firebase auth/data needed:
- shell renders (no white screen / fatal parse error)
- every core function the UI calls still exists (catches removed/renamed functions —
  the #1 regression). The list now includes the v62 functions: `buildLetterText`,
  `tailorCoverLetter`, `openSavedJobCard`, `openSavedCompanies`, `notifOn`,
  `togglePhoneOnResume`, etc.
- nav works and view-switching doesn't throw
- no duplicate DOM ids
- Browse filter controls + Swipe deck shells mount

**Visual capture** (`tests/screenshots.spec.js`) — the desktop-layout aid:
- captures every view (swipe / browse / resume) and the Saved Jobs + Saved
  Companies modals, on **desktop (1280×900)** and **mobile (390×844)**
- the app enters desktop mode at ≥1024px, so the wide viewport renders the REAL
  desktop layout — this is what lets us tune Batch-4 items (modal centering,
  footer alignment, startup scroll, Browse-card vs filter-box width, LinkedIn
  button width) against a real render instead of guessing
- output → `./screenshots/*.png`, uploaded as the **screenshots** CI artifact

## Run it
```bash
npm install                 # installs @playwright/test from package.json
npx playwright install chromium
npm test                    # smoke + visual capture (serves index.html on :8000)
npm run screenshots         # just the screenshots → ./screenshots
npm run report              # open the last HTML report
```
In CI: open the workflow run → **Artifacts** → download `screenshots` (and
`playwright-report`).

#### Adding a test when we build a feature
Add the new function name to the `required` list in `tests/smoke.spec.js`, and if
it has a visible surface, add a screenshot in `tests/screenshots.spec.js`. A future
push that breaks it then fails CI before it reaches you.

## Harvester env (set in GitHub Actions, NOT by editing the .py)
Hand-editing `job_spy_harvester.py` is what took ingestion down once. Configure via
repository/workflow variables instead:
- `SITES=linkedin,indeed,google` — widen capture sources
- `BACKFILL_MAX=50` — enable the opt-in employer-page description backfill
