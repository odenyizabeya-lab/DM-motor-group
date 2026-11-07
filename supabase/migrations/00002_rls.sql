-- ============================================================================
-- Row Level Security — defence in depth. The Cloudflare Worker (service role
-- key, server-only) performs all administrative writes; these policies also
-- allow correct direct access for any client holding a valid Supabase JWT.
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.vehicles        enable row level security;
alter table public.media           enable row level security;
alter table public.enquiries       enable row level security;
alter table public.enquiry_messages enable row level security;
alter table public.favourites      enable row level security;
alter table public.orders          enable row level security;
alter table public.banners         enable row level security;
alter table public.testimonials    enable row level security;
alter table public.notifications   enable row level security;
alter table public.settings        enable row level security;
alter table public.activity_logs   enable row level security;

-- ---------------------------------------------------------------- profiles
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid () or public.is_staff ());

create policy "profiles: update own non-role fields" on public.profiles
  for update using (id = auth.uid ())
  with check (id = auth.uid () and role = public.my_role ());

create policy "profiles: staff manage accounts" on public.profiles
  for update using (public.is_manager () or public.is_admin ());

create policy "profiles: admin views all" on public.profiles
  for select using (public.is_staff ());

-- ---------------------------------------------------------------- vehicles
create policy "vehicles: public reads published" on public.vehicles
  for select using (status = 'published' or public.is_staff () or public.is_manager () or public.is_admin ());

create policy "vehicles: staff full access" on public.vehicles
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- ------------------------------------------------------------------- media
create policy "media: public read" on public.media
  for select using (true);

create policy "media: staff manage" on public.media
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- ---------------------------------------------------------------- enquiries
create policy "enquiries: anyone may submit" on public.enquiries
  for insert with check (true);

create policy "enquiries: read own or staff" on public.enquiries
  for select using (user_id = auth.uid () or email in (
      select email from public.profiles where id = auth.uid ())
    or public.is_staff ());

create policy "enquiries: staff manage" on public.enquiries
  for update using (public.is_manager () or public.is_admin ());

-- --------------------------------------------------------- enquiry messages
create policy "messages: participants read" on public.enquiry_messages
  for select using (exists (
      select 1 from public.enquiries e
      where e.id = enquiry_id and (e.user_id = auth.uid () or public.is_staff ())));

create policy "messages: staff write" on public.enquiry_messages
  for insert with check (public.is_staff ());

-- -------------------------------------------------------------- favourites
create policy "favourites: own rows" on public.favourites
  for all using (user_id = auth.uid ()) with check (user_id = auth.uid ());

-- ------------------------------------------------------------------ orders
create policy "orders: submit own" on public.orders
  for insert with check (true);

create policy "orders: read own or staff" on public.orders
  for select using (user_id = auth.uid () or public.is_staff ());

create policy "orders: staff manage" on public.orders
  for update using (public.is_manager () or public.is_admin ());

-- ----------------------------------------------------------------- banners
create policy "banners: read active" on public.banners
  for select using (active or public.is_staff ());

create policy "banners: staff manage" on public.banners
  for all using (public.is_manager () or public.is_admin ())
  with check (public.is_manager () or public.is_admin ());

-- ------------------------------------------------------------- testimonials
create policy "testimonials: read approved" on public.testimonials
  for select using (status = 'approved' or public.is_staff ());

create policy "testimonials: customers may submit" on public.testimonials
  for insert with check (true);

create policy "testimonials: staff manage" on public.testimonials
  for all using (public.is_staff ()) with check (public.is_staff ());

-- ------------------------------------------------------------ notifications
create policy "notifications: own read/update" on public.notifications
  for select using (user_id = auth.uid ());

create policy "notifications: own mark read" on public.notifications
  for update using (user_id = auth.uid ()) with check (user_id = auth.uid ());

create policy "notifications: staff create" on public.notifications
  for insert with check (public.is_staff ());

-- ---------------------------------------------------------------- settings
create policy "settings: all can read" on public.settings
  for select using (true);

create policy "settings: admin only write" on public.settings
  for update using (public.is_admin ())
  with check (public.is_admin ());

-- ------------------------------------------------------------ activity log
create policy "activity: staff read" on public.activity_logs
  for select using (public.is_staff ());
