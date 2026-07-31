# Phase 2 — Interactive "detect gaps → ask → improve" engine

**[UI-REVIEW] PROPOSAL — no code until approved.** Founder-directed (2026-07-30).
Phase 1 (the honest mechanical lift: #9 skills, #8 dedupe, #10 mechanics) is shipped.
Phase 2 makes the AI *smarter without lying* by turning the honesty constraint into a question.

---

## The problem Phase 2 solves

Today, when a role values a skill the résumé lacks, the AI honestly **refuses** to add it — so
tailoring changes little (the founder's "only 1–2 changes" observation). The résumé also has
achievements with no number ("Managed accounts and client relationships") that a
metrics-focused posting rewards. The AI won't invent the number, so the bullet stays weak.

**The fix is not to loosen honesty — it's to ASK the user for the truth, then write it well.**

---

## The engine: three passes, run when any AI improve/match button is pressed

All detection is **offline** (no extra AI calls). The one AI call that already happens (the
tailor) then works from *confirmed* facts.

### Pass 1 — Skill gap → "Do you have this?"
- **Detect:** posting-valued skills the résumé lacks (reuse the mined terms, already #9-cleaned).
- **Ask (in-modal):** *"This role values **Google Analytics**. Do you have hands-on experience?"*
  → **[Yes, add it]** / **[No]**
- **On Yes:** the skill is added to the skills line AND offered to the AI to weave into the most
  relevant bullet (truthfully — the user confirmed it).
- Replaces today's silent "add to skills" checkbox with an honest yes/no framing.

### Pass 2 — Unquantified achievement → "What was the number?"
- **Detect:** bullets with an achievement verb + object but **no digit**
  (managed / grew / reduced / increased / led / cut / saved …), when the posting emphasizes metrics.
- **Ask (in-modal):** *"This could land harder with a number:
  '**Managed accounts and client relationships**' — roughly how many accounts?"*
  → user types **100** (or skips)
- **On answer:** the AI rewrites *that* bullet with the real number, placed correctly
  ("Managed **100+** accounts and client relationships end-to-end").
- **Honesty:** the number comes from the user, never invented.

### Pass 3 — mechanics (already Phase 1)
Redundancy (#8), spelling/grammar (#10) — no question needed, applied automatically.

---

## Where it lives (the UI — the part [UI-REVIEW] must approve)

A new **"Make it stronger"** step inside the **existing** Match-to-Job / improve modal, between
the current content and the "Download / Use" button. Not a new separate modal — woven into the
flow the user is already in, so it reads as one intuitive process.

- Shows **at most 3 questions** (skill-have + quantify), each **optional and skippable**.
- If **no gaps** are detected, the step is **skipped entirely** — no empty questions, straight
  to download (same graceful behavior as today's "already covers the most-requested skills").
- Every question has a visible **"Skip"** — the user is never blocked.
- Answers feed the AI tailor that already runs; **no extra AI calls, no new quota.**

*(If helpful I can build a clickable visual mockup of this step before we commit to the layout.)*

---

## Honesty invariant (unchanged, made interactive)

The AI never asserts a fact the user didn't confirm. The elicitation IS the honesty mechanism:
the user supplies each skill/number, the AI supplies the craft. No fabrication is possible
because nothing is added without a "Yes" or a typed value.

---

## [STATE-COVERAGE] matrix

| State | Behavior |
|---|---|
| **Guest** | Elicitation needs a résumé; guest hits the existing sign-in gate, unchanged. |
| **Authenticated** | Full flow: detect → ask → confirmed facts → tailor. |
| **Network fail** | Confirmed answers are written to the résumé draft BEFORE the AI call, so a failed tailor never loses the user's input; honest "saved your answers, AI unavailable" message. |
| **Empty / no gaps** | The "Make it stronger" step is skipped entirely — no empty UI. |

---

## Cost / quota (free-tier check)

- Detection: **offline**, zero reads, zero AI calls.
- The confirmed answers ride the **existing** tailor call (2 OpenAI calls already accounted for).
- **No new endpoint, no new quota.** Consistent with the $0-infra rule.

---

## Proposed build order (after approval)

- **2a — Quantify-this-bullet** (highest, most concrete: turns "Managed accounts" → "Managed 100 accounts").
- **2b — Skill-have** (reframe the mined checkboxes as honest "do you have this?" + weave into a bullet).

Each ships behind the full DoD sweep (benchmark 8/8, all-project suite, runtime before/after,
[STATE-COVERAGE] tests) exactly like Phase 1.

---

## What I need from the founder to start coding

1. **Approve the UI approach** — an in-modal "Make it stronger" step with ≤3 skippable questions.
2. **Approve the two question types** (skill-have, quantify-bullet) and their honesty model.
3. **Mockup first?** — say if you want a clickable visual before I write the real UI.
4. **Build order** — 2a (quantify) first, or 2b (skills) first.
