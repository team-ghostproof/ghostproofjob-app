// ============================================================================
// GhostProofJob — Recruiter corporate-domain email check (R1, backend)
// ----------------------------------------------------------------------------
// Verification v1 (recruiter-tier.md §1): block free/consumer + disposable/burner
// email domains at recruiter signup. A corporate domain is NECESSARY but NOT
// sufficient — `isValidated:false` + a manual admin spot-check for the first
// cohort still gate "Verified Employer". Pure + unit-testable in-repo (NOT locked
// in the Worker), same rule as the reverse-match scorer.
// ============================================================================
'use strict';

// Consumer/free mailbox providers — a recruiter must use a company domain.
const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'zoho.com',
  'yandex.com', 'mail.com', 'mail.ru', 'inbox.com', 'fastmail.com',
  'hey.com', 'tutanota.com', 'tuta.io', 'hushmail.com', 'comcast.net',
  'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'charter.net',
  'bellsouth.net', 'earthlink.net', 'juno.com', 'ntlworld.com', 'btinternet.com',
]);

// Disposable / burner domains + patterns.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'throwawaymail.com',
  'yopmail.com', 'getnada.com', 'dispostable.com', 'trashmail.com', 'maildrop.cc',
  'mailnesia.com', 'fakeinbox.com', 'moakt.com', 'tempail.com', 'emailondeck.com',
  'mohmal.com', 'spam4.me', 'mytemp.email', 'burnermail.io', 'mailcatch.com',
]);
const DISPOSABLE_PATTERN = /(^|\.)(mailinator|guerrilla|tempmail|temp-mail|throwaway|10minute|trashmail|yopmail|getnada|dispostable|maildrop|fakeinbox|mohmal|burner)/i;

const EMAIL_RX = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/**
 * @param {string} email
 * @returns {{ ok:boolean, domain:string, reason:string }}
 *   ok=true  → a plausible corporate domain (still needs admin spot-check).
 *   ok=false → reason ∈ 'invalid' | 'free_provider' | 'disposable'.
 */
function checkRecruiterEmail(email) {
  const m = EMAIL_RX.exec(String(email || '').trim().toLowerCase());
  if (!m) return { ok: false, domain: '', reason: 'invalid' };
  const domain = m[1];
  if (FREE_PROVIDERS.has(domain)) return { ok: false, domain, reason: 'free_provider' };
  if (DISPOSABLE_DOMAINS.has(domain) || DISPOSABLE_PATTERN.test(domain)) {
    return { ok: false, domain, reason: 'disposable' };
  }
  // a bare TLD-less or single-label domain is not a real company domain
  if (domain.split('.').length < 2) return { ok: false, domain, reason: 'invalid' };
  return { ok: true, domain, reason: 'corporate' };
}

/** Human-readable message for a rejected recruiter email. */
function rejectionMessage(reason) {
  switch (reason) {
    case 'free_provider':
      return 'Please use your company email — free inboxes (Gmail, Yahoo, Outlook…) can’t be verified as an employer.';
    case 'disposable':
      return 'That looks like a temporary/disposable address. Use your real company email.';
    case 'invalid':
      return 'Enter a valid company email address.';
    default:
      return 'Use your company email to continue.';
  }
}

module.exports = { checkRecruiterEmail, rejectionMessage, FREE_PROVIDERS, DISPOSABLE_DOMAINS };
