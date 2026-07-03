# GPJ — v74 Sprint: Master Instruction Prompt for Claude Code

> Paste this into Claude Code at the start of the v74 sprint. It assumes `CLAUDE.md`
> (project guide) is in the repo root and `docs/master-audit-checklist.md` exists.
> **Do the analysis + checklist update FIRST, get sign-off, THEN build.**

---

## 0) Your task, in order
1. Read `CLAUDE.md` fully and obey every rule in it (non-negotiable).
2. Read `docs/master-audit-checklist.md` — that is the single source of truth for open/closed items.
3. Apply the **checklist updates in §3 below** to `docs/master-audit-checklist.md` — **add the genuinely new items, refine the existing ones, and do NOT create duplicates** (dedupe against IDs already present: B-DECK-POOL, B-SALARY-CYCLE, B-SARATOGA, B1, F-CARD, B-SKIP-APPLY, F-REVIEW, F-ADDR, F-GHOST, F-COVERLETTER, F-AI, F-RATER, F-ATSPREVIEW, F-WORDING, F-TPL, F-DESK, F-TEST, B-DESC-CUT, D1).
4. Run the **end-to-end verification** in §5 against the current build (v73) to establish the benchmark before changing code.
5. Build the **v74 scope** in §4, insert-only, one grouped batch. Bump to **v74** (three markers).
6. Deliver per §6.

**Current build: v73.** Signed-in test user: Aaliyah (`asosa@ghostproofjob.com`, Houston, TX).

---

## 1) Non-negotiable rules (summary — full text in CLAUDE.md)
- INSERT-ONLY. Never rebuild/restructure/redesign. Never regress a prior fix or working feature.
- `[UI-REVIEW]` gate: any layout/view/overlay/z-index change → STOP, propose, get my approval BEFORE coding.
- Deliver FULL drop-in files for every changed file (no snippets).
- Works on mobile/iOS/Android/tablet/desktop.
- No misleading copy; honest "jump to apply"; no demo data in live views.
- Verify before delivering (see §5). Bump all three version markers.
- `index.html` and `GhostProofJob.html` must stay byte-identical.
- Vercel is case-sensitive (`firestoreWriter.js`, `redirectResolver.js`). Harvester config lives in GitHub Actions Variables only.
- Deploy = drag-upload to GitHub (never paste the 784 KB file).

---

## 2) Analysis from this session (evidence to inform the fixes)

**A. Résumé title ↔ content mismatch (root of the "deck shows Operations, not Marketing" saga).**
Aaliyah's résumé **title = "Marketing Specialist"**, but its **content is Account Management / Client Success / Operations** (summary literally says "Account Management and Client Success professional"; roles are Account Specialist, Regional/Lead/Sr Account Manager, GM/Program Manager). Consequence:
- `_resumeFieldWord()` returns **"marketing"** (first non-generic word of the title) → B1 tries to lead with *marketing-titled* jobs.
- `computeMatch` scores against the whole résumé, which is Account/Operations-heavy → Account & Operations jobs score high.
- In Browse, BOTH "Marketing Manager" AND "Account Executive" showed **98% match** — so the matcher works.

**B. Deck pool ≠ Browse pool (the real B-DECK-POOL cause).**
The user's **Applied bucket** (they swiped/applied) is full of **low-match Operations roles (16–52%)**: "People Operations Manager 43%", "Digital Operations Manager 52%", "Manager of Operations 28%", "Operations Manager – Customer Experience 34%", "Life Sciences Supply Chain 16%". Meanwhile **Browse shows 98%-match Marketing/Account roles in Houston** that never reached the deck. So the deck served low-match jobs while high-match matches sat in Browse. **Hypothesis to verify:** the deck (`_fetchLiveMarketJobs` → `fb.fetchJobs(regionKey,3000)`) uses a **server-side region-field query** ("Houston, TX") that MISSES jobs stored with broad region values (e.g. `region:"United States"`), while Browse (`ensureBrowsePool`) fetches wider and filters **client-side by location text** (catches "Houston" in the location string). Reconcile the two so the deck draws from the same catchment Browse does (metro + remote), then applies the role-first sort.

**C. "this role" phantom (NEW bug).**
A job literally titled **"this role"** appears in Applied ("this role · Serenity Healthcare · 34%"), and the generated cover letter reads **"apply for the this role position."** A missing job-title fallback ("this role") is leaking into the Applied bucket AND into AI prompts. Trace the cover-letter / "Match to Job" / apply path's title resolution.

**D. AI output quality is weak (refines F-AI / F-RATER / F-COVERLETTER).**
- Jett summary rewrite was generic: "Executed enterprise client portfolio management and ensured client success through strategic cross-functional alignment." User: "It's not great."
- The **"Match to Job" résumé output was nearly identical across three different target jobs** (Schwan's HR Generalist, PDS Health Operations Manager Trainee, Medline Sr Operations Manager) — only light skill additions (e.g. "Recruiting" for the HR one), no title/experience reframing toward the target role.
- The earlier cover letter force-fit "Operations" and used the "this role" placeholder.

**E. Confirmed working in v73 (do NOT reopen):** "View Full Posting" now records to the Applied bucket (the bucket is populated). Apply→Applied works.

---

## 3) Checklist updates to write into `docs/master-audit-checklist.md` (dedupe!)

**ADD (new — not currently on the list):**

> ### B-THISROLE · "this role" placeholder leaks into Applied + cover letters · ETA v74 · HIGH
> A missing job title falls back to the literal string "this role", which then appears as a job in the Applied bucket ("this role · Serenity Healthcare") and inside the cover-letter prompt ("apply for the this role position"). Fix the title resolution in the cover-letter / Match-to-Job / apply path so a real title is always used (or the item is skipped) — never the placeholder. Verify no phantom "this role" rows can be created.

**REFINE (already on the list — update, don't duplicate):**

> **B-DECK-POOL** — add root-cause note: the deck's server-side region-field query (`fb.fetchJobs(regionKey,3000)`) misses jobs stored with broad `region` values, so high-match Houston Marketing/Account roles that Browse surfaces (client-side location-text filter) never enter the deck. Fix: make the deck draw from the same catchment as Browse (metro + remote, matched on location TEXT, not just the region field), then re-rank role-first. This — not the sort — is why the deck served low-match Operations while 98% matches sat in Browse. Still needs live verification.

> **B1** — add note: for résumés whose TITLE and CONTENT diverge (here: title "Marketing Specialist" vs Account/Operations content), `_resumeFieldWord()` (title) and `computeMatch` (content) point different directions. Decide the intended behavior with the founder: lead by most-recent-role TITLE, by best CONTENT match, or blend. Both Marketing and Account scored 98% in Browse, so the matcher is fine — the gap is the pool (B-DECK-POOL). Role-first sort landed v73.

> **F-RATER / F-AI** — add note: "Match to Job" produced near-identical résumés across 3 different target roles (only minor skill tweaks, no reframing); Jett summary rewrites read generic. Strengthen role-tailoring (reframe summary + reorder/weight bullets toward the target posting) and improve rewrite specificity. Keep per-tier caps + "store data after each rewrite for future résumés" + safeguards active-but-not-restrictive.

> **F-COVERLETTER** — cross-reference B-THISROLE (the "the this role position" text is the same placeholder bug) and keep the "make emphasis reflect the ACTUAL posting, not a résumé keyword" note.

> **Mark VERIFIED (v73):** apply→Applied recording (Applied bucket populates); remote-always-in-deck; deck Best-Match role-first sort (pending live confirm of ordering once B-DECK-POOL is fixed).

---

## 4) v74 build scope (build after §3 sign-off; each `[UI-REVIEW]` item needs approval first)

Priority order — pick the top cluster that is logic-only + verifiable, propose it, then build:
1. **B-DECK-POOL** (HIGH, needs live verify): reconcile the deck's catchment with Browse's (metro + remote by location text) so high-match in-market roles reach the deck; refill/broaden (metro → remote → same-state → statewide via the approved control) BEFORE the empty state.
2. **B-THISROLE** (HIGH, logic): kill the "this role" placeholder leak in the apply / Match-to-Job / cover-letter title path.
3. **B-SALARY-CYCLE** + **B-SARATOGA / market hard-scope** + approved **"other regions" control** `[UI-REVIEW]`: Browse hard-scopes to market by default; salary toggle becomes a pure in-market filter.
4. **F-COVERLETTER / F-AI / F-RATER** quality pass (role-tailoring + specificity).
5. **B-DESC-CUT** (low): word-boundary truncation for the card description.

**Do NOT bundle** the market-scope/matching changes with unrelated UI work — they change LOCATION behavior and need isolated live verification.

---

## 5) End-to-end verification (run before AND after the build)
1. Extract inline `<script>` → `node --check` (syntax only — does NOT catch runtime/TDZ).
2. **Boot harness**: run the whole inline script in a mocked browser (Proxy-stub `document`/`window`/`localStorage`/`matchMedia`; stub `URL.createObjectURL`). Must print "RAN TO COMPLETION" and reach `buildDesktopGrid`. This catches TDZ/boot crashes `node --check` misses.
3. `<div>` open/close delta = 0.
4. `diff index.html GhostProofJob.html` → identical.
5. Handler audit: no `on*` references an undefined function.
6. No duplicate DOM IDs.
7. Bump `APP_VERSION` (index.html), `<span id="build-stamp">` (index + mirror), `CACHE_VERSION = 'gpj-v74'` (sw.js).
8. `wc -l index.html` sanity (an emptied file passes naive checks; `GhostProofJob.html` is the recovery asset).

Reminder: this environment can auto-verify no-crash/structure, but **matching/location OUTCOMES need live testing on real Firestore data** — deliver a your-side test checklist and treat the founder's live self-test as the final gate.

---

## 6) Deliverables for the v74 build
- Full drop-in files for every changed file (`index.html`, `GhostProofJob.html`, `sw.js`, and any `api/jobs/*`).
- Updated `docs/master-audit-checklist.md` (with §3 applied, deduped).
- Updated Feature Launch Document (PDF) IF a new user-facing feature shipped.
- Implementation instructions + a founder test checklist (esp. live location/matching checks) + any screenshots to review before the next batch.
- One clean, verified push. Confirm the three version markers and the mirror are in sync.
