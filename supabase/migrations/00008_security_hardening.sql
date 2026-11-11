-- ============================================================================
-- 00008 — security hardening for Row Level Security.
--
-- The Cloudflare Worker writes through the service role, which bypasses RLS.
-- These policies therefore only govern direct PostgREST/Storage access by
-- anonymous visitors and signed-in customers. Every statement is idempotent
-- and safe to re-run.
--
-- Addresses:
--   1. managers could change any profile role directly (privilege escalation)
--   2. anonymous visitors could INSERT enquiries and testimonials directly,
--      bypassing the Worker's validation/rate limits (and pre-approve reviews)
--   3. media rows for draft vehicles were publicly readable
--   4. every settings row (including internal flags) was publicly readable
--   5. viewers could modify testimonials and activity logs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Role escalation guard
-- ---------------------------------------------------------------------------
-- RLS cannot compare the old and new value of a column, so a trigger enforces
-- that only administrators (or the service role / SQL console) may change a
-- profile role. This also protects against a future policy mistake.
create or replace function public.prevent_role_escalation () returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and coalesce (auth.role (), '') not in ('service_role')
     and current_user not in ('postgres', 'supabase_admin', 'service_role')
     and not public.is_admin () then
    raise exception 'Only administrators may change account roles.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.prevent_role_escalation ();

-- Keep manager access to profile records, but the trigger above prevents them
-- from touching the role column. `with check` also stops role rewrites.
drop policy if exists "profiles: staff manage accounts" on public.profiles;
drop policy if exists "profiles: staff manage non-role fields" on public.profiles;
create policy "profiles: staff manage non-role fields" on public.profiles
  for update using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- The two SELECT policies in 00002 overlap ("read own" already includes staff).
drop policy if exists "profiles: admin views all" on public.profiles;

-- ---------------------------------------------------------------------------
-- 2. No anonymous direct inserts
-- ---------------------------------------------------------------------------
-- The public forms post to the Worker, which validates input, applies rate
-- limits, and inserts with the service role. Direct anonymous inserts would
-- bypass all of that (spam, fake enquiries, self-approved testimonials).
drop policy if exists "enquiries: anyone may submit" on public.enquiries;
drop policy if exists "testimonials: customers may submit" on public.testimonials;

-- Customers may still submit testimonials for their own account through the
-- Worker; if direct access is ever wanted, require authentication and a
-- pending status. None is granted here on purpose.

-- ---------------------------------------------------------------------------
-- 3. Media of unpublished vehicles is not public
-- ---------------------------------------------------------------------------
drop policy if exists "media: public read" on public.media;
drop policy if exists "media: public reads published vehicles" on public.media;
create policy "media: public reads published vehicles" on public.media
  for select using (
    public.is_staff ()
    or exists (
      select 1 from public.vehicles v
      where v.id = media.vehicle_id and v.status in ('published', 'reserved')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Only public settings are publicly readable
-- ---------------------------------------------------------------------------
-- Internal flags (maintenance_mode, dev_reset_tokens, ...) and any future
-- credential accidentally stored here must not be exposed by PostgREST.
drop policy if exists "settings: all can read" on public.settings;
drop policy if exists "settings: public reads public keys" on public.settings;
create policy "settings: public reads public keys" on public.settings
  for select using (
    public.is_staff ()
    or key in (
      'dealership_name', 'company_name',
      'phone', 'phone_main', 'phone_alt', 'phone_sales', 'whatsapp',
      'email', 'email_sales',
      'address', 'address_primary', 'address_secondary', 'city', 'country',
      'opening_hours', 'hours',
      'instagram', 'social_instagram', 'facebook', 'social_facebook',
      'youtube', 'social_youtube', 'linkedin', 'social_linkedin',
      'tiktok', 'social_tiktok',
      'currency', 'tagline', 'trade_license', 'inspection_note', 'payment_info'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Content moderation is a manager/admin action, not a viewer action
-- ---------------------------------------------------------------------------
drop policy if exists "testimonials: staff manage" on public.testimonials;
create policy "testimonials: staff manage" on public.testimonials
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

drop policy if exists "activity: staff write" on public.activity_logs;
create policy "activity: staff write" on public.activity_logs
  for insert with check (public.is_manager () or public.is_admin ());

-- ============================================================================
-- NOTE: this migration has not been applied to the live database yet. It needs
-- a Supabase personal access token (or the SQL editor). Until then the live
-- project keeps the older, weaker policies documented in 00002_rls.sql.
-- ============================================================================
