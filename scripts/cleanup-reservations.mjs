/* Remove test reservations and restore any vehicle they held. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const token = (await (await fetch('https://dmmotorgroup.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creds.email, password: creds.password }) })).json()).token;
const AH = { 'content-type': 'application/json', Authorization: 'Bearer ' + token };

const rows = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.reservation&select=id,vehicle_id,notes,status', { headers: H }).then((r) => r.json());
for (const o of rows || []) {
  let n = {}; try { n = JSON.parse(o.notes || '{}'); } catch {}
  const ref = (n.reservation && n.reservation.reference) || '';
  const isTest = /RES-\d{8}-/.test(ref) || /Test Buyer|Probe Person|audit/i.test(JSON.stringify(n.reservation && n.reservation.customer || {}));
  if (!isTest) { console.log('keeping real reservation:', ref || '#' + o.id); continue; }
  await fetch(env.SUPABASE_URL + '/rest/v1/orders?id=eq.' + o.id, { method: 'DELETE', headers: H });
  console.log('deleted test reservation:', ref || '#' + o.id);
}
/* restore any vehicle still reserved because of a test */
const veh = await fetch(env.SUPABASE_URL + '/rest/v1/vehicles?status=eq.reserved&select=id,slug,brand,model', { headers: H }).then((r) => r.json());
for (const v of veh || []) {
  await fetch(env.SUPABASE_URL + '/rest/v1/vehicles?id=eq.' + v.id, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'published' }) });
  console.log('restored vehicle to published:', v.brand, v.model);
}
/* remove the test enquiries created by the reservation flow */
const enq = await fetch(env.SUPABASE_URL + '/rest/v1/enquiries?type=eq.reservation&select=id,name,message', { headers: H }).then((r) => r.json());
for (const e of enq || []) {
  if (/Reservation request \(reference RES-|Debug Buyer|Rita Buyer/.test(e.message || '') || /Debug Buyer|Rita Buyer/i.test(e.name || '')) {
    await fetch(env.SUPABASE_URL + '/rest/v1/enquiries?id=eq.' + e.id, { method: 'DELETE', headers: H });
    console.log('deleted test reservation enquiry #', e.id);
  }
}
const left = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.reservation&select=id', { headers: H }).then((r) => r.json());
console.log('reservations left:', (left || []).length);
