'use strict';
/**
 * seo-generator/run.js — builds the static SEO landing pages.
 *
 *   npm run seo:build     → writes seo/*.html, seo/index.html, sitemap.xml
 *   npm run seo:check     → dry run: renders everything in memory, writes nothing
 *
 * WHY STATIC: these pages exist to earn organic search traffic and hand it to the
 * app. They are plain HTML with no client fetches, so they cost ZERO Firestore
 * reads to serve (important while D1 read-cost is still open) and load instantly.
 *
 * WHAT IT DOES NOT DO: no per-company pages (founder: off until legal review), and
 * no invented statistics — see template.js for the honesty constraints.
 */

const fs = require('fs');
const path = require('path');
const { cities } = require('./cities');
const { renderPage, renderIndex, SITE } = require('./template');

const OUT_DIR = path.join(__dirname, '..', 'seo');
const SITEMAP = path.join(__dirname, '..', 'sitemap.xml');

function buildSitemap(list) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: SITE + '/', pri: '1.0' },
    { loc: SITE + '/seo/index.html', pri: '0.8' },
    ...list.map((c) => ({ loc: SITE + '/seo/' + c.slug + '.html', pri: '0.7' })),
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((u) => '  <url><loc>' + u.loc + '</loc><lastmod>' + today + '</lastmod><priority>' + u.pri + '</priority></url>')
      .join('\n') +
    '\n</urlset>\n'
  );
}

async function build({ write = true, companies = true } = {}) {
  const pages = cities.map((c) => ({ slug: c.slug, html: renderPage(c) }));
  const index = renderIndex(cities);

  /* v123 (founder-approved "safest way"): neutral per-company pages built from
     the company's OWN live postings + a claim-your-page CTA. Fetched once at
     build time; a network failure never breaks the city-page build. */
  let coPages = [], coList = [];
  if (companies) {
    try {
      const { buildCompanies } = require('./companies');
      const r = await buildCompanies();
      coPages = r.pages; coList = r.list;
    } catch (e) { console.warn('[seo] company pages skipped (build continues):', e.message); }
  }

  const sitemap = buildSitemap(cities.concat(coList));

  if (write) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const p of pages) fs.writeFileSync(path.join(OUT_DIR, p.slug + '.html'), p.html, 'utf8');
    for (const p of coPages) fs.writeFileSync(path.join(OUT_DIR, p.slug + '.html'), p.html, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'index.html'), index, 'utf8');
    fs.writeFileSync(SITEMAP, sitemap, 'utf8');
  }
  return { pages, index, sitemap, count: pages.length, companyCount: coPages.length };
}

module.exports = { build, buildSitemap };

if (require.main === module) {
  const dry = process.argv.includes('--check');
  // dry run stays fully OFFLINE (CI-safe): cities only, nothing written
  build({ write: !dry, companies: !dry }).then((r) => {
    console.log(
      (dry ? '[seo] DRY RUN — rendered ' : '[seo] wrote ') +
        r.count + ' city pages + index' +
        (r.companyCount ? (' + ' + r.companyCount + ' company pages') : '') +
        (dry ? '' : ' → seo/ , sitemap.xml') +
        ' (static, zero runtime reads)'
    );
  });
}
