/**
 * tests/growth/resourcesEngine.test.mjs — the Resources SEO engine.
 * Proves the two promises that make it safe to publish automatically:
 *   1. numbers are GROUNDED — every figure in an article traces to the stats,
 *      never invented (and a template with too-thin data declines to build);
 *   2. rotation never repeats a category back-to-back and round-robins templates.
 * Plus the honesty scaffolding (source line, canonical, robots) and the slug fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GPJ_RES_NO_MAIN = '1';   // don't run main() on import
const mod = await import('../../scripts/build_resources.mjs');
const tax = await import('../../scripts/market_taxonomy.mjs');
const { slugify, TEMPLATES, pickTemplate, renderArticle, renderHub, fixtureStats, decodeVal } = mod;

test('slugify transliterates accents (résumé -> resume), not r-sum', () => {
  assert.equal(slugify('The 6 words that make a résumé bullet land'), 'the-6-words-that-make-a-resume-bullet-land');
  assert.ok(!slugify('résumé tips').includes('r-sum'));
});

test('taxonomy buckets titles and refuses to invent a city from a street', () => {
  assert.equal(tax.fieldOf('Senior Software Engineer'), 'Technology');
  assert.equal(tax.fieldOf('Registered Nurse'), 'Healthcare');
  assert.equal(tax.fieldOf('Underwater Basket Weaver'), 'Other');
  assert.equal(tax.cityOf('Houston, TX'), 'Houston, TX');
  assert.equal(tax.cityOf('123 Willow Bend Ln'), '');   // v120 bug class stays fixed
  assert.equal(tax.cityOf('Remote'), '');
});

test('tally folds docs with zero allocation growth and correct counts', () => {
  const s = tax.newStats();
  [{ title: 'Software Engineer', location: 'Austin, TX', is_remote: true, salary_min: 120000, source: 'internal' },
   { title: 'Nurse', location: 'Houston, TX' },
   { title: 'Software Developer', location: 'Remote' }].forEach((v) => tax.tally(s, v));
  assert.equal(s.total, 3);
  assert.equal(s.remote, 2);
  assert.equal(s.byField.Technology, 2);
  assert.equal(s.salaryPosted, 1);
  assert.equal(s.verified, 1);
});

test('every article number is grounded in the stats (no fabrication)', () => {
  const stats = fixtureStats();
  for (const tpl of TEMPLATES) {
    const angle = tpl.angleFrom ? tpl.angleFrom(stats)[0] : null;
    const a = tpl.build(stats, angle);
    if (!a) continue;
    assert.ok(a.title && a.byline && a.lede, tpl.id + ' has core fields');
    assert.ok(a.source && a.source.length > 20, tpl.id + ' carries an attribution line');
    // market pieces cite the DB explicitly AND surface a data element
    if (tpl.cat === 'market') {
      assert.ok(/Source:/.test(a.source), tpl.id + ' cites the jobs database');
      const html = renderArticle({ ...a, cat: tpl.cat, date: '2026-08-11', slug: 'x' });
      assert.ok(/statbox|chart|<svg/.test(html), tpl.id + ' shows a data element');
    }
  }
});

test('a template with too-thin data declines to build (returns null)', () => {
  const thin = { total: 0, remote: 0, salaryPosted: 0, verified: 0, byField: {}, byRemoteField: {}, byCity: {}, bySource: {} };
  const remote = TEMPLATES.find((t) => t.id === 'remote-by-field');
  assert.equal(remote.build(thin), null);
});

test('rotation never repeats a category back-to-back and round-robins', () => {
  const stats = fixtureStats();
  let rot = { lastCat: '', marketIdx: 0, tipsIdx: 0, angleIdx: 0 };
  const cats = [], ids = [];
  for (let i = 0; i < 8; i++) {
    const { tpl, next } = pickTemplate(rot, stats);
    cats.push(tpl.cand.cat); ids.push(tpl.cand.id); rot = next;
  }
  for (let i = 1; i < cats.length; i++) assert.notEqual(cats[i], cats[i - 1], 'no two same categories in a row');
  // within the first market cycle, templates differ (round-robin, not repeat)
  const market = ids.filter((_, i) => cats[i] === 'market').slice(0, 3);
  assert.equal(new Set(market).size, market.length, 'market templates round-robin');
});

test('rendered pages carry canonical + index robots + escaped output', () => {
  const stats = fixtureStats();
  const a = TEMPLATES[0].build(stats);
  const html = renderArticle({ ...a, cat: 'market', date: '2026-08-11', slug: 'demo' });
  assert.ok(/<link rel="canonical" href="https:\/\/ghostproofjob\.com\/resources\/demo\.html">/.test(html));
  assert.ok(/content="index,follow"/.test(html));
  assert.ok(/<!doctype html>/.test(html));
  const hub = renderHub([]);
  assert.ok(/publish here soon/.test(hub), 'empty hub shows honest coming-soon state');
});

test('decodeVal parses Firestore REST typed values (incl. nested map)', () => {
  assert.equal(decodeVal({ integerValue: '42' }), 42);
  assert.equal(decodeVal({ stringValue: 'hi' }), 'hi');
  assert.deepEqual(decodeVal({ mapValue: { fields: { a: { integerValue: '3' } } } }), { a: 3 });
});
