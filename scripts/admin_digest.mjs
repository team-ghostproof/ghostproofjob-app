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

if (!total) { console.log('[digest] queue is empty — no email'); process.exit(0); }
if (!key) { console.log('[digest] RESEND_API_KEY not set — counts logged only, no email sent'); process.exit(0); }

const li = [];
if (nr) li.push(`<li><b>${nr}</b> employer account${nr > 1 ? 's' : ''} awaiting verification</li>`);
if (nj) li.push(`<li><b>${nj}</b> employer job${nj > 1 ? 's' : ''} awaiting review</li>`);
const html = `<p>Good morning — the review queue has work waiting:</p><ul>${li.join('')}</ul>` +
  `<p>Approve them in the app: <b>Settings &rarr; Admin</b> (the bell shows the same counts on sign-in).</p>` +
  `<p>— GhostProofJob</p>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'GhostProofJob <no-reply@ghostproofjob.com>',
    to: ['asosa@ghostproofjob.com', 'ksosa@ghostproofjob.com'],
    subject: `[GPJ] ${total} pending approval${total > 1 ? 's' : ''} in the review queue`,
    html
  })
});
console.log('[digest] resend status:', res.status);
if (!res.ok) console.log('[digest] resend body:', await res.text());
