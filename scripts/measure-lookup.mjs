import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const t0 = Date.now();
const orders = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.purchase&select=*', { headers: H }).then((r) => r.json());
console.log('purchase orders:', (orders || []).length, '| fetch took', Date.now() - t0, 'ms');
const t1 = Date.now();
const one = await fetch(env.SUPABASE_URL + '/rest/v1/orders?type=eq.purchase&notes=like.*DMG-*&select=id,status,notes', { headers: H }).then((r) => r.json());
console.log('like-filtered query:', (one || []).length, 'rows in', Date.now() - t1, 'ms');
const t2 = Date.now();
const live = await fetch('https://dmmotorgroup.com/api/payments/lookup?reference=DMG-20261115-TEST1234').then((r) => r.json().catch(() => ({})));
console.log('live lookup took', Date.now() - t2, 'ms ->', JSON.stringify(live).slice(0, 90));
