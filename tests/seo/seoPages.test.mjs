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

const r = build({ write: false });          // render in memory — never touches disk
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
    assert.ok(austin.html.includes('Austin') && !austin.html.includes('Houston,'), 'pages are distinct per city');
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
  test('NO per-company pages are generated (off until legal review)', () => {
    for (const p of r.pages) assert.ok(p.slug.startsWith('ghost-jobs-in-'), 'only city pages: ' + p.slug);
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
