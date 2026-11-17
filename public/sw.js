'use strict';
/* DM Motor Group — service worker: app shell + offline fallback.
 * Rule #1: never leave a request unanswered — the customer must never see a
 * black browser error page. Every navigation falls back to a branded offline
 * card; every asset falls back to the cached shell or a clean 503. */
const CACHE = 'dm-v42';
const ASSETS = ['/', '/styles.css?v=29', '/app.js?v=35', '/manifest.webmanifest', '/assets/icon.svg', '/apple-touch-icon.png'];
const OFFLINE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DM Motor Group — connection needed</title><style>body{margin:0;background:#050607;color:#e8e6df;font-family:Georgia,'Times New Roman',serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}.card{max-width:460px;text-align:center;border:1px solid rgba(201,164,92,.45);border-radius:18px;padding:40px 34px;background:linear-gradient(165deg,#151920,#0e1116)}h1{font-size:26px;margin:0 0 10px;color:#e6c987;font-weight:normal}p{color:#b9b4a4;line-height:1.65;font-size:15px;font-family:Helvetica,Arial,sans-serif}a{display:inline-block;margin-top:18px;background:#c9a45c;color:#141414;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:14px 30px;border-radius:10px}</style></head><body><div class="card"><h1>DM Motor Group</h1><p>Your connection seems to have dropped. The showroom needs a moment — your browsing is safe, and everything will be here exactly as you left it.</p><p style="font-size:13px;color:#8f8b7d">Please check your internet connection. The page will refresh itself when you are back online.</p><a href="/">Retry now</a></div><script>window.addEventListener('online',function(){location.reload()});setInterval(function(){fetch('/api/meta',{cache:'no-store'}).then(function(r){if(r.ok)location.reload()}).catch(function(){})},4000);</script></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* install must not fail because one asset hiccupped — cache what we can */
    await Promise.allSettled(ASSETS.map((a) => c.add(a)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  /* Never intercept cross-origin requests (video/audio streams, posters,
   * Google Fonts): re-fetching them inside the SW breaks range requests and
   * CORS handling, producing net::ERR_FAILED / black video playback. */
  if (url.origin !== self.location.origin) return;
  // API: always the network (never cached inventory or private data)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  const isNav = (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) || e.request.mode === 'navigate';
  // app shell: network-first; ALWAYS answer — request, cache, or branded offline page
  if (isNav) {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(async () => {
      const hit = await caches.match(e.request).catch(() => null);
      if (hit) return hit;
      const home = await caches.match('/').catch(() => null);
      if (home) return home;
      return new Response(OFFLINE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }));
    return;
  }
  // static: cache-first, fall back to network, fall back to a clean answer (never an error page)
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(async () => {
    const home = await caches.match('/').catch(() => null);
    if (home && /\.(?:js|css|html)$/.test(url.pathname)) return home;
    return new Response('', { status: 503, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
  })));
});
