/* debug 6: exact worker QSP vs minimal — find the tell that makes PostgREST scream orbrand */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

const probe = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles`, {
  method: 'POST', headers: { ...SERVICE, Prefer: 'return=representation' },
  body: JSON.stringify([{ slug: 'probe-quattro-2023', brand: 'Zebra Motors', model: 'Quattro Text', year: 2023, price: 7, status: 'published' }]),
});
console.log('insert:', probe.status);

const or = '(br-comp ilike."%Quattro%")'; /* nonsense to force an error message that reveals parsing */
const tries = {
  'worker-exact': { select: '*', status: 'in.(published,reserved)', or: '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")', order: 'created_at.desc,id.desc', limit: '12', offset: '0' },
  'no-order': { select: '*', status: 'in.(published,reserved)', or: '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")', limit: '12', offset: '0' },
  'order-or-swapped': { select: '*', or: '(brand.ilike."%Quattro%",model.ilike."%Quattro%",description.ilike."%Quattro%",vin.ilike."%Quattro%",location.ilike."%Quattro%")', order: 'created_at.desc,id.desc', limit: '12', offset: '0', status: 'in.(published,reserved)' },
};
for (const [name, obj] of Object.entries(tries)) {
  const qs = new URLSearchParams(obj).toString();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?${qs}`, { headers: SERVICE });
  const text = await res.text();
  console.log(name, '→', res.status, text.slice(0, 150).replace(/\n/g, ' '));
  /* also show how PostgREST echoes: print raw request line once */
  if (res.status !== 200) console.log('   qs:', qs.slice(0, 220));
}

await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?slug=eq.probe-quattro-2023`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
console.log('probe cleaned');
