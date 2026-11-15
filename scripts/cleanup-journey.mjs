/* Clean up everything the buyer-journey test created and restore the vehicle. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };
const BASE = 'https://dmmotorgroup.com';
const creds = JSON.parse(fs.readFileSync('.tmp-audit-admin.json', 'utf8'));
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: creds.email, password: creds.password }) }).then((r) => r.json());
const AH = { 'content-type': 'application/json', Authorization: 'Bearer ' + login.token };

/* restore the vehicle that the test reserved */
const rows = await fetch(BASE + '/api/admin/vehicles', { headers: AH }).then((r) => r.json());
for (const v of rows.filter((x) => x.slug === 'plymouth-barracuda-1970' && x.status !== 'published')) {
  const r = await fetch(BASE + '/api/admin/vehicles/' + v.id + '/status', { method: 'POST', headers: AH, body: JSON.stringify({ status: 'published' }) });
  console.log('restored vehicle to published:', v.slug, '->', r.status);
}

/* test payments */
const orders = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.purchase&select=id,notes', { headers: H }).then((r) => r.json());
const testOrders = (orders || []).filter((o) => { try { return !!JSON.parse(o.notes || '{}').payment; } catch { return false; } });
if (testOrders.length) {
  await fetch(env.SUPABASE_URL + '/rest/v1/orders?id=in.(' + testOrders.map((o) => o.id).join(',') + ')', { method: 'DELETE', headers: H });
  console.log('deleted test payments:', testOrders.length);
}
/* receipts */
const files = await fetch(env.SUPABASE_URL + '/storage/v1/object/list/payment-receipts', { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ prefix: '', limit: 100 }) }).then((r) => r.json()).catch(() => []);
if (Array.isArray(files)) for (const f of files) await fetch(env.SUPABASE_URL + '/storage/v1/object/payment-receipts/' + encodeURIComponent(f.name), { method: 'DELETE', headers: H });
console.log('deleted test receipts:', Array.isArray(files) ? files.length : 0);
/* test accounts */
const ba = await fetch(BASE + '/api/admin/bank-accounts', { headers: AH }).then((r) => r.json());
for (const a of ba.accounts || []) {
  await fetch(BASE + '/api/admin/bank-accounts/' + a.id, { method: 'DELETE', headers: AH });
  console.log('deleted test account:', a.bankName, a.currency);
}
const left = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=like.bank_account:*&select=key', { headers: H }).then((r) => r.json());
console.log('bank account rows left:', left.length);
