/* Dump the LIVE Supabase schema (tables, columns, types, defaults, FKs) and the
 * live RPC list, so the pending migrations can be written against reality. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, Accept: 'application/openapi+json' };
const spec = await fetch(env.SUPABASE_URL + '/rest/v1/', { headers: H }).then((r) => r.json());

const defs = spec.definitions || spec.components?.schemas || {};
const out = [];
const line = (s = '') => { out.push(s); console.log(s); };

line('# LIVE SUPABASE SCHEMA (read ' + new Date().toISOString().slice(0, 19) + 'Z)');
line('');
for (const [name, def] of Object.entries(defs)) {
  if (def.type !== 'object' || !def.properties) continue;
  line('## ' + name);
  const req = def.required || [];
  for (const [col, c] of Object.entries(def.properties)) {
    const type = c.format ? c.format : (c.type || (c.anyOf ? c.anyOf.map((a) => a.type || a.$ref).join('|') : '?'));
    let d = '';
    if (c.default !== undefined) d = ' default ' + JSON.stringify(c.default);
    if (c.description) d += ' -- ' + c.description.replace(/\s+/g, ' ').slice(0, 60);
    line(`  ${col}  ${type}${req.includes(col) ? ' NOT NULL' : ''}${d}`);
  }
  line('');
}
const rpcs = Object.keys(spec.paths || {}).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)).sort();
line('## LIVE RPCs (' + rpcs.length + ')');
line(rpcs.join(', '));
fs.writeFileSync('data/live-schema.md', out.join('\n') + '\n');
console.log('\nWrote data/live-schema.md (' + out.length + ' lines)');
