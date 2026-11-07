/* Verify the production database: tables, policies, functions, buckets, settings. */
const TOKEN = process.env.SB_MGMT_TOKEN;
const REF = 'gevxgqdevaanmxqzverv';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const q = async (sql) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: H, body: JSON.stringify({ query: sql }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t || '[]');
};

const [tables, policies, fns, buckets, settings, rls] = await Promise.all([
  q(`select table_name from information_schema.tables where table_schema='public' order by 1`),
  q(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`),
  q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`),
  q(`select id, public, file_size_limit from storage.buckets order by 1`),
  q(`select count(*) as n from public.settings`),
  q(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`),
]);

console.log('TABLES (' + tables.length + '):', tables.map(t => t.table_name).join(', '));
console.log('FUNCTIONS (' + fns.length + '):', fns.map(f => f.proname).join(', '));
console.log('BUCKETS:', JSON.stringify(buckets));
console.log('SETTINGS ROWS:', settings[0].n);
console.log('POLICIES (' + policies.length + '):');
let last = '';
for (const p of policies) {
  if (p.tablename !== last) { console.log(' · ' + p.tablename); last = p.tablename; }
  console.log('   - ' + p.policyname);
}
console.log('RLS ENABLED ON ALL TABLES:', rls.every(r => r.relrowsecurity) ? 'YES' : 'NO — ' + JSON.stringify(rls.filter(r => !r.relrowsecurity)));
