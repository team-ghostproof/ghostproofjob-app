'use strict';
/**
 * seo-generator/template.js — renders one static "ghost jobs in {city}" page.
 *
 * DESIGN CONSTRAINTS (from CLAUDE.md):
 *  - ZERO runtime reads: every page is fully static HTML. No Firestore, no API,
 *    no client JS that fetches. It loads instantly and costs nothing to serve.
 *  - NO misleading copy, NO invented data: the guidance below is evergreen and
 *    factual. We never claim a city-level ghost-job percentage or any statistic
 *    we haven't measured — the city only localizes framing + the app CTA.
 *  - Honest product claims only: free until hired, no ads, no data selling,
 *    "jump to apply" (auto-apply is architecturally impossible).
 */

const SITE = 'https://ghostproofjob.com';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** The evergreen, factual FAQ (also emitted as JSON-LD FAQPage structured data). */
function faqFor(label) {
  return [
    {
      q: 'What is a ghost job?',
      a: 'A ghost job is a posting that is advertised but not actively being filled — the role may already be filled, indefinitely on hold, or collected to build a résumé pipeline. It looks like a real opening, so applicants spend real time on it and usually never hear back.',
    },
    {
      q: 'How can I spot a ghost job in ' + label + '?',
      a: 'Watch for a posting that keeps getting reposted or has been open for months, a vague description with no named team or scope, no salary range, a company that is otherwise not hiring, and an "evergreen" listing that never closes. None of these alone proves a ghost job — together they raise the risk.',
    },
    {
      q: 'Why do employers post ghost jobs?',
      a: 'Common reasons include keeping a pipeline of résumés on file, signalling growth, testing a market before funding a role, satisfying an internal posting requirement when an internal candidate is already chosen, or simply forgetting to take a filled role down.',
    },
    {
      q: 'Is GhostProofJob free?',
      a: 'Yes — GhostProofJob is free until you are hired. Applications are always unlimited, there are no ads, and we never sell your data.',
    },
    {
      q: 'Does GhostProofJob apply to jobs for me?',
      a: 'No. Auto-apply is not possible from a browser for security reasons, and we will not claim otherwise. GhostProofJob takes you straight to the real employer posting so you apply yourself — without the aggregator ad-walls in between.',
    },
  ];
}

function renderPage({ city, state, label, slug }) {
  const title = 'Ghost Jobs in ' + label + ' — How to Spot Fake Job Postings | GhostProofJob';
  const desc =
    'Job hunting in ' + label + '? Learn how to spot ghost jobs — postings that are advertised but never filled — and find verified, real openings. Free until you\'re hired. No ads, no data selling.';
  /* explicit .html so we never need Vercel cleanUrls (which rewrites /index.html
     and could disturb the PWA service-worker cache). SEO-neutral. */
  const url = SITE + '/seo/' + slug + '.html';
  const faq = faqFor(label);

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'WebPage',
        name: title,
        description: desc,
        url,
        isPartOf: { '@type': 'WebSite', name: 'GhostProofJob', url: SITE },
      },
    ],
  };

  const sign = (h, b) =>
    '<li style="margin-bottom:12px;"><strong style="color:var(--off);">' + h + '</strong><br><span style="color:var(--muted);">' + b + '</span></li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="GhostProofJob">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="/assets/favicon-32.png">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
  :root{--plum:#120F1D;--plum2:#1C1830;--plum3:#251F3A;--plum4:#2E2850;--mint:#00F5A0;--cyber:#B55FE6;--off:#E8E6F0;--muted:#8A85A0;--danger:#FF4D6A;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--plum);color:var(--off);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px;}
  header{display:flex;align-items:center;gap:10px;margin-bottom:30px;}
  header .logo{font-size:24px}
  header .name{font-weight:800;font-size:19px;color:var(--off);text-decoration:none}
  header .name span{color:var(--mint)}
  h1{font-size:clamp(26px,5vw,38px);line-height:1.2;letter-spacing:-.02em;margin:0 0 12px;text-wrap:balance}
  h2{font-size:20px;margin:34px 0 10px;letter-spacing:-.01em}
  .lede{font-size:17px;color:var(--muted);margin:0 0 22px}
  ul{padding-left:20px}
  .cta{display:block;background:linear-gradient(135deg,var(--mint),#00C97F);color:var(--plum);font-weight:800;text-decoration:none;text-align:center;border-radius:12px;padding:15px 20px;margin:26px 0;font-size:16px}
  .card{background:var(--plum2);border:1px solid var(--plum3);border-radius:14px;padding:18px 20px;margin:18px 0}
  .faq dt{font-weight:700;color:var(--off);margin-top:16px}
  .faq dd{margin:6px 0 0;color:var(--muted)}
  footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--plum3);color:var(--muted);font-size:13px}
  footer a{color:var(--cyber)}
  .pill{display:inline-block;background:rgba(0,245,160,.12);color:var(--mint);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700;margin-bottom:14px}
</style>
</head>
<body>
<div class="wrap">
  <header><span class="logo">👻</span><a class="name" href="${SITE}">GhostProof<span>Job</span></a></header>

  <span class="pill">Job hunting in ${esc(label)}</span>
  <h1>Ghost jobs in ${esc(city)} — and how to spot them</h1>
  <p class="lede">A ghost job looks like a real opening but isn't actually being filled. If you're applying in ${esc(label)} and never hearing back, this is often why — and it isn't you.</p>

  <a class="cta" href="${SITE}">Find real, verified ${esc(city)} jobs →</a>

  <h2>What a ghost job actually is</h2>
  <p>A ghost job is a posting that's advertised but not actively being filled. The role may already be filled internally, be paused indefinitely, or exist mainly to collect résumés. It looks identical to a genuine opening from the outside — which is exactly the problem. You write the cover letter, tailor the résumé, hit apply, and the posting simply outlives your application.</p>

  <h2>Signs a ${esc(city)} posting might be a ghost job</h2>
  <div class="card">
    <ul>
      ${sign('It keeps getting reposted', 'The same role reappears every few weeks, or has sat open for months with no close date.')}
      ${sign('No salary range', 'A company that can\'t say what the role pays often hasn\'t finalised — or funded — the role.')}
      ${sign('Vague scope', 'No named team, no manager, no concrete responsibilities. Real roles have real edges.')}
      ${sign('The company isn\'t otherwise hiring', 'One evergreen listing and no other activity is a pipeline-building signal.')}
      ${sign('The listing never closes', 'Genuine roles get filled and come down. "Always open" is a flag.')}
    </ul>
    <p style="margin:6px 0 0;color:var(--muted);font-size:14px;">No single sign proves a ghost job. Together, they raise the risk — which is exactly what GhostProofJob scores for you.</p>
  </div>

  <h2>What to do instead</h2>
  <p>Protect your time. Before you invest an hour tailoring an application for a ${esc(city)} role, check how long the posting has been live, whether the salary is stated, and whether other hunters have flagged the company. Then spend your energy on the roles that are actually being filled.</p>

  <h2>How GhostProofJob helps</h2>
  <div class="card">
    <p style="margin-top:0">GhostProofJob is a job search built to be honest with you:</p>
    <ul>
      <li style="margin-bottom:8px;"><strong style="color:var(--mint)">Ghost Risk score</strong> — every listing is scored on the signals above, so you see the risk before you apply.</li>
      <li style="margin-bottom:8px;"><strong style="color:var(--mint)">Real employer links</strong> — we route you to the actual posting, not an aggregator ad-wall.</li>
      <li style="margin-bottom:8px;"><strong style="color:var(--mint)">Résumé matching</strong> — see how you match a role, and tailor an ATS-safe résumé in a tap.</li>
      <li style="margin-bottom:8px;"><strong style="color:var(--mint)">Hunter reports</strong> — when someone gets ghosted, everyone else gets the warning.</li>
    </ul>
    <p style="margin-bottom:0;color:var(--muted);font-size:14px;">Free until you're hired. Applications are always unlimited. No ads. No data selling. Ever.</p>
  </div>

  <a class="cta" href="${SITE}">Start your ${esc(city)} hunt free →</a>

  <h2>Questions</h2>
  <dl class="faq">
    ${faq.map((f) => '<dt>' + esc(f.q) + '</dt><dd>' + esc(f.a) + '</dd>').join('\n    ')}
  </dl>

  <footer>
    <p><a href="${SITE}">GhostProofJob</a> — Build · Optimize · Apply. Free until you're hired 💚<br>
    <a href="${SITE}/seo/index.html">Other cities</a> · <span style="color:var(--muted)">No ads. No data selling. Ever.</span><br>
    <span style="color:var(--muted)">GhostProofJob · Houston, TX · <a href="tel:+12819159482">(281) 915-9482</a> · <a href="mailto:support@ghostproofjob.com">support@ghostproofjob.com</a></span></p>
  </footer>
</div>
</body>
</html>
`;
}

/** The index that links every city page (also the internal-link hub for crawlers). */
function renderIndex(cities) {
  const title = 'Ghost Jobs by City — Spot Fake Job Postings | GhostProofJob';
  const desc = 'City guides to spotting ghost jobs — postings advertised but never filled. Find verified, real openings near you. Free until you\'re hired.';
  const links = cities
    .map((c) => '<li style="margin-bottom:8px;"><a href="/seo/' + c.slug + '.html" style="color:var(--mint);text-decoration:none;">Ghost jobs in ' + esc(c.label) + ' →</a></li>')
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/seo/index.html">
<link rel="icon" href="/assets/favicon-32.png">
<style>
  :root{--plum:#120F1D;--plum2:#1C1830;--plum3:#251F3A;--mint:#00F5A0;--cyber:#B55FE6;--off:#E8E6F0;--muted:#8A85A0;}
  body{margin:0;background:var(--plum);color:var(--off);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px}
  h1{font-size:clamp(24px,5vw,34px);letter-spacing:-.02em;margin:0 0 10px}
  .lede{color:var(--muted);margin:0 0 22px}
  ul{list-style:none;padding:0;columns:2;column-gap:26px}
  @media(max-width:560px){ul{columns:1}}
  a.name{font-weight:800;font-size:19px;color:var(--off);text-decoration:none}
  a.name span{color:var(--mint)}
  footer{margin-top:36px;padding-top:18px;border-top:1px solid var(--plum3);color:var(--muted);font-size:13px}
  footer a{color:var(--cyber)}
</style>
</head>
<body>
<div class="wrap">
  <p><span style="font-size:24px">👻</span> <a class="name" href="${SITE}">GhostProof<span>Job</span></a></p>
  <h1>Ghost jobs, city by city</h1>
  <p class="lede">A ghost job is a posting that's advertised but never actually filled. Pick your city for the signs to watch for — and find roles that are real.</p>
  <ul>
      ${links}
  </ul>
  <footer><p><a href="${SITE}">GhostProofJob</a> — free until you're hired 💚 · No ads. No data selling. Ever.<br>
  <span style="color:var(--muted)">Houston, TX · <a href="tel:+12819159482">(281) 915-9482</a> · <a href="mailto:support@ghostproofjob.com">support@ghostproofjob.com</a></span></p></footer>
</div>
</body>
</html>
`;
}

module.exports = { renderPage, renderIndex, faqFor, esc, SITE };
