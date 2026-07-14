'use strict';
// ============================================================================
// GhostProofJob — Match-Token Builder  (R3 backend, recruiter-tier.md §2/§5)
// ----------------------------------------------------------------------------
// Extracts a SMALL per-candidate token doc from each OPTED-IN (discoverable)
// profile, so the reverse-match scorer reads tiny docs instead of full profiles
// (keeps Firestore reads bounded — D1). Backend-only (firebase-admin); the pure
// projection `profileToToken` is unit-tested with fixtures.
//
// Writes match_tokens/{uid} = { uid, title, skills[], market, is_remote,
//   discoverable, displayName, contact }   (contact present ONLY when the
//   candidate is discoverable — that flag IS the consent to be contacted).
// ============================================================================

function _split(s) { return String(s || '').split(/[·,\n]/).map((x) => x.trim()).filter(Boolean); }
function _market(profile) {
  const loc = profile.location || profile.market || (profile.addr && [profile.addr.city, profile.addr.state].filter(Boolean).join(', ')) || '';
  return String(loc).trim();
}
function _displayName(profile) {
  const r = profile.resume || {};
  const n = (r.name || [profile.first, profile.last].filter(Boolean).join(' ') || '').trim();
  return n;
}
function _contact(profile) {
  const r = profile.resume || {};
  return String(r.contact || profile.email || '').trim();
}

/** Pure: profile doc → token doc, or null if the candidate hasn't opted in. */
function profileToToken(uid, profile) {
  if (!uid || !profile) return null;
  if (profile.discoverable !== true) return null;              // consent gate — no opt-in, no token
  const r = profile.resume || {};
  const title = String(r.title || (Array.isArray(r.jobs) && r.jobs[0] && r.jobs[0].t) || '').trim();
  const skills = _split(r.skills).slice(0, 20);
  const market = _market(profile);
  if (!title && !skills.length) return null;                   // nothing to match on
  return {
    uid,
    title,
    skills,
    market,
    is_remote: profile.openToRemote === true || /remote/i.test(market),
    discoverable: true,
    displayName: _displayName(profile),                        // shown only to verified recruiters
    contact: _contact(profile),                                // discoverable == consented to contact
  };
}

/** Orchestration: read discoverable profiles, (re)write their match_tokens.
 *  Deletes the token when a candidate has opted back out. Requires firebase-admin. */
async function run(db, opts) {
  opts = opts || {};
  const cap = opts.cap || 5000;
  const snap = await db.collection('profiles').where('discoverable', '==', true).limit(cap).get();
  let wrote = 0;
  const batchSize = 400;
  let batch = db.batch(); let pending = 0;
  for (const d of snap.docs) {
    const tok = profileToToken(d.id, d.data() || {});
    if (!tok) continue;
    batch.set(db.collection('match_tokens').doc(d.id), tok, { merge: true });
    wrote++; pending++;
    if (pending >= batchSize) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending) await batch.commit();
  return { discoverable: snap.size, tokensWritten: wrote };
}

module.exports = { profileToToken, run };
