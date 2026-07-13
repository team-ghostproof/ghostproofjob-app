// ============================================================================
// GhostProofJob — ghost-content engine tests (Sprint 4 growth automation)
// Pure-JS (node:test) — NO Firestore, NO firebase-admin. Runs via `npm run
// test:growth`. Proves the defamation guardrails + no-fabrication invariants.
// ============================================================================
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getWeeklyGhostData, aggregateJobs, aggregateReports } = require('../../ghost-report-generator/getWeeklyGhostData.js');
const { generateContentPack, renderMarkdown, safeCompanyMention, MIN_REPORTS } = require('../../ghost-report-generator/generateContentPack.js');

const fixture = JSON.parse(readFileSync(new URL('../../ghost-report-generator/fixtures/sample-week.json', import.meta.url)));

describe('aggregation is factual', () => {
  test('stale rate + per-city rates come straight from posting ages', () => {
    const s = aggregateJobs(fixture.jobs);
    assert.equal(s.sampled, 18);
    // Houston: 8 sampled, stale(>=30): 41,55,38,47,33 = 5 -> 63%
    const hou = s.topStaleCities.find((c) => c.city === 'Houston');
    assert.equal(hou.sampled, 8);
    assert.equal(hou.stalePct, 63);
    assert.ok(s.stalePct > 0 && s.stalePct <= 100);
  });
  test('thin cities (< MIN_CITY_SAMPLE) are not published', () => {
    const s = aggregateJobs([{ location: 'Tinytown, TX', posting_age_days: 90 }]);
    assert.equal(s.topStaleCities.length, 0, 'a 1-sample city must not yield a published rate');
  });
  test('report aggregation counts per company', () => {
    const r = aggregateReports(fixture.reports);
    const vw = r.find((x) => x.company === 'Vaporware Staffing');
    assert.equal(vw.reports, 4);
    assert.equal(r.find((x) => x.company === 'OneOff LLC').reports, 1);
  });
});

describe('defamation guardrails', () => {
  test('safeCompanyMention gates below MIN_REPORTS and never asserts fact', () => {
    assert.equal(safeCompanyMention('OneOff LLC', 1), null, 'below threshold -> omitted');
    assert.equal(safeCompanyMention('X', MIN_REPORTS - 1), null);
    const ok = safeCompanyMention('Vaporware Staffing', 4);
    assert.ok(ok.includes('community-reported'), 'must carry community-reported framing');
    assert.ok(/flagged slow or no responses/.test(ok), 'describes reports, not a verdict');
    assert.ok(!/ghosts applicants|scam|fraud|liar|worst/i.test(ok), 'never an accusation/verdict');
  });

  test('a below-threshold company is NEVER named in any post, but is surfaced to the founder', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const pack = generateContentPack(data);
    const allText = pack.posts.map((p) => p.text).join('\n');
    assert.ok(!allText.includes('OneOff LLC'), 'the 1-report company must not appear in any post');
    assert.ok(allText.includes('Vaporware Staffing'), 'the 4-report company may appear (community-framed)');
    assert.ok(pack.omittedBelowThreshold.includes('OneOff LLC'), 'held-back companies are listed for the founder only');
  });

  test('nothing in the pack claims a specific company "ghosts" as fact', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const pack = generateContentPack(data);
    pack.posts.forEach((p) => {
      assert.ok(!/\b\w+ (ghosts|scams|defrauds)\b/i.test(p.text), 'no verdict phrasing: ' + p.text.slice(0, 60));
    });
  });
});

describe('content pack shape', () => {
  test('all six required post types are present + never-auto-post disclaimer', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const pack = generateContentPack(data);
    const platforms = new Set(pack.posts.map((p) => p.platform));
    ['LinkedIn', 'Reddit', 'TikTok', 'X', 'tip', 'green-flag'].forEach((pl) => assert.ok(platforms.has(pl), 'missing ' + pl));
    assert.match(pack.disclaimer, /nothing here is posted automatically/i);
  });

  test('green-flag post is positive (balances the tone)', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const pack = generateContentPack(data);
    const gf = pack.posts.find((p) => p.platform === 'green-flag');
    assert.ok(gf.text.includes('Bright Ops Co'), 'uses the fixture green-flag company');
    assert.match(gf.text, /✅|green flag/i);
  });

  test('every number in the stat posts traces to the data (no fabrication)', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const pack = generateContentPack(data);
    const x = pack.posts.find((p) => p.platform === 'X');
    assert.ok(x.text.includes(String(data.jobsStats.stalePct)), 'X post uses the real stale %');
    assert.ok(x.text.includes(data.jobsStats.sampled.toLocaleString()), 'X post uses the real sample size');
  });

  test('markdown renders and carries the review disclaimer', async () => {
    const data = await getWeeklyGhostData({ fixture });
    const md = renderMarkdown(generateContentPack(data));
    assert.match(md, /Weekly Content Pack/);
    assert.match(md, /founder review/i);
  });

  test('with NO report aggregate (F-GHOST unbuilt), community posts are omitted, stats still ship', async () => {
    const data = await getWeeklyGhostData({ fixture: { jobs: fixture.jobs, reports: [] } });
    const pack = generateContentPack(data);
    assert.ok(!pack.posts.some((p) => p.kind === 'community-report'), 'no community posts without reports');
    assert.ok(pack.posts.some((p) => p.kind === 'ghost-stat'), 'ghost-job stat posts still ship');
    assert.match(data._note, /F-GHOST/);
  });
});
