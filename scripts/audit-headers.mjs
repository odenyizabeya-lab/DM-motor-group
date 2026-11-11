const BASE = process.argv[2] || 'https://dmmotorgroup.com';
for (const p of ['/', '/admin/', '/api/health', '/vehicles/plymouth-barracuda-1970']) {
  const r = await fetch(BASE + p, { redirect: 'manual' });
  console.log(`\n=== ${p} -> ${r.status} ===`);
  for (const [k, v] of r.headers) {
    if (/^(content-type|content-length|cache-control|strict-transport|x-frame|x-content-type|content-security|referrer-policy|permissions-policy|x-xss|server|cf-|access-control)/i.test(k)) console.log(`${k}: ${v}`);
  }
}
