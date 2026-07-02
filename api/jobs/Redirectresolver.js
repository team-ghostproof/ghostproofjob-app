'use strict';
/**
 * LAYER 3 — PUPPETEER-CORE REDIRECT RESOLVER (Firebase-optimized)
 * ----------------------------------------------------------------
 * Resolves an aggregator link (Jooble / Adzuna) through its redirect chain to
 * the final employer destination, returning a clean URL.
 *
 * v68 FIX: file is named `redirectResolver.js` to MATCH `require('./redirectResolver')`
 * in regionalRouter.js (Vercel's filesystem is case-sensitive; the old
 * `Redirectresolver.js` never loaded). Exports also expose `resolve` as an alias of
 * `resolveLink`, which is the method regionalRouter actually calls.
 *
 * Designed for Firebase Cloud Functions memory limits (512MB-2GB):
 *   - puppeteer-core + @sparticuz/chromium (no bundled full Chrome).
 *   - Single page, request interception to BLOCK images/fonts/media/css so the
 *     navigation is light and fast (we only need the redirect chain).
 *   - Hard navigation timeout, and a `finally` that ALWAYS closes the browser -
 *     a leaked Chromium process is the #1 cause of OOM in serverless.
 *
 * Cold-start note: launch is the expensive part; resolve a small BATCH per
 * invocation (resolveBatch) so one browser amortizes across many links.
 *
 * Deps (functions/package.json):
 *   "puppeteer-core": "^22.x", "@sparticuz/chromium": "^123.x"
 */

let puppeteer;
let chromium;
try {
  puppeteer = require('puppeteer-core');
  chromium = require('@sparticuz/chromium');
} catch (e) {
  // Allow the module to load in environments without the heavy deps (e.g. unit
  // tests of the URL helpers); launch() will throw a clear error if actually used.
  puppeteer = null;
  chromium = null;
}

const NAV_TIMEOUT_MS = 15000;
const MAX_HOPS = 6;
const BLOCK_TYPES = new Set(['image', 'media', 'font', 'stylesheet', 'imageset']);
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'aff', 'affid', 'ref', 'source', 'mc_cid', 'mc_eid'];

/** Strip common tracking params for a clean destination URL. */
function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    // drop a trailing "?" if no params remain
    return u.toString().replace(/\?$/, '');
  } catch (e) {
    return raw;
  }
}

/** Some aggregators expose the real URL as a query param - unwrap without a browser. */
function unwrapParamUrl(raw) {
  try {
    const u = new URL(raw);
    for (const key of ['url', 'u', 'to', 'dest', 'destination', 'target', 'link', 'r', 'redirect', 'out']) {
      const v = u.searchParams.get(key);
      if (v && /^https?:\/\//i.test(decodeURIComponent(v))) return decodeURIComponent(v);
    }
  } catch (e) { /* fall through */ }
  return null;
}

/** Launch a single hardened, low-memory Chromium instance. */
async function launchBrowser() {
  if (!puppeteer || !chromium) {
    throw new Error('puppeteer-core / @sparticuz/chromium not installed in this runtime');
  }
  return puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'],
    defaultViewport: { width: 800, height: 600 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
}

/**
 * Resolve ONE url on an already-open browser. Caller owns the browser lifecycle.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} inputUrl
 * @returns {Promise<{url:string, resolved:boolean}>}
 */
async function resolveOnBrowser(browser, inputUrl) {
  if (!/^https?:\/\//i.test(inputUrl || '')) return { url: inputUrl, resolved: false };

  // Cheap path first: if the real URL is a query param, skip the browser entirely.
  const unwrapped = unwrapParamUrl(inputUrl);
  if (unwrapped) return { url: cleanUrl(unwrapped), resolved: true };

  let page;
  try {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // Block heavy resources; we only care about the navigation/redirect chain.
      if (BLOCK_TYPES.has(req.resourceType())) return req.abort();
      return req.continue();
    });

    let hops = 0;
    page.on('response', (resp) => {
      const s = resp.status();
      if (s >= 300 && s < 400) hops++;
    });

    await page.goto(inputUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    // Give a brief moment for any JS-driven meta/JS redirect to settle, capped.
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 3000 }).catch(() => {});

    const finalUrl = page.url();
    const resolved = hops > 0 || finalUrl !== inputUrl;
    return { url: cleanUrl(finalUrl), resolved };
  } catch (err) {
    // Honest fallback: never return a broken link - give back the original.
    console.error('[resolver] nav failed:', err && err.message);
    return { url: inputUrl, resolved: false };
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * Resolve a single aggregator link. Launches + tears down its own browser.
 * Prefer resolveBatch when you have several links (amortizes cold start).
 * @param {string} inputUrl
 * @returns {Promise<{url:string, resolved:boolean}>}
 */
async function resolveLink(inputUrl) {
  const quick = unwrapParamUrl(inputUrl);
  if (quick) return { url: cleanUrl(quick), resolved: true };

  let browser;
  try {
    browser = await launchBrowser();
    return await resolveOnBrowser(browser, inputUrl);
  } catch (err) {
    console.error('[resolver] launch failed:', err && err.message);
    return { url: inputUrl, resolved: false };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * Resolve a batch of links on ONE browser instance (sequential to bound memory).
 * The browser is guaranteed to close even if individual links throw.
 * @param {string[]} urls
 * @returns {Promise<Array<{input:string, url:string, resolved:boolean}>>}
 */
async function resolveBatch(urls) {
  const list = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u) : [];
  if (!list.length) return [];

  // Resolve everything we can without a browser first.
  const results = new Array(list.length);
  const needBrowser = [];
  list.forEach((u, i) => {
    const quick = unwrapParamUrl(u);
    if (quick) results[i] = { input: u, url: cleanUrl(quick), resolved: true };
    else needBrowser.push(i);
  });

  if (!needBrowser.length) return results;

  let browser;
  try {
    browser = await launchBrowser();
    // Sequential: one page at a time keeps peak memory flat in serverless.
    for (const i of needBrowser) {
      const r = await resolveOnBrowser(browser, list[i]);
      results[i] = { input: list[i], url: r.url, resolved: r.resolved };
    }
  } catch (err) {
    console.error('[resolver] batch launch failed:', err && err.message);
    // Fill any unresolved slots with honest fallbacks.
    for (const i of needBrowser) {
      if (!results[i]) results[i] = { input: list[i], url: list[i], resolved: false };
    }
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
    }
  }

  // Guarantee no holes.
  for (let i = 0; i < list.length; i++) {
    if (!results[i]) results[i] = { input: list[i], url: list[i], resolved: false };
  }
  return results;
}

module.exports = { resolveLink, resolveBatch, cleanUrl, unwrapParamUrl };
module.exports.resolve = resolveLink; // alias: regionalRouter calls resolver.resolve(...)
