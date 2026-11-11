import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const email = `audit.ui.${Date.now()}@example.com`;
const password = 'AuditUi' + Math.random().toString(36).slice(2, 10) + '!9';
const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST', headers: SVC, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Audit UI' } }),
});
const created = await r.json().catch(() => ({}));
if (!created.id) throw new Error('create failed: ' + JSON.stringify(created));
await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'PATCH', headers: SVC, body: JSON.stringify({ role: 'admin' }) });
fs.writeFileSync('.tmp-audit-admin.json', JSON.stringify({ id: created.id, email, password }, null, 2));
console.log('created', email, created.id);
