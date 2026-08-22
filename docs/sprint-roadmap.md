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

### A3 · Tailored-résumé / cover-letter sections read as buttons  **[UI]** · Impact MED · Effort S
- **Why:** In Account, "Your Tailored Résumés / Cover Letters" look like plain text with a faint "–"; users don't know they're interactive, so generated assets feel lost. (Full Site Analysis, P2.)
- **How (insert-only):** restyle the two collapsible headers as pills/list-buttons — chevron, hover state, count badge — aligned to the same gutter/width as the cards above. Behavior unchanged (still toggles the same content).
- **[STATE-COVERAGE]:** empty (0 tailored → pill shows "None yet" state, still looks like a control) · populated (count badge) · both themes.
- **Test:** a state-coverage assertion the sections are focusable/role=button and show a count.
- **Rollback:** CSS/markup only; revert the block.

### A4 · Geolocation toggle polish  · Impact LOW · Effort S
- **Why:** Not a bug — the browser denies location and the app honestly falls back — but the toggle can look "on but dead," and there's no hint on how to enable it. (Full Site Analysis, P3.)
- **How (insert-only):** on the permission-denied callback, snap the toggle visibly back to OFF; append one honest line ("Location is blocked for this site — enable it in your browser's settings") to the existing toast/status.
- **[STATE-COVERAGE]:** denied · granted · unsupported (`!navigator.geolocation`) · already-off.
- **Test:** state-coverage: simulate a denied callback → toggle reads OFF.
- **Rollback:** revert the callback lines.

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

- **C1 · Ambient background + column rhythm/typography** **[UI]** · HIGH · M — subtle plum→purple radial glow behind the deck + ~3% dotted grid; cap the primary column, confident headings, 8px scale. Kills the flat/empty feel. Guardrail: never reduce light-mode contrast; honor `prefers-reduced-motion`.
- **C2 · Contextual right rail (applicant side)** **[UI]** · HIGH · M — fill the width with USEFUL info: streak/weekly-goal ring, market pulse (reuse `resources/_market_stats`, ~1 read), a Jett tip, recent activity. Stacks/collapses on mobile.
- **C3 · Hero job card + animated match ring** **[UI]** · HIGH · M — circular animated match ring, subtle gradient border on the top card, company avatar, one tile system, crisp ghost-risk meter. Your signature "wow"/shareable.
- **C4 · Motion & delight (applicant only)** **[UI]** · HIGH · M — finish swipe spring physics, count-up stats, streak flame, extend Apply/Hired celebrations. Employer side stays calm. Respect reduced-motion; never block the core action.
- **C5 · Skeleton loaders + mascot empty states** **[UI]** · MED · S — cheapest "feels fast/finished" upgrade; ghost-led empty/first-run states.
- **C6 · Signed-out home hero + honest social-proof bar** **[UI]** · HIGH (conversion) · M — a muted looping demo swipe on the landing; honest aggregate numbers (jobs verified / ghosts flagged) ONLY when real. Ties to the Sprint-D F-GHOST data.

---

## SPRINT D — Signature Features  _(net-new value)_

- **D1 · F-GHOST aggregated flag popup + real counts** · MED · M — Firestore-aggregated flag count + "Another hunter reported this job." The emotional core of the brand, underused today. Honest — "—" when no data.
- **D2 · Full Inbox tab** · MED · M — replace the interim per-message dismiss/collapse (v196) with a real inbox: anti-ghosting record + employer messages in one place. **[UI]** for the new tab.
- **D3 · Five résumé templates (F-TPL)** **[UI]** · MED · M — multiple export layouts; differentiation + a reason to stay. Must not break export/accent/headshot/spacing.
- **D4 · Location/role broaden flow + "other regions" control (§7)** **[UI]** · MED · M — same-state → statewide → other cities ladder; single pill, never widens on its own; reuses `loadDeckOtherCities`. Also folds in B-SALARY-CYCLE (pure client-side filter) + B-SARATOGA hard-scope live-verify.

---

## SPRINT E — Growth & Cost  _(last, per founder instruction)_

- **E1 · Resources cron GO-LIVE** · MED-HIGH · S — flip the every-other-day publish on after you review the first real articles; add light monitoring. Near-zero cost SEO growth engine. _(Founder action to enable the schedule + the FIREBASE_SERVICE_ACCOUNT secret path.)_
- **E2 · D1 read-cost reduction** · HIGH after 2026-09-19 · M-L — cache region pool per session, cap queries, paginate. The Blaze trial credit ends 2026-09-19; today the cost is masked.
- **E3 · F-TEST hardening** · MED · M — Playwright screenshots, more backend coverage, signed-in CI.

---

## FOUNDER TEST CHECKLIST  _(I update this after each commit — test each logged-in AND logged-out where it applies)_
**v227 — A1 job-card full data** _(needs live jobs → test logged-in)_
- [ ] Open a job from **Browse** → the detail modal shows **Job Expectations & Summary + Requirements + Benefits**, all full text, **no mid-word clip** ("Review p" is gone).
- [ ] Open a job from **Saved Jobs** and from a **company's "Full Job Card"** → same complete sections (they reuse the same modal).
- [ ] A job with no Requirements/Benefits → those headers are **omitted** (no empty section).
- [ ] Each section (Summary / Requirements / Benefits) is a **tap-to-expand accordion** — shows a preview with "▾ tap to expand" and a "▴ collapse" bar, exactly like the swipe drawer. The card/modal itself still opens + closes.
- [ ] Both **dark + light**, **desktop + mobile**. On a slow connection the modal shows the preview instantly, then fills in the full posting a moment later (never blank).

---

**A2 — static-page logo + gradient wordmark** _(no login needed — check on ghostproofjob.com)_
- [ ] **/resources/** (hub + both articles) → header shows the **transparent ghost mark + gradient "GhostProofJob" wordmark**, matching the app. No boxed emoji. Check **dark + light** (theme toggle top-right) + **mobile**.
- [ ] **/resume-checker.html** → the top mascot is the **transparent mark** (not a flat 👻); the footer "GhostProofJob" is the gradient wordmark.
- [ ] Note: the article **byline avatar** (small ghost in a gradient circle) is intentionally left as-is — tell me if you want it swapped too.

## Change log for this tracker
- 2026-08-22 — created; consolidated the two v226 review PDFs + prior tracker + CLAUDE.md §7/§8 into Sprints A–E.
- 2026-08-22 — **A1 shipped (v227)**: Browse modal lazy-loads the full posting + renders Summary + Requirements + Benefits as **tap-to-expand accordions** (same `.desc-clamp` as the swipe drawer → "one universal card"); full card-surface scan (Saved + company-live reuse the same modal). 4 new state-coverage tests.
- 2026-08-22 — **A2 shipped (static, no app version)**: Resources + Résumé Checker now use the transparent brand mark + gradient wordmark (both build scripts + the 3 existing committed pages). +1 resourcesEngine assertion. Byline avatar left as-is (founder call).
