# Email opt-out / suppression (Sprint 5 — CAN-SPAM)

Two systems send automated email for GhostProofJob:

1. **This repo** — `api/notifications/sendAutomatedEmail.js` (Vercel function).
   ✅ Fully wired for opt-out: a global `emailUnsub` flag beats every per-type
   preference, and **every** sent email gets an unsubscribe footer.
2. **The Cloudflare Worker** — `/welcome`, `/email/*`, and the daily cron.
   ⚠️ Lives only in Cloudflare (not in this repo). It must be updated to honor
   the same suppression + carry the same footer. See **"Worker changes"** below.

## The suppression gate (single source of truth)
`/api/unsubscribe` (one-click, in this repo) writes:
- `email_suppress/{id}` = `{ unsub:true, reason, ts }` — the canonical gate.
- `profiles/{id}.emailUnsub = true` — when `id` is a profile uid (so the
  candidate's own Settings reflect it and `sendAutomatedEmail` honors it).

**Before sending, both systems must check suppression.** This repo already does
(`isSuppressed(user)`). The Worker must too.

## Worker changes (paste into the live worker.js, then redeploy)
1. **Footer on every template** — before sending any email `html`, append:
   ```js
   const SITE = 'https://ghostproofjob.com';
   function unsubFooter(idOrEmail){
     const u = SITE + '/api/unsubscribe?u=' + encodeURIComponent(idOrEmail);
     return '<hr style="border:none;border-top:1px solid #e5e0ee;margin:28px 0 12px"/>'
       + '<p style="font:12px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#8a85a0;margin:0">'
       + 'You’re getting this from GhostProofJob. <a href="'+u+'" style="color:#8a85a0">Unsubscribe</a> anytime.</p>';
   }
   // html = shell(...) + unsubFooter(recipientUidOrEmail)
   ```
2. **Suppression check** — before the cron / `/email/*` / `/welcome` send:
   ```js
   // Firestore REST or admin: skip if suppressed
   const sup = await getDoc('email_suppress/' + id);           // {unsub:true} → skip
   const prof = await getDoc('profiles/' + uid);               // .emailUnsub === true → skip
   if ((sup && sup.unsub) || (prof && prof.emailUnsub)) return; // do not send
   ```
3. Redeploy the Worker in Cloudflare (it is **not** auto-deployed).

## Founder actions
- Set the Vercel env `FIREBASE_SERVICE_ACCOUNT` (same value the harvester uses)
  so `/api/unsubscribe` can write. Optionally set `UNSUB_SECRET` to sign links.
- Paste the two Worker snippets above into the live `worker.js` and redeploy.
- (Recommended) commit the live `worker.js` into `worker/` so it's reviewable
  and the footer/suppression stay in sync going forward.

## Note: the filename bug this fixed
`sendAutomatedEmail.js` was committed as `api/notifications/notifications`
(no `.js`), so Vercel never routed it as a function — it was dead. Renamed here.
