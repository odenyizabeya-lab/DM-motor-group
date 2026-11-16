import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
const pg = new EmbeddedPostgres({ databaseDir: './.tmp-pgdiag', user: 'postgres', password: 'testpassword', port: 55441, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
await pg.initialise(); await pg.start();
const client = pg.getPgClient(); await client.connect();
await client.query(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_meta jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.uid () returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role () returns text language sql stable as $$ select current_user $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, owner uuid, public boolean default false, created_at timestamptz default now(), updated_at timestamptz default now(), file_size_limit bigint, allowed_mime_types text[], bucket_id text);
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb
  );
  create or replace function storage.foldername (name text) returns text language sql immutable as $$ select name $$;
`);
const body = fs.readFileSync('supabase/migrations/00003_storage.sql', 'utf8');
const stmts = body.split(';\n').map((s) => s.trim()).filter((s) => s && !/^--/.test(s));
for (const s of stmts) {
  try { await client.query(s.endsWith(';') ? s : s + ';'); }
  catch (e) {
    console.log('FIRST FAILING STATEMENT:\n' + s.replace(/\s+/g, ' ').slice(0, 200));
    console.log('\nERROR: ' + String(e.message).split('\n').find((l) => /^(ERROR|FATAL)/i.test(l)));
    break;
  }
}
await client.end(); await pg.stop();
