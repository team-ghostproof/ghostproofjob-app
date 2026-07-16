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

function build({ write = true } = {}) {
  const pages = cities.map((c) => ({ slug: c.slug, html: renderPage(c) }));
  const index = renderIndex(cities);
  const sitemap = buildSitemap(cities);

  if (write) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const p of pages) fs.writeFileSync(path.join(OUT_DIR, p.slug + '.html'), p.html, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'index.html'), index, 'utf8');
    fs.writeFileSync(SITEMAP, sitemap, 'utf8');
  }
  return { pages, index, sitemap, count: pages.length };
}

module.exports = { build, buildSitemap };

if (require.main === module) {
  const dry = process.argv.includes('--check');
  const r = build({ write: !dry });
  console.log(
    (dry ? '[seo] DRY RUN — rendered ' : '[seo] wrote ') +
      r.count +
      ' city pages + index' +
      (dry ? '' : ' → seo/ , sitemap.xml') +
      ' (static, zero runtime reads)'
  );
}
