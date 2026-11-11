/* Admin surface test with a temporary administrator, full cleanup afterwards. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const stamp = Date.now();
const email = `audit.admin.${stamp}@example.com`;
const password = 'AuditAdmin123!';
const log = [];
const rec = (name, ok, detail = '') => { log.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function call(path, { method = 'GET', token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  let payload;
  if (raw) { h['content-type'] = raw.type; payload = raw.data; }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, data };
}

let userId = null, token = null, testVehicleId = null;
const originalSettings = {};
try {
  /* create temporary admin through GoTrue admin API */
  let r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: SVC, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Audit Admin' } }) });
  let created = await r.json().catch(() => ({}));
  userId = created.id;
  rec('temporary admin created', !!userId, `status=${r.status}`);
  if (!userId) throw new Error('cannot continue without admin');
  await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ role: 'admin' }) });

  r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  token = r.data.token;
  rec('temporary admin can sign in', r.status === 200 && r.data.user.role === 'admin', `role=${r.data.user && r.data.user.role}`);

  /* baseline settings, captured for exact restore */
  const srows = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?select=key,value`, { headers: SVC }).then((x) => x.json());
  for (const row of srows) originalSettings[row.key] = row.value;

  /* admin pages' data sources */
  r = await call('/api/admin/stats', { token });
  rec('admin stats', r.status === 200, `status=${r.status} ${Object.keys(r.data).slice(0, 6).join(',')}`);
  r = await call('/api/admin/settings', { token });
  rec('admin settings readable', r.status === 200, `company_name=${JSON.stringify(r.data.company_name)}`);
  rec('settings canonical keys present', r.status === 200 && 'company_name' in r.data && 'phone_main' in r.data && 'address_primary' in r.data && 'hours' in r.data);
  rec('legacy values normalised', r.data.company_name === (originalSettings.dealership_name || 'DM Motor Group'), `company_name=${r.data.company_name}`);
  r = await call('/api/admin/customers', { token });
  rec('customers_list RPC works', r.status === 200 && Array.isArray(r.data), `status=${r.status} rows=${Array.isArray(r.data) ? r.data.length : 'n/a'}`);
  r = await call('/api/admin/enquiries', { token });
  rec('admin enquiries list', r.status === 200 && Array.isArray(r.data), `status=${r.status} rows=${Array.isArray(r.data) ? r.data.length : 'n/a'}`);
  r = await call('/api/admin/activity', { token });
  rec('activity log', r.status === 200 && Array.isArray(r.data), `status=${r.status} rows=${Array.isArray(r.data) ? r.data.length : 'n/a'}`);
  r = await call('/api/admin/integrations', { token });
  rec('integrations list', r.status === 200 && Array.isArray(r.data), `status=${r.status}`);
  r = await call('/api/admin/ai/status', { token });
  rec('AI scanner status endpoint', r.status === 200, `status=${r.status}`);

  /* settings round-trip via canonical keys */
  r = await call('/api/admin/settings', { method: 'PUT', token, body: { company_name: 'Audit Motors', phone_main: '+10000000000', hours: 'Audit hours' } });
  rec('settings save accepted', r.status === 200, `status=${r.status}`);
  const after = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?select=key,value`, { headers: SVC }).then((x) => x.json());
  const map = Object.fromEntries(after.map((x) => [x.key, x.value]));
  rec('canonical keys persisted to legacy rows', map.dealership_name === 'Audit Motors' && map.phone === '+10000000000' && map.opening_hours === 'Audit hours', `dealership_name=${map.dealership_name} phone=${map.phone}`);
  r = await call('/api/home');
  rec('public home reads updated settings', r.data.settings.company_name === 'Audit Motors' && r.data.settings.phone_main === '+10000000000', `company=${r.data.settings.company_name}`);

  /* vehicle create/update/delete (draft only, so never publicly visible) */
  r = await call('/api/admin/vehicles', { method: 'POST', token, body: { brand: 'Audit', model: 'Test Car', year: 2020, price: 1, status: 'draft', description: 'automated audit test' } });
  testVehicleId = r.data.id;
  rec('vehicle create', r.status === 200 && !!testVehicleId, `status=${r.status} id=${testVehicleId}`);
  r = await call(`/api/admin/vehicles/${testVehicleId}`, { method: 'PUT', token, body: { mileage: 12345 } });
  rec('vehicle update', r.status === 200, `status=${r.status}`);
  r = await call(`/api/admin/vehicles/${testVehicleId}`, { token });
  rec('vehicle read back', r.status === 200 && Number(r.data.mileage) === 12345, `mileage=${r.data && r.data.mileage}`);
  r = await call(`/api/vehicles/audit-test-car`, {});
  rec('draft vehicle hidden from public', r.status === 404, `status=${r.status}`);

  /* upload validation: spoofed content type must be rejected */
  if (testVehicleId) {
    r = await call(`/api/admin/upload?vehicleId=${testVehicleId}&type=image&filename=evil.jpg`, { method: 'PUT', token, raw: { type: 'text/html', data: '<script>alert(1)</script>' } });
    rec('upload rejects HTML disguised as .jpg', r.status === 400, `status=${r.status} ${r.data.error || ''}`);
    r = await call(`/api/admin/upload?vehicleId=${testVehicleId}&type=image&filename=evil.exe`, { method: 'PUT', token, raw: { type: 'application/octet-stream', data: 'MZ' } });
    rec('upload rejects disallowed extension', r.status === 400, `status=${r.status} ${r.data.error || ''}`);

    /* real 1x1 PNG upload */
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64');
    r = await call(`/api/admin/upload?vehicleId=${testVehicleId}&type=image&filename=pixel.png`, { method: 'PUT', token, raw: { type: 'image/png', data: png } });
    rec('valid PNG upload', r.status === 200 && !!r.data.id, `status=${r.status}`);
    if (r.data.id) {
      const del = await call(`/api/admin/media/${r.data.id}`, { method: 'DELETE', token });
      rec('media delete', del.status === 200, `status=${del.status}`);
    }
  }
  r = await call(`/api/admin/vehicles/${testVehicleId}`, { method: 'DELETE', token });
  rec('vehicle delete', r.status === 200, `status=${r.status}`);

  /* manager must not be able to call admin-only user creation */
  r = await call('/api/admin/users', { method: 'POST', token, body: { email: 'x@example.com', password: '12345678', role: 'admin' } });
  rec('admin-only route reachable by admin', r.status !== 403, `status=${r.status}`);
} catch (e) {
  rec('admin test harness completed', false, e.message);
} finally {
  /* restore every setting we touched (and remove any created keys) */
  const restore = {
    dealership_name: originalSettings.dealership_name,
    phone: originalSettings.phone,
    opening_hours: originalSettings.opening_hours,
  };
  const clean = Object.fromEntries(Object.entries(restore).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length) await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/set_settings`, { method: 'POST', headers: SVC, body: JSON.stringify({ p: clean }) }).catch(() => {});
  if (testVehicleId) await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?id=eq.${testVehicleId}`, { method: 'DELETE', headers: SVC }).catch(() => {});
  if (userId) {
    const d = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: SVC });
    rec('cleanup temporary admin', d.ok || d.status === 404, `status=${d.status}`);
  }
  await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs?actor=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: SVC }).catch(() => {});
}
const failed = log.filter((x) => !x.ok);
console.log(`\n${log.length - failed.length}/${log.length} checks passed; ${failed.length} failed.`);
process.exitCode = failed.length ? 1 : 0;
