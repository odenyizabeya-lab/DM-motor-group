/* =====================================================================
   REAL SQL TEST of the migrations against a throwaway PostgreSQL 16
   (Docker), recreating the live schema first:
     1. start postgres, create the Supabase auth stubs
     2. apply 00001-00005 (the migrations already live in production)
     3. insert representative data (vehicles, media, enquiries, orders,
        profiles, settings, testimonials)
     4. apply MIGRATION 1 and MIGRATION 2
     5. verify: no errors, data intact, new columns/tables/policies exist
     6. re-apply both migrations to prove they are idempotent
     7. test the hardened policies with a role switch to `anon`
   ===================================================================== */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const CONTAINER = 'dm-sql-test';
const PW = 'testpassword';
const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

function psql(sql, db = 'postgres') {
  fs.writeFileSync('/tmp/_q.sql', sql);
  execSync(`docker cp /tmp/_q.sql ${CONTAINER}:/tmp/_q.sql`, { stdio: 'ignore' });
  return execSync(`docker exec ${CONTAINER} psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -f /tmp/_q.sql`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function psqlQuiet(sql) {
  fs.writeFileSync('/tmp/_q.sql', sql);
  execSync(`docker cp /tmp/_q.sql ${CONTAINER}:/tmp/_q.sql`, { stdio: 'ignore' });
  return execSync(`docker exec ${CONTAINER} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f /tmp/_q.sql`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/* ---- 1. start the database ---- */
try { execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' }); } catch {}
run(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PW} -e POSTGRES_DB=postgres -p 55439:5432 postgres:16`);
console.log('postgres container started');
for (let i = 0; i < 40; i++) {
  try { execSync(`docker exec ${CONTAINER} pg_isready -U postgres`, { stdio: 'ignore' }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}
console.log('postgres ready');

/* Supabase-specific stubs that the migrations expect */
psqlQuiet(`
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid () returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role () returns text language sql stable as $$ select current_user $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
`);
console.log('auth stubs + roles created');

/* ---- 2. apply the migrations already live in production ---- */
for (const f of ['00001_schema.sql', '00002_rls.sql', '00003_storage.sql', '00004_helpers.sql', '00005_admin_integrations.sql']) {
  const sql = fs.readFileSync('supabase/migrations/' + f, 'utf8');
  try { psqlQuiet(sql); console.log('  applied ' + f); }
  catch (e) { console.log('  FAILED ' + f + ': ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR|error/.test(l)).slice(0, 3).join(' | ')); }
}

/* ---- 3. representative data ---- */
psqlQuiet(`
  insert into public.vehicles (slug, status, brand, model, year, price, currency, mileage, engine, features, safety_features)
  values ('test-car-1', 'published', 'Plymouth', 'Barracuda', 1970, 56995, 'USD', 12000, 'V8', '[]'::jsonb, '[]'::jsonb),
         ('test-car-2', 'draft',    'Ford',     'Mustang',  2019, 3500,   'USD', 45000, 'V8', '[]'::jsonb, '[]'::jsonb);
  insert into public.media (vehicle_id, type, url, thumb_url, caption, position)
  select id, 'video', 'https://example.test/v.mp4', '', 'demo video', 0 from public.vehicles where slug = 'test-car-1';
  insert into public.enquiries (vehicle_id, type, name, email, message) values (1, 'question', 'Buyer One', 'buyer@example.com', 'Is this available?');
  insert into public.orders (vehicle_id, type, amount, currency, status, notes) values (1, 'purchase', 1000, 'USD', 'new', '{"payment":{"reference":"DMG-20260101-TEST0001"}}');
  insert into public.profiles (id, name, email, role) values (gen_random_uuid(), 'Buyer One', 'buyer@example.com', 'customer');
  insert into public.settings (key, value) values ('company_name', 'DM Motor Group'), ('dev_reset_tokens', '0'), ('legal_company_name', 'DM Motor Group Ltd');
  insert into public.testimonials (name, location, rating, body, status) values ('Probe', 'Probe', 5, 'probe', 'approved');
`);
console.log('sample data inserted');

/* ---- 4. apply the two new migrations ---- */
let m1 = 'n/a', m2a = 'n/a', m2b = 'n/a';
try { psqlQuiet(fs.readFileSync('supabase/migrations/00006_vehicle_ai_fields.sql', 'utf8')); m1 = 'OK'; }
catch (e) { m1 = 'FAILED: ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 4).join(' | '); }
try { psqlQuiet(fs.readFileSync('supabase/migrations/00007_ai_customer_service.sql', 'utf8')); m2a = 'OK'; }
catch (e) { m2a = 'FAILED: ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 4).join(' | '); }
try { psqlQuiet(fs.readFileSync('supabase/migrations/00008_security_hardening.sql', 'utf8')); m2b = 'OK'; }
catch (e) { m2b = 'FAILED: ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 4).join(' | '); }
console.log('MIGRATION 1 :', m1);
console.log('MIGRATION 2a:', m2a);
console.log('MIGRATION 2b:', m2b);

/* ---- 5. verify ---- */
const q = (sql) => execSync(`docker exec ${CONTAINER} psql -U postgres -d postgres -t -A -F "|" -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
console.log('\nVERIFICATION');
console.log('  vehicles rows            :', q('select count(*) from public.vehicles'));
console.log('  first vehicle price/mileage preserved:', q("select price||' / '||coalesce(mileage::text,'-') from public.vehicles where slug='test-car-1'"));
console.log('  enquiries preserved      :', q('select count(*) from public.enquiries'));
console.log('  orders + notes preserved :', q("select count(*)||' / '||left(max(notes),28) from public.orders"));
console.log('  profiles preserved       :', q('select count(*) from public.profiles'));
console.log('  settings rows preserved  :', q('select count(*) from public.settings'));
console.log('  new vehicle columns     :', q("select count(*) from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name in ('headline','selling_points','market_value_estimate','seo_title','seo_description','technology_features','interior_features','exterior_features','damage','ownership_history','service_history','documents','inspection_points','inspection_date','inspection_verified','reservation_deposit','reservation_terms','discount_percent','discount_note','discount_until')"));
console.log('  media.playes column      :', q("select count(*) from information_schema.columns where table_schema='public' and table_name='media' and column_name='plays'"));
console.log('  ai_* tables              :', q("select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai_%'"));
console.log('  ai_claim_jobs function   :', q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ai_claim_jobs'"));
console.log('  rls enabled on ai tables :', q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'ai_%' and c.relrowsecurity"));
console.log('  role-guard trigger       :', q("select count(*) from pg_trigger where tgname='profiles_role_guard'"));
console.log('  hardened settings policy :', q("select count(*) from pg_policies where schemaname='public' and tablename='settings' and policyname='settings: public reads public keys'"));
console.log('  anon-insert policy gone  :', q("select count(*) from pg_policies where schemaname='public' and policyname in ('testimonials: customers may submit','enquiries: anyone may submit')"));
console.log('  duplicate indexes?       :', q("select count(*) from (select indexname from pg_indexes where schemaname='public' group by indexname having count(*)>1) x"));

/* ---- 6. idempotency: re-run both migrations ---- */
let again = 'OK';
try {
  psqlQuiet(fs.readFileSync('supabase/migrations/00006_vehicle_ai_fields.sql', 'utf8'));
  psqlQuiet(fs.readFileSync('supabase/migrations/00007_ai_customer_service.sql', 'utf8'));
  psqlQuiet(fs.readFileSync('supabase/migrations/00008_security_hardening.sql', 'utf8'));
} catch (e) { again = 'FAILED: ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 4).join(' | '); }
console.log('\nRE-RUN (idempotency):', again);
console.log('  vehicle columns after re-run (must be unchanged):', q("select count(*) from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name in ('headline','selling_points','market_value_estimate','seo_title','seo_description','technology_features','interior_features','exterior_features','damage','ownership_history','service_history','documents','inspection_points','inspection_date','inspection_verified','reservation_deposit','reservation_terms','discount_percent','discount_note','discount_until')"));
console.log('  rows still intact:', q('select count(*) from public.vehicles'), 'vehicles,', q('select count(*) from public.enquiries'), 'enquiries,', q('select count(*) from public.orders'), 'orders');

/* ---- 7. policy behaviour with the anon role ---- */
psqlQuiet(`
  grant usage on schema public to anon, authenticated;
  grant select on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
`);
const anonTest = (sql) => {
  try {
    const out = execSync(`docker exec ${CONTAINER} psql -U postgres -d postgres -t -A -c "set role anon; ${sql}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch (e) { return 'ERROR: ' + String(e.stdout || e.message).split('\n').filter((l) => /ERROR/.test(l))[0]; }
};
console.log('\nPOLICY BEHAVIOUR AS `anon` (after migration 2)');
console.log('  read internal settings row dev_reset_tokens ->', anonTest("select count(*) from public.settings where key='dev_reset_tokens'") + ' (must be 0)');
console.log('  read public settings row company_name      ->', anonTest("select count(*) from public.settings where key='company_name'") + ' (must be 1)');
console.log('  read legal_company_name                    ->', anonTest("select count(*) from public.settings where key='legal_company_name'") + ' (must be 1)');
console.log('  read enquiries                             ->', anonTest('select count(*) from public.enquiries') + ' (must be 0)');
console.log('  read profiles                              ->', anonTest('select count(*) from public.profiles') + ' (must be 0)');
console.log('  read orders                                ->', anonTest('select count(*) from public.orders') + ' (must be 0)');
console.log('  insert testimonial as approved             ->', anonTest("insert into public.testimonials (name, location, rating, body, status) values ('x','x',5,'x','approved')") + ' (must fail)');

/* ---- 8. the ai job claim function actually works ---- */
psqlQuiet(`
  insert into public.ai_jobs (kind, payload) values ('test', '{}'::jsonb), ('test2', '{}'::jsonb);
`);
const claim = q("select count(*) from public.ai_claim_jobs(1)");
console.log('\nai_claim_jobs(1) claimed rows:', claim, '(must be 1 - the other stays pending)');
console.log('  ai_jobs rows:', q('select count(*) from public.ai_jobs'), '| still pending:', q("select count(*) from public.ai_jobs where status='pending'"));

execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
console.log('\ntest container removed');
