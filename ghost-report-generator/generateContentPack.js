'use strict';
/* ============================================================================
 * GhostProofJob — Weekly Content Pack generator  (Sprint 4, growth automation)
 * ----------------------------------------------------------------------------
 * Turns the normalized weekly snapshot (getWeeklyGhostData) into a full week of
 * DRAFT social posts for the founder to review and post manually.
 *
 *   ⚠️ NEVER auto-posts. Output is text for human review only.
 *
 * DEFAMATION GUARDRAILS (baked in, unit-tested):
 *   • MIN_REPORTS — a company is NEVER named from fewer than N independent
 *     community reports. Below the threshold it is omitted entirely.
 *   • "Community-reported" framing ONLY — posts say "N hunters flagged slow/no
 *     responses at X", never "X ghosts applicants" (opinion/fact assertion).
 *   • No fabricated numbers — every figure traces to the passed-in data.
 *   • Ghost-JOB stats (stale posting rates) are framed factually ("postings
 *     30+ days old"), never as an accusation against a named company.
 *   • A positive GREEN-FLAG post balances the tone (responsive employers).
 * ==========================================================================*/

const MIN_REPORTS = 3;              // never name a company below this many reports
const BRAND = 'GhostProofJob';
const SITE = 'ghostproofjob.com';

function _pctWord(n) { return n + '%'; }

/* the ONLY sanctioned way a company name enters a post — community-framed, gated */
function safeCompanyMention(company, reports, minReports = MIN_REPORTS) {
  const co = String(company || '').trim();
  const n = Number(reports) || 0;
  if (!co || n < minReports) return null;                       // gate
  return n + ' job hunters have flagged slow or no responses at ' + co + ' (community-reported on ' + SITE + ')';
}

function _linkedIn(d) {
  const s = d.jobsStats;
  const topCity = (s.topStaleCities || [])[0];
  const lead = topCity
    ? 'In ' + topCity.city + ', ' + _pctWord(topCity.stalePct) + ' of open postings we tracked this week are ' + s.staleDays + '+ days old — a classic ghost-job signal.'
    : _pctWord(s.stalePct) + ' of the postings we tracked this week are ' + s.staleDays + '+ days old.';
  return {
    platform: 'LinkedIn', kind: 'ghost-stat',
    text: lead + '\n\nA role that has sat open for a month is often already filled, frozen, or never real. '
      + 'You deserve to know before you spend an hour tailoring a resume to it.\n\n'
      + BRAND + ' flags likely ghost jobs and surfaces verified ones — free until you’re hired. ' + SITE,
  };
}

function _reddit(d) {
  const s = d.jobsStats;
  return {
    platform: 'Reddit', kind: 'discussion',
    text: '[Data] I tracked ' + s.sampled.toLocaleString() + ' live job postings this week — '
      + _pctWord(s.stalePct) + ' were ' + s.staleDays + '+ days old.\n\n'
      + 'Not every stale posting is a ghost job, but a month-old "urgently hiring" listing is worth a skeptical look. '
      + 'How do you all decide whether a posting is still real before applying? '
      + '(I’ve been building a free tool that flags these — happy to share if useful, not trying to spam.)',
  };
}

function _tiktok(d) {
  const s = d.jobsStats;
  const topCity = (s.topStaleCities || [])[0];
  return {
    platform: 'TikTok', kind: 'script',
    text: 'HOOK: "That job you’re about to apply to? It might already be gone."\n'
      + 'BEAT 1: ' + (topCity ? _pctWord(topCity.stalePct) + ' of postings in ' + topCity.city : _pctWord(s.stalePct) + ' of postings')
      + ' we checked this week are over a month old.\n'
      + 'BEAT 2: Old postings = often filled, frozen, or fake. You apply into the void.\n'
      + 'BEAT 3: Check the posting age before you apply. Or let a free tool flag it for you.\n'
      + 'CTA: ' + SITE + ' — free until you’re hired. #jobsearch #ghostjobs #hiring',
  };
}

function _x(d) {
  const s = d.jobsStats;
  return {
    platform: 'X', kind: 'short',
    text: _pctWord(s.stalePct) + ' of the ' + s.sampled.toLocaleString() + ' job postings we tracked this week are '
      + s.staleDays + '+ days old.\n\nOld posting ≠ open role. Check the age before you apply. ' + SITE,
  };
}

function _tip(d) {
  return {
    platform: 'tip', kind: 'green-tip',
    text: 'Ghost-job tip of the week: before applying, check when the posting went up. '
      + 'If it’s 30+ days old and still says "urgent," open the company careers page — if it’s not there, it’s likely filled or frozen. '
      + 'Two minutes saves you an hour of tailoring.',
  };
}

function _greenFlag(d) {
  const gf = (d.greenFlags || [])[0];
  if (gf && gf.company) {
    return {
      platform: 'green-flag', kind: 'positive',
      text: 'Green flag ✅ ' + gf.company + (gf.note ? (' — ' + gf.note) : ' keeps candidates informed and responds.')
        + '\n\nWe don’t just call out ghosting — responsive employers deserve the shout-out. ' + SITE,
    };
  }
  return {
    platform: 'green-flag', kind: 'positive',
    text: 'Green flag ✅: employers who reply to every applicant — even a no — make the whole market better. '
      + 'If a company kept you informed this week, name them in the replies. Let’s reward the good ones. ' + SITE,
  };
}

/* community-report posts (only when real, gated aggregate exists) */
function _communityPosts(d) {
  const out = [];
  (d.reportedCompanies || []).forEach((c) => {
    const mention = safeCompanyMention(c.company, c.reports);
    if (!mention) return;   // below threshold → omitted, never named
    out.push({
      platform: 'X', kind: 'community-report',
      text: mention + '.\n\nIf you’ve applied there, you’re not imagining the silence. Report + check ghost scores free at ' + SITE,
    });
  });
  return out;
}

function generateContentPack(data, opts = {}) {
  const minReports = opts.minReports || MIN_REPORTS;
  const posts = [_linkedIn(data), _reddit(data), _tiktok(data), _x(data), _tip(data), _greenFlag(data)];
  const community = _communityPosts(data);
  const omittedCompanies = (data.reportedCompanies || [])
    .filter((c) => (Number(c.reports) || 0) < minReports)
    .map((c) => c.company);
  return {
    weekOf: data.weekOf,
    generatedAt: new Date().toISOString(),
    disclaimer: 'DRAFTS for founder review — nothing here is posted automatically. Verify before posting.',
    posts: posts.concat(community),
    omittedBelowThreshold: omittedCompanies,   // named here for the founder, NOT in any post
    note: data._note,
  };
}

/* render the pack as a review-friendly markdown file */
function renderMarkdown(pack) {
  const lines = [];
  lines.push('# ' + BRAND + ' — Weekly Content Pack (' + pack.weekOf + ')');
  lines.push('');
  lines.push('> ' + pack.disclaimer);
  if (pack.note) lines.push('>');
  if (pack.note) lines.push('> ' + pack.note);
  lines.push('');
  pack.posts.forEach((p, i) => {
    lines.push('## ' + (i + 1) + '. ' + p.platform + '  ·  _' + p.kind + '_');
    lines.push('');
    lines.push(p.text);
    lines.push('');
  });
  if (pack.omittedBelowThreshold && pack.omittedBelowThreshold.length) {
    lines.push('---');
    lines.push('_Companies with reports below the ' + MIN_REPORTS + '-report threshold (NOT named in any post): '
      + pack.omittedBelowThreshold.length + ' held back for now._');
  }
  return lines.join('\n');
}

module.exports = { generateContentPack, renderMarkdown, safeCompanyMention, MIN_REPORTS };
