'use strict';
/* DM Motor Group — service worker: app shell + offline fallback */
const CACHE = 'dm-v18';
const ASSETS = ['/', '/styles.css?v=10', '/app.js?v=17', '/manifest.webmanifest', '/assets/icon.svg', '/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  /* Never intercept cross-origin requests (video/audio streams, posters,
   * Google Fonts): re-fetching them inside the SW breaks range requests and
   * CORS handling, producing net::ERR_FAILED / Format error -> black video.
   * They must go straight to the network. */
  if (url.origin !== self.location.origin) return;
  // API + video/image uploads: always network (never cache inventory or media streams)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  // app shell: network-first with cache fallback (offline support).
  // Only cache OK responses — never pin a 404/maintenance/error page to a device.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html') || e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))));
    return;
  }
  // static: cache-first, but only cache OK responses
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  })));
});
