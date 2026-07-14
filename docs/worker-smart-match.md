# Worker `/smart-match` — why AI "never touched ChatGPT," and the exact fix

The Cloudflare Worker source is **not** in this repo (it lives in the Cloudflare
dashboard / a separate deploy). This doc records what the app now sends, what the
Worker returns, the root cause of the founder's "Improve with Jett never hit
ChatGPT" report, and the precise Worker-side change needed.

## What the app sends (v105, `fb.smartMatch`)

`POST https://ghostproofjob-worker.ghostproofjob.workers.dev/smart-match`
Headers: `Authorization: Bearer <Firebase ID token>`, `Content-Type: application/json`
Body:
```json
{
  "userResumeBullets": ["..."],
  "jobDescriptionKeywords": "…",
  "forceRewrite": true,
  "avoid": "…",
  "jobContext": "GOAL: …",
  "mode": "summary" | "duties" | ""
}
```
`mode` is **new in v105** — before v105 the client never sent it, so a Worker branch
on `mode` could not have worked even if it existed. (Client bug, now fixed.)

## What the Worker returns (observed by probing the live endpoint)

With **no / invalid token** the Worker answers **HTTP 200** and:
```json
{ "finalResume": ["<echoes the input unchanged>"], "isAILimitHit": true, "reason": "no_token" }
```
i.e. it does **not** call OpenAI; it echoes the input back. That is the whole bug:

- The founder ran "Improve with Jett" → the Worker returned the input verbatim →
  the app saw text that wasn't "materially different" → silently fell back to the
  local smart-template rewrite → **OpenAI logged no request**. It looked like the AI
  "never ran" because, for that request, it genuinely didn't.

If an authenticated founder still sees `reason:"no_token"` (or any token/auth
reason), then **JWKS token verification in the Worker is rejecting valid Firebase
tokens** — that is the server-side half of the bug and the thing to fix first.

## App-side fixes already shipped (v105, in this repo)

1. **Forward `mode`** in the POST body (`index.html`, `fb.smartMatch`).
2. **Read the Worker's own verdict** (`_workerNoAI(res)`): if `isAILimitHit` is
   truthy, map `reason` → `unavailable` (token/auth), `throttle` (rate/quota), or
   `cap`. Both `improveSummary` and `improveKeyDuties` now use this so the user sees
   an honest banner instead of a silent local fallback (transparency requirement).

## Worker-side changes needed (do these in the Cloudflare dashboard)

1. **Fix / confirm token verification.** For a signed-in user the Worker must
   verify the Firebase ID token via Google JWKS and proceed to OpenAI. If it is
   returning `reason:"no_token"` for authenticated calls, the verification is
   failing — check the JWKS fetch, the audience/issuer (`ghostproofjob-app`), and
   clock skew. Until this passes, **no live AI runs for anyone**, and the app will
   (correctly, now) show the "Live AI isn't reachable" banner.

2. **Branch on `mode` for the summary prompt.** The default prompt is a
   bullet-rewrite that forces one line per input item. A professional *summary* needs
   2–3 sentences. Pseudocode:
   ```js
   const system = body.mode === 'summary'
     ? SUMMARY_SYSTEM_PROMPT   // "Return ONE 2–3 sentence professional summary (45–80 words). Synthesize the facts in jobContext. No bullet formatting."
     : BULLET_REWRITE_SYSTEM_PROMPT;
   ```
   Without this branch, summaries come back as a single terse line and lose to the
   local facts-floor (`_gpjSummaryQuality`), which is why the summary felt untouched.

3. **Return a precise `reason`** so the app can be honest: use `rate_limited` /
   `quota` for throttles, a cap-type reason for monthly caps, and reserve token/auth
   reasons for verification failures. The app already maps these.

## How the app degrades until the Worker is fixed

Every AI button falls back to the local smart-template rewrite **and shows the
transparency banner** naming smart templates + when live AI returns. Nothing is
broken or dishonest in the meantime — but live AI only actually runs once the
Worker's token verification passes and (for summaries) the `mode` branch exists.
