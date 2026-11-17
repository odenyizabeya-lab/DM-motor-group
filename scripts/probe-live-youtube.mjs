import fs from 'node:fs';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const BASE = 'https://dmmotorgroup.com';
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'DMAdmin' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
const lj = await login.json().catch(() => ({}));
console.log('login:', login.status, lj.user ? 'role=' + lj.user.role : JSON.stringify(lj).slice(0, 150));
if (!lj.token) process.exit(1);
const H = { Authorization: 'Bearer ' + lj.token, 'x-requested-with': 'DMAdmin' };
const st = await fetch(BASE + '/api/admin/youtube/status', { headers: H });
const stj = await st.json();
console.log('status:', st.status, 'connected:', stj.connection && stj.connection.connected, 'queue:', (stj.queue || []).length, 'first:', (stj.queue || [])[0] ? (stj.queue[0].brand + ' ' + stj.queue[0].model + ' ' + stj.queue[0].year) : 'none');
const q = await fetch(BASE + '/api/admin/youtube/queue', { headers: H });
const qj = await q.json();
console.log('queue:', q.status, 'items:', qj.length, '| first 3:', qj.slice(0, 3).map((v) => v.brand + ' ' + v.model + ' (' + v.videos + ' video)').join(' | '));
const dry = await fetch(BASE + '/api/admin/youtube/publish-now', {
  method: 'POST', headers: { ...H, 'content-type': 'application/json' },
  body: JSON.stringify({ dryRun: true }),
});
const dj = await dry.json();
console.log('dryRun:', dry.status, 'title:', dj.title, '| id:', dj.vehicleId);
const h = await fetch(BASE + '/api/admin/youtube/history', { headers: H });
console.log('history:', h.status, JSON.stringify(await h.json()));
