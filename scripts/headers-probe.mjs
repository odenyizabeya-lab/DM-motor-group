/* Inspect full response headers for sw.js and / on both hosts. */
const A = 'https://dmmotorgroup.com';
for (const u of [A + '/sw.js', A + '/app.js?v=9', A + '/']) {
  const r = await fetch(u, { headers: { accept: 'text/html' }, cache: 'no-store' });
  console.log('=== ' + u + ' -> ' + r.status);
  for (const [k, v] of r.headers) {
    if (/cache|cf-|age|etag|server/i.test(k)) console.log('  ' + k + ': ' + v);
  }
}
