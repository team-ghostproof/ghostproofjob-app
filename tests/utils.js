/* ───────────────────────────────────────────────────────────────────────────
   GhostProofJob — shared Playwright test utilities ([STATE-COVERAGE] rule,
   CLAUDE.md §3 rule 9). Quadrant 3 (Interrupted/Failed network) and Quadrant 4
   (Empty/Missing data) for any surface that talks to Firestore or the
   Cloudflare Worker.

   Usage in a spec (install routes BEFORE the goto / action that fetches):
     const { mockNetworkFailure, mockEmptyData, FIRESTORE_URLS, WORKER_URLS } = require('./utils');
     await mockNetworkFailure(page, FIRESTORE_URLS);   // Firestore unreachable
     await mockEmptyData(page, WORKER_URLS);           // Worker returns nothing

   NOTE: Firestore reads run over a WebChannel protocol, so for Firestore the
   high-fidelity "empty data" simulation is usually mockNetworkFailure (drives
   the app's catch/degrade paths) or seeding the pool via page.evaluate — a
   plain '[]' body only fully applies to REST-shaped endpoints like the
   Worker. Pass a custom body when an endpoint expects a specific shape.
   ─────────────────────────────────────────────────────────────────────────── */

const FIRESTORE_URLS = '**/*firestore.googleapis.com/**';
const WORKER_URLS = '**/*ghostproofjob-worker*/**';

/** Quadrant 3: abort every matching request with a network-level failure. */
async function mockNetworkFailure(page, urlPattern) {
  await page.route(urlPattern, (route) => route.abort('failed'));
}

/** Quadrant 4: fulfill matching requests with an empty (or custom) payload. */
async function mockEmptyData(page, urlPattern, body) {
  await page.route(urlPattern, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: body !== undefined ? body : '[]',
  }));
}

module.exports = { mockNetworkFailure, mockEmptyData, FIRESTORE_URLS, WORKER_URLS };
