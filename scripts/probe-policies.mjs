/* Determine whether migration 00008 (security hardening) is live, by testing
 * the actual policy behaviour with the ANON key:
 *   - 00008 makes only whitelisted settings keys readable by anon
 *   - the older 00002 policy lets anon read every settings row
 * Also test anonymous writes that 00008 forbids. */
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const ANON = { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY };
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };

const probe = async (label, path, opts = {}) => {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { headers: ANON, ...opts });
  const t = await r.text();
  let n = 0;
  try { const j = JSON.parse(t); n = Array.isArray(j) ? j.length : 1; } catch { n = -1; }
  console.log(`  ${label.padEnd(46)} status ${String(r.status).padEnd(4)} rows ${n}`);
  return { status: r.status, rows: n, body: t.slice(0, 120) };
};

console.log('ANON read of a NON-public settings key (dev_reset_tokens):');
const s1 = await probe('settings?key=eq.dev_reset_tokens', 'settings?key=eq.dev_reset_tokens&select=key,value');
console.log('  -> if rows > 0, migration 00008 is NOT applied (old permissive policy is live)');

console.log('\nANON read of a public settings key (company_name):');
await probe('settings?key=eq.company_name', 'settings?key=eq.company_name&select=key,value');

console.log('\nANON read of vehicles (should be allowed):');
await probe('vehicles?select=id&limit=1', 'vehicles?select=id&limit=1');

console.log('\nANON read of enquiries (private customer data):');
await probe('enquiries?select=id&limit=2', 'enquiries?select=id&limit=2');

console.log('\nANON read of profiles (private customer data):');
await probe('profiles?select=id&limit=2', 'profiles?select=id&limit=2');

console.log('\nANON read of orders (payments):');
await probe('orders?select=id&limit=2', 'orders?select=id&limit=2');

console.log('\nANON insert into testimonials (00008 forbids this):');
const t1 = await probe('POST testimonials', 'testimonials', {
  method: 'POST',
  headers: { ...ANON, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ name: 'policy probe', location: 'probe', rating: 5, body: 'policy probe - should be removed', status: 'approved', vehicle_label: 'probe' }),
});
if (t1.status >= 200 && t1.status < 300) {
  console.log('  -> anonymous insert SUCCEEDED: 00008 is NOT applied');
  /* clean up immediately */
  const svc = await fetch(env.SUPABASE_URL + '/rest/v1/testimonials?name=eq.policy%20probe', { method: 'DELETE', headers: SVC });
  console.log('  probe row removed:', svc.status);
} else {
  console.log('  -> anonymous insert REFUSED: 00008 IS applied');
}

console.log('\nService role check (should see everything):');
const svcRows = await fetch(env.SUPABASE_URL + '/rest/v1/settings?key=eq.dev_reset_tokens&select=key', { headers: SVC }).then((r) => r.json());
console.log('  service role sees dev_reset_tokens:', Array.isArray(svcRows) ? svcRows.length : 'n/a');
