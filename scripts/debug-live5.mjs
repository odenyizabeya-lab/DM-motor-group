/* Probe both the versioned deployment and the production alias, with a live
 * published row, to see exactly which filter expression each one builds. */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles`, {
  method: 'POST', headers: { ...SERVICE, Prefer: 'return=representation' },
  body: JSON.stringify([{ slug: 'probe-quattro-text-2023', brand: 'Zebra Motors', model: 'Quattro Text', year: 2023, price: 7, status: 'published' }]),
});
console.log('insert:', ins.status);

const url = new URLSearchParams({ select: 'id', status: 'in.(published,reserved)', or: '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")', limit: '10' }).toString();
console.log('worker row-query would be: or=', url);

for (const base of ['https://6dda788a.dm-motor-group.pages.dev', 'https://dm-motor-group.pages.dev']) {
  const res = await fetch(`${base}/api/vehicles?q=Quattro`);
  const d = await res.json();
  console.log(base, '→', res.status, JSON.stringify(d).slice(0, 160));
}

await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?slug=eq.probe-quattro-text-2023`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
console.log('probe cleaned');
