/* =====================================================================
   REAL SQL TEST of the migrations against a real PostgreSQL 18 instance.
     1. start PostgreSQL
     2. Supabase auth stubs + roles
     3. apply 00001-00005 (already live in production)
     4. insert representative data
     5. apply MIGRATION 1 and MIGRATION 2
     6. verify data intact + new objects exist + policies correct
     7. re-apply both migrations (idempotency)
     8. test the hardened policies as the `anon` role
   ===================================================================== */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';

const pg = new EmbeddedPostgres({
  databaseDir: './.tmp-pgtest', user: 'postgres', password: 'testpassword', port: 55439, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const q = async (t) => (await client.query(t)).rows;
const sql = async (t) => { await client.query(t); };
const one = async (t) => (await q(t))[0];
const val = async (t) => Object.values((await q(t))[0])[0];

console.log('1. PostgreSQL', (await val('select version()')).toString().slice(0, 28), 'ready');

await sql(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.uid () returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role () returns text language sql stable as $$ select current_user $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- Supabase-managed storage schema (00003 writes policies on it)
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key, name text, owner uuid, public boolean default false,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    file_size_limit bigint, allowed_mime_types text[], bucket_id text
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    metadata jsonb
  );
  create or replace function storage.foldername (name text) returns text language sql immutable as $$ select name $$;
`);
console.log('2. auth + storage stubs + roles created');

for (const f of ['00001_schema.sql', '00002_rls.sql', '00003_storage.sql', '00004_helpers.sql', '00005_admin_integrations.sql']) {
  try { await sql(fs.readFileSync('supabase/migrations/' + f, 'utf8')); console.log('   applied ' + f); }
  catch (e) { console.log('   FAILED ' + f + ': ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 2).join(' | ')); }
}

await sql(`
  insert into public.vehicles (slug, status, brand, model, year, price, currency, mileage, engine, features, safety_features)
  values ('test-car-1','published','Plymouth','Barracuda',1970,56995,'USD',12000,'V8','[]'::jsonb,'[]'::jsonb),
         ('test-car-2','draft','Ford','Mustang',2019,3500,'USD',45000,'V8','[]'::jsonb,'[]'::jsonb);
  insert into public.media (vehicle_id, type, url, thumb_url, caption, position)
  select id,'video','https://example.test/v.mp4','','demo video',0 from public.vehicles where slug='test-car-1';
  insert into public.enquiries (vehicle_id, type, name, email, message) values (1,'question','Buyer One','buyer@example.com','Is this available?');
  insert into public.orders (vehicle_id, type, amount, currency, status, notes) values (1,'purchase',1000,'USD','new','{"payment":{"reference":"DMG-20260101-TEST0001"}}');
  insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'buyer@example.com')
    on conflict (id) do nothing;
  -- the handle_new_user() trigger creates the profile row automatically
  insert into public.settings (key, value) values ('company_name','DM Motor Group'),('dev_reset_tokens','0'),('legal_company_name','DM Motor Group Ltd')
    on conflict (key) do update set value = excluded.value;
  insert into public.testimonials (name, location, rating, body, status) values ('Probe','Probe',5,'probe','approved');
`);
console.log('3. sample data inserted');

let m1 = 'OK', m2a = 'OK', m2b = 'OK', m3 = 'OK';
try { await sql(fs.readFileSync('supabase/migrations/00006_vehicle_ai_fields.sql', 'utf8')); } catch (e) { m1 = 'FAILED: ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | '); }
try { await sql(fs.readFileSync('supabase/migrations/00007_ai_customer_service.sql', 'utf8')); } catch (e) { m2a = 'FAILED: ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | '); }
try { await sql(fs.readFileSync('supabase/migrations/00008_security_hardening.sql', 'utf8')); } catch (e) { m2b = 'FAILED: ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | '); }
try { await sql(fs.readFileSync('supabase/migrations/00009_vehicle_frames.sql', 'utf8')); } catch (e) { m3 = 'FAILED: ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | '); }
console.log('\n4. MIGRATION 1 :', m1);
console.log('   MIGRATION 2a:', m2a);
console.log('   MIGRATION 2b:', m2b);
console.log('   MIGRATION 3 :', m3);

const NEW_VEH_COLS = "('headline','selling_points','market_value_estimate','seo_title','seo_description','technology_features','interior_features','exterior_features','damage','ownership_history','service_history','documents','inspection_points','inspection_date','inspection_verified','reservation_deposit','reservation_terms','discount_percent','discount_note','discount_until')";
console.log('\n5. VERIFICATION');
console.log('   vehicles preserved         :', await val('select count(*) from vehicles'), '| car 1 price/mileage:', JSON.stringify(await one("select price, mileage from vehicles where slug='test-car-1'")));
console.log('   enquiries preserved       :', await val('select count(*) from enquiries'));
console.log('   orders preserved          :', await val('select count(*) from orders'), '| notes:', (await one('select left(max(notes),26) n from orders')).n);
console.log('   profiles preserved        :', await val('select count(*) from profiles'));
console.log('   settings preserved       :', await val('select count(*) from settings'));
console.log('   testimonials preserved   :', await val('select count(*) from testimonials'));
console.log('   new vehicle columns       :', await val(`select count(*) from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name in ${NEW_VEH_COLS}`), 'of 20');
console.log('   media.plays column        :', await val("select count(*) from information_schema.columns where table_schema='public' and table_name='media' and column_name='plays'"));
console.log('   ai_* tables created        :', await val("select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai_%'"), 'of 7');
console.log('   ai_claim_jobs function     :', await val("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ai_claim_jobs'"));
console.log('   RLS enabled on ai tables   :', await val("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'ai_%' and c.relrowsecurity"), 'of 7');
console.log('   role-guard trigger         :', await val("select count(*) from pg_trigger where tgname='profiles_role_guard'"));
console.log('   hardened settings policy   :', await val("select count(*) from pg_policies where schemaname='public' and tablename='settings' and policyname='settings: public reads public keys'"));
console.log('   anon-insert policies left :', await val("select count(*) from pg_policies where schemaname='public' and policyname in ('testimonials: customers may submit','enquiries: anyone may submit')"), '(must be 0)');
console.log('   duplicate index names      :', await val("select count(*) from (select indexname from pg_indexes where schemaname='public' group by indexname having count(*)>1) x"), '(must be 0)');

let again = 'OK';
try {
  await sql(fs.readFileSync('supabase/migrations/00006_vehicle_ai_fields.sql', 'utf8'));
  await sql(fs.readFileSync('supabase/migrations/00007_ai_customer_service.sql', 'utf8'));
  await sql(fs.readFileSync('supabase/migrations/00008_security_hardening.sql', 'utf8'));
  await sql(fs.readFileSync('supabase/migrations/00009_vehicle_frames.sql', 'utf8'));
} catch (e) { again = 'FAILED: ' + String(e.message).split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' | '); }
console.log('\n6. RE-RUN (idempotency):', again);
console.log('   vehicle columns after re-run:', await val(`select count(*) from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name in ${NEW_VEH_COLS}`), '(must still be 20)');
console.log('   rows intact               :', await val('select count(*) from vehicles'), 'vehicles,', await val('select count(*) from enquiries'), 'enquiries,', await val('select count(*) from orders'), 'orders,', await val('select count(*) from settings'), 'settings');

await sql(`grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon, authenticated; grant usage, select on all sequences in schema public to anon, authenticated;`);
const asAnon = async (t) => {
  try { await sql('set role anon'); const r = await q(t); await sql('reset role'); return r; }
  catch (e) {
    await sql('reset role').catch(() => {});
    const msg = String(e.message || e);
    const line = msg.split('\n').find((l) => /permission denied|error/i.test(l)) || msg.split('\n')[0];
    return 'DENIED (' + String(line).trim().slice(0, 70) + ')';
  }
};
console.log('\n7. POLICY BEHAVIOUR AS `anon` (after migration 2)');
console.log('   internal settings (dev_reset_tokens) ->', (await asAnon("select count(*) c from settings where key='dev_reset_tokens'"))[0].c, '(must be 0)');
console.log('   public settings (company_name)      ->', (await asAnon("select count(*) c from settings where key='company_name'"))[0].c, '(must be 1)');
console.log('   legal_company_name                   ->', (await asAnon("select count(*) c from settings where key='legal_company_name'"))[0].c, '(must be 1)');
console.log('   enquiries                            ->', (await asAnon('select count(*) c from enquiries'))[0].c, '(must be 0)');
console.log('   profiles                             ->', (await asAnon('select count(*) c from profiles'))[0].c, '(must be 0)');
console.log('   orders                               ->', (await asAnon('select count(*) c from orders'))[0].c, '(must be 0)');
console.log('   insert approved testimonial          ->', String(await asAnon("insert into testimonials (name, location, rating, body, status) values ('x','x',5,'x','approved')")).slice(0, 90), '(must be denied)');

/* vehicle_frames verification: table exists, RLS works for anon reads */
console.log('\n7b. vehicle_frames (migration 3)');
await sql(`insert into public.vehicle_frames (vehicle_id, url, position)
  select id, 'https://example.test/f1.jpg', 0 from public.vehicles where slug = 'test-car-1'`);
await sql(`insert into public.vehicle_frames (vehicle_id, url, position)
  select id, 'https://example.test/f2.jpg', 0 from public.vehicles where slug = 'test-car-2'`);
console.log('   rows inserted                :', await val('select count(*) from vehicle_frames'), '(must be 2)');
console.log('   duplicate (vehicle_id, position)  :', await val("select count(*) from (select vehicle_id, position from vehicle_frames group by 1,2 having count(*) > 1) x"), '(must be 0)');
console.log('   anon sees published frames  ->', (await asAnon("select count(*) c from vehicle_frames f join vehicles v on v.id = f.vehicle_id where v.slug = 'test-car-1'"))[0].c, '(must be 1)');
console.log('   anon sees draft frames      ->', (await asAnon("select count(*) c from vehicle_frames f join vehicles v on v.id = f.vehicle_id where v.slug = 'test-car-2'"))[0].c, '(must be 0)');
console.log('   anon cannot insert frames   ->', String(await asAnon("insert into vehicle_frames (vehicle_id, url, position) values (1, 'https://example.test/evil.jpg', 0)")).slice(0, 80), '(must be denied)');

await sql(`insert into public.ai_jobs (kind, payload) values ('t1','{}'::jsonb),('t2','{}'::jsonb);`);
console.log('\n8. ai_claim_jobs(1) claimed:', (await q('select count(*) c from ai_claim_jobs(1)'))[0].c, 'row; still pending:', await val("select count(*) from ai_jobs where status='pending'"), '(1 of 2)');

await client.end();
await pg.stop();
console.log('\nTEST COMPLETE - PostgreSQL stopped.');
