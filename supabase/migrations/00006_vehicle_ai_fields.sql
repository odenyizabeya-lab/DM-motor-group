-- ============================================================================
-- 00006_vehicle_ai_fields.sql
-- AI scanner enriched listing fields (headline, selling points, features,
-- SEO metadata, market value) added to the vehicles table so that a completed
-- AI scan → listing generation → save → publish workflow persists cleanly.
-- ============================================================================
alter table public.vehicles add column if not exists headline text;
alter table public.vehicles add column if not exists selling_points jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists market_value_estimate numeric(14,2);
alter table public.vehicles add column if not exists seo_title text;
alter table public.vehicles add column if not exists seo_description text;
alter table public.vehicles add column if not exists technology_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists interior_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists exterior_features jsonb not null default '[]'::jsonb;
alter table public.vehicles add column if not exists damage jsonb not null default '[]'::jsonb;
