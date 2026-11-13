/* Correct method-aware probe of the live API. */
const BASE = 'https://dmmotorgroup.com';
const GETS = [
  ['/api/health', 'health check'],
  ['/api/testimonials', 'testimonials'],
  ['/api/auth/me', 'current session'],
  ['/api/admin/stats', 'admin dashboard stats'],
  ['/api/admin/vehicles', 'admin vehicle list'],
  ['/api/admin/ai/status', 'AI service status'],
  ['/api/admin/ai/jobs', 'AI job queue'],
  ['/api/admin/enquiries', 'enquiry inbox'],
  ['/api/admin/settings', 'dealership settings'],
  ['/api/favourites', 'saved vehicles'],
  ['/api/notifications', 'notifications'],
  ['/api/my/enquiries', 'my enquiries'],
];
console.log('=== GET endpoints');
for (const [p, label] of GETS) {
  try {
    const r = await fetch(BASE + p, { headers: { accept: 'application/json' } });
    const t = await r.text();
    console.log(`${String(r.status).padEnd(4)} ${p.padEnd(28)} ${label.padEnd(24)} ${t.slice(0, 80).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`ERR  ${p} ${String(e).slice(0, 40)}`); }
}

console.log('\n=== POST endpoints (method-correct probe)');
const POSTS = [
  ['/api/enquiries', { name: 'Probe', email: 'probe@example.com', message: 'Automated availability probe.' }],
  ['/api/inspections', { vehicleId: 46, name: 'Probe', email: 'probe@example.com', phone: '+27000000000' }],
  ['/api/webhooks/resend', { type: 'email.received', data: {} }],
  ['/api/auth/login', { email: 'probe@example.com', password: 'wrong-password-probe' }],
];
for (const [p, body] of POSTS) {
  try {
    const r = await fetch(BASE + p, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    console.log(`${String(r.status).padEnd(4)} ${p.padEnd(28)} ${t.slice(0, 110).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`ERR  ${p} ${String(e).slice(0, 40)}`); }
}

/* employee-facing pages present in the built site */
console.log('\n=== static assets / PWA');
for (const p of ['/manifest.webmanifest', '/sw.js', '/robots.txt', '/sitemap.xml', '/apple-touch-icon.png', '/assets/icon.svg']) {
  const r = await fetch(BASE + p, { headers: { accept: '*/*' } });
  console.log(`${String(r.status).padEnd(4)} ${p.padEnd(28)} ${r.headers.get('content-type') || ''}`);
}
