-- ============================================================================
-- 00005_admin_integrations.sql
-- Admin API integrations registry (credentials kept here are MASKED metadata;
-- live secrets live in server-only environment secrets, never here).
-- ============================================================================
create table if not exists public.admin_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  provider text not null,
  name text not null,
  kind text not null default 'other',
  status text not null default 'disconnected',
  masked_value text,
  config jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_integrations_provider on public.admin_integrations (provider);

alter table public.admin_integrations enable row level security;

drop policy if exists "admin_integrations: staff manage" on public.admin_integrations;
create policy "admin_integrations: staff manage" on public.admin_integrations
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager', 'viewer')
    )
  );
