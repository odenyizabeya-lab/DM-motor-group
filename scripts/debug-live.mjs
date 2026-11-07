/* Debug the three failing behaviours in isolation. */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const SERVICE = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch('https://dm-motor-group.pages.dev' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
};

/* login as the smoke admin still present (not yet deleted) */
const EMAIL = 'smoke-test-owner@dmmotorgroup.example', PASSWORD = 'SmokeTest#2026';
const login = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
const T = login.data.token;

/* A: text search via or-filter */
await api('POST', '/api/admin/vehicles', { token: T, body: { brand: 'Zebra Motors', model: 'Quattro Text', year: 2023, price: 1, status: 'published' } });
await new Promise(r => setTimeout(r, 500));
const s = await api('GET', '/api/vehicles?q=Quattro');
console.log('A text search shipped:', s.status, 'total=', s.data?.total, 'err=', s.data?.error || '');

/* B: admin enquiry list raw response */
await api('POST', '/api/enquiries', { body: { name: 'Debug Enquirer', email: 'dbg@example.com', message: 'Debug enquiry for the Zebra Motors Quattro Text.', type: 'question', vehicleId: s.data?.items?.[0]?.id || 1 } });
const el = await api('GET', '/api/admin/enquiries', { token: T });
console.log('B admin enquiries shipped:', el.status, JSON.stringify(el.data).slice(0, 400));

/* C: storage delete directly */
const files = await (await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/vehicle-media`, { method: 'POST', headers: SERVICE, body: JSON.stringify({ prefix: 'v', limit: 20 }) })).json();
console.log('C objects in vehicle-media:', JSON.stringify(files?.map?.(f => f.name)) || JSON.stringify(files));
if (files?.length) {
  const path = files[0].name;
  const del = await fetch(`${env.SUPABASE_URL}/storage/v1/object/vehicle-media/${path}`, { method: 'DELETE', headers: SERVICE });
  console.log('C delete response:', del.status, (await del.text()).slice(0, 200));
}

/* cleanup: wipe vehicle + enquiry + user */
for (const v of (await api('GET', '/api/admin/vehicles', { token: T })).data || []) await api('DELETE', `/api/admin/vehicles/${v.id}`, { token: T });
await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?email=eq.dbg@example.com`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs?action=ilike.%25%25`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } }).catch(()=>{});
const pr = await (await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(EMAIL)}&select=id`, { headers: SERVICE })).json();
if (pr?.[0]) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${pr[0].id}`, { method: 'DELETE', headers: SERVICE });
await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs`, { method: 'DELETE', headers: { ...SERVICE, Prefer: 'return=minimal' } });
console.log('cleanup done');
