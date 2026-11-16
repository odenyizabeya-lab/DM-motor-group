/* Verify the two migrations are live in the production database and that
 * nothing was damaged. Run right after the user executes the SQL. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const SVC = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY };
const ANON = { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY };
const B = env.SUPABASE_URL;
const get = async (p, h = SVC) => {
  const r = await fetch(B + '/rest/v1/' + p, { headers: h });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, rows: Array.isArray(j) ? j.length : (j ? 1 : 0), body: t.slice(0, 120) };
};

console.log('=== 1. MIGRATION 1: new vehicle + media columns');
const spec = await fetch(B + '/rest/v1/', { headers: { ...SVC, Accept: 'application/openapi+json' } }).then((r) => r.json());
const defs = spec.definitions || spec.components?.schemas || {};
const cols = (t) => Object.keys((defs[t] || {}).properties || {});
const vehCols = cols('vehicles');
const NEW = ['headline', 'selling_points', 'market_value_estimate', 'seo_title', 'seo_description', 'technology_features',
  'interior_features', 'exterior_features', 'damage', 'ownership_history', 'service_history', 'documents',
  'inspection_points', 'inspection_date', 'inspection_verified', 'reservation_deposit', 'reservation_terms',
  'discount_percent', 'discount_note', 'discount_until'];
const have = NEW.filter((c) => vehCols.includes(c));
const missing = NEW.filter((c) => !vehCols.includes(c));
console.log('  vehicle columns present :', have.length + '/20', missing.length ? '| MISSING: ' + missing.join(',') : '');
const medCols = cols('media');
console.log('  media.plays column     :', medCols.includes('plays') ? 'present' : 'MISSING',
  '| media.last_played_at:', medCols.includes('last_played_at') ? 'present' : 'MISSING');

console.log('\n=== 2. MIGRATION 2a: AI tables + queue');
const tables = Object.keys(defs).filter((n) => n.startsWith('ai_'));
console.log('  ai_* tables in the live schema:', tables.length + '/7', tables.length ? '(' + tables.join(', ') + ')' : '');
console.log('  ai_settings row             :', (await get('ai_settings?select=id,enabled')).rows, 'row(s)');
console.log('  ai_secrets readable by svc  :', (await get('ai_secrets?select=key')).rows, 'row(s)');
console.log('  ai_jobs queue               :', (await get('ai_jobs?select=id')).rows, 'row(s)');

console.log('\n=== 3. MIGRATION 2b: security hardening (tested as ANON)');
const internal = await get('settings?key=eq.dev_reset_tokens&select=key', ANON);
console.log('  anon reads internal settings   :', internal.rows, 'row(s)', internal.rows === 0 ? '-> BLOCKED (correct)' : '-> STILL READABLE (00008 not applied)');
const pub = await get('settings?key=eq.company_name&select=key', ANON);
console.log('  anon reads public settings     :', pub.rows, 'row(s)', pub.rows === 1 ? '-> ALLOWED (correct)' : '-> BROKEN (public pages would break)');
const legal = await get('settings?key=eq.legal_company_name&select=key', ANON);
console.log('  anon reads legal_company_name  :', legal.rows, 'row(s)', legal.rows === 1 ? '-> ALLOWED (correct)' : '-> BLOCKED (legal pages would show placeholders)');
for (const t of ['enquiries', 'profiles', 'orders']) {
  const r = await get(t + '?select=id&limit=2', ANON);
  console.log('  anon reads ' + t.padEnd(10) + '         :', r.rows, 'row(s)', r.rows === 0 ? '-> BLOCKED (correct)' : '-> LEAK');
}
const tInsert = await fetch(B + '/rest/v1/testimonials', {
  method: 'POST', headers: { ...ANON, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ name: 'policy check', location: 'check', rating: 5, body: 'policy check', status: 'approved' }),
});
console.log('  anon inserts approved testimonial:', tInsert.status, tInsert.status >= 400 ? '-> DENIED (correct)' : '-> STILL ALLOWED');
if (tInsert.status < 300) {
  await fetch(B + '/rest/v1/testimonials?name=eq.policy%20check', { method: 'DELETE', headers: SVC });
  console.log('     (check row removed)');
}

console.log('\n=== 4. DATA INTACT (service role)');
for (const t of ['vehicles', 'media', 'enquiries', 'orders', 'profiles', 'settings', 'notifications', 'activity_logs', 'banners', 'testimonials', 'favourites']) {
  const r = await get(t + '?select=*&limit=1');
  process.stdout.write('  ' + t.padEnd(16) + r.rows + ' row(s)   ');
}
console.log('\n  vehicles by status:');
const byStatus = await fetch(B + '/rest/v1/vehicles?select=status', { headers: SVC }).then((r) => r.json());
const counts = {};
for (const v of byStatus) counts[v.status] = (counts[v.status] || 0) + 1;
console.log('   ', JSON.stringify(counts));
const withVid = await fetch(B + '/rest/v1/media?type=eq.video&select=id', { headers: SVC }).then((r) => r.json());
console.log('    videos still attached:', withVid.length);

console.log('\n=== 5. APPLICATION STILL READS/WRITES');
const r1 = await fetch(B + '/rest/v1/vehicles?select=id,brand,model,headline,price&limit=3', { headers: SVC }).then((r) => r.json());
console.log('  vehicles select incl. new columns:', Array.isArray(r1) && r1.length ? 'OK (' + r1.map((v) => v.brand + ' ' + v.model).join(', ') + ')' : 'FAILED');
const upd = await fetch(B + '/rest/v1/vehicles?slug=eq.plymouth-barracuda-1970', {
  method: 'PATCH', headers: { ...SVC, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ headline: 'schema write check' }),
});
const updBody = await upd.json();
console.log('  write to a new column         :', upd.status, Array.isArray(updBody) && updBody[0] ? 'OK (headline=' + JSON.stringify(updBody[0].headline) + ')' : updBody);
await fetch(B + '/rest/v1/vehicles?slug=eq.plymouth-barracuda-1970', {
  method: 'PATCH', headers: { ...SVC, 'content-type': 'application/json' }, body: JSON.stringify({ headline: null }),
});
console.log('  (test value cleared)');
