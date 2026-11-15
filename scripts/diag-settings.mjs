import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json' };
/* list the bank account rows directly */
const rows = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=like.bank_account:*&select=key,value', { headers: H }).then((r) => r.json());
console.log('rows found:', rows.length);
for (const r of rows.slice(0, 4)) {
  let v; try { v = JSON.parse(r.value); } catch (e) { v = r.value; }
  console.log('  ', r.key, '->', JSON.stringify(v).slice(0, 150));
}
/* try a direct PATCH on one row */
if (rows.length) {
  const key = rows[0].key;
  const p = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=' + encodeURIComponent(key), {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ value: rows[0].value, updated_at: new Date().toISOString() }),
  });
  console.log('\ndirect PATCH status:', p.status, '| body:', (await p.text()).slice(0, 200));
}
/* check the public payment-methods endpoint for the deactivated GBP account */
const pub = await fetch('https://dmmotorgroup.com/api/payment-methods/bank-accounts').then((r) => r.json());
console.log('\npublic accounts:', pub.accounts.map((a) => `${a.currency}/${a.bankName}/active=${a.active}`).join(' | '));
