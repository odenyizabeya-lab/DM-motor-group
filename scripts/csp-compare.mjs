/* Compare CSP + cache headers of / vs /videos on both hosts. */
for (const u of ['https://dmmotorgroup.com/', 'https://dmmotorgroup.com/videos']) {
  const r = await fetch(u, { headers: { accept: 'text/html' }, cache: 'no-store' });
  console.log('=== ' + u + ' -> ' + r.status);
  for (const [k, v] of r.headers) {
    if (/content-security|cf-cache|cache-control|age$|etag/i.test(k)) console.log('  ' + k + ': ' + String(v).slice(0, 220));
  }
  const t = await r.text();
  const meta = (t.match(/<meta[^>]*http-equiv[^>]*>/i) || [])[0];
  console.log('  meta CSP in body:', meta ? meta.slice(0, 160) : 'none');
}
