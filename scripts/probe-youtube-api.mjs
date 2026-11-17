import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const BASE = 'http://127.0.0.1:8798';
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'DMAdmin' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
const lj = await login.json().catch(() => ({}));
console.log('login:', login.status, lj.user ? 'role=' + lj.user.role : JSON.stringify(lj).slice(0, 120));
if (!lj.token) process.exit(1);
const H = { Authorization: 'Bearer ' + lj.token, 'x-requested-with': 'DMAdmin' };
for (const path of ['/api/admin/youtube/status', '/api/admin/youtube/queue', '/api/admin/youtube/history']) {
  const r = await fetch(BASE + path, { headers: H });
  const t = await r.text();
  console.log(path, '->', r.status, t.slice(0, 300));
}
const dry = await fetch(BASE + '/api/admin/youtube/publish-now', {
  method: 'POST', headers: { ...H, 'content-type': 'application/json' },
  body: JSON.stringify({ dryRun: true }),
});
const dt = await dry.text();
console.log('dryRun ->', dry.status, dt.slice(0, 700));
