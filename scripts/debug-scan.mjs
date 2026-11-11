import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const email = `debug.scan.${Date.now()}@example.com`;
const password = 'DebugScan123!';
let id;
try {
  const c = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: SVC, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Debug' } }) }).then((r) => r.json());
  id = c.id;
  await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ role: 'admin' }) });
  const login = await fetch('https://dmmotorgroup.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
  for (const base of ['https://dmmotorgroup.com', 'https://fc27aeac.dm-motor-group-9dq.pages.dev', 'https://dm-motor-group-9dq.pages.dev']) {
    const started = Date.now();
    const r = await fetch(base + '/api/admin/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + login.token, 'content-type': 'application/json' },
      body: JSON.stringify({ images: [{ name: 'car.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }] }),
    });
    const t = await r.text();
    console.log('\n===', base, '->', r.status, `${Date.now() - started}ms`, 'type', r.headers.get('content-type'));
    for (const [k, v] of r.headers) if (/^(cf-|server|content-type|content-length|x-)/i.test(k)) console.log(' ', k + ':', v);
    console.log(' body:', t.slice(0, 200).replace(/\s+/g, ' '));
  }
} finally {
  if (id) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
}
