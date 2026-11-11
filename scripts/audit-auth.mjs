/* End-to-end customer account test using a temporary user, then cleanup. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const stamp = Date.now();
const email = `audit.temp.${stamp}@example.com`;
const password = 'AuditPass123!';

const log = [];
const rec = (name, ok, detail = '') => { log.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: r.status, data };
}

let userId = null;
let token = null;
try {
  /* 1. register */
  let r = await call('/api/auth/register', { method: 'POST', body: { name: 'Audit Tester', email, password } });
  rec('register new customer', r.status === 200 && !!r.data.token, `status=${r.status} role=${r.data.user && r.data.user.role}`);
  token = r.data.token;
  userId = r.data.user && r.data.user.id;

  /* 2. duplicate registration must be rejected */
  r = await call('/api/auth/register', { method: 'POST', body: { name: 'Audit Tester', email, password } });
  rec('duplicate registration rejected', r.status === 409, `status=${r.status}`);

  /* 3. me */
  r = await call('/api/auth/me', { token });
  rec('me returns account', r.status === 200 && r.data.user && r.data.user.email === email, `name=${r.data.user && r.data.user.name} unread=${r.data.unread}`);

  /* 4. login (correct + wrong) */
  r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  rec('login correct password', r.status === 200 && !!r.data.token, `status=${r.status}`);
  r = await call('/api/auth/login', { method: 'POST', body: { email, password: password + 'x' } });
  rec('login wrong password rejected', r.status === 401, `status=${r.status}`);

  /* 5. profile update */
  r = await call('/api/auth/profile', { method: 'PUT', token, body: { name: 'Audit Tester Updated' } });
  rec('profile update', r.status === 200, `status=${r.status}`);
  r = await call('/api/auth/me', { token });
  rec('profile update persisted', r.data.user && r.data.user.name === 'Audit Tester Updated', `name=${r.data.user && r.data.user.name}`);

  /* 6. welcome notification created by trigger */
  r = await call('/api/notifications', { token });
  const welcome = (r.data.items || []).find((n) => /welcome/i.test(n.title || ''));
  rec('welcome notification exists', !!welcome, `items=${(r.data.items || []).length} unread=${r.data.unread}`);
  r = await call('/api/notifications/read', { method: 'POST', token, body: { all: true } });
  r = await call('/api/notifications', { token });
  rec('mark all read', r.data.unread === 0, `unread=${r.data.unread}`);

  /* 7. favourites */
  const vres = await call('/api/vehicles?per=1');
  const vehicle = (vres.data.items || [])[0];
  rec('public vehicle available for tests', !!vehicle, vehicle && vehicle.slug);
  if (vehicle) {
    r = await call('/api/favourites', { method: 'POST', token, body: { vehicleId: vehicle.id } });
    r = await call('/api/favourites', { token });
    rec('favourite saved', Array.isArray(r.data) && r.data.some((v) => v.id === vehicle.id), `count=${r.data.length}`);
    r = await call(`/api/favourites/${vehicle.id}`, { method: 'DELETE', token });
    r = await call('/api/favourites', { token });
    rec('favourite removed', Array.isArray(r.data) && !r.data.some((v) => v.id === vehicle.id), `count=${r.data.length}`);

    /* 8. enquiry */
    r = await call('/api/enquiries', { method: 'POST', token, body: { name: 'Audit Tester', email, message: 'Automated audit enquiry — please ignore.', type: 'question', vehicleId: vehicle.id } });
    rec('enquiry accepted', r.status === 200 && r.data.ok, `status=${r.status} id=${r.data.id}`);
    const enquiryId = r.data.id;
    r = await call('/api/my/enquiries', { token });
    rec('enquiry visible to customer', (r.data || []).some((e) => e.id === enquiryId), `count=${(r.data || []).length}`);

    /* 9. order/reservation request */
    r = await call('/api/orders', { method: 'POST', token, body: { vehicleId: vehicle.id, type: 'reservation', notes: 'Automated audit test — ignore.' } });
    rec('reservation request accepted', r.status === 200 && r.data.ok, `status=${r.status} id=${r.data.id}`);
    const orderId = r.data.id;
    r = await call('/api/my/orders', { token });
    rec('reservation visible to customer', (r.data || []).some((o) => o.id === orderId), `count=${(r.data || []).length}`);

    /* 10. customer must not reach admin API */
    for (const p of ['/api/admin/stats', '/api/admin/vehicles', '/api/admin/settings']) {
      r = await call(p, { token });
      if (r.status === 200) rec(`customer blocked from ${p}`, false, 'GOT 200');
      else rec(`customer blocked from ${p}`, r.status === 403 || r.status === 401, `status=${r.status}`);
    }
    /* /api/admin/users only accepts POST — check the write path is refused */
    r = await call('/api/admin/users', { method: 'POST', token, body: { email: `hack.${Date.now()}@example.com`, password: 'HackAttempt1!', role: 'admin' } });
    rec('customer blocked from creating staff', r.status === 403 || r.status === 401, `status=${r.status}`);
  }

  /* 11. password change with wrong current password must fail */
  r = await call('/api/auth/profile', { method: 'PUT', token, body: { currentPassword: 'wrongwrong', password: 'NewAuditPass123!' } });
  rec('password change requires current password', r.status === 403, `status=${r.status}`);
} catch (e) {
  rec('test harness completed', false, e.message);
} finally {
  /* cleanup: delete the temporary auth user (cascades profile/favourites/notifications) */
  if (userId) {
    const d = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: SVC });
    rec('cleanup temporary user', d.ok || d.status === 404, `status=${d.status}`);
    await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: SVC });
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?user_id=eq.${userId}`, { method: 'DELETE', headers: SVC });
    await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs?actor=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: SVC });
  }
}
const failed = log.filter((x) => !x.ok);
console.log(`\n${log.length - failed.length}/${log.length} checks passed; ${failed.length} failed.`);
process.exitCode = failed.length ? 1 : 0;
