/* debug round 4: live worker search vs raw PostgREST on identical data */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

/* probe vehicle (published) */
const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles`, {
  method: 'POST', headers: { ...SERVICE, Prefer: 'return=representation' },
  body: JSON.stringify([{ slug: 'probe-quattro-text-2023', brand: 'Zebra Motors', model: 'Quattro Text', year: 2023, price: 7, status: 'published' }]),
});
console.log('insert:', ins.status, (await ins.text()).slice(0, 80));

/* via the live Worker */
for (const q of ['q=Quattro', 'q=Test', 'q=zebra']) {
  const res = await fetch(`https://dm-motor-group.pages.dev/api/vehicles?${q}`);
  const d = await res.json();
  console.log(`worker /api/vehicles?${q} →`, res.status, 'total', d?.total, 'items', d?.items?.length, d?.error || '');
}

/* raw PostgREST for comparison */
const or = '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")';
const qs = new URLSearchParams({ select: 'id', status: 'in.(published,reserved)', or, limit: '10' }).toString();
const raw = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?${qs}`, { headers: SERVICE });
console.log('raw:', raw.status, (await raw.text()).slice(0, 120));

/* cleanup probe */
await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?slug=eq.probe-quattro-text-2023`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
console.log('probe cleaned');
