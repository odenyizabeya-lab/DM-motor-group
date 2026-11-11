/* Crawl the public SPA routes and record status, title and visible errors. */
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const routes = ['/', '/vehicles', '/videos', '/compare', '/contact', '/about', '/account', '/favourites', '/finance', '/sell', '/privacy', '/terms', '/nope-does-not-exist'];

for (const r of routes) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + r, { redirect: 'manual' });
    const text = await res.text();
    const ms = Date.now() - t0;
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const shell = /id="app"/.test(text) ? 'SPA-shell' : 'no-app-root';
    console.log(`${r.padEnd(24)} ${String(res.status).padEnd(4)} ${String(ms + 'ms').padEnd(7)} ${shell.padEnd(12)} ${title.slice(0, 70)}`);
  } catch (e) {
    console.log(`${r.padEnd(24)} ERR  ${e.message}`);
  }
}
