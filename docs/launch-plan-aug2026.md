# GhostProofJob — Launch Plan to end of August 2026

> Goal (founder): **live & ready for end-user usage before Aug 31, 2026.** Today: **Aug 24** → ~7 working days.
> Every build follows the standing contract: **no break · no regression · no broken features/links/buttons/processes · light + dark for every design · full no-skip gate before commit** (§4 benchmark + 8 backend suites + full Playwright chromium+mobile — all pages, themes, logged-in/out, device, orientation, platforms). **Red CI is never acceptable** — a red run is stop-and-fix at the root cause, never dismissed as a flake.
> [UI-REVIEW] items get a mockup + explicit approval BEFORE any code.

---

## 1. What "live & ready" means (launch bar)

The app is already deployed at ghostproofjob.com and functional. "Ready for end users" = a first-time visitor gets a polished, honest, bug-free core experience end-to-end:

1. **Honest** — zero fabricated data anywhere (the founder's #1 rule). This is a hard launch gate.
2. **Polished** — the "wow" pass (Sprint C) makes it feel finished, not a wireframe, on every device + theme.
3. **Trustworthy core** — the résumé rater, cover-letter/AI, and matching produce good, honest output (Sprint B verify + fix).
4. **First impression** — a signed-out visitor sees a compelling, honest landing (C6), not a bare deck.
5. **Green CI** — every gate green; the promote-to-stable pipeline clean.

Everything above is **launch-critical**. Big net-new features (5 templates, full Inbox tab) and cost work (D1) are **post-launch** — see §4.

---

## 2. Launch-critical schedule (Aug 24 → Aug 31)

| Ver | Item | Type | Why (launch) | Days |
|-----|------|------|--------------|------|
| **v241** | **C3 hero job card + toast-centering fix** | [UI] approved | The flagship surface reads as a wireframe; hero card = the "wow". Toast is visibly off-center beside the C2 rail. | Aug 24 |
| **v242** | **Honesty sweep**: kill fabricated Ghosts stats (`2,847`/`94%`), audit every hardcoded number site-wide | correctness/honesty | Hard launch gate — no fake data in front of real users. | Aug 25 |
| **v243** | **C6 signed-out home hero** + honest social-proof (only-when-real) | [UI-REVIEW] | The first thing a new end-user sees. Highest conversion lever. | Aug 25–26 |
| **v244** | **C5 skeleton loaders + mascot empty/first-run states** | [UI] | Cheapest "feels fast + finished" upgrade; kills blank flashes on live data. | Aug 26–27 |
| **v245** | **Sprint B-1 — cover-letter / AI quality** verify + fix (F-AI, F-COVERLETTER) | core value | The paid promise. Must produce good, honest output; fallbacks labelled. | Aug 27–28 |
| **v246** | **Sprint B-2 — rater + ATS-preview** verify (F-RATER, F-ATSPREVIEW) | core value | The rater is a headline feature (public checker too). Must be trustworthy. | Aug 28–29 |
| **v247** | **Sprint B-3 — site-wide wording / pricing consistency** sweep (F-WORDING) | correctness | Consistent, honest pricing/messaging everywhere before launch. | Aug 29–30 |
| **v248** | **C4 motion & delight (light touch)** — swipe spring, count-ups, celebrations; respects reduced-motion | [UI] | Final polish. Kept light so it can't destabilize core flows. | Aug 30 |
| — | **Launch-readiness sweep + re-rate** — full E2E on all devices/themes/platforms + live self-test | verify | Final go/no-go. | Aug 31 |

**Sequencing logic:** honesty + first-impression + polish (C/honesty) front-loaded because they're user-visible and lower-risk; the "verify the intelligence" (B) block is mid-week because it may surface deeper fixes and needs buffer; C4 motion last because it's the most optional and must never block a core action.

---

## 3. Per-item implementation detail

### v241 · C3 hero job card + toast fix  `[UI-REVIEW ✅ approved]`
- **Why:** the swipe card is the product's centerpiece; today it's flat. Mockup approved (GPJ-sprintC3-mockup.html).
- **How (insert-only):** on the 3 existing card slots + `fillSlot()` — (a) gradient border on `.job-card.top` only (CSS pseudo-element); (b) real company logo in `.s-logo` via `_gpjLogoHtml` (ties to v240); (c) animated count-up match ring (the Match tile becomes a conic-gradient ring; keeps its tap→cardMatchInsight); (d) A7: ghost/gap pills → a 2-up tile row matching the tile system + a crisp ghost-risk meter. Toast: `body.desk:has(#view-swipe.gpj-rail-on.active) #toast` shifts left 162px to align under the deck column (same fix shape as the v240 footer).
- **Light/dark:** all via tokens; verified both. **Reduced-motion:** ring shows final state, no animation.
- **[STATE-COVERAGE]:** guest (no résumé → ring/tiles hidden or neutral), authed (real %), no-salary/no-ghost data (— states), 3 stacked slots consistent.
- **Gate:** full no-skip + browser-verify both themes desktop+mobile.

### v242 · Honesty sweep  `[correctness]`
- **Why:** `2,847 Community Reports` + `94% Data Accuracy` are hardcoded (index.html ~2861) — same class as the v237 fabricated trending list. Founder rule #5.
- **How:** **decision needed** — (A) compute real numbers from community data (costs Firestore reads — weigh against [FREE-TIER]); (B) replace with honest, derivable copy (e.g. "Search any company's ghost-risk"); (C) remove the two stat tiles. **Recommendation: C or B** (zero read-cost, fully honest). Plus a grep sweep for any other hardcoded stats/counts.
- **Gate:** full no-skip; new [STATE-COVERAGE] test asserting no fabricated stat tiles.

### v243 · C6 signed-out home hero  `[UI-REVIEW — mockup first]`
- **Why:** the landing a new end-user hits. Currently they see the app chrome; a hero that explains the promise + shows an honest, muted demo swipe converts.
- **How:** a signed-out-only hero block above the deck (or gating the deck) — tagline, one-line value, "Build your profile" CTA, and honest aggregate numbers **only if real** (else omit). No fabricated social proof. Reuses existing auth/switch flows.
- **Gate:** full no-skip; guest vs authed [STATE-COVERAGE]; light/dark; mobile.

### v244 · C5 skeleton loaders + mascot empty states  `[UI]`
- **Why:** live Firestore data has load latency; blank flashes read as broken. Ghost-led empty states make first-run friendly.
- **How:** lightweight CSS skeleton rows for the deck/Browse/rater while data loads; mascot + copy for genuinely-empty states (reuse the existing empty-deck asset). No layout shift on fill.
- **Gate:** full no-skip; interrupted-network + empty-data [STATE-COVERAGE]; both themes.

### v245 · Sprint B-1 · Cover-letter / AI quality  `[core value]`
- **Why:** the founder pays for the AI; output quality is the promise. Known issues: unfilled phrasing ("the this role position"), forced emphasis, fallback honesty.
- **How:** verify the live Worker path end-to-end; fix phrasing/templating defects found; confirm every AI button states when it fell back to templates AND when live AI returns (existing honesty pattern); confirm per-tier counts/limits + safeguards not over-restrictive; persist rewrite data for reuse.
- **Gate:** full no-skip + backend `test:apply`/email; honest-fallback [STATE-COVERAGE]. **Risk:** if deep defects surface, may span 2 builds — buffer built into the week.

### v246 · Sprint B-2 · Rater + ATS-preview  `[core value]`
- **Why:** the rater is a headline feature (in-app + the public /resume-checker.html). Must read the whole résumé + benchmark honestly (the v156/v179 rubric work is in; this is a full verification + any fixes).
- **How:** verify rater reads the full résumé, scores on the stable corpus yardstick, two honest labelled scores; verify ATS preview shows the real machine-readable data; fix gaps.
- **Gate:** full no-skip + `test:match`; rater [STATE-COVERAGE] (already strong — keep green).

### v247 · Sprint B-3 · Wording / pricing consistency  `[correctness]`
- **Why:** launch needs one consistent, honest pricing + messaging story (unlimited applies always; AI tiers; free-until-hired; no auto-apply).
- **How:** site-wide copy sweep (app + static pages + Resources + checker); align every pricing/tier mention; honesty/transparency pass.
- **Gate:** full no-skip + `test:seo`/`test:resources`.

### v248 · C4 motion & delight (light)  `[UI]`
- **Why:** final tactile polish. Kept deliberately light so it can't regress core flows.
- **How:** swipe spring/touch-drag easing, stat count-ups, streak flame, extend Apply/Hired celebrations. Employer side stays calm. Respects `prefers-reduced-motion`; never blocks the core action.
- **Gate:** full no-skip; reduced-motion [STATE-COVERAGE]; both themes.

### Aug 31 · Launch-readiness sweep
- Full E2E across all views × dark/light × desktop/mobile × signed-in/out × orientation; live in-app self-test (19+ checks); confirm CI + promote-to-stable green; final screenshots. Go/no-go.

---

## 4. Post-launch tail (September) — honest deferral

**CORRECTION (2026-08-24 audit):** Sprint D is mostly ALREADY BUILT — see the roadmap Sprint D audit. So most of it is VERIFY (folds into the Aug 27–29 Sprint-B verification block), not net-new work. Only **D2 (Inbox)** is a real build.

- **Sprint D:**
  - **D2 — Full Inbox tab** — the ONE net-new Sprint D build. Founder flagged it important (tracks messages both sides). **Candidate to pull into the launch window** (Sprint D verifies freed the time) as a [UI-REVIEW] build, OR ship right after launch. Founder's call.
  - **D1 F-GHOST** (reports + "N hunters reported" badge), **D3 5 templates** (Export Template Studio), **D4 broaden flow** (Browse widen pill + deck other-cities) — **already built → VERIFY only**, folded into the Sprint-B verification days.
- **Sprint E:**
  - **E2 (read-cost)** — biggest sink already cut (the `job_pools` pool: deck reads ~3,800→~6). Finish the lighter caching (Browse/company reads, query caps) **before 2026-09-19** so post-trial we sit inside the free tier (50k reads/20k writes per day). Not heavy to build.
  - **E1 Resources cron** — founder runs `resources_refresh` once + reviews the first article, then I flip the cron (2-line uncomment). The "Weekly Content Pack" that ran today is a different, already-live social-draft workflow.
  - **E3 signed-in CI** — reliability nicety; post-launch.
- **Harvester logo long-tail** — v240 already captures `company_url`; logos/website links populate automatically as the pool self-heals (~8 days), no action needed.

---

## 5. Risks & honest caveats
- **7 days is tight for Sprint B done well.** B is "verify + fix the intelligence" — if verification surfaces deep defects, a build can expand. The schedule keeps B mid-week with C4 as the flex item that can slip to post-launch without hurting the launch bar.
- **Live-data items can't be fully verified from this environment** (no Firestore/network in the build sandbox) — matching %, location scoping, and the harvester logo tail need the founder's live testing after deploy.
- **[UI-REVIEW] gate stands** — v243 (home hero) and any card-face change get a mockup + approval before code, which costs a round-trip; front-loaded so they don't bottleneck the end of the week.
- **Every build still runs the full no-skip gate (~20 min).** That paces the day; ~1–2 solid builds/day is the realistic throughput.

---

## 6. Change log
- 2026-08-24 — created. Launch target Aug 31; launch-critical = Sprint C finish + honesty sweep + Sprint B verify; Sprint D/E deferred to September (D1 per founder's own deferral to Sep 19).
