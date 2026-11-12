/* Print FULL CSP headers for / and /videos, both hosts. */
for (const u of ['https://dmmotorgroup.com/', 'https://dmmotorgroup.com/videos']) {
  const r = await fetch(u, { headers: { accept: 'text/html' }, cache: 'no-store' });
  console.log('=== ' + u + ' -> ' + r.status);
  console.log('CSP:', r.headers.get('content-security-policy'));
}
for (const u of ['https://dm-motor-group-9dq.pages.dev/', 'https://dm-motor-group-9dq.pages.dev/videos']) {
  const r = await fetch(u, { headers: { accept: 'text/html' }, cache: 'no-store' });
  console.log('=== ' + u + ' -> ' + r.status);
  console.log('CSP:', r.headers.get('content-security-policy'));
}
