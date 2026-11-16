/* Does the LIVE database accept UTF-8 text (em dash, smart quotes)?
 * If the database encoding is WIN1252 this fails - which would mean the
 * migration files must be plain ASCII. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' };

const probe = async (label, value) => {
  const key = 'encoding_probe_' + Math.random().toString(36).slice(2, 8);
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/settings', {
    method: 'POST', headers: H, body: JSON.stringify({ key, value }),
  });
  const t = await r.text();
  console.log(`  ${label.padEnd(34)} status ${String(r.status).padEnd(4)} ${r.status < 300 ? 'ACCEPTED' : t.slice(0, 150)}`);
  if (r.status < 300) await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=eq.' + key, { method: 'DELETE', headers: H });
  return r.status < 300;
};

console.log('LIVE DATABASE ENCODING PROBE');
await probe('plain ASCII', 'plain ascii value');
await probe('em dash (UTF-8)', 'dash — here');
await probe('curly quotes', 'quotes “ ” here');
await probe('euro sign', 'price € 100');
await probe('accented latin', 'café Münster');
