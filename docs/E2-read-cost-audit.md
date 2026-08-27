# E2 · Firestore Read-Cost Audit (2026-08-27, build v246)

> Read-only code trace of every Firestore read path in `index.html`, mapped to the user action
> that triggers it, ranked by cost. Goal: sit inside the **free tier (50K reads / 20K writes/day)**
> before the Blaze trial credit expires **2026-09-19**. No code changed by this audit.

## How reads work here (the good foundation already in place)
- **`fetchJobs(region, max)`** is pool-first: it reads `job_pools/metro-<slug>-*` + `job_pools/all-*`
  (a handful of aggregate docs, ~6) instead of thousands of individual job docs. Deck build went
  **~3,800 → ~6 reads**. ✅ This is the big win, already shipped (v152).
- **Session cache `_jobsCache`**: keyed by `region|cap`, **TTL 10 min**, but keeps **only ONE slot**
  (evicts all other keys — a deliberate v139 mobile-OOM fix). Repeat fetches of the *same* key inside
  10 min = **0 reads**.
- **`getCountFromServer`** (applicant counts, admin counts, 24h error count) = **1 read each**, cheap.
- **`getJobFull(id)`** on card open = **1 read**, only when the preview looks clipped (v210 invariant). ✅

## Reads per typical candidate session (pool live, one region, <10 min)
Auth/restore `loadProfile` (~1) + cloudSync (~1–2) → deck `fetchJobs` (~6–10) → Browse `ensureBrowsePool`
= **same `region|3000` key → cache HIT (0)** → a few card opens (`getJobFull`, 1 each) → ghost badges (low).
**One company-view open can add up to ~800 by itself** — it dominates a normal session.

## Ranked findings

### 🔴 #1 — Pool staleness → live fallback of 3,000–8,000 reads/fetch  (the surprise-bill tail risk)
If the harvest/pool-build fails and the pool ages **>36h** (`POOL_STALE_MS`), OR a region has no pool,
`fetchJobs` falls through to live queries capped at **`max`** — and callers pass **3000** (deck/Browse)
and **8000** (nationwide keyword). At even modest traffic that blows 50K/day in a handful of sessions.
This is the **most likely cause of an unexpected charge.**
- **Fix (cheap, high-value):** (a) lower the live-fallback caps (e.g. 3000→800, 8000→1500) so even a
  fallback is survivable; (b) add a pool-freshness guard/console signal (already logs HIT/MISS) surfaced
  to the admin panel; (c) confirm `build_job_pool.mjs` runs reliably right after each daily harvest.

### ✅ #2 — CORRECTION (2026-08-27): company view is ALREADY pool-cached; the ≤800 sink was mis-attributed
The original audit claimed `loadCompanyJobs` did an 800-doc query. **That was wrong** — verified by reading the
code: `loadCompanyJobs` searches via `fb.fetchJobs('', …)` (the **pool-first + 10-min session-cached** path),
filtering client-side by company. The `limit(maxDocs||800)` I flagged is actually **`fb.mineHires`** — a read of
the small `hired` collection on the **rater** path (bills only the few docs returned; self-limiting). So **E2-2
needs no build.** Residual (minor): `loadCompanyJobs` calls `fetchJobs('','3000')` then, if empty, `fetchJobs('','4000')`
— different cache keys from the deck's `regionKey|3000`, so a company-view open can trigger a ~40-read national-pool
fetch + thrash the single-slot cache. **The clean fix for that is #4 (two-slot cache), not a company-view rewrite.**

### 🟠 #3 — Ghost-report counters read matching docs (≤200 each); `countJobReports` fires on every card paint
`_paintJobReportBadge` (~11326, in `fillSlot`) → `countJobReports(jobKey)` and `countGhostReports(co)`
each `getDocs(query(ghost_reports, where …, limit(200)))`. Firestore bills docs **returned**, so today
(low community volume) this is cheap — but it scales linearly with reports-per-company and repaints per card.
- **Fix:** **session-memoize** by `jobKey`/`companyKey` (don't re-query the same one); consider
  `getCountFromServer` where the exact unique-hunter dedup isn't essential. Memoization alone kills the
  per-repaint cost.

### 🟡 #4 — Single-slot cache thrash + 10-min TTL
Only one `region|cap` key is kept, so **alternating region ↔ nationwide** (`|8000`) evicts and re-reads the
pool; any session >10 min also re-reads. Pool reads are cheap (~6–40), so this is modest — but free to fix.
- **Fix:** keep **2 slots** (region + nationwide) and raise TTL to ~30–60 min (the pool is immutable within a day).

### 🟡 #5 — Internal-jobs query `limit(300)` on every `fetchJobs` pool hit
Line ~335 reads all active `source:'internal'` jobs each fetch (so employer roles are never buried). Low now
(few employer jobs); **cache per session** or accept. Minor until the employer side grows.

### ⚪ #6 — Recruiter/admin reads (bounded, not candidate-path)
`loadJobApplicants` (≤100), `loadRecommendedCandidates` (≤50), reach-outs (≤100), admin counts (1 each),
`countJobApplicants` Promise.all over a recruiter's jobs. Bounded by that recruiter's own volume; fine.

## What only the founder can measure
- [ ] **Firebase console → Firestore → Usage tab**: the actual **reads/day** and the trend. That single number
  tells us whether we're already under 50K or not, and which day-parts spike (harvest vs. traffic). Please screenshot it.

## Effort estimate
**~1–2 focused days, not a week.** #1 (fallback caps + freshness signal) and #2 (company-view reuses the pool)
are the high-value pair and are **read-path only — no `[UI-REVIEW]`**; each ships with a `[STATE-COVERAGE]`
test (pool-hit / pool-miss / empty / offline). #3–#5 are small follow-ups. None require a rules or Worker change.

## Recommended build order for E2
1. **#1 fallback caps + pool-freshness signal** (removes the bill tail-risk) — do first.
2. **#2 company-view reuses the pool** (biggest normal saver).
3. **#3 memoize ghost counters.**
4. **#4 two-slot cache + longer TTL**, **#5 internal-jobs cache** (cleanup).
Re-measure the Usage tab after #1–#2 to confirm we're inside the free tier before layering #3–#5.
