# GhostProofJob — Release Policy & Rollback

**Owner:** Aaliyah (founder) · **Established:** v143, 2026-07-21

The rule this exists to enforce: **there must always be one commit you can redeploy
that is known-good, verified by machine, not by anyone's memory.**

---

## The two branches

| Branch | What it means | Who moves it |
|---|---|---|
| `main` | Work in progress. May be broken at any moment. | Anyone |
| `stable` | **Every gate passed.** Safe to deploy right now, unattended. | CI only — never by hand |

`stable` is advanced automatically by `.github/workflows/verify.yml`, and **only** after
the benchmark, backend suites, Firestore rules, and the full Playwright run are all green
on that exact commit. There is no way to put an unverified commit on `stable`.

---

## The gate (`npm run verify`, and CI on every push)

| Gate | Command | Catches |
|---|---|---|
| §4 benchmark | `npm run benchmark` | Boot crashes/TDZ, div imbalance, mirror drift, duplicate ids, dead `on*` handlers, version-marker drift |
| Backend | `test:match` `test:growth` `test:email` `test:apply` `test:seo` `test:billing` | Scorer, content, email, apply, SEO, Stripe logic |
| Rules | `test:rules` | Firestore security regressions (needs Java — CI always has it) |
| E2E | Playwright chromium, `--workers=2` | Every `[STATE-COVERAGE]` flow |

`node --check` is **not** sufficient and never was — it does not catch the TDZ boot crashes
that have taken this app down before. Benchmark step [2] boots the whole inline script in a
mocked browser and requires `RAN TO COMPLETION`.

> **Playwright flake note:** the suite flakes under parallel load on a saturated machine —
> failures rotate run-to-run and pass 3/3 in isolation. `--workers=2` is the documented
> stable setting. Do not raise it to speed CI up.

---

## Change classes

### Bug fix — auto-approved
A change that makes existing, already-agreed behaviour correct. No new surface, no new
user-visible capability. Ships once the gate is green.

### Feature / behaviour change — requires founder approval
Anything that adds surface, changes a flow, alters layout or stacking, or changes how data
is stored or written. Before pushing, I owe you:

1. **What it changes** — in plain language, including anything that will look different.
2. **Full impact audit** — which existing features touch this code, and why each one still works.
3. **The `[STATE-COVERAGE]` matrix** — guest / authenticated / failed-network / empty-data.
4. **What could go wrong** — the honest failure modes, not a reassurance.
5. **The rollback** — the exact command to undo it.

Then I ask, and wait. **`[UI-REVIEW]` still applies on top of this** (CLAUDE.md §3.2): any
layout, view, overlay, z-index, or visual change is stop-and-approve *before code is written*,
not at push time.

### Data-write changes — treated as features, always
Any change to how `lists`, profiles, or community data are written is a feature-class change
even when it is fixing a bug. This class has caused every catastrophic incident so far.

---

## Rollback — three levels

**1. Redeploy the last verified build (fastest, no git needed)**
Download `index.html`, `GhostProofJob.html`, and `sw.js` from the `stable` branch on GitHub
and drag-upload them. *(Drag-and-drop only — pasting truncates the ~1.1 MB file.)*

**2. Point main back at stable**
```bash
git fetch origin
git checkout main
git reset --hard origin/stable
git push --force-with-lease origin main
```

**3. Undo one specific commit, keep everything after it**
```bash
git revert <commit-sha>     # creates a new commit that undoes it; history preserved
git push origin main
```

Prefer (3) — it is reversible and leaves an audit trail. Use (2) only when several
commits are implicated and you need main clean immediately.

---

## Founder setup (one-time, on GitHub — I cannot do these for you)

1. **Branch protection on `stable`** — Settings → Branches → add rule for `stable`:
   restrict who can push (CI only), and do **not** allow force pushes from people.
2. **Branch protection on `main`** — require the `verify` status checks to pass before merge.
3. **Enable Firestore point-in-time recovery** — 7-day window. This is what would have made
   the lost job history recoverable. It is not a code change and only you can enable it.

---

## Why the benchmark is not "the last version that worked"

I walked **every version in the repo, v20 through v142**, checking the two ingredients of the
data loss. The result:

- The sign-out wipe (`gpjWipeLocalUserData`) has existed since **v20** — the earliest build in
  the repo.
- `cloudSync` has written `lists` as a whole-document overwrite since **v20**.
- **No version before v143 flushed to the cloud before wiping local data.** Not one.

So there is **no earlier stable version to roll back to.** The vulnerability was latent for
the entire life of the app; what varied was luck. Before v137, `cloudSync` wrote often enough
that the cloud usually held a recent copy, so sign-out wiped local and the cloud restored it.
v137's gate blocked writes until a cloud read completed, and while that gate could stick shut
(until v140) the cloud never received a copy — so sign-out destroyed the only one. Latent
became catastrophic.

**v143 is the first genuinely safe build, and is therefore the benchmark.** Rolling back to any
earlier version would *reinstate* the data-loss bug, not escape it.
