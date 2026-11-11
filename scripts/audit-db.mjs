/* Read-only audit of the live database. */
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const svc = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const anon = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };

async function count(table, headers = svc) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, { headers: { ...headers, Prefer: 'count=exact' } });
  const range = r.headers.get('content-range') || '';
  return { status: r.status, count: r.status === 200 ? (range.split('/')[1] || '?') : null, body: r.status === 200 ? '' : (await r.text()).slice(0, 140) };
}

console.log('=== table sizes (service role) ===');
for (const t of ['vehicles', 'media', 'enquiries', 'enquiry_messages', 'orders', 'profiles', 'notifications', 'settings', 'banners', 'testimonials', 'activity_logs', 'admin_integrations', 'ai_settings', 'ai_secrets', 'ai_conversations', 'ai_messages', 'ai_inspections', 'ai_jobs', 'ai_email_events']) {
  const r = await count(t);
  console.log(`${t.padEnd(20)} ${r.status === 200 ? 'ok  rows=' + r.count : 'MISSING/ERR ' + r.body}`);
}

console.log('\n=== anonymous access (RLS probe) ===');
for (const t of ['vehicles', 'media', 'settings', 'enquiries', 'profiles', 'orders', 'notifications', 'ai_conversations', 'ai_secrets']) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=2`, { headers: anon });
  const txt = await r.text();
  console.log(`${t.padEnd(20)} status=${r.status} ${r.status === 200 ? 'READABLE rows=' + JSON.parse(txt).length : txt.slice(0, 80)}`);
}

console.log('\n=== vehicle integrity ===');
const vres = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicles?select=id,slug,status,price,currency,brand,model,year,cover_media_id&order=id.asc`, { headers: svc });
const vehicles = await vres.json();
const byStatus = vehicles.reduce((a, v) => (a[v.status] = (a[v.status] || 0) + 1, a), {});
console.log('vehicles', vehicles.length, byStatus);
const missingCover = vehicles.filter((v) => !v.cover_media_id);
console.log('vehicles without cover_media_id:', missingCover.length, missingCover.map((v) => v.id).slice(0, 20));
const badSlug = vehicles.filter((v) => !/^[a-z0-9-]+$/.test(v.slug || ''));
console.log('invalid slugs:', badSlug.length);
const zeroPrice = vehicles.filter((v) => !(Number(v.price) > 0));
console.log('price=0 (shown as Price on request):', zeroPrice.length);

const mres = await fetch(`${env.SUPABASE_URL}/rest/v1/media?select=id,vehicle_id,type,url,thumb_url&limit=500`, { headers: svc });
const media = await mres.json();
console.log('media rows', media.length, media.reduce((a, m) => (a[m.type] = (a[m.type] || 0) + 1, a), {}));
console.log('media missing url:', media.filter((m) => !m.url).length);
console.log('media missing thumb:', media.filter((m) => !m.thumb_url).length);

console.log('\n=== orphaning / FK probe ===');
const vids = new Set(vehicles.map((v) => v.id));
console.log('media with unknown vehicle:', media.filter((m) => !vids.has(m.vehicle_id)).length);

console.log('\n=== settings keys ===');
const sres = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?select=key,value`, { headers: svc });
const settings = await sres.json();
console.log(settings.map((s) => s.key).join(', '));
const empty = settings.filter((s) => !String(s.value || '').trim());
console.log('settings with empty value:', empty.map((s) => s.key).join(', ') || 'none');
