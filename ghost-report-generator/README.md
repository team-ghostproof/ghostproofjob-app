# Ghost-Data Content Engine (Sprint 4 — growth automation)

Auto-**drafts** a week of social posts from GhostProofJob's ghost-job data so the
founder posts on a low-effort weekly rhythm. **It never posts anything** — the
output is text for human review.

## What it does
- Reads two sources (via `getWeeklyGhostData`):
  1. **`jobs` collection (LIVE today)** — stale-posting rates by city (a posting
     ≥30 days old is a classic ghost-job signal). Factual, no dependency.
  2. **`ghost_reports` collection (needs F-GHOST — NOT built yet)** — community
     flag counts per company. Until F-GHOST aggregates reports into Firestore
     this is empty and the community-report posts are simply omitted; the
     ghost-**job** stat posts still ship.
- Drafts 6 post types + optional community posts: LinkedIn, Reddit, TikTok, X,
  weekly tip, green-flag (a positive shout-out to responsive employers).

## Defamation guardrails (unit-tested — `npm run test:growth`)
- **MIN_REPORTS = 3**: a company is **never named** from fewer than 3 independent
  reports. Below that it is omitted (and only surfaced to the founder in a
  held-back list, never in a post).
- **Community-reported framing only**: "N hunters flagged slow/no responses at
  X (community-reported)" — never "X ghosts applicants" or any verdict.
- **No fabricated numbers**: every figure traces to the passed-in data.
- **Positive balance**: a green-flag post highlights responsive employers.

## Run it
```bash
npm run content:sample     # offline: uses fixtures/sample-week.json (no creds)
npm run content:weekly     # LIVE: needs FIREBASE_SERVICE_ACCOUNT (same secret as the harvester)
```
Both write `content-packs/<weekOf>.md` + `.json` (gitignored — regenerated each run).
**Review, then post manually.** Nothing is published by this tool.

## Weekly automation (opt-in)
`.github/workflows/weekly_content.yml` runs it every Monday and uploads the pack
as a downloadable **artifact** for review. It requires the `FIREBASE_SERVICE_ACCOUNT`
secret (already used by the harvester) and **does not post** to any platform.

## Dependency note
Live company-report posts need **F-GHOST** (Firestore report aggregation), which
is not built yet — reports currently live only in each device's `localStorage`.
Until then the engine produces the ghost-**job** stat + tip + green-flag posts
from live jobs data. See `docs/master-audit-checklist.md` (F-GHOST).
