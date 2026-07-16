# Worker — add the `/email/company-invite` route (v112)

The company **Team** feature (invite a colleague → they get an email → they create an
account and join your company with a role) needs one new Worker route. Everything
else for it is already deployed in the app + Firestore rules.

**If you skip this**, invites still work — the invite is created and the seat is held,
but no email goes out, so you'd have to send the link yourself. Nothing breaks.

---

## 1. Add the template

In your Worker, inside the `TEMPLATES` object (next to `welcome`, `boosterApproved`, …),
add:

```js
  companyInvite: (v) => ({
    subject: (v.company ? (v.company + ' invited you') : 'You’ve been invited') + ' to GhostProofJob 🏢',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">You’ve been invited 🏢</p>' +
      '<p>' + (v.invitedByName ? esc(v.invitedByName) : 'A colleague') + ' invited you to join <strong style="color:'+C.mint+';">' + esc(v.company || 'their company') + '</strong> on GhostProofJob — the job platform built to be honest with candidates.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">Your access: ' + (v.role === 'admin' ? 'Company admin' : 'Team member') + '</strong><br>' +
        (v.role === 'admin'
          ? 'You can edit the company profile, post roles, review applicants and reach out to candidates.'
          : 'You can post roles, review applicants and reach out to candidates.'), C.mint) +
      '<p style="margin-top:14px;">Click below to create your account. <strong>This invite only works for this email address.</strong></p>',
      'Join ' + esc(v.company || 'the team') + ' →',
      'https://ghostproofjob.com/?invite=' + encodeURIComponent(v.inviteId || ''),
      'You’ve been invited to join ' + (v.company || 'a company') + ' on GhostProofJob.',
      v.unsubUrl)
  }),
```

## 2. Register the route

In the `EMAIL_ROUTES` map, add one line:

```js
      '/email/company-invite':   { tpl: 'companyInvite',    need: ['email'] },
```

## 3. Pass the extra fields through

In the `EMAIL_ROUTES` handler, the `vars` object is built from the POST body. Add these
three lines alongside the existing `firstName` / `planName` / … lines:

```js
        company: String(body.company || '').slice(0, 80),
        role: String(body.role || 'standard').slice(0, 20),
        inviteId: String(body.inviteId || '').slice(0, 80),
        invitedByName: String(body.invitedByName || '').slice(0, 80),
```

Then **Deploy**.

---

## What the app sends

`POST https://ghostproofjob-worker.ghostproofjob.workers.dev/email/company-invite`

```json
{
  "email": "colleague@acme.com",
  "company": "Acme Talent Partners",
  "role": "standard",
  "inviteId": "<firestore company_invites doc id>",
  "invitedByName": "Aaliyah Sosa"
}
```

## Security note (why the link is safe to email)

The invite id in the link is only *half* the gate. Redeeming it also requires the
person to be **signed in with the exact invited email address** — enforced in
`firestore.rules` (`company_invites` update + the `recruiters` create rule's
`grantMatchesInvite`). So a forwarded or leaked link cannot be used by anyone else,
and it can never grant more than the role the admin chose (never `owner`, never
site-admin).

This route is a **marketing/transactional** send to an address a verified employer
supplied, and it inherits the standard unsubscribe footer + mailing address from
`shell()` like every other email.
