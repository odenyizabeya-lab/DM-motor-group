-- ============================================================================
-- Row Level Security — defence in depth. The Cloudflare Worker (service role
-- key, server-only) performs all administrative writes; these policies also
-- allow correct direct access for any client holding a valid Supabase JWT.
-- Idempotent: every policy is dropped before creation.
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.vehicles         enable row level security;
alter table public.media            enable row level security;
alter table public.enquiries        enable row level security;
alter table public.enquiry_messages enable row level security;
alter table public.favourites       enable row level security;
alter table public.orders           enable row level security;
alter table public.banners          enable row level security;
alter table public.testimonials     enable row level security;
alter table public.notifications    enable row level security;
alter table public.settings         enable row level security;
alter table public.activity_logs    enable row level security;

-- ---------------------------------------------------------------- profiles
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid () or public.is_staff ());

drop policy if exists "profiles: admin views all" on public.profiles;
create policy "profiles: admin views all" on public.profiles
  for select using (public.is_staff ());

drop policy if exists "profiles: update own non-role fields" on public.profiles;
create policy "profiles: update own non-role fields" on public.profiles
  for update using (id = auth.uid ())
  with check (id = auth.uid () and role = public.my_role ());

drop policy if exists "profiles: staff manage accounts" on public.profiles;
create policy "profiles: staff manage accounts" on public.profiles
  for update using (public.is_manager () or public.is_admin ());

-- ---------------------------------------------------------------- vehicles
drop policy if exists "vehicles: public reads published" on public.vehicles;
create policy "vehicles: public reads published" on public.vehicles
  for select using (status in ('published','reserved') or public.is_staff ());

drop policy if exists "vehicles: staff full access" on public.vehicles;
create policy "vehicles: staff full access" on public.vehicles
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- ------------------------------------------------------------------- media
drop policy if exists "media: public read" on public.media;
create policy "media: public read" on public.media
  for select using (true);

drop policy if exists "media: staff manage" on public.media;
create policy "media: staff manage" on public.media
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- --------------------------------------------------------------- enquiries
drop policy if exists "enquiries: anyone may submit" on public.enquiries;
create policy "enquiries: anyone may submit" on public.enquiries
  for insert with check (true);

drop policy if exists "enquiries: read own or staff" on public.enquiries;
create policy "enquiries: read own or staff" on public.enquiries
  for select using (user_id = auth.uid () or public.is_staff ());

drop policy if exists "enquiries: staff manage" on public.enquiries;
create policy "enquiries: staff manage" on public.enquiries
  for update using (public.is_manager () or public.is_admin ());

-- --------------------------------------------------------- enquiry messages
drop policy if exists "messages: participants read" on public.enquiry_messages;
create policy "messages: participants read" on public.enquiry_messages
  for select using (exists (
      select 1 from public.enquiries e
      where e.id = enquiry_id and (e.user_id = auth.uid () or public.is_staff ())));

drop policy if exists "messages: staff write" on public.enquiry_messages;
create policy "messages: staff write" on public.enquiry_messages
  for insert with check (public.is_staff ());

-- -------------------------------------------------------------- favourites
drop policy if exists "favourites: own rows" on public.favourites;
create policy "favourites: own rows" on public.favourites
  for all using (user_id = auth.uid ()) with check (user_id = auth.uid ());

-- ------------------------------------------------------------------ orders
drop policy if exists "orders: submit own" on public.orders;
create policy "orders: submit own" on public.orders
  for insert with check (user_id = auth.uid ());

drop policy if exists "orders: read own or staff" on public.orders;
create policy "orders: read own or staff" on public.orders
  for select using (user_id = auth.uid () or public.is_staff ());

drop policy if exists "orders: staff manage" on public.orders;
create policy "orders: staff manage" on public.orders
  for update using (public.is_manager () or public.is_admin ());

-- ----------------------------------------------------------------- banners
drop policy if exists "banners: read active" on public.banners;
create policy "banners: read active" on public.banners
  for select using (active or public.is_staff ());

drop policy if exists "banners: staff manage" on public.banners;
create policy "banners: staff manage" on public.banners
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- ------------------------------------------------------------ testimonials
drop policy if exists "testimonials: read approved" on public.testimonials;
create policy "testimonials: read approved" on public.testimonials
  for select using (status = 'approved' or public.is_staff ());

drop policy if exists "testimonials: customers may submit" on public.testimonials;
create policy "testimonials: customers may submit" on public.testimonials
  for insert with check (true);

drop policy if exists "testimonials: staff manage" on public.testimonials;
create policy "testimonials: staff manage" on public.testimonials
  for all using (public.is_staff ()) with check (public.is_staff ());

-- ------------------------------------------------------------ notifications
drop policy if exists "notifications: own read/update" on public.notifications;
create policy "notifications: own read/update" on public.notifications
  for select using (user_id = auth.uid ());

drop policy if exists "notifications: own mark read" on public.notifications;
create policy "notifications: own mark read" on public.notifications
  for update using (user_id = auth.uid ()) with check (user_id = auth.uid ());

drop policy if exists "notifications: staff create" on public.notifications;
create policy "notifications: staff create" on public.notifications
  for insert with check (public.is_staff ());

-- ---------------------------------------------------------------- settings
drop policy if exists "settings: all can read" on public.settings;
create policy "settings: all can read" on public.settings
  for select using (true);

drop policy if exists "settings: admin only write" on public.settings;
create policy "settings: admin only write" on public.settings
  for update using (public.is_admin ())
  with check (public.is_admin ());

-- ------------------------------------------------------------ activity log
drop policy if exists "activity: staff read" on public.activity_logs;
create policy "activity: staff read" on public.activity_logs
  for select using (public.is_staff ());

drop policy if exists "activity: staff write" on public.activity_logs;
create policy "activity: staff write" on public.activity_logs
  for insert with check (public.is_staff ());
