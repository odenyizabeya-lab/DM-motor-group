/* Security-focused live tests: body limits, error masking, scan validation,
 * role enforcement and maintenance mode. Temporary admin is deleted afterwards. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = process.argv[2] || 'https://dmmotorgroup.com';
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const stamp = Date.now();
const email = `audit.sec.${stamp}@example.com`;
const password = 'AuditSec123!';
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
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: r.status, data, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let userId = null, adminToken = null, custToken = null, custId = null;
let originalMaintenance = '0';

/* read the raw maintenance value with the service role */
try {
  const rows = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode&select=value`, { headers: SVC }).then((r) => r.json());
  originalMaintenance = (rows && rows[0] && rows[0].value) || 'no';
} catch {}

try {
  /* ---------------- temporary admin ---------------- */
  let r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Audit Security' } }),
  });
  const created = await r.json().catch(() => ({}));
  userId = created.id;
  rec('temporary admin created', !!userId, `status=${r.status}`);
  if (!userId) throw new Error('cannot continue');
  await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ role: 'admin' }) });

  let login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  adminToken = login.data.token;
  rec('temporary admin signs in', login.status === 200 && login.data.user.role === 'admin');

  /* ---------------- a normal customer for authz checks ---------------- */
  const custEmail = `audit.cust.${stamp}@example.com`;
  let reg = await call('/api/auth/register', { method: 'POST', body: { name: 'Audit Customer', email: custEmail, password } });
  custToken = reg.data.token;
  custId = reg.data.user && reg.data.user.id;
  rec('customer account created', reg.status === 200 && !!custToken);

  /* ---------------- scan validation happens before any AI request ---------------- */
  r = await call('/api/admin/scan', { method: 'POST', token: adminToken, raw: { type: 'application/json', data: JSON.stringify({ images: [{ name: 'x.jpg', mimeType: 'text/html', dataBase64: 'PGgxPmhpPC9oMT4=' }] }) } });
  rec('scan rejects HTML disguised as an image', r.status === 400, `status=${r.status}`);

  r = await call('/api/admin/scan', { method: 'POST', token: adminToken, raw: { type: 'application/json', data: JSON.stringify({ images: [{ name: 'x.txt', mimeType: 'text/plain', dataBase64: 'aGk=' }] }) } });
  rec('scan rejects unsupported image MIME', r.status === 400, `status=${r.status}`);

  r = await call('/api/admin/scan', { method: 'POST', token: adminToken, raw: { type: 'application/json', data: JSON.stringify({ video: { name: 'v.mov.exe', mimeType: 'application/x-msdownload', dataBase64: 'TVo=' } }) } });
  rec('scan rejects unsupported video MIME', r.status === 400, `status=${r.status}`);

  /* a valid image now reaches the provider, which is unconfigured: the admin
   * must get a clear provider error, not a silent success or fake listing. */
  r = await call('/api/admin/scan', { method: 'POST', token: adminToken, raw: { type: 'application/json', data: JSON.stringify({ images: [{ name: 'car.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }] }) } });
  rec('scan never fakes a result without an AI key', r.status >= 500 && /AI provider error/i.test(r.data.error || ''), `status=${r.status} body=${JSON.stringify(r.data).slice(0, 160)}`);

  r = await call('/api/admin/scan', { method: 'POST', raw: { type: 'application/json', data: '{}' } });
  rec('scan requires authentication', r.status === 401 || r.status === 403, `status=${r.status}`);

  r = await call('/api/admin/scan', { method: 'POST', token: custToken, raw: { type: 'application/json', data: '{}' } });
  rec('scan forbidden for customers', r.status === 403, `status=${r.status}`);

  /* ---------------- 5xx messages must not leak internals ---------------- */
  r = await call('/api/admin/ai/tick', { method: 'POST', token: adminToken });
  rec('internal failure is masked for clients', r.status === 500 && /temporarily unavailable/i.test(r.data.error || '') && !/migration|postgrest|relation|schema/i.test(r.data.error || ''), `status=${r.status} "${String(r.data.error || '').slice(0, 60)}"`);

  /* ---------------- body size limits ---------------- */
  const big = JSON.stringify({ name: 'Audit', email: 'a@example.com', message: 'x'.repeat(2 * 1024 * 1024) });
  r = await call('/api/enquiries', { method: 'POST', raw: { type: 'application/json', data: big } });
  rec('oversized enquiry body rejected', r.status === 413, `status=${r.status}`);

  const bad = await call('/api/enquiries', { method: 'POST', raw: { type: 'application/json', data: '{not json' } });
  rec('malformed JSON rejected', bad.status === 400, `status=${bad.status}`);

  /* ---------------- privilege checks ---------------- */
  for (const p of ['/api/admin/settings', '/api/admin/ai/credentials', '/api/admin/ai/jobs']) {
    r = await call(p, { token: custToken });
    rec(`customer blocked from ${p}`, r.status === 403 || r.status === 401, `status=${r.status}`);
  }
  r = await call('/api/admin/settings', { method: 'PUT', token: custToken, body: { company_name: 'Hacked' } });
  rec('customer cannot write settings', r.status === 403, `status=${r.status}`);
  r = await call('/api/admin/ai/credentials', { method: 'PUT', token: custToken, body: { gemini_api_key: 'x' } });
  rec('customer cannot write AI credentials', r.status === 403, `status=${r.status}`);

  /* ---------------- direct PostgREST RLS (anon key) ---------------- */
  const anonHeaders = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, Prefer: 'return=representation' };
  r = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries`, {
    method: 'POST', headers: { ...anonHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'RLS Audit', email: 'rls@example.com', message: 'direct write test', type: 'question', status: 'responded' }),
  }).then(async (x) => ({ status: x.status, data: await x.json().catch(() => ({})) }));
  rec('anonymous direct enquiry insert blocked (live policies)', r.status === 401 || r.status === 403, `status=${r.status}`);

  /* ---------------- maintenance mode (real, server-side) ---------------- */
  const setMode = async (mode) => {
    const rr = await call('/api/admin/settings', { method: 'PUT', token: adminToken, body: { maintenance_mode: mode } });
    return rr;
  };
  /* The live site must never be left in maintenance mode. Read the flag, and
   * if a previous run left it on, turn it off before doing anything else. */
  const readFlag = async () => {
    const rows = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode&select=value`, { headers: SVC })
      .then((x) => x.json()).catch(() => []);
    return String((rows && rows[0] && rows[0].value) || 'no').toLowerCase();
  };
  if (String(originalMaintenance).toLowerCase() === 'yes') {
    await setMode('no');
    rec('previous run left maintenance mode on — restored to normal', (await readFlag()) !== 'yes');
    originalMaintenance = 'no';
  }
  r = await setMode('yes');
  rec('maintenance mode enabled', r.status === 200, `status=${r.status}`);
  let publicStatus = 0, waited = 0;
  while (waited < 90) {
    const pr = await fetch(BASE + '/', { headers: { accept: 'text/html' } }).catch(() => ({ status: 0 }));
    publicStatus = pr.status;
    if (publicStatus === 503) break;
    await sleep(5000); waited += 5;
  }
  rec('public page shows maintenance 503', publicStatus === 503, `status=${publicStatus} after ${waited}s`);
  r = await call('/api/health');
  rec('API stays available during maintenance', r.status === 200, `status=${r.status}`);
  const adminPage = await fetch(BASE + '/admin/', { headers: { accept: 'text/html' } }).catch(() => ({ status: 0 }));
  rec('admin dashboard stays available', adminPage.status === 200, `status=${adminPage.status}`);

  r = await setMode(originalMaintenance || 'no');
  rec('maintenance mode restored', r.status === 200, `status=${r.status}`);
  let restored = 0; waited = 0;
  while (waited < 120) {
    const pr = await fetch(BASE + '/', { headers: { accept: 'text/html' } }).catch(() => ({ status: 0 }));
    restored = pr.status;
    if (restored === 200) break;
    await sleep(5000); waited += 5;
  }
  rec('public site restored', restored === 200, `status=${restored} after ${waited}s`);
} catch (e) {
  rec('security harness completed', false, e.message);
} finally {
  /* Restore the flag through the database AND verify it, with retries — a
   * silent failure here would take the live site offline. */
  for (let i = 0; i < 5; i++) {
    const cur = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode&select=value`, { headers: SVC })
      .then((x) => x.json()).catch(() => []);
    const now = String((cur && cur[0] && cur[0].value) || 'no').toLowerCase();
    if (now !== 'yes') break;
    await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode`, {
      method: 'PATCH', headers: SVC, body: JSON.stringify({ value: originalMaintenance || 'no' }),
    }).catch(() => {});
    await sleep(1500);
  }
  const finalFlag = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?key=eq.maintenance_mode&select=value`, { headers: SVC })
    .then((x) => x.json()).catch(() => []);
  rec('maintenance flag is off after the run',
    String((finalFlag && finalFlag[0] && finalFlag[0].value) || 'no').toLowerCase() !== 'yes',
    `value=${(finalFlag && finalFlag[0] && finalFlag[0].value) || 'unknown'}`);
  if (custId) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${custId}`, { method: 'DELETE', headers: SVC }).catch(() => {});
  if (userId) {
    const d = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: SVC });
    rec('cleanup temporary users', d.ok || d.status === 404, `status=${d.status}`);
  }
  await fetch(`${env.SUPABASE_URL}/rest/v1/activity_logs?actor=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: SVC }).catch(() => {});
  await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?email=eq.${encodeURIComponent(`audit.cust.${stamp}@example.com`)}`, { method: 'DELETE', headers: SVC }).catch(() => {});
}
const failed = log.filter((x) => !x.ok);
console.log(`\n${log.length - failed.length}/${log.length} checks passed; ${failed.length} failed.`);
process.exitCode = failed.length ? 1 : 0;
