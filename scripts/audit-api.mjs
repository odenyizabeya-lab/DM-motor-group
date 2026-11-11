/* Live API audit: status codes, payload shapes and unauthenticated access. */
const BASE = process.argv[2] || 'https://dmmotorgroup.com';

const results = [];
async function hit(label, path, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { redirect: 'manual', ...opts });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 120); }
    results.push({ label, path, status: r.status, ms: Date.now() - t0, body });
    return { r, body, text };
  } catch (e) {
    results.push({ label, path, status: 'ERR', ms: Date.now() - t0, body: e.message });
    return { r: null, body: null, text: '' };
  }
}
const preview = (b) => {
  if (b == null) return '';
  if (typeof b === 'string') return b.replace(/\s+/g, ' ').slice(0, 110);
  if (Array.isArray(b)) return `array(${b.length})`;
  if (b.error) return `error: ${b.error}`;
  return Object.keys(b).slice(0, 7).join(',');
};

console.log('--- public endpoints ---');
await hit('health', '/api/health');
await hit('meta', '/api/meta');
await hit('home', '/api/home');
await hit('vehicles', '/api/vehicles');
await hit('vehicles page2', '/api/vehicles?page=2&perPage=5');
await hit('vehicles filter', '/api/vehicles?brand=BMW&priceMax=100000&sort=price_asc');
await hit('vehicles sort invalid', '/api/vehicles?sort=%3Cscript%3E&perPage=abc');
await hit('vehicles slug', '/api/vehicles/bmw-x5-2021');
await hit('vehicle missing', '/api/vehicles/does-not-exist');
await hit('videos', '/api/videos');
await hit('videos limit', '/api/videos?limit=1');
await hit('testimonials', '/api/testimonials');
await hit('unknown api', '/api/does-not-exist');

console.log('--- auth required (no token; must be 401/403) ---');
for (const p of ['/api/auth/me', '/api/favourites', '/api/notifications', '/api/my/enquiries', '/api/my/orders',
  '/api/admin/stats', '/api/admin/vehicles', '/api/admin/enquiries', '/api/admin/customers',
  '/api/admin/settings', '/api/admin/activity', '/api/admin/integrations',
  '/api/admin/ai/overview', '/api/admin/ai/settings', '/api/admin/ai/credentials', '/api/admin/ai/jobs']) {
  await hit('anon ' + p, p);
}

console.log('--- validation ---');
await hit('enquiry empty', '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
await hit('enquiry bad email', '/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test', email: 'nope', message: 'hello there' }) });
await hit('inspect empty', '/api/inspections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
await hit('webhook unsigned', '/api/webhooks/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"email.sent"}' });
await hit('tick no key', '/api/internal/ai/tick', { method: 'POST' });
await hit('register weak', '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A', email: 'bad', password: 'x' }) });
await hit('login wrong', '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongwrong' }) });

console.log('\nstatus  label                          path / body');
for (const r of results) {
  console.log(`${String(r.status).padEnd(5)} ${r.label.padEnd(30)} ${String(r.ms).padEnd(5)}  ${preview(r.body)}`);
}
const bad = results.filter((r) => typeof r.status === 'number' && r.status >= 500);
console.log(`\n5xx count: ${bad.length}`);
if (bad.length) console.log(bad.map((b) => `${b.path} -> ${b.status} ${preview(b.body)}`).join('\n'));
