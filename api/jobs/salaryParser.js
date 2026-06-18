'use strict';
/**
 * api/jobs/salaryParser.js
 * Normalizes raw salary strings into numeric annual {salary_min, salary_max}.
 * Additive only — never alters the core schema keys.
 *
 * Handles:
 *   "$55k - $75k"            -> { salary_min: 55000,  salary_max: 75000 }
 *   "$120,000/year"          -> { salary_min: 120000, salary_max: 120000 }
 *   "$19.66 - $34.59 / hour" -> hourly *2080 -> annualized
 *   "Up to $90k"             -> { salary_min: 0,      salary_max: 90000 }
 *   "From 60000"             -> { salary_min: 60000,  salary_max: 0 }
 *   "" / "Salary on request" -> { salary_min: 0,      salary_max: 0 }
 */

const HOURS_PER_YEAR = 2080;

function num(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/,/g, '');
  const k = /k\b/.test(s);
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (k) n *= 1000;
  return n;
}

function annualize(n, isHourly) {
  if (n == null) return 0;
  if (isHourly) return Math.round(n * HOURS_PER_YEAR);
  return Math.round(n);
}

/**
 * @param {string} raw salary text
 * @returns {{salary_min:number, salary_max:number}}
 */
function parseSalary(raw) {
  const out = { salary_min: 0, salary_max: 0 };
  if (!raw) return out;
  const s = String(raw).toLowerCase();
  const isHourly = /\/\s*h|per\s*hour|hourly|\bhr\b|an hour/.test(s);

  // grab up to two numeric tokens (with optional k / decimal)
  const tokens = s.match(/\$?\s*\d[\d,]*(\.\d+)?\s*k?/g) || [];
  const nums = tokens.map((t) => num(t)).filter((v) => v != null && v > 0);

  if (!nums.length) return out;

  let lo = nums[0];
  let hi = nums.length > 1 ? nums[1] : nums[0];

  // "up to X" / "max X" => min unknown
  if (/\bup to\b|\bmax(imum)?\b|\bunder\b/.test(s) && nums.length === 1) {
    lo = 0; hi = nums[0];
  }
  // "from X" / "starting X" / "min X" => max unknown
  if (/\bfrom\b|\bstarting\b|\bmin(imum)?\b|\bat least\b/.test(s) && nums.length === 1) {
    lo = nums[0]; hi = 0;
  }

  out.salary_min = annualize(lo, isHourly);
  out.salary_max = annualize(hi, isHourly);

  // normalize ordering when both present
  if (out.salary_min && out.salary_max && out.salary_min > out.salary_max) {
    const t = out.salary_min; out.salary_min = out.salary_max; out.salary_max = t;
  }
  return out;
}

module.exports = { parseSalary, annualize };
