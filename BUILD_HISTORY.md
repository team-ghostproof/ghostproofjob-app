# GhostProofJob — Master Build History

> One line per shipped build. Newest at the top. This is the single source of truth for
> "what changed in each version." It is **auto-updated by `bump_version.py`** on every version
> bump (see the `[BUILD-DOC]` rule in CLAUDE.md), so it stays current without manual effort.
> Older builds (v1–v99) are preserved in git history and CLAUDE.md §9.

_Last updated: 2026-08-23 · Current live build: **v235**_

---

## v219–v222 — founder live-test sprint (2026-08-20): CI integrity + logged-in card polish
- **v235** — A6 completion (founder): company logo now on the COMPANY card too — a persistent logo BOX in the company-card header (employer upload → online logo by the company's REAL domain → 🏢 placeholder), matching the job card. Before this, A6 only showed an inline logo on the company card when a domain was present, so companies without one (e.g. opened from Ghosts) showed no logo at all
- **v234** — A4 (last Sprint A item): geolocation toggle polish — when the BROWSER blocks location, keep the toggle visibly OFF and give an honest, actionable message (enable it in your browser's site settings, or type your city) + a matching loc-status hint, instead of a dead-end 'permission denied'. Location stays opt-in
- **v233** — v233 (A8): page-section alignment — sections with an inline mobile margin (.section-card on Resume, #set-profile on Account) were left-shifting ~100px on desktop because their inline margin:0 16px overrode the desktop centering rule; added !important to the desktop #desk-main>div>* auto-margins so every section shares ONE centered gutter (all now at the same left edge). Desktop-only; mobile keeps its 16px margin
- **v232** — v232 button text centering: flex-center the labels in the shared button classes (.upgrade-btn/.coffee-btn/.opt-btn-go/.opt-btn-skip/.buzz-add) and the card + company-card action buttons (Match/Cover/Apply/Save/Not Interested/Save Company/Reviews) so the emoji+text group sits true-center horizontally AND vertically and stays centered if it wraps — text-align+padding alone drifted with emojis
- **v231** — A6 company logos: show the company logo where the briefcase was (company-card header + Browse job card) with an HONEST fallback chain — employer uploaded logo → the logo found online from their REAL website domain (DuckDuckGo icons; never a guessed domain, so never the wrong company) → the default emoji (onerror-safe). Employer profile form gains a note that an unuploaded logo falls back to the online one. Client-side img only (no backend/quota); CSP already allows https images
- **v230** — A5 company-card cleanup: the company view is now company-only — the per-role Match/Cover/Apply/View bleed is replaced by one slim 'tap to open the role' line (opens the full job card via openCmFeaturedRole); the stray Apply is removed from the Connect-with-hiring-team social row; the duplicate green 'Reviews' chip is gone, leaving ONE clean 'Reviews & rating' button + an explicit 'See Glassdoor reviews' link (we link out, never scrape reviews)
- **v229** — v229 job-card + requirements bug fixes: (B-BROWSE-SUMMARY) the Browse job modal now renders Job Expectations from the FULL description (j.desc) instead of the short j.summary preview that shadowed it — fixes the mid-word 'HubS' truncation so Browse matches the swipe drawer; (B-GAPS-ONLY) the Requirements-check modal shows ONLY the missing requirements (the 'requirements you already meet' list is hidden; the Match modal still shows matching strengths)
- **v228** — A3: account 'Your Tailored Resumes / Cover Letters' sections now read as pill-buttons with a count badge + chevron (scoped .pref-pill class — the other pref-section-title sections are untouched); counts fed by the existing render functions + refreshed on account open
- **v227** — A1 job-card full data: the Browse detail modal now lazy-loads the full posting (mirrors the swipe drawer's v210 fix via fb.getJobFull) and renders Summary + Requirements + Benefits — no more mid-word clip ('Review p') and no missing sections; Saved-jobs + company-live 'Full Job Card' reuse the same modal so every job surface shows complete data
- **v226** — account chip icon-only on tight phones (≤380px): name wrapped in .chip-name span + hidden via CSS so it reads as a clean emoji, not the dangling '🙂 Aa…' the 56px ellipsis produced; name still shows on every wider screen; XSS-safe (textContent, not innerHTML); recruiter 🛡️ badge appends a node so the span survives
- **v225** — scroll + pill placement [UI-REVIEW approved]: desktop scrollbar now at the FAR-RIGHT window edge (2-col + app fills width; inner-scroll model KEPT so the header stays fixed + all bottom-anchored popups keep working — no regression); content centered BETWEEN the rail and the scrollbar with equal gaps; toast centered in the content column; ghost+gap pills moved directly UNDER the Match/Salary/Location tiles (grouped, not floating after the Green Flag). Verified logged-in AND logged-out, desktop + mobile
- **v224** — transparent header logo (founder-provided): removed the baked navy square — the ghost now reads clean on both the light and dark header (dark outline + mint drop-shadow glow keep the white body visible); onboarding mascot matches; Jett avatar unchanged
- **v223** — housekeeping + docs: master BUILD_HISTORY.md now auto-maintained by bump_version ([BUILD-DOC] rule); public footer version hidden (internal APP_VERSION/CACHE_VERSION markers kept for SW cache-busting + What's-New); verified the approved logo design = the gradient wordmark, already live (the squareless ghost still needs a transparent asset)
- **v222** — card uniformity + honest green flag + wordmark clip fix: tiles share one background per mode (Match accents via its green number, not a clashing tile); ghost+gap pills centered; green flag reads "Fresh posting · Nd ago" (dropped the unverifiable "Actively hiring now" + the confusing city append); header wordmark no longer clips on phones.
- **v221** — logged-in card polish + desktop centering across all widths: salary no longer clips ("On request"); ghost kept as the clean 👻N% pill (reverted a mistaken bar); ghost+gap share one row; drawer stops repeating duties (overlap dedup) + shows more before "tap to expand"; card widened to match the console; `#employers` stripped from the URL; centering fixed across 1024→1920 (the 1182px dead zone).
- **v220** — desktop true-center + balanced layout: card/footer dead-center in the viewport (was shoved +119px right); dead margin cut 120→38px/side.
- **v219** — CI integrity: 4 real regressions I'd mislabeled as flakes + 1 real flake, all fixed; per-job "Match to Job" tailor is DOWNLOAD-ONLY (never mutates the master résumé).

## v199–v218 — the "wow" UX pass + founder live-test fixes
- **v218** — deck wow — desktop "expand" (fill the screen, no islands)
- **v217** — deck wow — mobile decision-snapshot card + logo-cutoff fix
- **v216** — match scorer Q1 — seniority-gap cap (a Director role no longer scores 98% for a lower-level résumé)
- **v215** — footer/nav cleanup + Resources "Employers" link fix
- **v214** — rater Q2 — dock soft-skill dilution + near-duplicate bullets (in-app + public checker)
- **v213** — Match-to-Job #4 — bulletproof checkbox capture (later refined in v219 to download-only)
- **v212** — match honesty — a high % never reads as "stretch role — no skills"
- **v211** — keyword search fix — renderBrowse honors the any-word fallback (67-found→0-shown)
- **v210** — D1 truncation fix — drawer lazy-loads the FULL posting (root cause: v198)
- **v208–v209** — deck wow: gamify bar (streak + weekly goal) + Apply/Hired celebrations + haptics; visible centered undo + spring snap-back
- **v202–v207** — employer wow suite: download résumé/CL from the Applicant Card; Anti-Ghosting badge on the chip; metrics strip; hiring kanban (Applied→Hired); honest Hired feed + role-aware ⌘K; kanban bulk stage-move
- **v199–v201** — wow pass foundation: deck-level "undo last swipe" (+ Z key); employer side defaults to light; honest gamify data layer (streak + weekly count)

## v183–v198 — light mode + AI honesty + SEO + Resources engine
- **v198** — cover-letter z-index + keyword any-word fallback + honest empty-state + CL phrasing
- **v197** — Resources SEO engine (data-grounded article generator) + footer link
- **v195–v196** — homepage footer link to the free résumé checker; per-message dismiss + collapsible messages (interim before the Inbox tab)
- **v193–v194** — dark/light choice during signup; progressive keyword search (Enter searches the whole regional DB → nationwide)
- **v190–v192** — intuitive title-based keyword search; the ✕ on "Improve My Whole Resume" cancels; a checked Match-to-Job skill leads the skills line (survives the 15-cap)
- **v186–v189** — compact "Hide Ledger" + D1 pool guardrail; matching reads education + certs; light-mode contrast softened; fix literal `&amp;` in a toast
- **v183–v185** — light-mode toggle (opt-in; dark stays default); AI-honesty + polish; SEO homepage self-canonical + OG/Twitter tags

## v154–v182 — résumé/rater/cover-letter + match engine
- **v181** — Outcome Elicitation — "Improve My Whole Resume with Jett" asks for measurable results and weaves the real number in
- **v177–v180** — rater "Add these with Jett" updates the master; metric-preservation guard; "Résumé Strength" honest rubric; remove the blended "Overall" number
- **v172–v176** — Role-Fit honesty (field-alignment gate); apply panel leads with the tailored CL; P0 résumé-corruption fix; Cover Letter opens the review flow everywhere; un-save a company card
- **v154–v171** — Match Preferences finally do something (weighted); two-labelled rater scores; Match-to-Job tailors a COPY + rewrites the summary; the tailoring bug (stale-DOM revert); skill mining + quantify targeting

## v123–v153 — recruiter tier maturation + trust surfaces + CI stability
- **v151–v153** — notification emails (event-driven); D1 client seam (fetchJobs reads the pre-built pool, ~3800→~6 reads)
- **v138–v150** — one-employer-one-key (kills duplicate/recycling jobs); iPhone-crash fix (4 pools in memory); the real match/sync gate bug; community flags; desktop deck sized to the card; sign-out no longer deletes history; restore resilience; CI-red reconciliations
- **v123–v137** — kind-decline + account deletion + 250 SEO pages; real contact details on trust surfaces; client error monitoring; admin insights; internal scheduling; post-apply email; CRITICAL swipe-right-wrong-job fix

## v100–v122 — recruiter tier (two-sided marketplace) + billing + live-test batches
- **v114–v122** — Stripe automation (payments grant/revoke); notification centre; Listings edit + fill-source; live-test bug batches; street-safe City/State; candidate withdrawal + attribution; password recovery
- **v109–v113** — recruiter view foundation + full tab reskin by role; recruiter header chrome + company team + two security holes closed
- **v100–v108** — recruiter frontend R1 + smart-data finish; R2–R8 (onboarding, posting, internal apply, reverse-match, matched-candidates, outreach, anti-ghosting badge, plan caps); F-GEO distance filter; Referral engine

## v66–v99 — location/deck bug arc + ATS backend + recruiter R0
Detailed in CLAUDE.md §9 (git history preserved). Highlights: v67 boot-crash/TDZ fix + boot harness; v68 ATS backend case-fix; v73–v80 deck pool + role-first matching + market hard-scope; v96 MATCH-TRUTH (confirmed benchmark); v99 recruiter tier R1 frontend.

---

### How this file stays current
`bump_version.py` appends the new version + its `--note` to the top of the current-sprint section on every bump. Do not hand-edit past entries; add context via the commit `--note`.
