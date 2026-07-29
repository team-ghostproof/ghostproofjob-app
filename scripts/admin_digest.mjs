// Nightly admin digest — emails the founders when employer accounts or jobs
// are waiting for review, so nobody sits in the queue unnoticed (v120,
// founder-directed: "send me an email so I don't have ppl waiting").
// Runs as a step of the nightly reverse-match workflow. Bounded reads.
// Safe no-op without FIREBASE_SERVICE_ACCOUNT; logs counts without RESEND_API_KEY.
import admin from 'firebase-admin';

const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
const key = process.env.RESEND_API_KEY;
if (!svc) { console.log('[digest] no FIREBASE_SERVICE_ACCOUNT — skip'); process.exit(0); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
const db = admin.firestore();

const recs = await db.collection('recruiters').where('isValidated', '==', false).limit(100).get();
const jobsSnap = await db.collection('jobs').where('source', '==', 'internal').limit(200).get();
const jobs = jobsSnap.docs.filter((d) => d.data().isValidated !== true);
const nr = recs.size, nj = jobs.length, total = nr + nj;
console.log('[digest] pending recruiters:', nr, '· pending jobs:', nj);

/* ===== v160: FOUNDER-ONLY trial-credit expiry countdown =====
   The Google Cloud trial credit funds the read-heavy paths (rater mining, job-pool
   builds, reverse match) that the SEO growth work leans on. When it lapses those
   costs stop being free — so this must be impossible to forget.

   Deliberately founder-only: it rides this existing digest (already scheduled, already
   authenticated, no new workflow/function/cron = zero added quota) and is NEVER shown
   to users. Escalates at 30/14/7/3/1 days, then daily once overdue.

   NOTE it is computed BEFORE the empty-queue exit below: that gate returns early on any
   day the review queue is clear, which is most days, so a reminder placed after it would
   simply never arrive. */
const TRIAL_END = Date.UTC(2026, 8, 19);           // 2026-09-19, month is 0-indexed
const MS_DAY = 86400000;
const daysLeft = Math.ceil((TRIAL_END - Date.now()) / MS_DAY);
const expiryDue = daysLeft <= 0 || [30, 14, 7, 3, 1].includes(daysLeft);
const expiryHtml = !expiryDue ? '' : (
  daysLeft > 0
    ? `<p style="padding:10px;border-left:3px solid #B55FE6;"><b>⏳ Google Cloud trial credit expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''} (2026-09-19).</b><br>`
      + `Before then, turn off or re-cost the Firestore read-heavy paths: <b>rater keyword mining</b>, <b>job-pool builds</b>, and <b>nightly reverse match</b>. `
      + `After expiry these bill at standard rates instead of drawing on the credit.</p>`
    : `<p style="padding:10px;border-left:3px solid #FF4D6A;"><b>🔴 The Google Cloud trial credit expired on 2026-09-19.</b><br>`
      + `Firestore reads are now billable. Confirm rater mining, job-pool builds and reverse match are throttled or off.</p>`
);
if (expiryDue) console.log(`[digest] trial-credit countdown: ${daysLeft} day(s) left`);

/* the expiry notice must be able to send on its own, even with an empty review queue */
if (!total && !expiryDue) { console.log('[digest] queue is empty and no expiry milestone — no email'); process.exit(0); }
if (!key) { console.log('[digest] RESEND_API_KEY not set — counts logged only, no email sent'); process.exit(0); }

const li = [];
if (nr) li.push(`<li><b>${nr}</b> employer account${nr > 1 ? 's' : ''} awaiting verification</li>`);
if (nj) li.push(`<li><b>${nj}</b> employer job${nj > 1 ? 's' : ''} awaiting review</li>`);
const html = (total
    ? `<p>Good morning — the review queue has work waiting:</p><ul>${li.join('')}</ul>`
      + `<p>Approve them in the app: <b>Settings &rarr; Admin</b> (the bell shows the same counts on sign-in).</p>`
    : `<p>Good morning — the review queue is clear.</p>`)
  + expiryHtml
  + `<p>— GhostProofJob</p>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'GhostProofJob <no-reply@ghostproofjob.com>',
    to: ['asosa@ghostproofjob.com', 'ksosa@ghostproofjob.com'],
    subject: expiryDue
      ? (daysLeft > 0
          ? `[GPJ] ⏳ Trial credit expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}${total ? ` · ${total} pending approval${total > 1 ? 's' : ''}` : ''}`
          : `[GPJ] 🔴 Trial credit EXPIRED — Firestore reads are now billable`)
      : `[GPJ] ${total} pending approval${total > 1 ? 's' : ''} in the review queue`,
    html
  })
});
console.log('[digest] resend status:', res.status);
if (!res.ok) console.log('[digest] resend body:', await res.text());
