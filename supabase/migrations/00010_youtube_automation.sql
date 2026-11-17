-- ============================================================================
-- MIGRATION 4 - YouTube Marketing Automation
-- File: 00010_youtube_automation.sql
--
-- Run AFTER 00009_vehicle_frames.sql. Idempotent and safe to re-run.
--
-- Design notes:
--   * youtube_settings  - ONE row (id = 1): connection + schedule configuration,
--                         edited only through the admin dashboard.
--                         OAuth tokens are NOT stored here (they live in the
--                         service-role-only ai_secrets table).
--   * youtube_publications - every publication attempt and its result. The
--                         UNIQUE partial index on (vehicle_id, status='published')
--                         prevents the same vehicle being published twice at the
--                         same time; the claim flow enforces it end to end.
--   * Workers/Pages + service role only; no anon access of any kind.
-- ============================================================================

create table if not exists public.youtube_settings (
  id                     smallint     primary key default 1 check (id = 1),
  enabled                boolean      not null default false,
  paused                 boolean      not null default false,
  publish_hour           smallint     not null default 10 check (publish_hour between 0 and 23),
  publish_minute         smallint     not null default 0   check (publish_minute between 0 and 59),
  timezone               text         not null default 'Asia/Dubai',
  videos_per_day         smallint     not null default 1   check (videos_per_day between 1 and 4),
  frequency_days         integer      not null default 30  check (frequency_days >= 1),
  selection_mode         text         not null default 'auto' check (selection_mode in ('auto', 'manual')),
  auto_selection         boolean      not null default true,
  auto_thumbnail         boolean      not null default true,
  privacy_status         text         not null default 'private' check (privacy_status in ('private', 'unlisted', 'public')),
  category_id            text         not null default '2',   -- 2 = Cars & Vehicles
  tags                   text[]       not null default '{}'::text[],
  last_run_at            timestamptz,
  last_error             text,
  updated_at             timestamptz  not null default now()
);

insert into public.youtube_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.youtube_publications (
  id                bigint generated always as identity primary key,
  vehicle_id        bigint      not null references public.vehicles (id) on delete cascade,
  video_media_id    bigint      references public.media (id) on delete SET NULL,
  slug              text        not null,
  video_title       text        not null default '',
  youtube_video_id  text,
  youtube_url       text,
  status            text        not null default 'queued'
                    check (status in ('queued', 'uploading', 'published', 'failed', 'skipped')),
  privacy_status    text        not null default 'private',
  upload_offset     bigint      not null default 0,
  upload_session    text,
  upload_session_expires timestamptz,
  attempts          smallint    not null default 0,
  error_message     text,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A vehicle may only have ONE in-flight publication at a time.
create unique index if not exists youtube_publications_inflight_uidx
  on public.youtube_publications (vehicle_id)
  where status in ('queued', 'uploading');

create index if not exists youtube_publications_status_idx
  on public.youtube_publications (status, created_at desc);
create index if not exists youtube_publications_vehicle_idx
  on public.youtube_publications (vehicle_id, created_at desc);
create index if not exists youtube_publications_published_at_idx
  on public.youtube_publications (published_at desc);

alter table public.youtube_settings    enable row level security;
alter table public.youtube_publications enable row level security;

-- No public policies on purpose: these tables are read/written only by the
-- Worker with the service role (admin API). Anon and authenticated customers
-- must never see the schedule, tokens or failure history.

-- ============================================================================
-- End of migration 4.
-- ============================================================================
