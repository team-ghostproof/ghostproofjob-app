/**
 * GhostProofJob — Backend Worker (Cloudflare)
 * ============================================
 * Endpoints:
 *   GET  /jobs     → RETIRED (v45): aggregators off; jobs now come only from Firestore.
 *   GET  /resolve  → resolve-on-click clean URL (strips trackers, follows redirects)
 *   POST /smart-match → AI résumé/summary/cover tailoring (Jett), Firebase-token gated
 *   POST /contact  → Support email via Resend
 *   POST /welcome  → Welcome email to a new signup via Resend
 *   POST /email/*  → event-triggered lifecycle emails via Resend
 *   (cron)         → daily lifecycle emails (7-day, Core Search, Booster, Base Camp)
 *
 * Secrets needed (Settings → Variables and Secrets):
 *   RESEND_API_KEY  (required for all mail)
 *   FIREBASE_PROJECT_ID, FIREBASE_API_KEY  (required for the daily cron + /smart-match token check)
 *   OPENAI_API_KEY  (required for /smart-match AI résumé tailoring)
 *   UNSUB_SECRET    (OPTIONAL — CAN-SPAM one-click unsubscribe HMAC. If you set it here,
 *                    set the SAME value on Vercel's /api/unsubscribe, or set it on NEITHER.)
 * Resend: verify ghostproofjob.com so mail sends from support@ghostproofjob.com.
 *
 * v106 NOTE: /smart-match now branches on `mode:"summary"` (2–3 sentence professional
 * summary prompt) vs the default bullet-rewrite, and feeds the app's `jobContext` into
 * the model. Every lifecycle email now carries a working one-click Unsubscribe link, and
 * the daily cron skips anyone who unsubscribed (profiles.emailUnsub === true).
 *
 * REPO MIRROR (v151): this file is a reviewable copy of the LIVE Cloudflare Worker so the
 * footer/suppression + lifecycle templates stay in sync going forward (per
 * api/notifications/README.md). Cloudflare is the source of truth — after editing here,
 * paste into the live worker.js and redeploy; it is NOT auto-deployed from this repo.
 */

const ALLOWED_ORIGINS = [
  'https://ghostproofjob.com',
  'https://www.ghostproofjob.com',
  'http://localhost:8000',
  'null',
];

const ADZUNA_COUNTRY = 'us';
const COUNTRY_WHITELIST = ['us','ca','mx','gb','au','nz','in','sg','za','de','fr','it','es','nl','be','at','pl','ch','br'];
const CACHE_SECONDS  = 300;
const SUPPORT_TO     = 'support@ghostproofjob.com';
const SUPPORT_FROM   = 'GhostProofJob Support <support@ghostproofjob.com>';
const WELCOME_FROM   = 'GhostProofJob Support <support@ghostproofjob.com>';

// >>> ADDED (v106): CAN-SPAM requires a valid physical postal address in commercial email.
//     Replace with your real mailing address or a PO box before marketing sends.
const MAILING_ADDRESS = 'GhostProofJob · 3511 Benjamin Franklin Ln, Missouri City, TX, USA';

const contactHits = new Map();
const CONTACT_LIMIT = 5;
const CONTACT_WINDOW = 3600_000;
const welcomeHits = new Map();
const WELCOME_LIMIT = 3;

/**
 * GhostProofJob — Email templates (embedded in the Worker).
 * Each function takes a vars object and returns { subject, html }.
 * Shared brand shell keeps every email consistent + email-client safe.
 */

const C = {
  plum:'#120F1D', plum2:'#1C1830', plum3:'#251F3A', plum4:'#2E2850',
  mint:'#00F5A0', cyber:'#B55FE6', cyan:'#06B6D4', muted:'#8A85A0', off:'#E8E6F0',
};

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// >>> ADDED (v106): the unsubscribe + physical-address footer block, shared by all mail.
function unsubFooter(unsubUrl){
  const link = unsubUrl
    ? '<a href="'+esc(unsubUrl)+'" style="color:'+C.muted+';text-decoration:underline;">Unsubscribe from these emails</a>'
    : 'Manage emails in the app under Settings → Notifications';
  return '<div style="font-size:11px;color:'+C.muted+';margin-top:14px;line-height:1.7;text-align:center;">' +
    'You’re receiving this because you created a GhostProofJob account.<br>' +
    link + '<br><span style="color:'+C.muted+';">'+esc(MAILING_ADDRESS)+'</span></div>';
}

function shell(bodyHtml, ctaText, ctaUrl, preheader, unsubUrl){   // >>> CHANGED (v106): added unsubUrl
  const cta = ctaText ? (
    '<tr><td align="center" style="padding:8px 32px 28px;">' +
      '<a href="'+(ctaUrl||'https://ghostproofjob.com')+'" style="display:inline-block;background:'+C.mint+';color:'+C.plum+';font-weight:800;font-size:15px;text-decoration:none;padding:14px 30px;border-radius:10px;">'+ctaText+'</a>' +
    '</td></tr>'
  ) : '';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:'+C.plum+';font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
    '<span style="display:none;max-height:0;overflow:hidden;opacity:0;">'+(preheader||'')+'</span>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:'+C.plum+';padding:24px 0;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:'+C.plum2+';border-radius:18px;overflow:hidden;border:1px solid '+C.plum3+';">' +
    '<tr><td align="center" style="padding:30px 32px 10px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font-size:26px;">👻</td>' +
      '<td style="padding-left:10px;font-size:22px;font-weight:800;color:'+C.off+';">GhostProof<span style="color:'+C.mint+';">Job</span></td>' +
      '</tr></table>' +
      '<div style="font-size:11px;color:'+C.mint+';font-weight:700;letter-spacing:1px;margin-top:6px;">BUILD · OPTIMIZE · APPLY</div>' +
    '</td></tr>' +
    '<tr><td style="padding:14px 32px 4px;color:'+C.off+';font-size:15px;line-height:1.6;">'+bodyHtml+'</td></tr>' +
    cta +
    '<tr><td style="padding:18px 32px 26px;border-top:1px solid '+C.plum3+';">' +
      '<div style="font-size:12px;color:'+C.muted+';line-height:1.6;text-align:center;">' +
        'GhostProofJob (GPJ) · Free until you’re hired 💚<br>No ads. No data selling. Ever.<br>' +
        '<a href="https://ghostproofjob.com" style="color:'+C.cyber+';text-decoration:none;">ghostproofjob.com</a></div>' +
    '</td></tr></table>' +
    unsubFooter(unsubUrl) +          // >>> CHANGED (v106): was a static "you're receiving this" line
    '</td></tr></table></body></html>';
}

function cardBlock(inner, accent){
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:'+C.plum3+';border-radius:12px;border-left:4px solid '+(accent||C.mint)+';margin:10px 0;"><tr><td style="padding:14px 16px;color:'+C.off+';font-size:14px;line-height:1.55;">'+inner+'</td></tr></table>';
}

// ---- individual templates ----  (>>> CHANGED v106: each shell() now passes v.unsubUrl)
const TEMPLATES = {
  welcome: (v) => ({
    subject: 'Welcome to GhostProofJob 👻',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Welcome aboard, '+esc(v.firstName||'there')+' 👻</p>' +
      '<p>You just joined GhostProofJob — the job-search platform built to be honest with you. Real jobs, flagged ghosts, no ads, no selling your data. <strong style="color:'+C.mint+';">Free until you’re hired.</strong></p>' +
      '<p style="font-weight:700;color:'+C.off+';margin-top:18px;">Here’s how to get your first matches in three steps:</p>' +
      cardBlock('<strong style="color:'+C.mint+';">1 · Build</strong> — Upload your resume or import from LinkedIn. We auto-fill your profile and build a clean, ATS-safe resume. Tap <strong>✨ Improve with AI</strong> to sharpen your summary.', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">2 · Optimize</strong> — Every job shows a <strong>Match %</strong> and a <strong>👻 Ghost Risk %</strong>. Use <strong>Match to Job</strong> to tailor your resume so it passes that employer’s ATS scanner.', C.cyber) +
      cardBlock('<strong style="color:'+C.cyan+';">3 · Apply</strong> — Swipe right to apply, left to skip — or use Browse for a list view. We route you straight to employers, not aggregator ad-walls.', C.cyan) +
      '<p style="margin-top:18px;">Right now you’re in <strong style="color:'+C.mint+';">Hyper-Drive</strong> — unlimited applications for your first 45 days. We’ll always tell you, ahead of time, when anything about your account changes.</p>' +
      '<p>Let’s get you hired.</p>',
      'Start your hunt →', 'https://ghostproofjob.com',
      'Your job hunt just got an unfair advantage.', v.unsubUrl)
  }),

  checkin7: (v) => ({
    subject: 'Your first week + what’s ahead',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">One week in, '+esc(v.firstName||'there')+' 🚀</p>' +
      '<p>You’ve had GhostProofJob for 7 days. Here’s a quick, honest map of your <strong>free access timeline</strong> so there are never any surprises — every date is based on your signup on <strong>'+esc(v.signupDate||'')+'</strong>.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">⚡ Now → Day 45 — Hyper-Drive</strong><br>Unlimited applications. Go as hard as you want. <span style="color:'+C.muted+';">(through '+esc(v.day45Date||'')+')</span>', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">Day 46 → Day 90 — Core Search</strong><br>Up to <strong>50 applications/day</strong> — plenty of runway to land interviews. <span style="color:'+C.muted+';">(starts '+esc(v.day46Date||'')+')</span>', C.cyber) +
      cardBlock('<strong style="color:'+C.cyan+';">Day 91+ — Base Camp</strong><br>Up to <strong>30 applications/day</strong>, free indefinitely. Your hunt never gets cut off. <span style="color:'+C.muted+';">(starts '+esc(v.day91Date||'')+')</span>', C.cyan) +
      '<p style="margin-top:16px;">A few honest notes:</p>' +
      '<ul style="margin:6px 0 14px;padding-left:20px;color:'+C.off+';font-size:14px;line-height:1.6;">' +
        '<li>If you’re hired on Day 12, your whole hunt cost <strong>$0</strong>. That’s the outcome we’re built for.</li>' +
        '<li>Hit a wall? You can request a <strong style="color:'+C.mint+';">Booster</strong> anytime — +30 days of unlimited Hyper-Drive. We get that people need help.</li>' +
        '<li>Want unlimited forever? A one-time <strong>$12 lifetime</strong> pass or <strong>$0.99/month</strong> exists. Zero pressure — the free track is real and permanent.</li>' +
      '</ul><p>Keep going — you’ve got this.</p>',
      'Open my dashboard →', 'https://ghostproofjob.com',
      'A quick check-in and a clear map of your free access timeline.', v.unsubUrl)
  }),

  coreSearch: (v) => ({
    subject: 'Your access shifted to Core Search — here’s what changes',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Nice work, '+esc(v.firstName||'there')+' — 45 days in 💪</p>' +
      '<p>Your <strong style="color:'+C.mint+';">Hyper-Drive</strong> sprint is complete. As of today you’ve moved into <strong style="color:'+C.cyber+';">Core Search</strong> — and we want you to know exactly what that means.</p>' +
      cardBlock('<strong style="color:'+C.cyber+';">What changes:</strong> You now have up to <strong>50 applications per day</strong> instead of unlimited. For most hunters that’s more than enough to keep strong momentum.', C.cyber) +
      cardBlock('<strong style="color:'+C.mint+';">What stays exactly the same:</strong> Every feature — matching, Ghost Risk, Match to Job, tailored resumes & cover letters, ATS-safe builder, saved jobs. All still free.', C.mint) +
      '<p style="margin-top:16px;">This tier runs through <strong>Day 90 ('+esc(v.day90Date||'')+')</strong>, after which you’ll move to Base Camp (30/day) — free indefinitely.</p>' +
      '<p>If the market’s being brutal and you need full throttle back, you can request a <strong style="color:'+C.mint+';">Booster</strong> (+30 days unlimited) anytime — no judgment. Or go unlimited forever for a one-time <strong>$12</strong>.</p>' +
      '<p>You’re making progress. Keep it up.</p>',
      'Continue your hunt →', 'https://ghostproofjob.com',
      'Day 45 is complete — here’s exactly what changes (and what doesn’t).', v.unsubUrl)
  }),

  baseCamp: (v) => ({
    subject: 'You’ve reached Base Camp — still free, still here',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Still in your corner, '+esc(v.firstName||'there')+' 🤝</p>' +
      '<p>You’ve completed 90 days with GhostProofJob. That’s real persistence, and we respect it. As of today you’re in <strong style="color:'+C.cyan+';">Base Camp</strong>.</p>' +
      cardBlock('<strong style="color:'+C.cyan+';">What this means:</strong> Up to <strong>30 applications per day</strong> — free, with no end date. Your hunt never gets shut off here.', C.cyan) +
      cardBlock('<strong style="color:'+C.mint+';">A reminder you’ve earned:</strong> You can request a <strong>Booster</strong> anytime — +30 days of unlimited Hyper-Drive access. The job market is hard, and asking for a push is normal. We approve these personally.', C.mint) +
      '<p style="margin-top:16px;">If you’d rather have unlimited applications permanently, a one-time <strong>$12 lifetime</strong> pass (or <strong>$0.99/month</strong>) removes all daily limits forever. Completely optional — Base Camp is yours free for as long as you need it.</p>' +
      '<p>However long this takes, we’re here. Let’s get you that offer.</p>',
      'Request a Booster →', 'https://ghostproofjob.com',
      'Day 90 complete. Your access continues, free, indefinitely.', v.unsubUrl)
  }),

  boosterReminder: (v) => ({
    subject: 'A push whenever you need it 💚',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Hey '+esc(v.firstName||'there')+' — a gentle reminder 💚</p>' +
      '<p>Searching for the right role takes time, and the current market is genuinely tough. We built something for exactly these moments.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">Your Booster</strong> — request it anytime and we’ll add <strong>+30 days of full, unlimited Hyper-Drive</strong> access to your account. It goes straight to our founding team, and we approve them personally. No long forms, no judgment.', C.mint) +
      '<p style="margin-top:14px;">There’s no shame in needing a boost — needing help is human, and we’d rather give you room to keep going than watch a daily limit slow you down.</p>' +
      '<p>You can request it from your profile menu under <strong>“💚 Request Booster”</strong> whenever you’re ready.</p>' +
      '<p>Rooting for you,<br>The GhostProofJob team</p>',
      'Request a Booster →', 'https://ghostproofjob.com',
      'The job market is brutal — your Booster is always one tap away.', v.unsubUrl)
  }),

  paidWelcome: (v) => ({
    subject: 'You’re unlimited now — thank you 💚',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Thank you, '+esc(v.firstName||'there')+' 💚</p>' +
      '<p>You upgraded to <strong style="color:'+C.mint+';">'+esc(v.planName||'unlimited access')+'</strong> — and you just did two things at once.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">For you:</strong> Unlimited applications, forever. No daily limits, no tier changes, no countdowns. Just hunt.', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">For everyone else:</strong> Your support is what keeps GhostProofJob ad-free and free-until-hired for people who can’t pay right now. You’re funding someone else’s shot. That matters.', C.cyber) +
      '<p style="margin-top:14px;">Every feature is on, all the time. If anything ever feels off, just reply to this email — a real person reads it.</p>' +
      '<p>Now go land it.</p>',
      'Open GhostProofJob →', 'https://ghostproofjob.com',
      'Your support keeps GPJ ad-free for everyone.', v.unsubUrl)
  }),

  boosterApproved: (v) => ({
    subject: 'Your Booster is live — +30 days unlimited ⚡',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Done — you’re boosted, '+esc(v.firstName||'there')+' ⚡</p>' +
      '<p>We reviewed your request personally and added <strong style="color:'+C.mint+';">+30 days of full, unlimited Hyper-Drive</strong> to your account, effective now.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">Through '+esc(v.boosterEndDate||'')+':</strong> Unlimited applications, every feature wide open. No limits, no counting.', C.mint) +
      '<p style="margin-top:14px;">Use it. Apply boldly. And if you need another push when this one ends, just ask again — that’s what it’s here for.</p>' +
      '<p>We’re genuinely pulling for you.</p><p>— The GhostProofJob team</p>',
      'Back to your hunt →', 'https://ghostproofjob.com',
      'Approved. You’re back in full Hyper-Drive.', v.unsubUrl)
  }),

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
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || 'null';
    if (request.headers.has('Origin') && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname === '/resolve' && request.method === 'GET') {
      const target = url.searchParams.get('url') || '';
      const j = (obj) => new Response(JSON.stringify(obj), { headers: { ...cors, 'Content-Type': 'application/json' } });
      if (!/^https?:\/\//i.test(target)) return j({ url: target, resolved: false });
      try {
        let current = target, resolved = false;
        for (let i = 0; i < 4; i++) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 3500);
          let resp;
          try {
            resp = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal,
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GhostProofJob/1.0)' } });
          } finally { clearTimeout(timer); }
          const loc = resp.headers.get('Location');
          if (resp.status >= 300 && resp.status < 400 && loc) { current = new URL(loc, current).toString(); resolved = true; continue; }
          break;
        }
        try {
          const fu = new URL(current);
          ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','aff','affid','ref','source'].forEach(p => fu.searchParams.delete(p));
          current = fu.toString();
        } catch (e) {}
        return j({ url: current, resolved });
      } catch (e) { return j({ url: target, resolved: false }); }
    }

    /* ---------------- GET /jobs — RETIRED (v45) ---------------- */
    if (url.pathname === '/jobs' && request.method === 'GET') {
      return json({ retired: true, count: 0, results: [] }, 200, { ...cors, 'Cache-Control': 'no-store' });
    }

    /* ---------------- POST /smart-match — AI résumé/summary/cover tailoring (Jett) ---------------- */
    if (url.pathname === '/smart-match' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      const bullets = Array.isArray(body.userResumeBullets) ? body.userResumeBullets.map(b => String(b || '')).filter(Boolean) : [];
      const kwIn = body.jobDescriptionKeywords;
      const keywords = Array.isArray(kwIn) ? kwIn.map(k => String(k || '')) : (typeof kwIn === 'string' ? [kwIn] : []);
      const mode = String(body.mode || '');                              // >>> ADDED (v106)
      const jobContext = String(body.jobContext || '').slice(0, 6000);   // >>> ADDED (v106)
      if (!bullets.length) return json({ finalResume: bullets, isAILimitHit: false, changedCount: 0 }, 200, cors);

      /* 1) verify the Firebase ID token (JWKS signature, then REST fallback). */
      const authz = request.headers.get('Authorization') || '';
      const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
      if (!idToken) return json({ finalResume: bullets, isAILimitHit: true, reason: 'no_token' }, 200, cors);
      let uid = '';
      if (env.FIREBASE_PROJECT_ID) { try { uid = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID); } catch (e) {} }
      if (!uid && env.FIREBASE_API_KEY) {
        try {
          const vr = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + env.FIREBASE_API_KEY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
          });
          const vj = await vr.json();
          uid = (vj && vj.users && vj.users[0] && vj.users[0].localId) || '';
        } catch (e) {}
      }
      if (!uid) return json({ finalResume: bullets, isAILimitHit: true, reason: 'bad_token' }, 200, cors);

      /* 2) call OpenAI — truthful tailoring only, never fabricate experience */
      if (!env.OPENAI_API_KEY) return json({ finalResume: bullets, isAILimitHit: true, reason: 'no_openai_key' }, 200, cors);

      // >>> ADDED (v106): branch the prompt on mode. `summary` returns ONE 2–3 sentence
      //     professional summary; everything else keeps the one-line-per-bullet rewrite.
      //     Both now fold in the app's rich jobContext (GOAL + FACTS/keyword-preserve list).
      let sys, usr;
      if (mode === 'summary') {
        sys = 'You are an expert resume writer composing a PROFESSIONAL SUMMARY tailored to the SPECIFIC target role given in the context (TARGET ROLE + POSTING). Using ONLY facts present in the provided text and any FACTS block, write ONE polished summary of 2 to 3 sentences (roughly 45-80 words) that POSITIONS the candidate\'s REAL experience toward that target role — lead with the capabilities, domains, and scope numbers most relevant to the posting, and mirror the posting\'s language where it is truthful for this candidate. Never invent metrics, employers, titles, dates, or experience; never claim seniority the facts do not support. No bullet points, no first-person "I", no filler like "results-driven", "proven track record", or "dynamic professional". Return ONLY valid JSON: {"finalResume": ["<the summary as a single string>"]}.';
        usr = (jobContext ? (jobContext + '\n\n') : '') +
              (keywords.length ? ('Target keywords: ' + keywords.join(', ') + '\n\n') : '') +
              'Current summary / source text to elevate:\n' + bullets.join('\n');
      } else {
        sys = 'You are an expert resume editor tailoring a résumé to the SPECIFIC target role given in the context (TARGET ROLE + POSTING). Rewrite each bullet so it FOREGROUNDS the parts of the candidate\'s REAL work most relevant to that target role and naturally mirrors the posting\'s language and duties — WITHOUT inventing anything. You MAY re-emphasize, shift which detail leads, and choose wording that connects the real work to the target role\'s responsibilities; but every metric, employer, title, date, tool, and accomplishment must come only from the original bullet — never fabricate skills, seniority, or results. Lead each bullet with a strong, varied action verb (never repeat the same opening verb twice; never stack two like "Drove ensured"). Keep each to one line. If a bullet is genuinely irrelevant to the target role, tighten it truthfully rather than forcing a false connection. Return ONLY valid JSON: {"finalResume": ["...","..."]} with EXACTLY the same number of items, in the same order as the input.';
        usr = (jobContext ? (jobContext + '\n\n') : '') +
              'Target keywords: ' + keywords.join(', ') + '\n\nResume bullets:\n' + bullets.map((b, i) => (i + 1) + '. ' + b).join('\n');
      }

      try {
        const oa = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
            temperature: mode === 'summary' ? 0.6 : 0.5,
            response_format: { type: 'json_object' },
            max_tokens: 1200
          })
        });
        if (!oa.ok) return json({ finalResume: bullets, isAILimitHit: true, reason: 'openai_' + oa.status }, 200, cors);
        const oj = await oa.json();
        const txt = (oj && oj.choices && oj.choices[0] && oj.choices[0].message && oj.choices[0].message.content) || '';
        let parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
        let out = (parsed && Array.isArray(parsed.finalResume)) ? parsed.finalResume.map(x => String(x || '').trim()).filter(Boolean) : null;
        if (!out || !out.length) return json({ finalResume: bullets, isAILimitHit: true, reason: 'bad_ai_json' }, 200, cors);
        // summary mode returns exactly one string; bullet mode keeps count aligned to input
        if (mode !== 'summary') { while (out.length < bullets.length) out.push(bullets[out.length]); }
        let changed = 0;
        for (let i = 0; i < Math.min(out.length, bullets.length); i++) { if (out[i].toLowerCase() !== String(bullets[i]).toLowerCase()) changed++; }
        return json({ finalResume: out, isAILimitHit: false, changedCount: changed }, 200, cors);
      } catch (e) {
        return json({ finalResume: bullets, isAILimitHit: true, reason: 'openai_exception' }, 200, cors);
      }
    }


    if (url.pathname === '/contact' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const now = Date.now();
      const rec = contactHits.get(ip) || { n: 0, t: now };
      if (now - rec.t > CONTACT_WINDOW) { rec.n = 0; rec.t = now; }
      if (rec.n >= CONTACT_LIMIT) return json({ error: 'rate_limited' }, 429, cors);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      const name = String(body.name || '').slice(0, 100).trim();
      const email = String(body.email || '').slice(0, 150).trim();
      const message = String(body.message || '').slice(0, 3000).trim();
      if (!message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_fields' }, 400, cors);
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: SUPPORT_FROM, to: [SUPPORT_TO], reply_to: email,
            subject: `Support: ${name || email}`, text: `From: ${name || '(no name)'} <${email}>\n\n${message}` }),
        });
        if (!res.ok) return json({ error: 'send_failed' }, 502, cors);
        rec.n++; contactHits.set(ip, rec);
        return json({ ok: true }, 200, cors);
      } catch (e) { return json({ error: 'send_failed' }, 502, cors); }
    }

    if (url.pathname === '/welcome' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const now = Date.now();
      const rec = welcomeHits.get(ip) || { n: 0, t: now };
      if (now - rec.t > CONTACT_WINDOW) { rec.n = 0; rec.t = now; }
      if (rec.n >= WELCOME_LIMIT) return json({ error: 'rate_limited' }, 429, cors);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      const email = String(body.email || '').slice(0, 150).trim();
      const first = String(body.first || '').slice(0, 60).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400, cors);
      const name = first || 'there';
      const unsubUrl = await buildUnsubUrl(env, email);   // >>> ADDED (v106)
      const text = 'Hey ' + name + ',\n\nWelcome to GhostProofJob — you just joined the hunt. 👻\n\n' +
        'Here’s what you can do right now:\n' +
        '• Upload your resume and we’ll make an ATS-safe version that real systems can actually read.\n' +
        '• Swipe through real jobs near you — no ghost listings, no aggregator ad-walls.\n' +
        '• Check any company’s Ghost Risk before you waste time applying.\n' +
        '• Match your resume to any job in one tap.\n\n' +
        'You’re on the house — GhostProofJob is free until you’re hired. No ads, no data selling, ever.\n\n' +
        'Go get hired,\nThe GhostProofJob team\n\nhttps://ghostproofjob.com\n\nUnsubscribe: ' + unsubUrl;
      const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;background:#120F1D;color:#F1F5F9;border-radius:16px;overflow:hidden;border:1px solid #2E2850;">' +
        '<div style="padding:28px 28px 8px;text-align:center;"><div style="font-size:34px;">👻</div>' +
        '<div style="font-size:22px;font-weight:800;margin-top:6px;color:#00F5A0;">Welcome to GhostProofJob</div>' +
        '<div style="font-size:13px;color:#94A3B8;margin-top:4px;">Hey ' + esc(name) + ' — you just joined the hunt.</div></div>' +
        '<div style="padding:14px 28px 4px;font-size:14px;line-height:1.7;">Here’s what you can do right now:' +
        '<div style="margin:14px 0;display:block;">' +
        '<div style="margin-bottom:9px;">📄 &nbsp;Upload your resume — we’ll build an ATS-safe version real systems can read.</div>' +
        '<div style="margin-bottom:9px;">🃏 &nbsp;Swipe real jobs near you — no ghost listings, no ad-walls.</div>' +
        '<div style="margin-bottom:9px;">👻 &nbsp;Check a company’s Ghost Risk before you apply.</div>' +
        '<div style="margin-bottom:9px;">🎯 &nbsp;Match your resume to any job in one tap.</div></div></div>' +
        '<div style="padding:6px 28px 4px;font-size:13px;color:#00F5A0;font-weight:700;">Free until you’re hired 💚 — no ads, no data selling, ever.</div>' +
        '<div style="padding:18px 28px 20px;text-align:center;"><a href="https://ghostproofjob.com" style="display:inline-block;background:#00F5A0;color:#120F1D;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 26px;font-size:14px;">Start hunting →</a></div>' +
        '<div style="padding:0 28px 22px;text-align:center;font-size:11px;color:#8A85A0;line-height:1.7;">You’re receiving this because you created a GhostProofJob account.<br><a href="' + esc(unsubUrl) + '" style="color:#8A85A0;text-decoration:underline;">Unsubscribe</a><br>' + esc(MAILING_ADDRESS) + '</div>' +   // >>> ADDED (v106)
        '</div>';
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: WELCOME_FROM, to: [email], subject: 'Welcome to GhostProofJob 👻', text: text, html: html }),
        });
        if (!res.ok) return json({ error: 'send_failed' }, 502, cors);
        rec.n++; welcomeHits.set(ip, rec);
        return json({ ok: true }, 200, cors);
      } catch (e) { return json({ error: 'send_failed' }, 502, cors); }
    }


    /* ===== EMAIL ROUTES (event-triggered, via Resend) ===== */
    const EMAIL_ROUTES = {
      '/email/paid-welcome':     { tpl: 'paidWelcome',     need: ['email'] },
      '/email/booster-approved': { tpl: 'boosterApproved', need: ['email'] },
      '/email/checkin7':         { tpl: 'checkin7',        need: ['email'] },
      '/email/core-search':      { tpl: 'coreSearch',      need: ['email'] },
      '/email/base-camp':        { tpl: 'baseCamp',        need: ['email'] },
      '/email/booster-reminder': { tpl: 'boosterReminder', need: ['email'] },
     '/email/company-invite':   { tpl: 'companyInvite',    need: ['email'] },
    };
    if (EMAIL_ROUTES[url.pathname] && request.method === 'POST') {
      const route = EMAIL_ROUTES[url.pathname];
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const now = Date.now();
      const rec = welcomeHits.get(ip) || { n: 0, t: now };
      if (now - rec.t > CONTACT_WINDOW) { rec.n = 0; rec.t = now; }
      if (rec.n >= 20) return json({ error: 'rate_limited' }, 429, cors);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
      const email = String(body.email || '').slice(0, 150).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400, cors);

      // >>> ADDED (v106): honor unsubscribe for the recurring lifecycle nudges (marketing).
      //     paid-welcome / booster-approved are transactional confirmations and always send.
      const marketing = ['checkin7','coreSearch','baseCamp','boosterReminder'];
      if (marketing.includes(route.tpl) && await isUnsubscribed(env, body.uid || email, email)) {
        return json({ ok: true, skipped: 'unsubscribed' }, 200, cors);
      }

      const vars = {
        firstName: String(body.firstName || body.first || 'there').slice(0, 60),
        signupDate: String(body.signupDate || '').slice(0, 40),
        day45Date: String(body.day45Date || '').slice(0, 40),
        day46Date: String(body.day46Date || '').slice(0, 40),
        day90Date: String(body.day90Date || '').slice(0, 40),
        day91Date: String(body.day91Date || '').slice(0, 40),
        planName: String(body.planName || '').slice(0, 40),
        boosterEndDate: String(body.boosterEndDate || '').slice(0, 40),
        company: String(body.company || '').slice(0, 80),
        role: String(body.role || 'standard').slice(0, 20),
        inviteId: String(body.inviteId || '').slice(0, 80),
        invitedByName: String(body.invitedByName || '').slice(0, 80),
        unsubUrl: await buildUnsubUrl(env, body.uid || email),   // >>> ADDED (v106): prefer uid so the profile mirror fires
      };
      const built = TEMPLATES[route.tpl](vars);
      const ok = await sendEmail(env, email, built.subject, built.html);
      if (!ok) return json({ error: 'send_failed' }, 502, cors);
      rec.n++; welcomeHits.set(ip, rec);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: 'not_found' }, 404, cors);
  },

  /* ===== DAILY CRON — time-based lifecycle emails ===== */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyEmails(env));
  },
};

/* ---- shared Resend sender ---- */
async function sendEmail(env, to, subject, html) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'GhostProofJob Support <support@ghostproofjob.com>', to: [to], subject, html }),
    });
    return res.ok;
  } catch (e) { return false; }
}

// >>> ADDED (v106): CAN-SPAM one-click unsubscribe URL (points at the repo's admin-privileged
//     Vercel endpoint, which writes email_suppress/{id} + mirrors profiles/{uid}.emailUnsub).
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function buildUnsubUrl(env, id) {
  const raw = String(id || '');
  let u = 'https://ghostproofjob.com/api/unsubscribe?u=' + encodeURIComponent(raw);
  if (env.UNSUB_SECRET) { try { u += '&t=' + (await hmacHex(env.UNSUB_SECRET, raw)).slice(0, 24); } catch (e) {} }
  return u;
}
// >>> ADDED (v106): suppression check for event-route marketing sends (one Firestore REST GET).
async function isUnsubscribed(env, id, email) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY) return false;
  const get = async (docId) => {
    try {
      const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/email_suppress/${encodeURIComponent(docId)}?key=${env.FIREBASE_API_KEY}`);
      if (!r.ok) return false;
      const d = await r.json();
      return !!(d && d.fields && d.fields.unsub && d.fields.unsub.booleanValue);
    } catch (e) { return false; }
  };
  if (id && await get(String(id))) return true;
  if (email && email !== id && await get(String(email))) return true;
  return false;
}

/* ---- date helpers ---- */
function fmtDate(ms) {
  try { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return ''; }
}
function daysBetween(aMs, bMs) { return Math.floor((bMs - aMs) / 86400000); }

/* ---- Firestore REST: list profiles (paged) ---- */
async function listProfiles(env, pageToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/profiles`;
  const url = base + `?pageSize=300&key=${env.FIREBASE_API_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
  const res = await fetch(url);
  if (!res.ok) return { docs: [], next: null };
  const data = await res.json();
  return { docs: data.documents || [], next: data.nextPageToken || null };
}

/* ---- Firestore REST: patch a profile's emailFlags (mark sent) ---- */
async function markEmailSent(env, docName, flagKey) {
  const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=emailFlags.${flagKey}&key=${env.FIREBASE_API_KEY}`;
  const body = { fields: { emailFlags: { mapValue: { fields: { [flagKey]: { booleanValue: true } } } } } };
  try { await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) {}
}

/* ---- read a string/number/bool field from a Firestore doc ---- */
function fval(doc, key) {
  const f = doc.fields && doc.fields[key];
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('timestampValue' in f) return Date.parse(f.timestampValue);
  return undefined;
}
function emailFlag(doc, key) {
  try { return !!doc.fields.emailFlags.mapValue.fields[key].booleanValue; } catch (e) { return false; }
}

/* ---- the daily run ---- */
async function runDailyEmails(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.RESEND_API_KEY) return;
  const now = Date.now();
  let pageToken = null, guard = 0;
  do {
    const { docs, next } = await listProfiles(env, pageToken);
    for (const doc of docs) {
      const email = fval(doc, 'email');
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
      if (fval(doc, 'isPaid') === true) continue;            // paid users skip lifecycle nudges
      if (fval(doc, 'emailUnsub') === true) continue;        // >>> ADDED (v106): CAN-SPAM opt-out (free — the doc is already loaded)
      // signup time: prefer installDate/createdAt; fall back to a stored signupTs
      const signupMs = fval(doc, 'installDate') || fval(doc, 'createdAt') || fval(doc, 'signupTs');
      if (!signupMs) continue;
      const age = daysBetween(signupMs, now);
      const firstName = fval(doc, 'first') || fval(doc, 'firstName') || 'there';
      const uid = String(doc.name || '').split('/').pop();   // >>> ADDED (v106): uid for the unsubscribe mirror
      const D = (n) => fmtDate(signupMs + n * 86400000);
      const vars = {
        firstName, signupDate: fmtDate(signupMs),
        day45Date: D(45), day46Date: D(46), day90Date: D(90), day91Date: D(91),
        unsubUrl: await buildUnsubUrl(env, uid),             // >>> ADDED (v106)
      };
      // pick the one email due today (each sent once via emailFlags)
      let tpl = null, flag = null;
      if (age >= 7 && age < 45 && !emailFlag(doc, 'checkin7')) { tpl = 'checkin7'; flag = 'checkin7'; }
      else if (age >= 46 && !emailFlag(doc, 'coreSearch')) { tpl = 'coreSearch'; flag = 'coreSearch'; }
      else if (age >= 90 && !emailFlag(doc, 'boosterReminder')) { tpl = 'boosterReminder'; flag = 'boosterReminder'; }
      else if (age >= 91 && !emailFlag(doc, 'baseCamp')) { tpl = 'baseCamp'; flag = 'baseCamp'; }
      if (!tpl) continue;
      const built = TEMPLATES[tpl](vars);
      const ok = await sendEmail(env, email, built.subject, built.html);
      if (ok) await markEmailSent(env, doc.name, flag);
    }
    pageToken = next; guard++;
  } while (pageToken && guard < 50);
}

/* ---- Firebase ID token verification via Google's public JWKS (RS256) ---- */
function _b64urlToBytes(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function _b64urlToStr(str) { return new TextDecoder().decode(_b64urlToBytes(str)); }
let _jwksCache = null, _jwksAt = 0;
async function _securetokenJWKS() {
  const now = Date.now();
  if (_jwksCache && (now - _jwksAt) < 3600000) return _jwksCache;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const j = await r.json();
  _jwksCache = (j && j.keys) || []; _jwksAt = now;
  return _jwksCache;
}
async function verifyFirebaseToken(idToken, projectId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return '';
  let header, payload;
  try { header = JSON.parse(_b64urlToStr(parts[0])); payload = JSON.parse(_b64urlToStr(parts[1])); }
  catch (e) { return ''; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.aud !== projectId) return '';
  if (payload.iss !== ('https://securetoken.google.com/' + projectId)) return '';
  if (!payload.exp || payload.exp <= now) return '';
  if (payload.iat && payload.iat > now + 300) return '';
  const keys = await _securetokenJWKS();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return '';
  try {
    const key = await crypto.subtle.importKey('jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      _b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return '';
  } catch (e) { return ''; }
  return payload.user_id || payload.sub || 'ok';
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
