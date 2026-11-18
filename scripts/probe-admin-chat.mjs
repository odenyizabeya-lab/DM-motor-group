import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
(async () => {
  const SBURL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_KEY;
  const create = await fetch(SBURL + '/rest/v1/ai_conversations', {
    method: 'POST', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC, 'content-type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ channel: 'web', customer_email: 'inspect@example.com', customer_name: 'Inspect', subject: 'inspect probe', status: 'open' }),
  });
  const text = await create.text();
  console.log('create:', create.status, text.slice(0, 300));
  const conv = JSON.parse(text)[0];
  console.log('id:', conv && conv.id);
  const login = await fetch('http://127.0.0.1:8798/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'DMAdmin' },
    body: JSON.stringify({ email: JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8')).email, password: JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8')).password }),
  });
  const lj = await login.json();
  const r2 = await fetch('http://127.0.0.1:8798/api/admin/chat/conversations', { headers: { Authorization: 'Bearer ' + lj.token, 'x-requested-with': 'DMAdmin' } });
  console.log('admin list:', r2.status, (await r2.text()).slice(0, 400));
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
