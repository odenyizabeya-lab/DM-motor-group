/* Inspect the live Supabase schema: tables, and any RPC that could run DDL. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const r = await fetch(env.SUPABASE_URL + '/rest/v1/', {
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, Accept: 'application/openapi+json' },
});
console.log('openapi status', r.status);
const spec = await r.json();
const tables = Object.keys(spec.paths || {}).filter((p) => p.startsWith('/') && !p.includes('{')).map((p) => p.replace('/', ''));
console.log('TABLES (' + tables.length + '):', tables.join(', '));
const rpcs = Object.keys(spec.paths || {}).filter((p) => p.startsWith('/rpc/')).map((p) => p.replace('/rpc/', ''));
console.log('\nRPCs (' + rpcs.length + '):', rpcs.join(', '));
const sqlish = rpcs.filter((n) => /sql|exec|migrat|ddl|query/i.test(n));
console.log('\nSQL-ish RPCs:', sqlish.length ? sqlish.join(', ') : 'NONE');
