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
const url = `${env.SUPABASE_URL}/rest/v1/vehicles?select=*&limit=5`;
const res = await fetch(url, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' } });
console.log('STATUS', res.status);
console.log('BODY', (await res.text()).slice(0, 400));
console.log('URL', url);
