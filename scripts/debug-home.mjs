/* Debug: reproduce the exact media query /api/home makes. */
const lines = Object.fromEntries(
  (await import('node:fs/promises')).readFile('.env.local', 'utf8').then(t => t.trim().split('\n').map(l => l.split('=')))
  ? [] : []
);
const env = {};
for (const l of (await (await import('node:fs/promises')).readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const qs = new URLSearchParams({
  select: 'id,type,url,thumb_url,caption,category,vehicle_id,vehicles!inner(slug,brand,model,year)',
  type: 'eq.video',
  'vehicles.status': 'in.(published,reserved)',
  order: 'id.desc', limit: '8',
}).toString();
const url = `${env.SUPABASE_URL}/rest/v1/media?${qs}`;
const res = await fetch(url, {
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
});
console.log('status', res.status);
console.log((await res.text()).slice(0, 500));
