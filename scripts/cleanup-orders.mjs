import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };
const orders = await fetch(env.SUPABASE_URL + '/rest/v1/orders?select=id,type,notes,vehicle_id', { headers: H }).then((r) => r.json());
for (const o of orders || []) {
  console.log('order', o.id, o.type, 'vehicle', o.vehicle_id, String(o.notes || '').slice(0, 120));
  await fetch(env.SUPABASE_URL + '/rest/v1/orders?id=eq.' + o.id, { method: 'DELETE', headers: H });
  console.log('  -> deleted (test artefact)');
}
const left = await fetch(env.SUPABASE_URL + '/rest/v1/orders?select=id', { headers: H }).then((r) => r.json());
console.log('orders left:', (left || []).length);
