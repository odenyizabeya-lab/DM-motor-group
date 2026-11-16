-- ============================================================================
-- MIGRATION 1 - vehicles listing fields
-- File: 00006_vehicle_ai_fields.sql
--
-- Adds, to the existing `vehicles` table, the fields that the listing, the
-- specification form and the AI scanner need. Every statement is
-- `if not exists`, so the file is safe to run twice and cannot create a
-- duplicate column. It only adds columns and indexes - no row is touched and
-- no existing value is changed.
--
-- NOTE ON THE AUDIT: the columns `price`, `mileage`, `vin`, `registration`,
-- `location`, `inspection_report`, `ownership_info` and `safety_features`
-- ALREADY EXIST in the live `vehicles` table (verified against the live
-- schema on 2026-11-16). They are empty because the documents for those
-- vehicles have not been supplied - not because the schema is missing them.
-- Nothing needs to be added for them and this migration does not touch them.
--
-- Run in: Supabase -> SQL Editor -> New query -> paste -> Run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. AI scanner output (headline, selling points, SEO metadata, market value)
--    so a completed scan -> listing -> save -> publish cycle persists cleanly.
-- ---------------------------------------------------------------------------
alter table public.vehicles add column if not exists headline text;
alter table public.vehicles add column if not exists selling_points jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists market_value_estimate numeric(14,2);
alter table public.vehicles add column if not exists seo_title text;
alter table public.vehicles add column if not exists seo_description text;
alter table public.vehicles add column if not exists technology_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists interior_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists exterior_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists damage jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Structured vehicle information
--    The text columns that already exist (ownership_info, inspection_report)
--    stay exactly as they are - these structured columns ADD to them and are
--    used for the multi-entry information the dashboard shows.
-- ---------------------------------------------------------------------------
alter table public.vehicles add column if not exists ownership_history jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists service_history jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists documents jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists inspection_points jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists inspection_date date;
alter table public.vehicles add column if not exists inspection_verified boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Reservation terms and deposit (per vehicle)
--    The dealership can set a deposit and its own terms for each car. The
--    deposit is only ever charged after a reservation is agreed.
-- ---------------------------------------------------------------------------
alter table public.vehicles add column if not exists reservation_deposit numeric(14,2);
alter table public.vehicles add column if not exists reservation_terms text;

-- ---------------------------------------------------------------------------
-- 4. Discounts and promotions
-- ---------------------------------------------------------------------------
alter table public.vehicles add column if not exists discount_percent numeric(5,2);
alter table public.vehicles add column if not exists discount_note text;
alter table public.vehicles add column if not exists discount_until date;

-- ---------------------------------------------------------------------------
-- 5. Video performance counters
--    `plays` counts how often the video has been played on the site, so the
--    dashboard can show the most-watched videos from real data.
-- ---------------------------------------------------------------------------
alter table public.media add column if not exists plays bigint not null default 0;
alter table public.media add column if not exists last_played_at timestamptz;

-- ---------------------------------------------------------------------------
-- 6. Indexes (only if they are not already present)
-- ---------------------------------------------------------------------------
create index if not exists media_vehicle_type_idx on public.media (vehicle_id, type);
create index if not exists vehicles_status_idx on public.vehicles (status);
create index if not exists vehicles_discount_idx on public.vehicles (discount_percent)
  where discount_percent is not null;

-- ============================================================================
-- End of migration 1. Nothing above modifies or deletes an existing row.
-- ============================================================================
