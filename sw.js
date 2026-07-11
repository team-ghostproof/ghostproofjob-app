/* GhostProofJob service worker — versioned cache with auto-update
   ================================================================
   HOW TO USE: every time you deploy a new index.html, change CACHE_VERSION
   below (e.g. bump the number). That tells every installed app a new version
   exists, triggers the in-app "Refresh" banner, and clears the old cache so
   home-screen users (like Kristina) never get stuck on a stale build.
*/
const CACHE_VERSION = 'gpj-v101';          // <-- BUMP THIS on every deploy
const CACHE_NAME = CACHE_VERSION;

// install: cache the shell, then become the waiting worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      './',
      './index.html',
      '/manifest.webmanifest',
      '/assets/logo.png',
      '/assets/icon-192.png',
      '/assets/icon-512.png',
      '/assets/icon-maskable-512.png',
      '/assets/apple-touch-icon.png',
      '/assets/favicon-32.png'
    ])).catch(() => {})
  );
  // do NOT skipWaiting here — we wait for the user to tap "Refresh" so we don't
  // yank the page out from under them mid-action
});

// activate: delete old version caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// the app posts this when the user taps "Refresh" on the update banner
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// fetch: network-first for the HTML (so updates show fast), cache fallback offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never cache Firestore / Cloud Functions / OpenAI / cross-origin API calls
  if (url.origin !== self.location.origin) return;

  // HTML: network-first (always try for the freshest version)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // other same-origin assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => cached))
  );
});
