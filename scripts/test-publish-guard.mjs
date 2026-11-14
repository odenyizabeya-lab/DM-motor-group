/* Publish guard, second case: a vehicle whose video row points at a file
 * that is not a playable video must be refused. */
import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const BASE = 'https://dmmotorgroup.com';
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
}).then((r) => r.json());
const H = { 'content-type': 'application/json', Authorization: 'Bearer ' + login.token };

const created = await fetch(BASE + '/api/admin/vehicles', {
  method: 'POST', headers: H,
  body: JSON.stringify({ brand: 'TEST', model: 'Guard check', year: 2020, status: 'draft' }),
}).then((r) => r.json());
const vid = created.id || (created.vehicle && created.vehicle.id);
console.log('scratch vehicle id:', vid, '| create status:', created.status || '');

/* attach a media row whose URL is not a video */
const row = await fetch(env.SUPABASE_URL + '/rest/v1/media', {
  method: 'POST',
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ vehicle_id: vid, type: 'video', url: 'https://dmmotorgroup.com/assets/icon.svg', thumb_url: '', caption: 'broken test video', category: 'video', position: 0 }),
}).then((r) => r.json());
console.log('media row inserted:', Array.isArray(row) ? row[0].id : row.id);

const pub = await fetch(BASE + '/api/admin/vehicles/' + vid + '/status', {
  method: 'POST', headers: H, body: JSON.stringify({ status: 'published' }),
});
console.log('publish with broken video ->', pub.status, (await pub.text()).slice(0, 200));

/* cleanup */
await fetch(BASE + '/api/admin/vehicles/' + vid, { method: 'DELETE', headers: H });
await fetch(env.SUPABASE_URL + '/rest/v1/media?vehicle_id=eq.' + vid, {
  method: 'DELETE',
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
});
const left = await fetch(env.SUPABASE_URL + '/rest/v1/media?vehicle_id=eq.' + vid + '&select=id', {
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY },
}).then((r) => r.json());
console.log('cleanup done. leftover media rows:', Array.isArray(left) ? left.length : 'n/a');
