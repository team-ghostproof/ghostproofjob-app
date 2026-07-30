# GPJ — AI action limits & credit accounting

**Verified 2026-07-30** by reading every counter + a runtime check. Answers the founder's
twice-asked questions (U33 "why 2 credits?", U56 "does the cover letter have a limit?").

Two different things are easy to conflate:
- **Daily/hourly limit** = how many AI *actions* the *user* is allowed. Counts actions, not API calls.
- **OpenAI API calls** = backend cost to the founder's OpenAI account. One action can be several calls.

---

## The numbers (from code)

| Constant | Value | Meaning |
|---|---|---|
| `getMatchCap()` | Hyper-Drive (day <46): **∞/day** · Core Search (46–90): **50/day** · Base Camp (91+): **30/day** · paid/admin: ∞ | daily AI-action cap |
| `AI_HOURLY_CAP` | **10 / hour** (per feature, every tier except paid/admin) | throttle so one user can't drain the shared budget |
| `MAX_CL_REVS` | **3** | "Tailor it more" rewrites **per job** on a cover letter |
| `AI_IMPROVE_MONTHLY` | **2 / section / month** (free tier) | Jett "Improve with AI" on summary & duties |
| applications | **unlimited, always** | manual apply only; nothing to ration |

---

## Per action: daily cost vs API calls

| Action | Daily-limit cost | OpenAI API calls | Notes |
|---|---|---|---|
| **Open Match-to-Job** (the modal) | **1** daily + 1 hourly (`bumpMatch` + `bumpAiHour('match')` at index.html:9099) | 0 | the charge is at open |
| **Download tailored résumé** (`applyMatch2Job`) | 0 additional | **2** — bullets **+** summary (two different prompts) | runtime-confirmed: 2 calls, no extra daily bump |
| **Cover Letter** (generate) | **1** daily (`bumpMatch` at index.html:14565) | 1 | see shared-counter note below |
| **"Tailor it more"** (cover) | counts toward `MAX_CL_REVS=3` per job | 1 each | capped at 3 per job |
| **Jett / Improve** (summary or duties) | monthly (`AI_IMPROVE_MONTHLY=2`/section) | 1 | separate from the daily match cap |
| **Rate résumé** | 0 (no AI call in the base path) | 0 | scores locally against a mined corpus |

### Direct answers
- **"Why 2 credits for one Match-to-Job?"** → those are **2 backend API calls** (bullets + summary — it does two jobs), **not** 2 against the user's daily allowance. The daily limit counts it as **1** action.
- **"If they only tailor OR only cover letter — still 2 credits?"** → **Cover-letter-only = 1 API call, 1 daily action.** Tailor-only = **2** API calls but still **1** daily action. So no — only Match-to-Job makes two calls.
- **"Does the cover letter have a limit?"** → Yes: it shares the **daily** AI-action cap (∞ / 50 / 30 by lifecycle stage), plus **3 "tailor it more" rewrites per job**. No separate weekly/monthly cap.

---

## Resolved (founder decision, 2026-07-30): SEPARATE per feature ✓

Previously the two clipboard cover-letter paths (index.html:14567, 14588) gated on
`matchAllowed()` / `bumpMatch()`, so Match-to-Job **and** a cover letter drained one shared
daily pool. The founder chose **separate per feature**. Now:

- Match-to-Job → `matchKey()` = `gpj_match_<date>` via `bumpMatch()` / `matchAllowed()`
- Cover Letter → `clKey()` = `gpj_cl_<date>` via new `bumpCl()` / `clAllowed()`

Same per-stage cap value (`getMatchCap()`), **independent counters** — runtime-verified: a
cover letter no longer consumes any of the Match-to-Job allowance and vice versa.
