import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const r = await fetch(env.SUPABASE_URL + '/storage/v1/bucket', { headers: H });
console.log('buckets:', r.status, JSON.stringify(await r.json()).slice(0, 500));
const o = await fetch(env.SUPABASE_URL + '/rest/v1/orders?select=*&limit=5', { headers: H });
console.log('orders sample:', JSON.stringify(await o.json()).slice(0, 500));
const s = await fetch(env.SUPABASE_URL + '/rest/v1/settings?select=*&limit=20', { headers: H });
const sj = await s.json();
console.log('settings rows:', Array.isArray(sj) ? sj.length : JSON.stringify(sj).slice(0, 200));
if (Array.isArray(sj)) for (const x of sj.slice(0, 12)) console.log('  -', x.key, '=', String(x.value).slice(0, 60));
