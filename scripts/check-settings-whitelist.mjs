import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const ANON = { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY };
const B = env.SUPABASE_URL;

const rows = await fetch(B + '/rest/v1/settings?select=key,value&limit=100', { headers: SVC }).then((r) => r.json());
console.log('settings rows in the live database (' + rows.length + '):');
for (const r of rows) console.log('   ' + r.key.padEnd(26) + '= ' + String(r.value).slice(0, 40));

const WL = ['dealership_name', 'company_name', 'currency', 'tagline', 'payment_info', 'inspection_note', 'trade_license',
  'legal_company_name', 'policy_deposit_percent', 'support_hours'];
console.log('\nANON read per key (whitelisted keys only):');
for (const k of WL) {
  const exists = rows.some((r) => r.key === k);
  const r = await fetch(B + '/rest/v1/settings?key=eq.' + encodeURIComponent(k) + '&select=key', { headers: ANON });
  const j = await r.json().catch(() => null);
  const n = Array.isArray(j) ? j.length : 0;
  const verdict = !exists ? 'row does not exist yet' : (n === 1 ? 'READABLE (correct)' : 'BLOCKED (unexpected)');
  console.log('   ' + k.padEnd(24) + ' exists=' + String(exists).padEnd(6) + ' anon rows=' + n + '  ' + verdict);
}
