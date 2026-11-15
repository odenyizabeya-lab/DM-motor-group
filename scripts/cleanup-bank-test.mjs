/* Remove every bank-account and payment record created by the tests. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };

/* test payment orders (manual bank transfers) */
const orders = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.purchase&select=id,notes', { headers: H }).then((r) => r.json());
const testOrders = (orders || []).filter((o) => {
  try { return !!JSON.parse(o.notes || '{}').payment; } catch { return false; }
});
if (testOrders.length) {
  const del = await fetch(env.SUPABASE_URL + '/rest/v1/orders?id=in.(' + testOrders.map((o) => o.id).join(',') + ')', { method: 'DELETE', headers: H });
  console.log('deleted test payment orders:', testOrders.length, '->', del.status);
} else console.log('no test payment orders');

/* receipts in storage */
const files = await fetch(env.SUPABASE_URL + '/storage/v1/object/list/payment-receipts', {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ prefix: '', limit: 100 }),
}).then((r) => r.json()).catch(() => []);
if (Array.isArray(files) && files.length) {
  for (const f of files) {
    await fetch(env.SUPABASE_URL + '/storage/v1/object/payment-receipts/' + encodeURIComponent(f.name), { method: 'DELETE', headers: H });
  }
  console.log('deleted test receipts:', files.length);
} else console.log('no test receipts found');

/* test bank accounts */
const rows = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=like.bank_account:*&select=key', { headers: H }).then((r) => r.json());
if ((rows || []).length) {
  const del = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=like.bank_account:*', { method: 'DELETE', headers: H });
  console.log('deleted test bank accounts:', rows.length, '->', del.status);
} else console.log('no test bank accounts');

const left = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=like.bank_account:*&select=key', { headers: H }).then((r) => r.json());
console.log('bank account rows left:', left.length);
