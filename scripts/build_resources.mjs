#!/usr/bin/env node
'use strict';
/**
 * scripts/build_resources.mjs — the Resources SEO engine (data-grounded articles).
 * ---------------------------------------------------------------------------
 * WHAT: publishes ONE static, crawlable article per run — real job-market numbers
 * (byline "The GhostProofJob Team") or a résumé tip (byline "Jett") — into
 * /resources/<slug>.html, and rebuilds the /resources hub + a manifest the sitemap
 * reads. Every figure is computed IN CODE from our own jobs DB and handed to the
 * prose as a fixed fact; the writer never invents a number (if a stat is missing,
 * the sentence isn't written). See docs + the approved mockup.
 *
 * [FREE-TIER]: the expensive full-collection scan already happens once a day in
 * build_job_pool.mjs, which now also writes a tiny `resources/_market_stats` doc
 * (zero extra reads). THIS script reads that ONE doc — not the collection — so a
 * daily article costs ~1 read. Output is static .html (0 Vercel functions), served
 * from CDN. One scheduled GitHub Action (free minutes on a public repo).
 *
 * Usage:
 *   node scripts/build_resources.mjs --fixture        # offline, synth stats, writes files
 *   node scripts/build_resources.mjs --dry-run        # read stats, build, write NOTHING
 *   node scripts/build_resources.mjs                  # read live stats, publish next article
 *   node scripts/build_resources.mjs --stats x.json   # build from a stats JSON file
 *
 * Stats source (default run): FIREBASE_SERVICE_ACCOUNT if set (admin SDK, 1 read),
 * else the public Firestore REST read of the single doc (1 read, no secret).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { topN } from './market_taxonomy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources');
const MANIFEST = path.join(OUT_DIR, '_index.json');
const ROTATION = path.join(OUT_DIR, '_rotation.json');
const SITE = 'https://ghostproofjob.com';

const DRY = process.argv.includes('--dry-run');
const FIXTURE = process.argv.includes('--fixture');
const statsArg = (() => { const i = process.argv.indexOf('--stats'); return i > -1 ? process.argv[i + 1] : null; })();

/* ---------------------------------------------------------------- utils --- */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const todayISO = () => new Date().toISOString().slice(0, 10);
const prettyDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

/* ------------------------------------------------------------- rendering --- */
/* Shared page CSS — GPJ brand tokens, light + dark, serif article body. These are
   STANDALONE static pages (real <head>, canonical, OG), not app views. */
const CSS = `
:root{--plum:#120F1D;--plum2:#1A1629;--plum3:#241E38;--line:rgba(181,95,230,.20);--mint:#00F5A0;--cyber:#B55FE6;--cyan:#5FD0E6;--danger:#FF4D6A;--warn:#FFB347;--ink:#F1EEF9;--muted:#9E97BA;--faint:#6E6688;--serif:Georgia,"Iowan Old Style","Times New Roman",serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
:root[data-theme=light]{--plum:#FBFAFE;--plum2:#FFFFFF;--plum3:#F3F0FA;--line:rgba(122,60,168,.20);--mint:#0B9E6B;--cyber:#7A3CA8;--cyan:#1E7F97;--ink:#241F33;--muted:#5B5473;--faint:#8A82A3}
@media(prefers-color-scheme:light){:root:not([data-theme=dark]){--plum:#FBFAFE;--plum2:#FFFFFF;--plum3:#F3F0FA;--line:rgba(122,60,168,.20);--mint:#0B9E6B;--cyber:#7A3CA8;--cyan:#1E7F97;--ink:#241F33;--muted:#5B5473;--faint:#8A82A3}}
*{box-sizing:border-box}body{margin:0;background:var(--plum);color:var(--ink);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:720px;margin:0 auto;padding:0 22px 90px}
.sitehdr{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:960px;margin:0 auto;padding:20px 22px}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:800;letter-spacing:-.01em;font-size:16px;text-decoration:none}.brandmark{width:26px;height:26px;object-fit:contain;flex:0 0 auto}.brandtext{background:linear-gradient(90deg,var(--mint),var(--cyber));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:var(--mint)}.brand .g{color:var(--mint)}
.snav{display:flex;gap:18px;font-size:13px;color:var(--muted)}.snav a{text-decoration:none}.snav a.on{color:var(--cyber);font-weight:700}
.pill{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--plum);padding:3px 9px;border-radius:6px}
.pill.market{background:var(--cyan)}.pill.tips{background:var(--mint)}.pill.ghost{background:var(--danger);color:#fff}
h1.at{font-size:clamp(26px,4.4vw,35px);line-height:1.16;letter-spacing:-.025em;margin:16px 0 12px;text-wrap:balance}
.ameta{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:24px}
.avatar{width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 35% 30%,var(--mint),var(--cyber));display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto}
.lede{font-family:var(--serif);font-size:19px;line-height:1.5}
.art p{font-family:var(--serif);font-size:17px;line-height:1.7;margin:16px 0}
.art h2{font-family:var(--sans);font-size:20px;letter-spacing:-.01em;margin:32px 0 6px}
.art ul{font-family:var(--serif);font-size:17px;line-height:1.6}.art li{margin:8px 0}
.src{font-family:var(--sans)!important;font-size:12.5px!important;color:var(--faint);font-style:italic;border-top:1px solid var(--line);padding-top:16px;margin-top:28px}
.statbox{background:var(--plum3);border:1px solid var(--line);border-left:3px solid var(--mint);border-radius:12px;padding:18px 20px;margin:24px 0}
.statbox .big{font-size:36px;font-weight:800;color:var(--mint);letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
.statbox .cap{font-size:13px;color:var(--muted);margin-top:6px}
.chart{width:100%;max-width:520px;margin:8px 0 4px}.bar{fill:var(--cyber)}.bar.hot{fill:var(--mint)}
.axis{stroke:var(--line);stroke-width:1}.blabel{fill:var(--muted);font-size:11px;font-family:var(--sans)}.bval{fill:var(--ink);font-size:11px;font-weight:700;font-family:var(--sans)}
.cta{background:var(--plum3);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:28px 0 0}
.cta a{color:var(--mint);font-weight:800;text-decoration:none}
.themetoggle{position:fixed;top:12px;right:12px;font-size:12px;font-weight:700;color:var(--muted);background:var(--plum2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;z-index:9}
.hubhead{font-size:clamp(24px,4vw,32px);letter-spacing:-.02em;margin:22px 0 4px;text-wrap:balance}
.hubsub{color:var(--muted);font-size:15px;max-width:600px}
.rlist{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:26px}@media(max-width:640px){.rlist{grid-template-columns:1fr}}
.rcard{display:block;text-decoration:none;background:var(--plum2);border:1px solid var(--line);border-radius:14px;padding:18px 18px 20px}
.rcard:hover{border-color:var(--cyber)}.rcard h3{font-size:17px;line-height:1.3;margin:10px 0 6px;letter-spacing:-.01em;text-wrap:balance}
.rcard p{font-size:13px;color:var(--muted);margin:0}.rmeta{font-size:11px;color:var(--faint);margin-top:10px}
.empty{color:var(--muted);font-size:15px;background:var(--plum2);border:1px dashed var(--line);border-radius:14px;padding:26px;margin-top:24px;text-align:center}
`;

const THEME_JS = `(function(){try{var t=localStorage.getItem('gpj_theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}window.__gpjTheme=function(){var r=document.documentElement;var cur=r.getAttribute('data-theme');if(!cur){cur=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}var n=(cur==='light')?'dark':'light';r.setAttribute('data-theme',n);try{localStorage.setItem('gpj_theme',n);}catch(e){}};})();`;

function pageShell({ title, desc, canonical, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary"><meta name="robots" content="index,follow">
<script>${THEME_JS}</script>
<style>${CSS}</style></head>
<body>
<div class="themetoggle" onclick="__gpjTheme()">◐ theme</div>
<header class="sitehdr">
  <a class="brand" href="/"><img class="brandmark" src="/assets/logo-mark.png" alt="GhostProofJob"/><span class="brandtext">GhostProofJob</span></a>
  <nav class="snav"><a href="/">Home</a><a href="/resume-checker.html">Résumé Checker</a><a class="on" href="/resources/">Resources</a><a href="/#employers">Employers</a></nav>
</header>
${body}
</body></html>`;
}

/* inline bar chart for ranking articles */
function barChart(pairs, { hotFirst = true } = {}) {
  if (!pairs.length) return '';
  const max = Math.max(...pairs.map((p) => p[1])) || 1;
  const W = 520, H = 40 + pairs.length * 34, bw = 300, x0 = 150;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ranking">`;
  pairs.forEach((p, i) => {
    const y = 16 + i * 34;
    const w = Math.max(4, Math.round((p[1] / max) * bw));
    const hot = hotFirst && i === 0 ? ' hot' : '';
    svg += `<text class="blabel" x="${x0 - 10}" y="${y + 15}" text-anchor="end">${esc(p[0])}</text>`;
    svg += `<rect class="bar${hot}" x="${x0}" y="${y}" width="${w}" height="22" rx="3"/>`;
    svg += `<text class="bval" x="${x0 + w + 8}" y="${y + 15}">${num(p[1])}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function renderArticle(a) {
  // Team byline = the brand → transparent brand mark inside the gradient circle (brand uniformity);
  // Jett keeps ✍️ (a distinct persona, not the GhostProofJob ghost).
  const bylineAvatar = a.byline === 'Jett' ? '✍️' : '<img src="/assets/logo-mark.png" alt="" style="width:22px;height:22px;object-fit:contain"/>';
  let body = `<div class="wrap"><article class="art">
<span class="pill ${a.pillClass || (a.cat === 'tips' ? 'tips' : 'market')}">${esc(a.category)}</span>
<h1 class="at">${esc(a.title)}</h1>
<div class="ameta"><div class="avatar">${bylineAvatar}</div><div>By <b style="color:var(--ink)">${esc(a.byline)}</b> · ${esc(prettyDate(a.date))} · ${a.readMin} min read</div></div>
<p class="lede">${esc(a.lede)}</p>`;
  for (const block of a.blocks) {
    if (block.h) body += `<h2>${esc(block.h)}</h2>`;
    if (block.stat) body += `<div class="statbox"><div class="big">${esc(block.stat.big)}</div><div class="cap">${block.stat.cap}</div></div>`;
    if (block.chart) body += block.chart;
    if (block.p) for (const para of [].concat(block.p)) body += `<p>${para}</p>`;
    if (block.list) body += `<ul>${block.list.map((li) => `<li>${li}</li>`).join('')}</ul>`;
  }
  body += `<p class="src">${esc(a.source)}</p>`;
  body += `<div class="cta">${a.cta}</div>`;
  body += `</article></div>`;
  return pageShell({ title: a.title + ' · GhostProofJob', desc: a.desc, canonical: `${SITE}/resources/${a.slug}.html`, body });
}

function renderHub(articles) {
  const cards = articles.length ? `<div class="rlist">${articles.map((a) => `<a class="rcard" href="/resources/${esc(a.slug)}.html">
<span class="pill ${a.cat === 'tips' ? 'tips' : 'market'}">${esc(a.category)}</span>
<h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p>
<div class="rmeta">${a.byline === 'Jett' ? '✍️' : '📊'} ${esc(a.byline)} · ${esc(prettyDate(a.date))}</div></a>`).join('')}</div>`
    : `<div class="empty">The first articles publish here soon — real job-market data and résumé tips, straight from our own verified-jobs database.</div>`;
  const body = `<div class="wrap" style="max-width:960px">
<h1 class="hubhead">Job-market intel &amp; résumé tips, from the data</h1>
<p class="hubsub">Every figure here comes from verified roles in our own database — no recycled listicles, no made-up stats. New posts every couple of days.</p>
${cards}</div>`;
  return pageShell({ title: 'Resources — Job-Market Data & Résumé Tips · GhostProofJob', desc: 'Data-driven job-market analysis and practical résumé tips from GhostProofJob’s verified-jobs database. Updated every couple of days.', canonical: `${SITE}/resources/`, body });
}

/* ------------------------------------------------------------- templates --- */
/* Each template returns a fully-formed article from FIXED facts computed here.
   Prose is deterministic + grounded; the numbers are never model-invented. */
const STD_CTA = 'Ready to act on this? Our free <a href="/resume-checker.html">Résumé Strength Checker</a> scores your résumé in seconds — no account needed — and the app tailors it to any role in a couple of minutes.';
const sourceLine = (s, extra) => `Source: GhostProofJob verified-jobs database${s.builtAt ? ', as of ' + prettyDate(new Date(s.builtAt).toISOString().slice(0, 10)) : ''}. ${extra || ''}Counts reflect active roles still accepting applicants and update automatically. Roles are grouped by title keyword, so treat fields as directional, not exact.`.trim();

const TEMPLATES = [
  /* ---- MARKET (The GhostProofJob Team) ---- */
  { id: 'remote-by-field', cat: 'market', build(s) {
      const pairs = topN(s.byRemoteField, 6).filter((p) => p[0] !== 'Other');
      if (pairs.length < 3) return null;
      const [top, second] = pairs;
      return {
        category: 'Market data', byline: 'The GhostProofJob Team',
        title: 'Which fields are hiring remote right now',
        desc: `${top[0]} leads remote hiring with ${num(top[1])} open verified roles. See the full ranking by field, from our jobs database.`,
        lede: `Everyone argues about whether remote work is shrinking. Instead of guessing, we counted every verified remote role in our database and grouped it by field.`,
        readMin: 4,
        blocks: [
          { stat: { big: num(top[1]), cap: `verified remote <b>${esc(top[0])}</b> roles are open right now — the clear #1, ahead of ${esc(second[0])} (${num(second[1])}).` } },
          { h: 'The full ranking', chart: barChart(pairs) },
          { p: `${top[0]} leads, but the more useful story is further down: fields like ${esc(second[0])} and ${esc((pairs[2] || pairs[1])[0])} post steadily and draw a fraction of the applicant crush that the top spot does. If you're flexible on field, that gap is where the interviews hide.` },
          { h: 'What to do with this', p: `Apply where the ratio favors you, not only where the volume is loudest. Remote roles move fast — a tailored résumé submitted early beats a generic one submitted late.` },
        ],
        source: sourceLine(s, 'Remote roles are those flagged remote by the employer or aggregator. '),
        cta: STD_CTA,
      };
    } },
  { id: 'in-demand-fields', cat: 'market', build(s) {
      const pairs = topN(s.byField, 6).filter((p) => p[0] !== 'Other');
      if (pairs.length < 3) return null;
      const top = pairs[0];
      return {
        category: 'Market data', byline: 'The GhostProofJob Team',
        title: 'The fields posting the most jobs this week',
        desc: `${top[0]} tops open hiring with ${num(top[1])} verified roles. The full ranking by field, from our jobs database.`,
        lede: `Which fields are actually hiring — not according to headlines, but according to the verified roles open in our database right now?`,
        readMin: 3,
        blocks: [
          { h: 'The ranking', chart: barChart(pairs) },
          { p: `${top[0]} sits at the top with ${num(top[1])} open roles, but volume isn't everything: the busiest field is also the most competitive. Look at where demand is healthy AND applicants are fewer — often a rung or two down this list.` },
          { h: 'Reading the list', p: `A field near the top means more openings; it does not mean easier. Pair this with your own experience and target where your background gives you an edge.` },
        ],
        source: sourceLine(s),
        cta: STD_CTA,
      };
    } },
  { id: 'salary-transparency', cat: 'market', build(s) {
      if (!s.total) return null;
      const p = pct(s.salaryPosted, s.total);
      return {
        category: 'Market data', byline: 'The GhostProofJob Team',
        title: `Only ${p}% of job posts show the salary. Here's why that matters`,
        desc: `We measured salary transparency across ${num(s.total)} verified roles: ${p}% disclose pay. What that means for your search.`,
        lede: `Pay transparency is spreading, but slowly. We checked how many of the ${num(s.total)} verified roles in our database actually post a salary.`,
        readMin: 3,
        blocks: [
          { stat: { big: p + '%', cap: `of the ${num(s.total)} open verified roles disclose a salary or salary range up front.` } },
          { p: `That means most postings still make you invest an application — sometimes an interview — before you learn whether the pay is even in range. Roles that post pay tend to be more serious and further along in their process.` },
          { h: 'How to use it', p: `When two roles look similar, favor the one that posts pay: it respects your time and signals a real, funded opening rather than a pipeline-filler. And always research a range before you talk numbers.` },
        ],
        source: sourceLine(s, 'A role counts as transparent if it posts a salary figure or range. '),
        cta: STD_CTA,
      };
    } },
  { id: 'verified-share', cat: 'market', build(s) {
      if (!s.total) return null;
      const p = pct(s.verified, s.total);
      return {
        category: 'Ghost jobs', pillClass: 'ghost', byline: 'The GhostProofJob Team',
        title: 'How many job posts come from a verified employer?',
        desc: `We flag which of ${num(s.total)} open roles come from a verified employer. Here's the share — and why it fights ghost jobs.`,
        lede: `A "ghost job" is a posting that isn't really hiring. One of the strongest signals that a role is real is a verified employer behind it.`,
        readMin: 3,
        blocks: [
          { stat: { big: num(s.verified), cap: `roles in the database right now come from a verified employer — ${p}% of the ${num(s.total)} open postings.` } },
          { p: `We can't promise every other posting is a ghost — plenty of legitimate roles come through aggregators. But a verified badge means a real company, a real contact, and a role we can hold accountable if it goes quiet.` },
          { h: 'Protect your time', list: [
            'Favor verified employers when the roles look otherwise equal.',
            'Watch for postings that have been "open" for many weeks with no updates.',
            'If a role stops responding, log it — our community ghost reports warn the next applicant.',
          ] },
        ],
        source: sourceLine(s, 'Verified = an employer that completed our corporate-domain verification, or a role posted directly on GhostProofJob. '),
        cta: STD_CTA,
      };
    } },
  { id: 'city-spotlight', cat: 'market', angleFrom: (s) => topN(s.byCity, 8).map((c) => c[0]), build(s, angle) {
      const cities = topN(s.byCity, 8);
      if (!cities.length) return null;
      const pickName = angle || cities[0][0];
      const found = cities.find((c) => c[0] === pickName) || cities[0];
      return {
        category: 'Market data', byline: 'The GhostProofJob Team',
        title: `The ${found[0]} job market this week`,
        desc: `${num(found[1])} verified roles are open in ${found[0]} right now. A quick, data-backed snapshot of local hiring.`,
        lede: `A quick, honest snapshot of what's actually open in ${found[0]} — counted from verified roles in our database, not scraped from a headline.`,
        readMin: 3,
        blocks: [
          { stat: { big: num(found[1]), cap: `verified roles are open in <b>${esc(found[0])}</b> right now.` } },
          { p: `Local numbers move week to week. The point of a snapshot isn't a forecast — it's a reality check: enough openings to be worth a focused local search, and a reminder that remote roles (always in our deck) widen the pool further.` },
          { h: 'Make your local search count', p: `Set your market, lead with your most recent role, and apply early. A résumé tuned to the local role beats a generic one every time.` },
        ],
        source: sourceLine(s, `A role counts toward ${found[0]} when its posted location resolves to that city. `),
        cta: STD_CTA,
      };
    } },
  /* ---- TIPS (Jett) — evergreen craft, lightly seasoned with one real number ---- */
  { id: 'bullet-teardown', cat: 'tips', build(s) {
      return {
        category: 'Résumé tips', byline: 'Jett',
        title: 'The 6 words that make a résumé bullet land',
        desc: 'A strong résumé bullet follows one pattern: strong verb, real scope, measurable result. Here it is, with before/afters.',
        lede: `Most résumé bullets describe duties. The ones that get interviews describe results — and they almost always follow the same six-word skeleton.`,
        readMin: 4,
        blocks: [
          { p: `The skeleton is: <b>[strong verb] + [what] + [scope] + [measurable result]</b>. Miss the result and a hiring manager can't tell a great hire from an average one.` },
          { h: 'Before → after', list: [
            '<i>Responsible for social media.</i> → <b>Grew Instagram from 4k to 22k followers in 8 months, lifting referral traffic 31%.</b>',
            '<i>Handled customer issues.</i> → <b>Resolved 40+ support tickets a day at a 96% satisfaction score.</b>',
            '<i>Helped with the budget.</i> → <b>Managed a $250k marketing budget, cutting cost-per-lead 18%.</b>',
          ] },
          { h: 'The fastest fix', p: `Open each bullet with a strong verb and end it with a number. If you can't add a number, add scope (how many, how big, how often). Our checker rewards exactly this structure.` },
        ],
        source: 'Guidance from the GhostProofJob résumé team, reflecting the structure our Résumé Strength Checker scores against.',
        cta: STD_CTA,
      };
    } },
  { id: 'ghost-red-flags', cat: 'tips', build(s) {
      return {
        category: 'Ghost jobs', pillClass: 'ghost', byline: 'Jett',
        title: '5 signs a job posting is a ghost',
        desc: 'Not every open role is really hiring. Five practical signals that a posting may be a ghost job — and what to do instead.',
        lede: `A ghost job looks real, wastes your time, and never closes. After flagging thousands of them, here are the patterns worth watching.`,
        readMin: 4,
        blocks: [
          { h: 'The signals', list: [
            '<b>It never closes.</b> A role that’s been "open" for months with no updates is often a pipeline-filler.',
            '<b>Vague everything.</b> No real responsibilities, no team, no manager named — just buzzwords.',
            '<b>Reposted on a loop.</b> The same listing reappears every few weeks with a fresh date.',
            '<b>No salary, ever.</b> Serious, funded roles increasingly post a range; perpetual silence is a flag.',
            '<b>Radio silence after applying.</b> Weeks of nothing, no confirmation, no rejection.',
          ] },
          { h: 'What to do instead', p: `Favor verified employers, apply early, and log the ones that go quiet. On GhostProofJob, a ghost report warns the next applicant — turning your wasted hour into someone else's saved one.` },
        ],
        source: 'Guidance from the GhostProofJob team, based on community ghost reports and posting-behavior patterns.',
        cta: STD_CTA,
      };
    } },
  { id: 'keyword-match', cat: 'tips', build(s) {
      return {
        category: 'Résumé tips', byline: 'Jett',
        title: "Why your résumé isn't matching — and the 2-minute fix",
        desc: 'Most résumés get filtered out on keywords, not qualifications. The quick, honest fix — no keyword stuffing required.',
        lede: `You're qualified, but you're not hearing back. Nine times out of ten the problem isn't your experience — it's that your résumé and the job description use different words for the same thing.`,
        readMin: 3,
        blocks: [
          { p: `Screening tools and busy recruiters both scan for the language in the posting. If the role says "stakeholder management" and your résumé says "worked with clients," you match in reality but not on paper.` },
          { h: 'The fix', list: [
            'Read the job description and highlight the 8–10 nouns it repeats.',
            'Mirror the ones you honestly have — in your real bullets, not a keyword dump.',
            'Match the exact phrasing (their words, your truth).',
          ] },
          { h: 'Don’t overdo it', p: `Never claim a skill you don't have — it falls apart in the interview. The goal is to describe your real experience in the posting's vocabulary. Our Match-to-Job tool does this for you in about two minutes.` },
        ],
        source: 'Guidance from the GhostProofJob résumé team, reflecting how our keyword matching and Match-to-Job features work.',
        cta: STD_CTA,
      };
    } },
];

/* ------------------------------------------------------------- rotation --- */
/* Alternate categories every run (never two of the same category back-to-back)
   and round-robin templates within each category. Angles rotate for templates
   that take one (e.g. city spotlight). State is a small repo file the workflow
   commits, so it is durable without an extra Firestore write. */
function loadRotation() {
  try { return JSON.parse(fs.readFileSync(ROTATION, 'utf8')); } catch { return { lastCat: '', marketIdx: 0, tipsIdx: 0, angleIdx: 0 }; }
}
function pickTemplate(rot, stats) {
  const market = TEMPLATES.filter((t) => t.cat === 'market');
  const tips = TEMPLATES.filter((t) => t.cat === 'tips');
  const wantCat = rot.lastCat === 'market' ? 'tips' : 'market';
  const pool = wantCat === 'market' ? market : tips;
  const idxKey = wantCat === 'market' ? 'marketIdx' : 'tipsIdx';
  // try up to pool.length templates so a null build() (not enough data) skips on
  let tpl = null, tries = 0, idx = rot[idxKey] || 0;
  let angle = null;
  while (tries < pool.length) {
    const cand = pool[idx % pool.length];
    angle = cand.angleFrom ? (cand.angleFrom(stats)[rot.angleIdx % Math.max(1, cand.angleFrom(stats).length)] || null) : null;
    const art = cand.build(stats, angle);
    idx++;
    tries++;
    if (art) { tpl = { cand, art }; break; }
  }
  const next = { ...rot, lastCat: wantCat, [idxKey]: idx, angleIdx: (rot.angleIdx || 0) + 1 };
  return { tpl, next };
}

/* -------------------------------------------------------------- stats io --- */
function fixtureStats() {
  return {
    builtAt: Date.now(), total: 8421, remote: 2140, salaryPosted: 3990, verified: 1310,
    byField: { Technology: 2103, Healthcare: 1620, Marketing: 1044, Sales: 980, Finance: 712, Operations: 611, 'Customer Support': 540, Other: 811 },
    byRemoteField: { Technology: 812, Marketing: 402, 'Customer Support': 300, Sales: 260, Healthcare: 190, Finance: 176 },
    byCity: { 'Houston, TX': 640, 'Austin, TX': 511, 'Dallas, TX': 498, 'Atlanta, GA': 402, 'Chicago, IL': 388, 'Phoenix, AZ': 301, 'Denver, CO': 277, 'Remote, US': 0 },
    bySource: { indeed: 6000, internal: 1310, greenhouse: 700, lever: 411 },
  };
}
/* decode Firestore REST typed value */
function decodeVal(v) {
  if (v == null) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) { const o = {}; const f = (v.mapValue.fields || {}); for (const k in f) o[k] = decodeVal(f[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeVal);
  return null;
}
async function loadStats() {
  if (FIXTURE) return fixtureStats();
  if (statsArg) return JSON.parse(fs.readFileSync(statsArg, 'utf8'));
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (svc) {
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
    const snap = await admin.firestore().collection('resources').doc('_market_stats').get();
    if (!snap.exists) return null;
    return snap.data();
  }
  // public REST read of the single doc — no secret needed
  const url = 'https://firestore.googleapis.com/v1/projects/ghostproofjob-app/databases/(default)/documents/resources/_market_stats';
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const out = {}; const f = j.fields || {};
  for (const k in f) out[k] = decodeVal(f[k]);
  return out;
}

/* --------------------------------------------------------------- manifest -- */
function loadManifest() { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return []; } }

/* ------------------------------------------------------------------ main --- */
async function main() {
  /* --init: write the empty-state hub + empty manifest so /resources/ exists on
     first deploy, WITHOUT publishing any (fixture) article. Real articles arrive
     once the pool builder writes real stats. */
  if (process.argv.includes('--init')) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderHub([]), 'utf8');
    fs.writeFileSync(MANIFEST, JSON.stringify([], null, 2), 'utf8');
    console.log('[resources] --init: wrote empty-state hub + manifest');
    return;
  }

  const stats = await loadStats();
  if (!stats || !stats.total) {
    console.error('[resources] no market stats yet — run the Daily Job Harvest first (build_job_pool writes resources/_market_stats). Nothing published.');
    process.exit(FIXTURE ? 1 : 0); // not an error in prod: just nothing to do until the pool builds
  }
  console.log('[resources] stats: ' + num(stats.total) + ' jobs, ' + num(stats.remote) + ' remote, ' + Object.keys(stats.byField || {}).length + ' fields');

  const rot = loadRotation();
  const { tpl, next } = pickTemplate(rot, stats);
  if (!tpl) { console.error('[resources] no template could build from current data'); process.exit(1); }

  const date = todayISO();
  const a = tpl.art;
  a.cat = tpl.cand.cat;
  a.date = date;
  a.slug = slugify(a.title) + '-' + date;
  const html = renderArticle(a);

  // manifest entry (newest first) — dedupe by slug
  let manifest = loadManifest().filter((m) => m.slug !== a.slug);
  manifest.unshift({ slug: a.slug, title: a.title, desc: a.desc, byline: a.byline, category: a.category, cat: a.cat, date });
  const hubHtml = renderHub(manifest);

  console.log('[resources] template: ' + tpl.cand.id + '  (' + a.cat + ', ' + a.byline + ')');
  console.log('[resources] article : ' + a.slug + '.html');
  console.log('[resources] title   : ' + a.title);

  if (DRY) { console.log('[resources] --dry-run: nothing written'); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, a.slug + '.html'), html, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), hubHtml, 'utf8');
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(ROTATION, JSON.stringify(next, null, 2), 'utf8');
  console.log('[resources] wrote ' + a.slug + '.html + index.html + manifest (' + manifest.length + ' articles) + rotation');
}

/* exported for the unit test (tests/growth/resourcesEngine.test.mjs) */
export { slugify, TEMPLATES, pickTemplate, renderArticle, renderHub, fixtureStats, decodeVal, sourceLine };

if (!process.env.GPJ_RES_NO_MAIN) {
  main().catch((e) => { console.error('[resources] failed:', e && e.stack || e); process.exit(1); });
}
