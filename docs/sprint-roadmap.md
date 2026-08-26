# GhostProofJob — Master Sprint Roadmap & Tracker
_Created 2026-08-22 · Live build: v226 · This is the single living plan. It merges the two v226 review PDFs (Full Site Analysis + Design/Wow) with the prior tracker and every open item in CLAUDE.md §7/§8. **Updated after every commit** (per the [BUILD-DOC] rule)._

## How this plan is executed (non-negotiable, per docs/guardrails.md)
Every item below runs the same loop, start to finish, no steps skipped:
1. **Why** → **How (INSERT-ONLY, no regression/breaking)** → **[UI-REVIEW] mockup + approval BEFORE any visual code** (rule 2.1).
2. **[STATE-COVERAGE] 4-quadrant matrix** (guest / authed / interrupted-network / empty-data) mapped, and a Playwright test written for any uncovered state (rule 9).
3. **Build** → deliver the COMPLETE file(s), never snippets (rule 3).
4. **Full verify gate, nothing skipped:** `node scripts/benchmark.mjs` (BENCHMARK GREEN) + all 8 backend suites (match/growth/email/apply/seo/billing/resources + pool:check) + full Playwright (`--project=chromium --project=mobile`), **logged-in AND logged-out** + confirm CI green. Never trust a piped exit code (PIPESTATUS).
5. **Visual proof** on all pages/platforms/devices/themes (before/after screenshots), logged-in and out.
6. **Commit + push** → `bump_version.py` auto-updates BUILD_HISTORY.md → **update THIS tracker's "Founder test checklist"** → update any other doc that changed (CLAUDE.md §9, master-audit-checklist).

Legend: **[UI]** = needs [UI-REVIEW] mockup+approval · **Effort** S/M/L · **Impact** LOW→HIGH.

---

## RECOMMENDED SPRINT ORDER (why this grouping)

- **Sprint A — Complete & Consistent** first: cheap, low-regression fixes that kill the "half-baked" impression (the #1 thing hurting trust today). Data-completeness + brand consistency.
- **Sprint B — Trust the Intelligence** next: verify/harden the AI + scoring the product sells on. Mostly logic + copy, testable via backend suites; no big redesign.
- **Sprint C — The Wow Pass**: the design-maturity lift (your "empty/incomplete" instinct). Done as ONE cohesive designed sprint so the pieces harmonize. All [UI].
- **Sprint D — Signature Features**: net-new value (F-GHOST, Inbox, templates, broaden flow). Each is its own feature build with tests.
- **Sprint E — Growth & Cost**: Resources cron go-live + D1 read-cost + CI hardening. Last, per founder instruction (finish + test the product first).

---

## SPRINT A — Complete & Consistent  _(low risk, high trust; do first)_

### A1 · Job-card full data everywhere + full card-surface scan  **[UI]** · Impact HIGH · Effort M · ✅ SHIPPED v227
- **Why:** The Browse detail modal clips mid-word ("Review p") and shows no Requirements/Benefits — a stranger reads that as a broken product. (Full Site Analysis, P1.)
- **Root cause (verified):** `buildBrowseExpanded()` renders `j.summary||j.desc` straight from the byte-trimmed D1 pool object; it never lazy-loads the full `jobs` doc the way the swipe drawer was fixed to in v210, and it renders no Requirements/Benefits block.
- **How (insert-only):** give the Browse modal the SAME lazy-load path the swipe drawer uses (fetch the full doc on open by id), then render full Summary + Requirements + Benefits with the v97 ceilings. Do NOT change the swipe drawer (already correct). Then scan every card surface — swipe face, swipe drawer, Browse modal, Saved-jobs, Company-view job cards, Skipped tab — and confirm each lazy-loads + shows full allocated text.
- **[STATE-COVERAGE]:** guest (Browse works signed-out — full text still renders) · authed (full doc lazy-loads) · interrupted (fetch fails → fall back to the pool text already shown, never blank) · empty (no req/benefits fields → hide the section, no empty headers).
- **Test:** extend the v100/v210 state-coverage tests to assert the Browse modal renders Requirements + Benefits and never ends mid-word; a fetch-fail fallback test.
- **Rollback:** the lazy-load is additive; on any failure the modal shows exactly what it shows today.

### A2 · Static-page logo sweep (brand consistency)  **[UI, low-risk asset swap]** · Impact MED-HIGH · Effort S · ✅ SHIPPED 2026-08-22 (static, no app version)
- **Why:** Resources + public Résumé Checker still use the 👻 emoji, not the transparent brand mark (v224). These are top-of-funnel, indexed pages — a stranger's first impression is off-brand.
- **How (insert-only):** embed the transparent `logo-mark.png` (or an inlined SVG of it) into the `pageShell` header in `scripts/build_resources.mjs` and into `resume-checker.html`; re-run the generators. No layout change beyond the mark.
- **[STATE-COVERAGE]:** static pages have no auth states; verify light+dark of each static page + mobile.
- **Test:** `tests/growth/resourcesEngine.test.mjs` assertion that the shell references the brand asset, not the emoji.
- **Rollback:** revert the shell string.

### A3 · Tailored-résumé / cover-letter sections read as buttons  **[UI]** · Impact MED · Effort S · ✅ SHIPPED v228
- **Why:** In Account, "Your Tailored Résumés / Cover Letters" look like plain text with a faint "–"; users don't know they're interactive, so generated assets feel lost. (Full Site Analysis, P2.)
- **How (insert-only):** restyle the two collapsible headers as pills/list-buttons — chevron, hover state, count badge — aligned to the same gutter/width as the cards above. Behavior unchanged (still toggles the same content).
- **[STATE-COVERAGE]:** empty (0 tailored → pill shows "None yet" state, still looks like a control) · populated (count badge) · both themes.
- **Test:** a state-coverage assertion the sections are focusable/role=button and show a count.
- **Rollback:** CSS/markup only; revert the block.

### A4 · Geolocation toggle polish  · Impact LOW · Effort S · ✅ SHIPPED v234 _(completes Sprint A build items; A7 folded into C3)_
- **Why:** Not a bug — the browser denies location and the app honestly falls back — but the toggle can look "on but dead," and there's no hint on how to enable it. (Full Site Analysis, P3.)
- **How (insert-only):** on the permission-denied callback, snap the toggle visibly back to OFF; append one honest line ("Location is blocked for this site — enable it in your browser's settings") to the existing toast/status.
- **[STATE-COVERAGE]:** denied · granted · unsupported (`!navigator.geolocation`) · already-off.
- **Test:** state-coverage: simulate a denied callback → toggle reads OFF.
- **Rollback:** revert the callback lines.

### A4.5 · Job-card + requirements bug fixes (founder-reported, verified)  · Impact HIGH · Effort S · ✅ SHIPPED v229
- **B-BROWSE-SUMMARY (the real truncation):** `buildBrowseExpanded` renders the summary as `j.summary||j.desc` (index.html ~6294). `j.summary` is a short ~600-char preview (`mapFirestoreJob` ~5799) that ALWAYS shadows `j.desc`, so even after A1's lazy-load fills the full `j.desc`, the summary section shows the preview (ends mid-word "HubS", no scroll). The swipe drawer reads `j.desc` directly → shows full. **A1 was incomplete here** — it fixed the lazy-load + added Requirements/Benefits, but not the summary source. **Fix:** render the Browse summary from `j.desc` (full), matching the drawer; verify the post-lazy-load re-render. Also set `j.summary=j.desc` in the hydrate so nothing stale lingers. **[STATE-COVERAGE]:** clipped-then-hydrated (full) · hydrate-fails (preview fallback) · internal job · both themes. Test: assert Browse summary renders from the full desc, not the short preview.
- **B-GAPS-ONLY:** `openReqGaps` (index.html ~6015) shows BOTH "Requirements you already meet" (`mi-have`) and "Requirements to address" (`mi-miss`). Founder: gaps must show ONLY the missing requirements (degree/experience/named skills) — the match % already covers strengths + how to raise it. **Fix:** hide the `mi-have` section in the gaps modal; `liveMatchInsight` (shared `match-modal` DOM) restores it so the Match modal still shows "your matching strengths." **[STATE-COVERAGE]:** gaps modal (only gaps) · match modal (strengths kept) · no-gaps state · both themes. Test: assert the gaps modal hides mi-have and the match modal shows it.

### A5 · Company-card cleanup — company-only content, one reviews button, no job bleed  **[UI]** · Impact HIGH · Effort M · ✅ SHIPPED v230
- **Why (founder-reported, verified):** the company card (`#company-modal` / `openCompanyView`) mixes JOB content into a COMPANY view: `cm-jobsummary` injects a role's Match/Cover/Apply/View at the top; a stray "Apply ↗" sits in the social row; and there are TWO reviews controls (the green `.cm-rev-btn` in the social row + "⭐ Rate / see reviews"). Confusing and off-design.
- **How (insert-only):** (1) remove the per-role action block from the company card — when opened from a role, show at most a slim "You were viewing: **[Role]** → tap to open" line that opens the JOB card (which already has all actions); the role also appears under "Open Roles". (2) Remove the stray Apply from the social row (14778). (3) Delete the green `.cm-rev-btn` (17844); keep ONE nicely-styled "⭐ Reviews & rating" button. (4) Company card = header + logo + ghost-risk/reports + community vibe + **one** reviews button + a "See Glassdoor reviews →" link + Open Roles + Recent News + Connect (social icons only). No job actions.
- **Honest constraint:** we do NOT scrape Glassdoor/Indeed reviews (ToS). "Online reviews" = our community reviews + an outbound Glassdoor link. "Overview" = employer-provided (accounts only).
- **[STATE-COVERAGE]:** opened-from-role (slim role line) · opened-standalone (no role line) · verified employer (✅) · no reports (honest "good sign"). Playwright: assert the company modal has no Match/Cover/Apply job buttons and exactly one reviews control.

### A6 · Company logos — surface + employer upload + online fallback  **[UI][FREE-TIER]** · Impact MED-HIGH · Effort M · ✅ SHIPPED v231 _(online source = DuckDuckGo icons; Clearbit was sunset)_
- **Why:** the 💼 briefcase placeholder is generic; real logos make cards trustworthy and scannable. Employer upload already exists (v120 data-URL at `openCompanyView` ~14751) but isn't surfaced broadly and has no fallback.
- **How (insert-only):** (1) render the company logo where the 💼 is — company-card header + the job-card company icon — using the uploaded data-URL when present. (2) **Online fallback** when no upload: derive it from the company's website domain via a logo/favicon service (e.g. `https://logo.clearbit.com/<domain>` or Google favicon) with the 💼 as the final fallback if that 404s (`onerror`). **[FREE-TIER]:** this is a client-side `<img>` load (no backend call, no quota) — confirm no CSP issue for the image host. (3) Employer company-profile form: add the note "If you don't upload a logo, we'll show the one we find online" + keep the manual upload.
- **Honesty:** never claim an online-fetched logo is employer-verified; the ✅ verified badge stays tied to account verification, not the logo.
- **[STATE-COVERAGE]:** uploaded logo · no upload but known domain (online) · no upload no domain (💼) · broken image URL (onerror → 💼).

### A7 · Card-face ghost/gap pills → a 2-up tile row (match the tile system)  **[UI]** · Impact MED · Effort S · _(planned 2026-08-22 → FOLDED INTO C3 per founder)_
- **Why (founder):** the 👻-risk + gaps pills under the Match/Salary/Location tiles still read as two small "random" floating chips.
- **How (insert-only):** render them as **two equal-width tiles in one row**, using the SAME `--plum3` background / border / radius / centered-content as the 3 tiles above → the card face becomes a tidy grid (3-up + 2-up). Recommended over merely widening the pills. Keep the honest content (ghost % tinted by risk; "✓ No gaps" / "⚠️ N gaps"). Applies to all 3 card slots + the Browse list card for consistency.
- **[STATE-COVERAGE]:** has-gaps · no-gaps · ghost "—" (no data) · both themes · mobile. Playwright: assert the two tiles share the tile background + equal widths.
- **Recommendation:** small + card-face — either do it right after the company-card work, or fold it into the Wow-pass hero card (C3) which re-treats the tiles anyway. My pick: **fold into C3** so the tile system is designed once, unless you want it sooner.

### A9 · Button/pill label centering (site-wide)  **[UI]** · Impact MED · Effort S · ✅ SHIPPED v232
- **Why (founder):** button labels ("Save", "Not Interested", "Save Company", "Reviews & rating", card actions) looked off-center — `text-align:center` + padding drifts when an emoji weights the line or the label wraps (measured ~1px vertical + emoji optical offset).
- **How (insert-only):** flex-center the labels (`display:flex;align-items:center;justify-content:center;gap`) in the shared button classes (.upgrade-btn/.coffee-btn/.opt-btn-go/.opt-btn-skip/.buzz-add→inline-flex) + the card/company action-button style fragments (Match/Cover/Apply/Save/Not Interested/Save Company/Reviews). The emoji+text group now sits true-center H+V and survives wrapping. 2 new tests.

### A8 · Align the "random" misaligned sections to the shared gutter  **[UI]** · Impact MED · Effort M · ✅ SHIPPED v233
- **Why (founder, refined):** NOT a global-width problem — each view is symmetrically centered overall. The real issue: a few sections within a page don't share the same left/right edges as their siblings, so they look "off" while the rest line up. **We deliberately do NOT force one uniform width** (sections have different designs) — each keeps its own width but must sit on the **same center axis / same gutter**.
- **Measured outliers (left-edge):** Résumé — a `section-card` at 312px vs the rest at 432px. Account — `set-profile` at 312px vs 416px. Settings/Ghosts — saved-job cards at 431/448px vs 416px (true sibling drift). (Some 312-vs-432 cases are parent-card-vs-indented-children nesting, to confirm per section.)
- **How (insert-only):** per-view pass — normalize each top-level section's horizontal container (padding/margin/max-width auto) so every sibling section shares ONE gutter, without changing any section's internal design/width. Fix the saved-job-card drift + the 312-outlier sections.
- **[STATE-COVERAGE]:** all 6 views · both themes · 1024→1920 · logged in/out. Playwright: assert sibling top-level sections in a view share the same left edge (within a small tolerance).
- **Recommendation:** dedicated focused pass (needs per-section CSS inspection); **[UI-REVIEW]**. Can pair with C1.

### Job-card data completeness — investigation conclusion (2026-08-22)
Founder saw "incomplete data on Browse job cards." **Verified:** v227/A1 IS live (build stamp v227; the `getJobFull` lazy-load is deployed), Firestore rules allow the single-doc read (`match /jobs/{jobId} allow read: if true`), the pool builder preserves `_docId` + sets `_clipped` correctly, and the founder's own screenshot shows Browse fully populated. **Most likely cause of the stale view:** the PWA service worker served a cached pre-v227 shell (hard-refresh / close-all-tabs forces the update). **One honest edge case:** a job pruned from the `jobs` collection (8-day cleanup) but still in the pool → `getJobFull` returns null → Browse falls back to the trimmed preview for that one job (rare; self-heals as the pool rebuilds). No code change required; monitoring only.

### A6b · Company logo on the COMPANY card too  · ✅ SHIPPED v235
Founder: A6 put the logo on job cards but the company card still had none (opened from Ghosts, no domain → nothing). Added a persistent logo BOX to the company-card header (upload → online-by-real-domain → 🏢 placeholder), matching the job card.

### A6c/A10 · Saved-Jobs → Browse + trending logos  · ✅ SHIPPED v236
- Saved Jobs moved off the Ghosts tab into a **collapsible "🔖 Your Saved Jobs" section in Browse** (collapsed by default, count badge, hides when empty). Ghosts is now companies-only.
- Trending/hunt company rows (`_v8RenderGhostCos`) now render the company **logo box** (real domain → DuckDuckGo → 🏢). Amazon/Meta/Stripe trending fallback carries real domains; hunt companies show 🏢 when their job data has no domain (no guessing).
- Note: my first edit hit a DEAD duplicate `renderGhostCompanies` (16611, captured as `_v8RenderGhostCos` at 17488 and wrapped at 17489) — the edit was live via `_v8RenderGhostCos`; test now checks the inner fn. **Also learned: the Ghosts view id is `view-ghost` (singular), Settings lives under Account — worth a follow-up to make the v233 alignment test cover ghost/settings too.**

### Findings parked for a decision (from 2026-08-23 review)
- **Candidate card icon** = anonymous 🧑 (no photo/logo — candidates stay anonymous until they apply/engage). Mockup delivered. Options if changing: keep 🧑 (rec) · initial-monogram on the Applicant Card only · GPJ mark.
- **Saved Jobs placement** — currently on the Ghosts tab (above companies), which is unintuitive (Ghosts = ghost-risk/company intel). Move options: (A) Browse "★ Saved (N)" filter/section [rec — jobs live in Browse] · (B) consolidate into Settings → Saved Jobs (exists) · (C) a Saved quick-link on Swipe/home. [UI-REVIEW] — mock before moving.
- **Button *word* centering** (10px, site-wide) — ON HOLD per founder; remind after Sprint C (options A keep-icon-pin-left / B drop-icon).
- **⚠️ Ghosts-page header stats are FABRICATED** (found 2026-08-24): `2,847 Community Reports` + `94% Data Accuracy` are HARDCODED demo numbers (index.html ~2861) — same honesty issue as the v237 trending list. **Decision needed:** (A) compute real from community data · (B) show "—" until real · (C) remove the two stat tiles. Awaiting founder call; slot into Sprint B (wording/honesty sweep) or a quick fix.

### Recommended slotting
Do **A5 then A6 back-to-back right after A4** — both touch the company card, so doing them together is efficient and avoids two separate regressions of the same view. Both are **[UI-REVIEW]** — I'll get your nod on the mockup before writing code. **A7** is tiny; fold into C3 (or pull earlier if it bugs you).

---

## SPRINT B — Trust the Intelligence  _(verify + harden the core value)_

### B1 · Cover-letter / AI quality verification + fixes (F-AI, F-COVERLETTER) · Impact HIGH · Effort M
- **Why:** This is core paid value; output quality drives retention. Known open items: unfilled "the this role position," forced "Operations" emphasis, honest fallbacks + per-tier limits.
- **How:** audit all AI call sites for distinct section-appropriate context (last confirmed v97); add guard tests for the phrasing bugs; verify the Worker fallback disclosure fires both on fallback AND on live return; confirm tier caps. Live-quality is a founder gate (Worker prompt is outside the repo).
- **[STATE-COVERAGE] + Test:** apply-suite + a new phrasing-guard test (no "the this role position"; matched-theme lowercasing v198 holds).

### B2 · Rater / ATS-preview verification (F-RATER, F-ATSPREVIEW) · Impact MED-HIGH · Effort M
- **Why:** the score must be trustworthy to be worth anything; the ATS preview must show real machine-readable data.
- **How:** confirm the rater reads the WHOLE résumé + rates against live postings on a professional rubric (v179 "Résumé Strength"); confirm the ATS preview reflects the true parsed data. Add/extend match + growth tests.

### B3 · Site-wide wording / pricing consistency sweep (F-WORDING) · Impact MED · Effort S-M
- **Why:** transparency + consistency of pricing/messaging (tiers, "free until hired," AI limits) across every surface incl. static pages.
- **How:** grep + reconcile pricing/tier copy; single source where possible; honest everywhere. Copy-only, low risk.

---

## SPRINT C — The Wow Pass  _(design maturity; all [UI], one cohesive sprint)_
_Grounded in the Design/Wow PDF. Brand-safe: keeps Midnight Plum / Mint / Cyber Purple / ghost. Mockups required + approved before ANY code._

- **C1 · Ambient background** **[UI]** · HIGH · M — ✅ SHIPPED v237: faint dotted grid + two low-opacity brand glows on #desk-main (fills the empty desktop margins) + #app (mobile); behind opaque content (contrast untouched), static, light+dark. (Column-rhythm/type polish can follow.)
- **Candidate avatar (hybrid A+B)** **[UI]** · MED · S — ✅ SHIPPED v238: `_gpjPersonAvatar(name,size)` — brand-gradient initial monogram when we have a real name (applicant card, company team rows), anonymous 🧑 for still-anonymous matches. No fabricated photos; light+dark.
- **C2 · Contextual right rail (applicant side)** **[UI]** · HIGH · M — ✅ SHIPPED v239: DESKTOP-ONLY (≥1180px) sticky rail beside the deck — 🔥 streak · 🎯 weekly-goal ring · 📊 market pulse · 💡 Jett tip · 🕑 recent. Founder-approved refinement: rail REPLACES the on-deck gamify bar on desktop (no repetition); mobile/tablet unchanged. Market pulse computed from the in-memory `jobsQueue` (extracted as testable `_gpjMarketPulse`) = ZERO reads; grounded empty states. Insert-only: one appended `#gpj-deck-rail` + `_gpjRenderDeckRail()` + a wide-desktop-gated CSS grid (`.active`+`!important` beats the inline display from `deskShowOnly`; column-1 items sized explicitly so `margin:auto` can't zero-width the deck). Recruiter mode reverts to single column. Browser-verified dark+light+narrow+mobile; 2 new tests.
- **C3 · Hero job card + animated match ring** **[UI]** · HIGH · M — _NEXT (v241); mockup approved (GPJ-sprintC3-mockup.html)_ — circular animated match ring, subtle gradient border on the top card, company avatar (real logo), one tile system (folds in A7 ghost/gap tiles), crisp ghost-risk meter. Your signature "wow"/shareable. **Bundling the C2 toast-centering fix** (the "N jobs loaded" popup was centered under the full main = 162px right of the card column, same cause as the v240 footer fix).
- **C4 · Motion & delight (applicant only)** **[UI]** · HIGH · M — finish swipe spring physics, count-up stats, streak flame, extend Apply/Hired celebrations. Employer side stays calm. Respect reduced-motion; never block the core action.
- **C5 · Skeleton loaders + mascot empty states** **[UI]** · MED · S — cheapest "feels fast/finished" upgrade; ghost-led empty/first-run states.
- **C6 · Signed-out home hero + honest social-proof bar** **[UI]** · HIGH (conversion) · M — a muted looping demo swipe on the landing; honest aggregate numbers (jobs verified / ghosts flagged) ONLY when real. Ties to the Sprint-D F-GHOST data.

---

## SPRINT D — Signature Features  _(net-new value)_

> **AUDIT 2026-08-24 (founder challenged "don't we already have these?"): mostly TRUE.** 3 of 4 are already built — they become VERIFY tasks, not builds. Only D2 (Inbox) is net-new.

- **D1 · F-GHOST aggregated flag popup + real counts** · **✅ LARGELY BUILT → VERIFY** — `fb.fileGhostReport` writes cross-user reports to the `ghost_reports` collection; `_paintJobReportBadge` (v141) paints "N hunters reported this" on the card face via a cached count() aggregation; honest "—" when no data. Remaining: live-verify the count aggregates correctly with real volume + confirm the "another hunter" popup surfaces everywhere intended. **Not a build.**
- **D2 · Full Inbox tab** · **⬜ NOT BUILT (founder: important — core feature)** — replace the interim per-message dismiss/collapse (v196) with a real inbox: anti-ghosting record + employer messages + candidate-side in one place. **[UI-REVIEW]** new tab. **This is the one real Sprint D build.**
- **D3 · Five résumé templates (F-TPL)** · **✅ ALREADY BUILT → VERIFY** — the Export Template Studio ships 5 (`Classic ATS / Modern Split / Minimal / Corporate Grid / Creative Accent` via `setTpl`/`renderTplPreview`, index.html ~2692). Roadmap/CLAUDE.md §8 was STALE. Remaining: verify each exports cleanly (accent/headshot/spacing/address toggles intact). **Not a build.**
- **D4 · Location/role broaden flow + "other regions" control (§7)** · **✅ LARGELY BUILT → VERIFY** — Browse `browseWiden()` + "Show other parts of [state] → / Show all regions →" pill (`_browseScope` market/wide, ~6121); deck `loadDeckOtherCities` + same-state broaden. Remaining: live-verify the full ladder + B-SALARY-CYCLE (client-side filter) + B-SARATOGA hard-scope. **Not a build.**

---

## SPRINT E — Growth & Cost  _(last, per founder instruction)_

- **E1 · Resources cron GO-LIVE** · **⬜ GATED ON FOUNDER REVIEW** — the publisher (`resources_refresh.yml`) is `workflow_dispatch`-only; its `cron` is COMMENTED (lines 15–16) until the founder runs it once + approves the first real article, then I uncomment 2 lines. NOTE: the **"Weekly Content Pack"** that ran this morning is a DIFFERENT workflow (`weekly_content.yml`, Mondays) — it drafts SOCIAL posts as an artifact to post manually, never publishes to the site. So the SEO Resources cron is NOT yet live. **Founder action: run resources_refresh → review → tell me to flip the cron.**
- **E2 · D1 read-cost reduction** · **PARTIALLY DONE — finish before 2026-09-19** — the biggest sink is ALREADY cut: the `job_pools` pool dropped deck reads ~3,800→~6 per load (D1-LIVE). Remaining: session-cache the Browse/company-view reads, cap query sizes, paginate. These REDUCE reads (cheap to build, not heavy). Trial credit ends 2026-09-19; budget: ~$12.28 of $300 used, founder cap ≈ $20 total. Free tier = 50k reads + 20k writes/day. **Do before Sep 19 so post-trial we sit inside free tier.**
- **E3 · F-TEST hardening (signed-in CI)** · MED · M — signed-in Playwright coverage in CI + screenshots. Separate from the standing NON-NEGOTIABLE: never skip the test protocol, and **red CI is never acceptable (flake or not)** — treat any red run as stop-and-fix at root cause.

---

## FOUNDER TEST CHECKLIST  _(I update this after each commit — test each logged-in AND logged-out where it applies)_
**v227 — A1 job-card full data** _(needs live jobs → test logged-in)_
- [ ] Open a job from **Browse** → the detail modal shows **Job Expectations & Summary + Requirements + Benefits**, all full text, **no mid-word clip** ("Review p" is gone).
- [ ] Open a job from **Saved Jobs** and from a **company's "Full Job Card"** → same complete sections (they reuse the same modal).
- [ ] A job with no Requirements/Benefits → those headers are **omitted** (no empty section).
- [ ] Each section (Summary / Requirements / Benefits) is a **tap-to-expand accordion** — shows a preview with "▾ tap to expand" and a "▴ collapse" bar, exactly like the swipe drawer. The card/modal itself still opens + closes.
- [ ] Both **dark + light**, **desktop + mobile**. On a slow connection the modal shows the preview instantly, then fills in the full posting a moment later (never blank).
- [ ] **Job-card uniformity (Browse == Swipe):** open the SAME role from Browse and from Swipe → both now show the full posting with expandable/collapsible Summary/Requirements/Benefits (A1 unified them). If Browse still looks clipped, you're on a cached build — hard-refresh to v227. _(If it's still clipped on v227, that's a new bug — tell me and I'll investigate.)_

---

**A2 — static-page logo + gradient wordmark** _(no login needed — check on ghostproofjob.com)_
- [ ] **/resources/** (hub + both articles) → header shows the **transparent ghost mark + gradient "GhostProofJob" wordmark**, matching the app. No boxed emoji. Check **dark + light** (theme toggle top-right) + **mobile**.
- [ ] **/resume-checker.html** → the top mascot is the **transparent mark** (not a flat 👻); the footer "GhostProofJob" is the gradient wordmark.
- [ ] Note: the article **byline avatar** is now the brand mark (A2b).

**v228 — A3 account pills** _(logged-in → Account/Profile)_
- [ ] "Your Tailored Résumés" and "Your Tailored Cover Letters" now look like **clickable pill-buttons** with a **count badge** + chevron; tapping still expands/collapses the list. The other sections (Job Titles, Minimum Salary, Industries) are unchanged. Both **dark + light**.

**v229 — job-card summary + gaps-only** _(logged-in; hard-refresh to v229)_
- [ ] **Browse** a job → "Job Expectations & Summary" now shows the **full posting** (not the "…HubS" clip); matches the swipe drawer.
- [ ] Tap the **"N requirement gaps"** chip → the Requirements-check modal shows **only the missing requirements** (degree, experience, named skills) — the "requirements you already meet" list is gone.
- [ ] Tap the **Match %** chip → the Match modal **still** shows "Your matching strengths" + "Add these to raise it" (unchanged). Both **dark + light**.

**v230 — company-card cleanup** _(open any company card)_
- [ ] Opened from a role → a slim "📋 You were viewing: [Role] · tap to open the role →" line (tapping opens the full job card); **no** Match/Cover/Apply/View buttons bleeding onto the company card.
- [ ] "Connect with hiring team" = social icons only (**no** stray Apply).
- [ ] **One** reviews button ("⭐ Reviews & rating") + a "🏢 See Glassdoor reviews →" link — the duplicate green "Reviews" chip is gone.
- [ ] Save Company + Reviews are two equal side-by-side buttons (no shared island). Both **dark + light**.

**v231 — company logos** _(open a job/company with a known website; employer profile)_
- [ ] A job/company with a real website domain shows the **company logo** where the 💼 was (Browse job card + company-card header); a job with no domain still shows 💼 (no wrong logos).
- [ ] **Employer profile** (recruiter account) → the Company-logo field has a note that an un-uploaded logo falls back to the online one; uploading still overrides it.
- [ ] A broken/missing online logo quietly falls back to 💼 (no broken-image box). Both **dark + light**.

**v232 — button label centering** _(look at any buttons across the app)_
- [ ] Button/pill labels (Save, Not Interested, Match to Job, Cover Letter, Save Company, Reviews & rating, etc.) sit **centered — middle both ways**; the emoji no longer pushes the text off-center; nothing looks lopsided. Both **dark + light**, desktop + mobile.

**v233 — page-section alignment** _(desktop; Résumé + Account pages)_
- [ ] On desktop, every section on a page lines up on the **same left/right edge** — the résumé "section-card" and the account profile card no longer stick out ~100px wider than the rest. Resize 1024→1920. (Mobile margins unchanged.)

**v234 — geolocation toggle (A4)** _(Account → "Use device location", with location blocked in the browser)_
- [ ] Tapping it when the browser blocks location keeps the toggle **OFF** and shows an honest message: enable it in your browser's site settings, or type your city. No dead-end "permission denied".

**v235 — company logo on the company card** _(open any company card)_
- [ ] The company-card header shows a logo box: real logo when the company has a domain, else 🏢. Both dark + light.

**v236 — Saved Jobs in Browse + trending logos**
- [ ] **Browse** has a collapsible "🔖 Your Saved Jobs" section (collapsed by default; count badge). **Ghosts no longer shows saved jobs** (companies only).
- [ ] Ghosts company rows show a logo box (real logo when the company has a domain, else 🏢).

**v237 — real-only ghost list + ambient background (Sprint C · C1)**
- [ ] **Ghosts** tab no longer shows fabricated "trending nationally" companies (the old Amazon/Meta/Stripe counts are gone); with no community data it shows an honest empty state ("Companies you apply to or browse will show here…").
- [ ] The app has a **subtle ambient background** (faint dotted grid + two soft brand glows) behind the content on **desktop** (the empty side margins) and **mobile** — text contrast is unchanged. Check **dark + light**.

**v238 — hybrid candidate avatar (Sprint C · avatar)**
- [ ] **Recruiter side — Applicants:** open a role's applicant list → each applicant shows a **colored initial monogram** (their initials in the brand gradient), not a generic 🧑.
- [ ] **Company team** rows (Employer → team/contacts) show the same initial monogram per teammate.
- [ ] **Matched candidates** (still anonymous, not yet applied) keep the **anonymous 🧑** — we never invent a name or photo. Check **dark + light**, desktop + mobile.

**v239 — desktop right rail (Sprint C · C2)** _(this is the big "fills the empty space" one)_
- [ ] **On DESKTOP (a wide window, ≥1180px):** the Swipe page now has a **right-hand rail** beside the job card — 🔥 streak, 🎯 weekly-goal ring, 📊 market pulse, 💡 Jett's tip, 🕑 recent activity. The empty right space is gone; the card + stats + filter still line up on the left.
- [ ] The old streak/weekly-goal bar that used to sit **above** the card is **gone on desktop** (the rail carries it now — no repetition). It should still be there on mobile.
- [ ] **Market pulse** shows real counts from the jobs currently loaded ("N roles loaded · X% remote · median $Y"). With nothing loaded yet it says "Set your location or add your résumé…" — never a made-up number.
- [ ] **On MOBILE / a narrow window:** nothing changes — single column, the streak bar is still above the card, **no** rail. (Shrink your browser below ~1180px to confirm it cleanly switches back.)
- [ ] Check **dark + light**. The rail cards should match the theme (dark panels in dark, off-white in light).
- [ ] Recruiter accounts: the Swipe/Employer view is unaffected (no rail, single column).

**v241 — hero job card (C3) + toast fix** _(open the Swipe deck)_
- [ ] The **top job card** now has a subtle **mint→cyber gradient border** marking it as the focal card; the **Match %** is an **animated donut ring** that counts up; the header shows the **real company logo** for known brands/domained jobs (💼 otherwise). No real match yet → plain "fit", no ring (no fake number). Check **dark + light**, desktop + mobile.
- [ ] On **desktop** the "N jobs loaded — start swiping" toast is now centered **under the card**, not shifted right beside the rail.

> ### ⚠️ BEFORE TESTING (morning): REDEPLOY THE WORKER
> The résumé-tailoring fix lives in **`worker/worker.js`** (the two `smart-match` system prompts).
> Cloudflare is the source of truth and does NOT auto-deploy from the repo — **paste `worker/worker.js`
> into the live Cloudflare Worker and redeploy**, or the reframing tune (v243→v244) won't be live.
> Everything else (v243–v245 app changes) is already deployed via the normal push.

**v245 — de-duplicated ghost % on the swipe card**
- [ ] The swipe job card no longer shows the ghost-risk % **twice** — the card-face tile is gone; the **% stays below "View Full Posting"** (in the drawer). The **gap button is centered** and about **one tile wide** (eye-catching). The Green/Red flag still shows risk at a glance. _(If you'd rather keep ghost at-a-glance on the card face and drop the drawer one instead, say so — it's a 2-line flip.)_

**v244 — truncation, "Hiring Company", ghost null%** _(the batch from your live test)_
- [ ] **Truncation:** open a job whose posting was cut mid-sentence (ended "…") → it now **fetches the full posting** and shows the complete text (Browse modal + swipe drawer). _If a specific job is STILL cut, that posting was stored truncated at harvest — tell me which and I'll confirm; a genuinely short posting is not re-fetched (saves reads)._
- [ ] **"Hiring Company":** the idealtraits job (Agency Coach AI) now shows the **real company name**, not "Hiring Company".
- [ ] **Ghosts "From you & your hunt":** companies you reported show **"—"** (not "null%") until there's a real community %.
- [ ] **Résumé tailoring (needs the Worker redeploy above):** re-run **Match-to-Job** on Geisinger / Indeed → bullets should reframe toward the role **naturally**, NOT stuff "marketing/communication" onto every line. Send me the PDFs and we'll tune further if needed.

**v243 — the tailoring engine (core value)**
- [ ] **This is the big one — after redeploying the Worker.** Match-to-Job should now produce a résumé that genuinely **targets the posting's language** (the v243 verdict: it works, v244 tuned it to stop keyword-stuffing). The **duplicate "Customer Service"** skill suggestion is gone.

**v241 — hero card (C3) + toast fix**
- [ ] Top card has a **gradient border** + **animated match-ring**; **real company logo** for known brands; the "N jobs loaded" toast centers under the card (desktop). Dark + light.

**v242 — gap consistency + bigger tiles + honest stats** _(the batch from your live test)_
- [ ] **Gap bug fixed:** open a job whose posting needs a degree you don't have (e.g. the Manager role) → the card's gap pill and the Requirements-check modal now **agree** (no more "✓ No gaps" on the card while the modal shows a Bachelor's gap).
- [ ] **Ghost % + gaps are now bigger TILES** (side-by-side, easy to read/tap), not tiny pills.
- [ ] **Ghosts page:** the fake "2,847 Community Reports / 94% Data Accuracy" are gone → honest "Free until you're hired · 0 ads."
- [ ] **Company card:** a **🔎 Google reviews →** link now sits beside 🏢 Glassdoor (we link out to real reviews; we don't fake a star rating). Check **dark + light**.

**v240 — brand logos + honesty fixes** _(the batch from your live test)_
- [ ] **Big-company logos:** search **Amazon** (Ghosts) / open **Microsoft**'s company card → their **real logo** now shows (was the building icon). Same on job cards + trending rows. A company we don't recognize still shows 🏢 (we never show a *wrong* logo).
- [ ] **Company Website button** (globe in "Connect with hiring team"): for a known brand it now opens their **real site** (e.g. microsoft.com) instead of a Google search.
- [ ] **null% is gone:** type in the **Ghosts** search (and Browse company search) → companies with no ghost data show **"👻 —"**, never "👻 null%".
- [ ] **Swipe footer:** on desktop the footer (Free Résumé Checker · Resources · …) now sits **under the card column**, lined up with the deck — not shifted right beside the rail. Mobile unchanged.
- [ ] **Long tail (over ~8 days):** the harvester now grabs each employer's website when the source provides it, so more companies (not just the big brands) will get logos + a real Website link as the pool refreshes. _Nothing to test day-one; just know it's coming._ **Heads-up:** I can't verify the harvester live from here — it'll show on the next real harvest.

---

### ✅ SPRINT A COMPLETE (build items) — v226–v234
A1 job-card full data · A2/A2b logo+wordmark · A3 tailored pills · A4 geo toggle · A4.5 Browse-summary + gaps-only bugs · A5 company-card cleanup · A6 company logos · A8 section alignment · A9 button centering. **A7 (card-face tiles) folded into Sprint C (Wow pass).** Open follow-up: button *word* vs *icon* centering (10px, site-wide) — awaiting founder A/B direction.

## Change log for this tracker
- 2026-08-25 — **v245 shipped**: de-duplicated the ghost-risk % on the swipe card (hid the card-face tile, kept the drawer one, centered + widened the gap button to ~one tile). Full gate.
- 2026-08-25 — **v244 shipped**: truncation-fetch robustness (fetch full posting when the preview ends in "…", never for short-complete ones — v210 read-cost invariant preserved), idealtraits "Hiring Company" fix, ghost "null%"→"—" on the reported list, tailoring-prompt tune (selective reframe, no keyword-stuffing — needs Worker redeploy). 860/860.
- 2026-08-25 — **v243 shipped (core value)**: reframe-toward-target-role Worker prompts (turns paraphrase into real tailoring) + duplicate-skill fix. Verdict on the live re-run: reframe WORKS (targets the role's language); v244 tuned it to stop over-stuffing. 856/856. **Worker redeploy required.**
- 2026-08-25 — **v242 shipped (Sprint B fixes)**: gap card↔modal consistency (shared `_paintReqPill`), A7 bigger ghost/gap tiles, honest Ghosts stats + Google-reviews link. 3 new tests; v142 deck-height bound updated for the intentionally-taller card. Full gate 854/854. **Next: v243 — the reframe-and-rewrite tailoring engine (core value).**
- 2026-08-25 — **v241 shipped (Sprint C · C3)**: hero card (gradient border + animated match ring + real logo) + toast-centering fix. 848/848.
- 2026-08-24 — **v240 shipped (founder live-test fixes)**: (1) curated verified brand→domain map so big-name logos (Amazon/Microsoft/etc.) resolve everywhere immediately (never a *guessed* domain); (2) harvester captures `company_url`→`companyWebsite` + pool carries it → long-tail logos + Website button populate over ~8 days; (3) company Website button links the real domain when known; (4) null% → honest "👻 —" in Ghost + Browse search dropdowns; (5) swipe footer aligns under the deck column beside the C2 rail. 4 new state tests + harvester selftest. Full no-skip gate. **Next: C3 hero card (v241) — mockup approved.**
- 2026-08-23 — **v239 shipped (Sprint C · C2 right rail)**: desktop-only sticky rail (streak/goal/market-pulse/Jett/recent) that replaces the on-deck gamify bar on desktop; mobile unchanged. Zero-read market pulse (`_gpjMarketPulse` from the in-memory pool). 2 new state tests. Browser-verified dark+light+narrow+mobile. Full no-skip gate. **Next: C3 hero card + animated match ring (needs its own mockup).**
- 2026-08-23 — **v238 shipped (Sprint C · candidate avatar)**: `_gpjPersonAvatar` hybrid — initial monogram for named people (applicant card, team rows), anonymous 🧑 for matched candidates. 1 new state test. Full no-skip gate green (benchmark + 8 backend + Playwright 836/836). **Next: C2 right rail (v239).**
- 2026-08-23 — **v237 shipped (Sprint C · C1)**: ambient background (#app + #desk-main) + real-only Ghosts list (removed fabricated trending companies). 2 new state tests. Full gate green (834/834).
- 2026-08-22 — created; consolidated the two v226 review PDFs + prior tracker + CLAUDE.md §7/§8 into Sprints A–E.
- 2026-08-22 — **A1 shipped (v227)**: Browse modal lazy-loads the full posting + renders Summary + Requirements + Benefits as **tap-to-expand accordions** (same `.desc-clamp` as the swipe drawer → "one universal card"); full card-surface scan (Saved + company-live reuse the same modal). 4 new state-coverage tests.
- 2026-08-22 — **A2 shipped (static, no app version)**: Resources + Résumé Checker now use the transparent brand mark + gradient wordmark (both build scripts + the 3 existing committed pages). +1 resourcesEngine assertion.
- 2026-08-22 — **A2b shipped**: resources byline avatar → brand mark (Jett keeps ✍️).
- 2026-08-22 — **A3 shipped (v228)**: account "Your Tailored Résumés / Cover Letters" → pill-buttons w/ count badge (scoped `.pref-pill`; 2 new tests). Planned A5/A6 (company card cleanup + logos) + A7 (card-face pills) + A8 (uniform content width); recorded the job-card data investigation conclusion.
