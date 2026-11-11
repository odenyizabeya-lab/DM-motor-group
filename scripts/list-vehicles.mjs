/* List current production vehicles + media inventory from Supabase. */
import fs from 'node:fs';
function parseEnv(p) {
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = parseEnv('.env.local');
const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
const S = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function get(base, path, headers = S) {
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) { console.log('GET FAIL', path, res.status, (await res.text()).slice(0, 200)); return null; }
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

const vehicles = await get(`${env.SUPABASE_URL}/rest/v1`, `/vehicles?select=*&order=created_at.desc&limit=200`);
const media = await get(`${env.SUPABASE_URL}/rest/v1`, `/media?select=*&order=created_at.desc&limit=300`);
const banners = await get(`${env.SUPABASE_URL}/rest/v1`, `/banners?select=*&order=position&limit=50`);
const settings = await get(`${env.SUPABASE_URL}/rest/v1`, `/settings?select=*`);
const enq = await get(`${env.SUPABASE_URL}/rest/v1`, `/enquiries?select=*&limit=50`);

console.log('VEHICLES:');
for (const v of vehicles) console.log(JSON.stringify(v));
console.log('MEDIA (' + (media ? media.length : 0) + '):');
for (const m of media || []) console.log(JSON.stringify(m));
console.log('BANNERS:', JSON.stringify(banners));
console.log('SETTINGS KEYS:', JSON.stringify((settings || []).map(s => s.key)));
console.log('ENQUIRIES:', JSON.stringify(enq));
