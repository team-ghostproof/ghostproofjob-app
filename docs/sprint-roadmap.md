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

### A4 · Geolocation toggle polish  · Impact LOW · Effort S
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

### A8 · Align the "random" misaligned sections to the shared gutter  **[UI]** · Impact MED · Effort M · _(diagnosed 2026-08-22 by per-section measurement)_
- **Why (founder, refined):** NOT a global-width problem — each view is symmetrically centered overall. The real issue: a few sections within a page don't share the same left/right edges as their siblings, so they look "off" while the rest line up. **We deliberately do NOT force one uniform width** (sections have different designs) — each keeps its own width but must sit on the **same center axis / same gutter**.
- **Measured outliers (left-edge):** Résumé — a `section-card` at 312px vs the rest at 432px. Account — `set-profile` at 312px vs 416px. Settings/Ghosts — saved-job cards at 431/448px vs 416px (true sibling drift). (Some 312-vs-432 cases are parent-card-vs-indented-children nesting, to confirm per section.)
- **How (insert-only):** per-view pass — normalize each top-level section's horizontal container (padding/margin/max-width auto) so every sibling section shares ONE gutter, without changing any section's internal design/width. Fix the saved-job-card drift + the 312-outlier sections.
- **[STATE-COVERAGE]:** all 6 views · both themes · 1024→1920 · logged in/out. Playwright: assert sibling top-level sections in a view share the same left edge (within a small tolerance).
- **Recommendation:** dedicated focused pass (needs per-section CSS inspection); **[UI-REVIEW]**. Can pair with C1.

### Job-card data completeness — investigation conclusion (2026-08-22)
Founder saw "incomplete data on Browse job cards." **Verified:** v227/A1 IS live (build stamp v227; the `getJobFull` lazy-load is deployed), Firestore rules allow the single-doc read (`match /jobs/{jobId} allow read: if true`), the pool builder preserves `_docId` + sets `_clipped` correctly, and the founder's own screenshot shows Browse fully populated. **Most likely cause of the stale view:** the PWA service worker served a cached pre-v227 shell (hard-refresh / close-all-tabs forces the update). **One honest edge case:** a job pruned from the `jobs` collection (8-day cleanup) but still in the pool → `getJobFull` returns null → Browse falls back to the trimmed preview for that one job (rare; self-heals as the pool rebuilds). No code change required; monitoring only.

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

## Change log for this tracker
- 2026-08-22 — created; consolidated the two v226 review PDFs + prior tracker + CLAUDE.md §7/§8 into Sprints A–E.
- 2026-08-22 — **A1 shipped (v227)**: Browse modal lazy-loads the full posting + renders Summary + Requirements + Benefits as **tap-to-expand accordions** (same `.desc-clamp` as the swipe drawer → "one universal card"); full card-surface scan (Saved + company-live reuse the same modal). 4 new state-coverage tests.
- 2026-08-22 — **A2 shipped (static, no app version)**: Resources + Résumé Checker now use the transparent brand mark + gradient wordmark (both build scripts + the 3 existing committed pages). +1 resourcesEngine assertion.
- 2026-08-22 — **A2b shipped**: resources byline avatar → brand mark (Jett keeps ✍️).
- 2026-08-22 — **A3 shipped (v228)**: account "Your Tailored Résumés / Cover Letters" → pill-buttons w/ count badge (scoped `.pref-pill`; 2 new tests). Planned A5/A6 (company card cleanup + logos) + A7 (card-face pills) + A8 (uniform content width); recorded the job-card data investigation conclusion.
