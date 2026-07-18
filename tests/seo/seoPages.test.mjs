// ============================================================================
// SEO page generator — content + honesty + SEO-correctness tests.
//   npm run test:seo
// These pages are public marketing surface, so the honesty rules from CLAUDE.md
// are enforced here as tests, not just conventions:
//   - no invented statistics (we never measured a city ghost-job rate)
//   - no auto-apply claim (architecturally impossible)
//   - no per-company pages (founder: off until legal review)
//   - zero runtime reads: no client fetch/XHR/Firestore in the output
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build, buildSitemap } = require('../../seo-generator/run.js');
const { cities } = require('../../seo-generator/cities.js');

const r = await build({ write: false, companies: false });   // in memory, OFFLINE — never touches disk or network
const houston = r.pages.find((p) => p.slug === 'ghost-jobs-in-houston-tx');

describe('SEO generator — output shape', () => {
  test('renders one page per city, plus an index and a sitemap', () => {
    assert.equal(r.pages.length, cities.length);
    assert.ok(r.pages.length >= 40, 'a meaningful city footprint');
    assert.ok(r.index.includes('Ghost jobs, city by city'));
    assert.ok(r.sitemap.startsWith('<?xml'));
  });
  test('every page has a unique slug + non-trivial content', () => {
    const slugs = new Set(r.pages.map((p) => p.slug));
    assert.equal(slugs.size, r.pages.length, 'no duplicate slugs');
    for (const p of r.pages) assert.ok(p.html.length > 3000, p.slug + ' has real content');
  });
});

describe('SEO correctness', () => {
  test('page carries title, meta description, canonical, OG + JSON-LD FAQ', () => {
    assert.match(houston.html, /<title>Ghost Jobs in Houston, TX[^<]*<\/title>/);
    assert.match(houston.html, /<meta name="description" content="[^"]{80,}"/);
    assert.match(houston.html, /<link rel="canonical" href="https:\/\/ghostproofjob\.com\/seo\/ghost-jobs-in-houston-tx\.html">/);
    assert.match(houston.html, /property="og:title"/);
    assert.match(houston.html, /application\/ld\+json/);
    assert.match(houston.html, /"@type":"FAQPage"/);
  });
  test('the city actually localises the page', () => {
    assert.ok(houston.html.includes('Houston'), 'city name present');
    const austin = r.pages.find((p) => p.slug === 'ghost-jobs-in-austin-tx');
    // v124: every page footer now carries the real business contact line
    // ("GhostProofJob · Houston, TX · phone") — that is the ADDRESS, not the
    // page's city. Strip it before asserting content distinctness.
    const austinBody = austin.html.replace(/GhostProofJob · Houston, TX[^<]*/g, '');
    assert.ok(austin.html.includes('Austin') && !austinBody.includes('Houston,'), 'pages are distinct per city');
  });
  test('sitemap lists the home page, the index and every city page', () => {
    const sm = buildSitemap(cities);
    assert.ok(sm.includes('<loc>https://ghostproofjob.com/</loc>'));
    assert.ok(sm.includes('/seo/index.html'));
    for (const c of cities) assert.ok(sm.includes('/seo/' + c.slug + '.html'), 'sitemap has ' + c.slug);
  });
  test('index links every city page (internal-link hub)', () => {
    for (const c of cities) assert.ok(r.index.includes('/seo/' + c.slug + '.html'), 'index links ' + c.slug);
  });
});

describe('HONESTY rules (CLAUDE.md) enforced on public marketing pages', () => {
  test('NO invented statistics — we never claim a measured ghost-job rate', () => {
    for (const p of r.pages) {
      assert.doesNotMatch(p.html, /\d+(\.\d+)?%\s*(of|are|were)\b/i, p.slug + ' must not state a fabricated percentage');
      assert.doesNotMatch(p.html, /\b(studies show|research shows|according to our data)\b/i, p.slug + ' must not cite phantom research');
    }
  });
  test('NO auto-apply claim (architecturally impossible)', () => {
    for (const p of r.pages) {
      assert.doesNotMatch(p.html, /auto[- ]?appl(y|ies|ying)\b(?!\s*is not)/i, p.slug + ' must not promise auto-apply');
    }
    assert.ok(houston.html.includes('Auto-apply is not possible'), 'we state the limitation honestly');
  });
  test('keeps the real pricing + no-ads promise', () => {
    assert.ok(houston.html.includes("free until you're hired") || houston.html.includes('Free until you'), 'free-until-hired stated');
    assert.ok(houston.html.includes('No ads'), 'no-ads promise stated');
    assert.ok(houston.html.includes('never sell your data') || houston.html.includes('No data selling'), 'no data selling stated');
  });
  test('city build emits only city pages (company pages are a separate, gated set)', () => {
    for (const p of r.pages) assert.ok(p.slug.startsWith('ghost-jobs-in-'), 'only city pages: ' + p.slug);
  });
});

// v123 (founder-approved): per-company pages ARE now generated — but ONLY as
// neutral placeholder pages built from the company's own postings, with a
// claim-your-page CTA. The safety model is enforced here as tests.
describe('company pages — the "safest way" honesty model', () => {
  const { aggregate, renderCompanyPage, MIN_ROLES } = require('../../seo-generator/companies.js');
  const fixture = [
    { company: 'Acme Logistics', title: 'Ops Manager', location: 'Houston, TX', active: true },
    { company: 'Acme Logistics', title: 'Dispatcher', location: 'Katy, TX', active: true },
    { company: 'Acme Logistics', title: '<script>alert(1)</script>', location: 'Houston, TX', active: true },
    { company: 'OneRoleCo', title: 'Solo Role', location: 'Austin, TX', active: true },
    { company: 'Unknown', title: 'Junk', location: '', active: true },
  ];
  const list = aggregate(fixture);
  const page = renderCompanyPage(list[0]);

  test('aggregation: junk names dropped, thin companies dropped, slugs prefixed', () => {
    assert.equal(list.length, 1, 'only companies with >=' + MIN_ROLES + ' roles get a page');
    assert.equal(list[0].name, 'Acme Logistics');
    assert.ok(list[0].slug.startsWith('co-'), 'company slugs never collide with city slugs');
  });
  test('NO ghost-report counts, risk %, or negative claims about the company', () => {
    assert.doesNotMatch(page, /report(s|ed)?/i, 'no report language');
    assert.doesNotMatch(page, /\d+\s*%/, 'no percentages of any kind');
    assert.doesNotMatch(page, /ghost job|ghosting risk|ghosted/i, 'no ghost accusations near a named company');
  });
  test('counts are framed honestly as "recently seen" (a static page is not a live feed)', () => {
    assert.match(page, /recently seen/i);
    assert.match(page, /update(s)? inside the app|Openings change daily/i);
  });
  test('the claim-your-page CTA is present (the growth loop)', () => {
    assert.match(page, /Are you .*Acme Logistics/);
    assert.match(page, /free employer account/i);
  });
  test('job-sourced text is escaped and nothing fetches at runtime', () => {
    assert.doesNotMatch(page, /<script>alert/, 'titles are escaped');
    assert.doesNotMatch(page, /\bfetch\s*\(|XMLHttpRequest|firestore/i, 'zero runtime reads');
  });
});

describe('ZERO runtime reads (D1-safe static output)', () => {
  test('no client-side fetching or Firestore in any page', () => {
    for (const p of r.pages) {
      assert.doesNotMatch(p.html, /\bfetch\s*\(/, p.slug + ' must not fetch at runtime');
      assert.doesNotMatch(p.html, /XMLHttpRequest|firestore|firebase/i, p.slug + ' must not touch the DB');
    }
    assert.doesNotMatch(r.index, /\bfetch\s*\(|firestore/i, 'index is static too');
  });
  test('the only script tag is the JSON-LD block (no executable JS)', () => {
    const scripts = houston.html.match(/<script[^>]*>/g) || [];
    assert.equal(scripts.length, 1, 'exactly one script tag');
    assert.match(scripts[0], /application\/ld\+json/, 'and it is structured data, not JS');
  });
  test('every page routes traffic to the app', () => {
    for (const p of r.pages) assert.ok(p.html.includes('https://ghostproofjob.com'), p.slug + ' links to the app');
  });
});
