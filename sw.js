// The Golden Compass — offline cache
// Bump CACHE_NAME when app files change to force clients to refresh.
const CACHE_NAME = 'playa-compass-v9';
// style.css/app.js/data.js are requested with a ?v= query from index.html
// (bump both together when editing those files) so the cache API's
// exact-URL match can't silently serve a stale copy after an update.
const ASSETS = [
  './',
  './index.html',
  './style.css?v=9',
  './app.js?v=9',
  './data.js?v=9',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

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
      }).catch(() => cached);
    })
  );
});
