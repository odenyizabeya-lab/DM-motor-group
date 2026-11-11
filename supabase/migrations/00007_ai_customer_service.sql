-- ============================================================================
-- 00007_ai_customer_service.sql
-- AI customer relations assistant: conversations, messages, inspections,
-- durable job queue, email events and server-only secrets.
--
-- SECURITY MODEL
--   * Every table has RLS enabled and NO policies, so only the service-role
--     key used by the Cloudflare Worker can read or write.
--   * API keys never live in the publicly-readable `settings` table.
--   * The job queue is claimed with SELECT ... FOR UPDATE SKIP LOCKED so two
--     concurrent ticks can never process the same job.
-- Idempotent: safe to re-run.
-- ============================================================================
create extension if not exists pgcrypto;

-- ------------------------------------------------------------- ai_settings
create table if not exists public.ai_settings (
  id                    int primary key default 1 check (id = 1),
  enabled               boolean not null default false,
  business_name         text not null default 'DM Motor Group',
  team_name             text not null default 'Customer Relations Team',
  from_name             text not null default 'DM Motor Group',
  from_email            text not null default '',
  reply_domain          text not null default '',
  admin_email           text not null default '',
  timezone              text not null default 'Asia/Dubai',
  tone                  text not null default 'warm, professional, respectful and reassuring',
  instructions          text not null default '',
  signature             text not null default 'Warm regards,',
  daily_email_cap       int  not null default 100,
  reply_delay_seconds   int  not null default 20,
  followup_hours        int  not null default 48,
  ai_provider           text not null default 'gemini',
  gemini_model          text not null default 'gemini-2.5-flash',
  openai_model          text not null default 'gpt-4o-mini',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------- ai_secrets
-- Server-only credentials. RLS with no policies + explicit revoke.
create table if not exists public.ai_secrets (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------- ai_conversations
create table if not exists public.ai_conversations (
  id                 uuid primary key default gen_random_uuid(),
  reply_token        text not null unique default encode(gen_random_bytes(9), 'hex'),
  customer_email     text not null,
  customer_name      text not null default '',
  vehicle_id         bigint references public.vehicles (id) on delete set null,
  enquiry_id         bigint references public.enquiries (id) on delete set null,
  subject            text not null default '',
  channel            text not null default 'email',
  status             text not null default 'open'
                     check (status in ('open','pending','closed')),
  ai_paused          boolean not null default false,
  human_takeover     boolean not null default false,
  escalated          boolean not null default false,
  escalation_reason  text not null default '',
  last_direction     text not null default '',
  last_message_at    timestamptz,
  message_count      int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ai_conversations_email_idx on public.ai_conversations (customer_email, updated_at desc);
create index if not exists ai_conversations_vehicle_idx on public.ai_conversations (vehicle_id, updated_at desc);
create index if not exists ai_conversations_status_idx on public.ai_conversations (status, updated_at desc);

-- ------------------------------------------------------------ ai_messages
create table if not exists public.ai_messages (
  id                  bigint generated always as identity primary key,
  conversation_id     uuid not null references public.ai_conversations (id) on delete cascade,
  direction           text not null check (direction in ('inbound','outbound','internal')),
  channel             text not null default 'email',
  from_email          text not null default '',
  to_email            text not null default '',
  subject             text not null default '',
  body_text           text not null default '',
  body_html           text not null default '',
  status              text not null default 'queued'
                      check (status in ('queued','sending','sent','delivered','received','failed','bounced','skipped')),
  provider            text not null default '',
  provider_message_id text not null default '',
  error               text not null default '',
  meta                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index if not exists ai_messages_provider_idx on public.ai_messages (provider_message_id);

-- ---------------------------------------------------------- ai_inspections
create table if not exists public.ai_inspections (
  id                bigint generated always as identity primary key,
  conversation_id   uuid references public.ai_conversations (id) on delete set null,
  vehicle_id        bigint references public.vehicles (id) on delete set null,
  customer_name     text not null default '',
  customer_email    text not null default '',
  preferred_date    date,
  preferred_time    text not null default '',
  customer_message  text not null default '',
  status            text not null default 'requested'
                    check (status in ('requested','confirmed','rescheduled','cancelled','completed')),
  admin_notes       text not null default '',
  confirmed_date    date,
  confirmed_time    text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ai_inspections_status_idx on public.ai_inspections (status, created_at desc);
create index if not exists ai_inspections_conversation_idx on public.ai_inspections (conversation_id);

-- ---------------------------------------------------------------- ai_jobs
create table if not exists public.ai_jobs (
  id               bigint generated always as identity primary key,
  kind             text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                   check (status in ('pending','processing','done','failed')),
  attempts         int not null default 0,
  max_attempts     int not null default 6,
  run_after        timestamptz not null default now(),
  locked_at        timestamptz,
  last_error       text not null default '',
  idempotency_key  text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ai_jobs_ready_idx on public.ai_jobs (status, run_after, id);
create index if not exists ai_jobs_kind_idx on public.ai_jobs (kind, created_at desc);

-- Atomic claim: one worker tick at a time may own a job.
create or replace function public.ai_claim_jobs (p_limit int default 10)
returns setof public.ai_jobs
language sql
security definer
set search_path = public
as $$
  update public.ai_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_at = now(),
         updated_at = now()
   where j.id in (
     select id
       from public.ai_jobs
      where status = 'pending'
        and run_after <= now ()
      order by run_after asc, id asc
      limit greatest (1, least (coalesce(p_limit, 10), 50))
      for update skip locked
   )
  returning j.*;
$$;

-- -------------------------------------------------------- ai_email_events
create table if not exists public.ai_email_events (
  id           bigint generated always as identity primary key,
  provider     text not null default 'resend',
  event_type   text not null,
  provider_id  text not null default '',
  payload      jsonb not null default '{}'::jsonb,
  processed    boolean not null default false,
  error        text not null default '',
  created_at   timestamptz not null default now()
);
create unique index if not exists ai_email_events_dedupe_idx
  on public.ai_email_events (provider, provider_id, event_type);

-- ------------------------------------------------------------------- RLS
alter table public.ai_settings      enable row level security;
alter table public.ai_secrets       enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_inspections   enable row level security;
alter table public.ai_jobs          enable row level security;
alter table public.ai_email_events  enable row level security;

-- No policies are created on purpose: service role bypasses RLS, everyone
-- else is denied. Extra grant hardening for the secrets table.
revoke all on public.ai_secrets from anon, authenticated;
revoke all on function public.ai_claim_jobs (int) from public, anon, authenticated;
