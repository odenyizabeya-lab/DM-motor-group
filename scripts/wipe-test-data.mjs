/* Wipe any leftover smoke-test rows (used between runs). */
import { readFile } from 'node:fs/promises';
const env = {};
for (const l of (await readFile('.env.local', 'utf8')).trim().split('\n')) {
  const i = l.indexOf('='); env[l.slice(0, i)] = l.slice(i + 1);
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' };

const wipe = async (table, filter) => {
  if (!filter) return console.log(table, 'skip: delete-all refused by PostgREST');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: H });
  console.log(table, filter, '→', res.status);
};

await wipe('activity_logs', 'detail=ilike.*smoke*');
await wipe('activity_logs', 'actor=eq.smoke-test-owner@dmmotorgroup.example');
await wipe('activity_logs', 'actor=eq.enquirer@example.com');
await wipe('activity_logs', 'actor=eq.smoke-test-owner@dmmotorgroup.example&actor=eq.smoke-test-owner@dmmotorgroup.example');
/* anything not owned by the future real admin is test residue at this stage: */
await wipe('enquiries', 'email=eq.enquirer@example.com');
await wipe('activity_logs', 'actor=eq.dbg@example.com');

/* counts */
for (const t of ['vehicles', 'media', 'enquiries', 'enquiry_messages', 'orders', 'favourites', 'notifications', 'profiles', 'activity_logs', 'banners', 'testimonials', 'settings']) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=id&limit=1`, { headers: { ...H, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
  const range = r.headers.get('content-range') || '*/?';
  console.log(' count', t, range.split('/')[1]);
}
