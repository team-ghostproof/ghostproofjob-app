/**
 * GhostProofJob — Backend Worker (Cloudflare)
 * ============================================
 * Endpoints:
 *   GET  /jobs     → RETIRED (v45): aggregators off; jobs now come only from Firestore.
 *   GET  /resolve  → resolve-on-click clean URL (strips trackers, follows redirects)
 *   POST /contact  → Support email via Resend
 *   POST /welcome  → Welcome email to a new signup via Resend
 *   POST /email/*  → event-triggered lifecycle emails via Resend
 *   (cron)         → daily lifecycle emails (7-day, Core Search, Booster, Base Camp)
 *
 * Secrets needed (Settings → Variables and Secrets):
 *   RESEND_API_KEY  (required for all mail)
 *   FIREBASE_PROJECT_ID, FIREBASE_API_KEY  (required for the daily cron)
 *   ADZUNA_APP_ID, ADZUNA_APP_KEY, JOOBLE_API_KEY  → NO LONGER USED (safe to delete).
 * Resend: verify ghostproofjob.com so mail sends from support@ghostproofjob.com.
 *
 * v45 NOTE: /jobs is intentionally short-circuited to an empty payload. The frontend
 * reads jobs exclusively from the Firestore `jobs` collection (written by the JobSpy
 * harvester), so no Jooble/Adzuna API calls are made anywhere. All email routes are
 * unchanged.
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
const WELCOME_FROM   = 'GhostProofJob <noreply@ghostproofjob.com>';

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

function shell(bodyHtml, ctaText, ctaUrl, preheader){
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
      '<td style="font-size:26px;">\uD83D\uDC7B</td>' +
      '<td style="padding-left:10px;font-size:22px;font-weight:800;color:'+C.off+';">GhostProof<span style="color:'+C.mint+';">Job</span></td>' +
      '</tr></table>' +
      '<div style="font-size:11px;color:'+C.mint+';font-weight:700;letter-spacing:1px;margin-top:6px;">BUILD \u00b7 OPTIMIZE \u00b7 APPLY</div>' +
    '</td></tr>' +
    '<tr><td style="padding:14px 32px 4px;color:'+C.off+';font-size:15px;line-height:1.6;">'+bodyHtml+'</td></tr>' +
    cta +
    '<tr><td style="padding:18px 32px 26px;border-top:1px solid '+C.plum3+';">' +
      '<div style="font-size:12px;color:'+C.muted+';line-height:1.6;text-align:center;">' +
        'GhostProofJob (GPJ) \u00b7 Free until you\u2019re hired \uD83D\uDC9A<br>No ads. No data selling. Ever.<br>' +
        '<a href="https://ghostproofjob.com" style="color:'+C.cyber+';text-decoration:none;">ghostproofjob.com</a></div>' +
    '</td></tr></table>' +
    '<div style="font-size:11px;color:'+C.muted+';margin-top:14px;">You\u2019re receiving this because you created a GhostProofJob account.</div>' +
    '</td></tr></table></body></html>';
}

function cardBlock(inner, accent){
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:'+C.plum3+';border-radius:12px;border-left:4px solid '+(accent||C.mint)+';margin:10px 0;"><tr><td style="padding:14px 16px;color:'+C.off+';font-size:14px;line-height:1.55;">'+inner+'</td></tr></table>';
}

// ---- individual templates ----
const TEMPLATES = {
  welcome: (v) => ({
    subject: 'Welcome to GhostProofJob \uD83D\uDC7B',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Welcome aboard, '+esc(v.firstName||'there')+' \uD83D\uDC7B</p>' +
      '<p>You just joined GhostProofJob \u2014 the job-search platform built to be honest with you. Real jobs, flagged ghosts, no ads, no selling your data. <strong style="color:'+C.mint+';">Free until you\u2019re hired.</strong></p>' +
      '<p style="font-weight:700;color:'+C.off+';margin-top:18px;">Here\u2019s how to get your first matches in three steps:</p>' +
      cardBlock('<strong style="color:'+C.mint+';">1 \u00b7 Build</strong> \u2014 Upload your resume or import from LinkedIn. We auto-fill your profile and build a clean, ATS-safe resume. Tap <strong>\u2728 Improve with AI</strong> to sharpen your summary.', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">2 \u00b7 Optimize</strong> \u2014 Every job shows a <strong>Match %</strong> and a <strong>\uD83D\uDC7B Ghost Risk %</strong>. Use <strong>Match to Job</strong> to tailor your resume so it passes that employer\u2019s ATS scanner.', C.cyber) +
      cardBlock('<strong style="color:'+C.cyan+';">3 \u00b7 Apply</strong> \u2014 Swipe right to apply, left to skip \u2014 or use Browse for a list view. We route you straight to employers, not aggregator ad-walls.', C.cyan) +
      '<p style="margin-top:18px;">Right now you\u2019re in <strong style="color:'+C.mint+';">Hyper-Drive</strong> \u2014 unlimited applications for your first 45 days. We\u2019ll always tell you, ahead of time, when anything about your account changes.</p>' +
      '<p>Let\u2019s get you hired.</p>',
      'Start your hunt \u2192', 'https://ghostproofjob.com',
      'Your job hunt just got an unfair advantage.')
  }),

  checkin7: (v) => ({
    subject: 'Your first week + what\u2019s ahead',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">One week in, '+esc(v.firstName||'there')+' \uD83D\uDE80</p>' +
      '<p>You\u2019ve had GhostProofJob for 7 days. Here\u2019s a quick, honest map of your <strong>free access timeline</strong> so there are never any surprises \u2014 every date is based on your signup on <strong>'+esc(v.signupDate||'')+'</strong>.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">\u26A1 Now \u2192 Day 45 \u2014 Hyper-Drive</strong><br>Unlimited applications. Go as hard as you want. <span style="color:'+C.muted+';">(through '+esc(v.day45Date||'')+')</span>', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">Day 46 \u2192 Day 90 \u2014 Core Search</strong><br>Up to <strong>50 applications/day</strong> \u2014 plenty of runway to land interviews. <span style="color:'+C.muted+';">(starts '+esc(v.day46Date||'')+')</span>', C.cyber) +
      cardBlock('<strong style="color:'+C.cyan+';">Day 91+ \u2014 Base Camp</strong><br>Up to <strong>30 applications/day</strong>, free indefinitely. Your hunt never gets cut off. <span style="color:'+C.muted+';">(starts '+esc(v.day91Date||'')+')</span>', C.cyan) +
      '<p style="margin-top:16px;">A few honest notes:</p>' +
      '<ul style="margin:6px 0 14px;padding-left:20px;color:'+C.off+';font-size:14px;line-height:1.6;">' +
        '<li>If you\u2019re hired on Day 12, your whole hunt cost <strong>$0</strong>. That\u2019s the outcome we\u2019re built for.</li>' +
        '<li>Hit a wall? You can request a <strong style="color:'+C.mint+';">Booster</strong> anytime \u2014 +30 days of unlimited Hyper-Drive. We get that people need help.</li>' +
        '<li>Want unlimited forever? A one-time <strong>$12 lifetime</strong> pass or <strong>$0.99/month</strong> exists. Zero pressure \u2014 the free track is real and permanent.</li>' +
      '</ul><p>Keep going \u2014 you\u2019ve got this.</p>',
      'Open my dashboard \u2192', 'https://ghostproofjob.com',
      'A quick check-in and a clear map of your free access timeline.')
  }),

  coreSearch: (v) => ({
    subject: 'Your access shifted to Core Search \u2014 here\u2019s what changes',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Nice work, '+esc(v.firstName||'there')+' \u2014 45 days in \uD83D\uDCAA</p>' +
      '<p>Your <strong style="color:'+C.mint+';">Hyper-Drive</strong> sprint is complete. As of today you\u2019ve moved into <strong style="color:'+C.cyber+';">Core Search</strong> \u2014 and we want you to know exactly what that means.</p>' +
      cardBlock('<strong style="color:'+C.cyber+';">What changes:</strong> You now have up to <strong>50 applications per day</strong> instead of unlimited. For most hunters that\u2019s more than enough to keep strong momentum.', C.cyber) +
      cardBlock('<strong style="color:'+C.mint+';">What stays exactly the same:</strong> Every feature \u2014 matching, Ghost Risk, Match to Job, tailored resumes & cover letters, ATS-safe builder, saved jobs. All still free.', C.mint) +
      '<p style="margin-top:16px;">This tier runs through <strong>Day 90 ('+esc(v.day90Date||'')+')</strong>, after which you\u2019ll move to Base Camp (30/day) \u2014 free indefinitely.</p>' +
      '<p>If the market\u2019s being brutal and you need full throttle back, you can request a <strong style="color:'+C.mint+';">Booster</strong> (+30 days unlimited) anytime \u2014 no judgment. Or go unlimited forever for a one-time <strong>$12</strong>.</p>' +
      '<p>You\u2019re making progress. Keep it up.</p>',
      'Continue your hunt \u2192', 'https://ghostproofjob.com',
      'Day 45 is complete \u2014 here\u2019s exactly what changes (and what doesn\u2019t).')
  }),

  baseCamp: (v) => ({
    subject: 'You\u2019ve reached Base Camp \u2014 still free, still here',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Still in your corner, '+esc(v.firstName||'there')+' \uD83E\uDD1D</p>' +
      '<p>You\u2019ve completed 90 days with GhostProofJob. That\u2019s real persistence, and we respect it. As of today you\u2019re in <strong style="color:'+C.cyan+';">Base Camp</strong>.</p>' +
      cardBlock('<strong style="color:'+C.cyan+';">What this means:</strong> Up to <strong>30 applications per day</strong> \u2014 free, with no end date. Your hunt never gets shut off here.', C.cyan) +
      cardBlock('<strong style="color:'+C.mint+';">A reminder you\u2019ve earned:</strong> You can request a <strong>Booster</strong> anytime \u2014 +30 days of unlimited Hyper-Drive access. The job market is hard, and asking for a push is normal. We approve these personally.', C.mint) +
      '<p style="margin-top:16px;">If you\u2019d rather have unlimited applications permanently, a one-time <strong>$12 lifetime</strong> pass (or <strong>$0.99/month</strong>) removes all daily limits forever. Completely optional \u2014 Base Camp is yours free for as long as you need it.</p>' +
      '<p>However long this takes, we\u2019re here. Let\u2019s get you that offer.</p>',
      'Request a Booster \u2192', 'https://ghostproofjob.com',
      'Day 90 complete. Your access continues, free, indefinitely.')
  }),

  boosterReminder: (v) => ({
    subject: 'A push whenever you need it \uD83D\uDC9A',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Hey '+esc(v.firstName||'there')+' \u2014 a gentle reminder \uD83D\uDC9A</p>' +
      '<p>Searching for the right role takes time, and the current market is genuinely tough. We built something for exactly these moments.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">Your Booster</strong> \u2014 request it anytime and we\u2019ll add <strong>+30 days of full, unlimited Hyper-Drive</strong> access to your account. It goes straight to our founding team, and we approve them personally. No long forms, no judgment.', C.mint) +
      '<p style="margin-top:14px;">There\u2019s no shame in needing a boost \u2014 needing help is human, and we\u2019d rather give you room to keep going than watch a daily limit slow you down.</p>' +
      '<p>You can request it from your profile menu under <strong>\u201C\uD83D\uDC9A Request Booster\u201D</strong> whenever you\u2019re ready.</p>' +
      '<p>Rooting for you,<br>The GhostProofJob team</p>',
      'Request a Booster \u2192', 'https://ghostproofjob.com',
      'The job market is brutal \u2014 your Booster is always one tap away.')
  }),

  paidWelcome: (v) => ({
    subject: 'You\u2019re unlimited now \u2014 thank you \uD83D\uDC9A',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Thank you, '+esc(v.firstName||'there')+' \uD83D\uDC9A</p>' +
      '<p>You upgraded to <strong style="color:'+C.mint+';">'+esc(v.planName||'unlimited access')+'</strong> \u2014 and you just did two things at once.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">For you:</strong> Unlimited applications, forever. No daily limits, no tier changes, no countdowns. Just hunt.', C.mint) +
      cardBlock('<strong style="color:'+C.cyber+';">For everyone else:</strong> Your support is what keeps GhostProofJob ad-free and free-until-hired for people who can\u2019t pay right now. You\u2019re funding someone else\u2019s shot. That matters.', C.cyber) +
      '<p style="margin-top:14px;">Every feature is on, all the time. If anything ever feels off, just reply to this email \u2014 a real person reads it.</p>' +
      '<p>Now go land it.</p>',
      'Open GhostProofJob \u2192', 'https://ghostproofjob.com',
      'Your support keeps GPJ ad-free for everyone.')
  }),

  boosterApproved: (v) => ({
    subject: 'Your Booster is live \u2014 +30 days unlimited \u26A1',
    html: shell(
      '<p style="font-size:18px;font-weight:800;color:'+C.off+';margin:8px 0 4px;">Done \u2014 you\u2019re boosted, '+esc(v.firstName||'there')+' \u26A1</p>' +
      '<p>We reviewed your request personally and added <strong style="color:'+C.mint+';">+30 days of full, unlimited Hyper-Drive</strong> to your account, effective now.</p>' +
      cardBlock('<strong style="color:'+C.mint+';">Through '+esc(v.boosterEndDate||'')+':</strong> Unlimited applications, every feature wide open. No limits, no counting.', C.mint) +
      '<p style="margin-top:14px;">Use it. Apply boldly. And if you need another push when this one ends, just ask again \u2014 that\u2019s what it\u2019s here for.</p>' +
      '<p>We\u2019re genuinely pulling for you.</p><p>\u2014 The GhostProofJob team</p>',
      'Back to your hunt \u2192', 'https://ghostproofjob.com',
      'Approved. You\u2019re back in full Hyper-Drive.')
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
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
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

    /* ---------------- GET /jobs — RETIRED (v45) ----------------
       Aggregators (Jooble/Adzuna) are off. GhostProofJob serves jobs exclusively
       from the Firestore `jobs` collection written by the JobSpy harvester, so the
       frontend never calls this route. We keep it returning a clean, cached-empty
       payload so any older cached client gets [] instead of an error. */
    if (url.pathname === '/jobs' && request.method === 'GET') {
      return json({ retired: true, count: 0, results: [] }, 200, { ...cors, 'Cache-Control': 'no-store' });
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
      const text = 'Hey ' + name + ',\n\nWelcome to GhostProofJob — you just joined the hunt. \uD83D\uDC7B\n\n' +
        'Here\u2019s what you can do right now:\n' +
        '\u2022 Upload your resume and we\u2019ll make an ATS-safe version that real systems can actually read.\n' +
        '\u2022 Swipe through real jobs near you \u2014 no ghost listings, no aggregator ad-walls.\n' +
        '\u2022 Check any company\u2019s Ghost Risk before you waste time applying.\n' +
        '\u2022 Match your resume to any job in one tap.\n\n' +
        'You\u2019re on the house \u2014 GhostProofJob is free until you\u2019re hired. No ads, no data selling, ever.\n\n' +
        'Go get hired,\nThe GhostProofJob team\n\nhttps://ghostproofjob.com';
      const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;background:#120F1D;color:#F1F5F9;border-radius:16px;overflow:hidden;border:1px solid #2E2850;">' +
        '<div style="padding:28px 28px 8px;text-align:center;"><div style="font-size:34px;">\uD83D\uDC7B</div>' +
        '<div style="font-size:22px;font-weight:800;margin-top:6px;color:#00F5A0;">Welcome to GhostProofJob</div>' +
        '<div style="font-size:13px;color:#94A3B8;margin-top:4px;">Hey ' + name + ' \u2014 you just joined the hunt.</div></div>' +
        '<div style="padding:14px 28px 4px;font-size:14px;line-height:1.7;">Here\u2019s what you can do right now:' +
        '<div style="margin:14px 0;display:block;">' +
        '<div style="margin-bottom:9px;">\uD83D\uDCC4 &nbsp;Upload your resume \u2014 we\u2019ll build an ATS-safe version real systems can read.</div>' +
        '<div style="margin-bottom:9px;">\uD83C\uDCCF &nbsp;Swipe real jobs near you \u2014 no ghost listings, no ad-walls.</div>' +
        '<div style="margin-bottom:9px;">\uD83D\uDC7B &nbsp;Check a company\u2019s Ghost Risk before you apply.</div>' +
        '<div style="margin-bottom:9px;">\uD83C\uDFAF &nbsp;Match your resume to any job in one tap.</div></div></div>' +
        '<div style="padding:6px 28px 4px;font-size:13px;color:#00F5A0;font-weight:700;">Free until you\u2019re hired \uD83D\uDC9A \u2014 no ads, no data selling, ever.</div>' +
        '<div style="padding:18px 28px 28px;text-align:center;"><a href="https://ghostproofjob.com" style="display:inline-block;background:#00F5A0;color:#120F1D;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 26px;font-size:14px;">Start hunting \u2192</a></div></div>';
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: WELCOME_FROM, to: [email], subject: 'Welcome to GhostProofJob \uD83D\uDC7B', text: text, html: html }),
        });
        if (!res.ok) return json({ error: 'send_failed' }, 502, cors);
        rec.n++; welcomeHits.set(ip, rec);
        return json({ ok: true }, 200, cors);
      } catch (e) { return json({ error: 'send_failed' }, 502, cors); }
    }


    /* ===== EMAIL ROUTES (event-triggered, via Resend) =====
       Each accepts POST { email, firstName, ... } and sends one templated email.
       Same pattern as /welcome. Rate-limited per IP. */
    const EMAIL_ROUTES = {
      '/email/paid-welcome':     { tpl: 'paidWelcome',     need: ['email'] },
      '/email/booster-approved': { tpl: 'boosterApproved', need: ['email'] },
      '/email/checkin7':         { tpl: 'checkin7',        need: ['email'] },
      '/email/core-search':      { tpl: 'coreSearch',      need: ['email'] },
      '/email/base-camp':        { tpl: 'baseCamp',        need: ['email'] },
      '/email/booster-reminder': { tpl: 'boosterReminder', need: ['email'] },
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
      const vars = {
        firstName: String(body.firstName || body.first || 'there').slice(0, 60),
        signupDate: String(body.signupDate || '').slice(0, 40),
        day45Date: String(body.day45Date || '').slice(0, 40),
        day46Date: String(body.day46Date || '').slice(0, 40),
        day90Date: String(body.day90Date || '').slice(0, 40),
        day91Date: String(body.day91Date || '').slice(0, 40),
        planName: String(body.planName || '').slice(0, 40),
        boosterEndDate: String(body.boosterEndDate || '').slice(0, 40),
      };
      const built = TEMPLATES[route.tpl](vars);
      const ok = await sendEmail(env, email, built.subject, built.html);
      if (!ok) return json({ error: 'send_failed' }, 502, cors);
      rec.n++; welcomeHits.set(ip, rec);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: 'not_found' }, 404, cors);
  },

  /* ===== DAILY CRON — time-based lifecycle emails =====
     Configure in wrangler/Dashboard: a daily Cron Trigger (e.g. "0 14 * * *").
     Reads the Firestore `profiles` collection via REST, and for each user sends the
     email matching their account age (7d check-in, day-46 Core Search, day-90 booster
     reminder, day-91 Base Camp). A per-profile `emailFlags` map prevents re-sends.
     Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_API_KEY (Web API key),
     and RESEND_API_KEY. Read REFERENCE in DEPLOY.txt for setup. */
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
      body: JSON.stringify({ from: 'GhostProofJob <noreply@ghostproofjob.com>', to: [to], subject, html }),
    });
    return res.ok;
  } catch (e) { return false; }
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
  // docName is the full resource name; update only emailFlags.<flagKey>=true
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
      // signup time: prefer installDate/createdAt; fall back to a stored signupTs
      const signupMs = fval(doc, 'installDate') || fval(doc, 'createdAt') || fval(doc, 'signupTs');
      if (!signupMs) continue;
      const age = daysBetween(signupMs, now);
      const firstName = fval(doc, 'first') || fval(doc, 'firstName') || 'there';
      const D = (n) => fmtDate(signupMs + n * 86400000);
      const vars = {
        firstName, signupDate: fmtDate(signupMs),
        day45Date: D(45), day46Date: D(46), day90Date: D(90), day91Date: D(91),
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

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
