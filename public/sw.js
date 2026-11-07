'use strict';
/* DM Motor Group — service worker: app shell + offline fallback */
const CACHE = 'dm-v5';
const ASSETS = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/assets/icon.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API + video/image uploads: always network (never cache inventory or media streams)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  // app shell: network-first with cache fallback (offline support)
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html') || e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/', cp)); return r; }).catch(() => caches.match('/')));
    return;
  }
  // static: cache-first
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })));
});
