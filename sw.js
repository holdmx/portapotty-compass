// The Golden Compass — offline cache
// Bump CACHE_NAME when app files change to force clients to refresh.
const CACHE_NAME = 'playa-compass-v13';
// style.css/app.js/data.js are requested with a ?v= query from index.html
// (bump both together when editing those files) so the cache API's
// exact-URL match can't silently serve a stale copy after an update.
const ASSETS = [
  './',
  './index.html',
  './style.css?v=13',
  './app.js?v=13',
  './data.js?v=13',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Deliberately not cache.addAll: that rejects atomically, so one bad
      // entry would leave the app with no offline cache at all — the failure
      // mode that matters most here, since there is no signal on playa to
      // retry from.
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain' },
  });
}

// Cache-first: this app has no server/API to talk to, everything it needs
// ships in the bundle, so once cached it works with zero signal on playa.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      }).catch(() => {
        // Offline and no exact cache hit. A page load must still give the
        // user their compass: cache matching is exact, so launching with any
        // URL variant (?utm=…, a stale home-screen entry) would otherwise
        // miss and leave them staring at an error with no signal to recover
        // from. Serve the cached shell for navigations instead.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html')
            .then((shell) => shell || caches.match('./'))
            .then((shell) => shell || offlineResponse());
        }
        // Sub-resources genuinely aren't there: fail cleanly. `cached` is
        // always undefined here, and respondWith(undefined) would throw a
        // TypeError rather than surfacing a real response.
        return offlineResponse();
      });
    })
  );
});
