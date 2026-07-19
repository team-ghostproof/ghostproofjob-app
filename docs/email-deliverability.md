# Email deliverability — no-reply, Reply-To, DMARC (v132)

Resend's **Insights** flagged two things on outbound mail, plus we found test
runs were emailing fixture addresses. All three are handled below.

## 1. "Don't use no-reply" + replies must reach you — DONE in the repo

Every email sent by the **repo** functions now uses a monitored From and a
Reply-To that lands in your inbox:

| File | From | Reply-To |
|---|---|---|
| `api/apply-email.js` (post-apply email) | `GhostProofJob <support@ghostproofjob.com>` | `support@ghostproofjob.com` |
| `api/notifications/sendAutomatedEmail.js` (lifecycle/cron) | `support@…` (env `EMAIL_FROM` overrides) | `support@…` (env `EMAIL_REPLY_TO` overrides) |

So when a candidate or employer **replies** to any of these, it goes to
**support@ghostproofjob.com** — you can answer directly.

### FOUNDER ACTION — the Cloudflare Worker (not in the repo)

The **welcome**, **contact**, and **company-invite** emails are sent by the
Cloudflare Worker, which still uses `noreply@ghostproofjob.com`. Update the
Worker's Resend send payload the same way — for each `fetch('https://api.resend.com/emails', …)`:

```js
body: JSON.stringify({
  from: 'GhostProofJob <support@ghostproofjob.com>',   // was noreply@
  reply_to: 'support@ghostproofjob.com',               // add this line
  to: [ /* … */ ],
  subject, html,
})
```

That clears the "no-reply" Insight for the invite/welcome emails you saw.

## 2. DMARC — FOUNDER ACTION (DNS, ~2 minutes)

Resend flagged **"No DMARC record found."** Google/Yahoo/Microsoft require one
for bulk senders. Add **one TXT record** at your DNS host (wherever
ghostproofjob.com's DNS lives — likely Vercel or your registrar):

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `_dmarc` |
| Value | `v=DMARC1; p=none; rua=mailto:support@ghostproofjob.com; fo=1` |

- `p=none` = **monitor only** (safe start — nothing gets blocked; you just get
  reports). After a week of clean reports, tighten to `p=quarantine` then
  `p=reject`.
- `rua=mailto:…` = where aggregate reports are sent.

Also confirm **SPF** and **DKIM** are green in the Resend dashboard
(Domains → ghostproofjob.com). Resend gives you those records; DMARC is the
one it doesn't auto-add.

## 3. The fixture emails (newhire@acme.com / sam@acme.com) — DONE

A Playwright test drove the real `inviteTeammate()` action, which fires a
`fetch()` to the Worker's `/email/company-invite` — sending a **real** invite
email to the test fixtures on every CI + local run (35+ suppressed sends).
Firestore was never polluted (the DB calls are stubbed), but the Worker fetch
wasn't. **Fixed:** a file-level guard in `tests/state-coverage.spec.js` now
blocks **every** Worker call at the network layer, so no test can email again.
They were all "Suppressed" (the fixture addresses bounce), so no real person was
ever spammed — but it was hurting your Resend reputation and is now stopped.
