'use strict';
/* CLI: produce this week's content pack for founder review.
 *   node ghost-report-generator/run.js              # LIVE (needs FIREBASE_SERVICE_ACCOUNT)
 *   node ghost-report-generator/run.js --fixture    # offline sample from fixtures/
 * Writes content-packs/<weekOf>.md and .json. NEVER posts anything. */
const fs = require('fs');
const path = require('path');
const { getWeeklyGhostData } = require('./getWeeklyGhostData');
const { generateContentPack, renderMarkdown } = require('./generateContentPack');

(async () => {
  const useFixture = process.argv.includes('--fixture');
  let fixture = null;
  if (useFixture) fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-week.json'), 'utf8'));
  const data = await getWeeklyGhostData(fixture ? { fixture } : {});
  const pack = generateContentPack(data);
  const outDir = path.join(__dirname, '..', 'content-packs');
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, pack.weekOf);
  fs.writeFileSync(base + '.md', renderMarkdown(pack));
  fs.writeFileSync(base + '.json', JSON.stringify(pack, null, 2));
  console.log('Wrote ' + base + '.md (' + pack.posts.length + ' draft posts). Review before posting — nothing was published.');
  if (data._note) console.log('NOTE: ' + data._note);
})().catch((e) => { console.error('content pack failed:', e.message); process.exit(1); });
