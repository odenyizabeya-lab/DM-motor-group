/* debug round 2: or-filter search + storage object state */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

/* 1. raw PostgREST: same expression the Worker builds now */
const or = '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")';
const qs = new URLSearchParams({ select: 'brand,model', status: 'in.(published,reserved)', or, limit: '10' }).toString();
const res = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?${qs}`, { headers: SERVICE });
console.log('raw postgREST or-search:', res.status);
console.log((await res.text()).slice(0, 300));

/* same but with spaces-padded value (imp now strips nothing relevant) */
const or2 = '(brand.ilike.*Quattro*,model.ilike.*Quattro*)';
const qs2 = new URLSearchParams({ select: 'brand', status: 'in.(published,reserved)', or: or2, limit: '10' }).toString();
const res2 = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?${qs2}`, { headers: SERVICE });
console.log('postgREST or-search asterisk:', res2.status);
console.log((await res2.text()).slice(0, 300));

/* postgrest wildcard IS *; quoted pattern with % may be a LITERAL % — verify */
/* 2. storage objects list (all buckets) */
const files = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/vehicle-media`, { method: 'POST', headers: SERVICE, body: JSON.stringify({ limit: 100 }) })).json();
console.log('vehicle-media objects:', JSON.stringify(files));

/* 3. leftover profiles / vehicles / enquiries / logs counts */
for (const t of ['vehicles', 'enquiries', 'enquiry_messages', 'orders', 'favourites', 'notifications', 'profiles', 'activity_logs']) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=id&limit=100`, { headers: { ...SERVICE, Prefer: 'count=exact', Range: '0-0' } });
  const range = r.headers.get('content-range') || '*/?';
  console.log(t, '→', range.split('/')[1], 'rows');
}
