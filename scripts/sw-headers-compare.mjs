/* Compare headers for /sw.js on pages.dev vs custom domain. */
for (const u of ['https://dm-motor-group-9dq.pages.dev/sw.js', 'https://dmmotorgroup.com/sw.js']) {
  const r = await fetch(u, { cache: 'no-store' });
  console.log('=== ' + u + ' -> ' + r.status);
  for (const [k, v] of r.headers) {
    if (/cache|cf-|etag|server/i.test(k)) console.log('  ' + k + ': ' + v);
  }
  const t = await r.text();
  console.log('  content is dm-v10:', t.includes('dm-v10'));
}
