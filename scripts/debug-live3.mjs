/* debug round 3: does the quoted % wildcard match? + final cleanup pass */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

/* insert one action test row */
const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles`, {
  method: 'POST', headers: { ...SERVICE, Prefer: 'return=representation' },
  body: JSON.stringify([{ slug: 'probe-quattro-text-2023', brand: 'Zebra Motors', model: 'Quattro Text', year: 2023, price: 1, status: 'published' }]),
});
console.log('insert:', ins.status, (await ins.text()).slice(0, 120));

/* the exact worker-built expression */
const or = '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")';
let qs = new URLSearchParams({ select: 'brand,model', status: 'in.(published,reserved)', or, limit: '10' }).toString();
let res = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?${qs}`, { headers: SERVICE });
const rows = await res.json();
console.log('or-search quoted-% matches:', res.status, JSON.stringify(rows));

/* cleanup the probe (also resolves leftover rows from lagged logging) */
const del1 = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?slug=eq.probe-quattro-text-2023`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
const del2 = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
const del3 = await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
console.log('cleanup deletes:', del1.status, del2.status, del3.status);

/* storage listing with required prefix */
const files = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/vehicle-media`, { method: 'POST', headers: SERVICE, body: JSON.stringify({ prefix: '', limit: 100 }) })).json();
console.log('vehicle-media objects:', JSON.stringify(files));
const bf = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/banners`, { method: 'POST', headers: SERVICE, body: JSON.stringify({ prefix: '', limit: 100 }) })).json();
console.log('banners objects:', JSON.stringify(bf));
