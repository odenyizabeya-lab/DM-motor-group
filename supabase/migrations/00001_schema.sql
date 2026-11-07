-- ============================================================================
-- DM Motor Group — Production schema (real data only; no demo content seeded)
-- Idempotent: safe to re-run on a partially migrated database.
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null,
  phone      text not null default '',
  address    text not null default '',
  role       text not null default 'customer'
             check (role in ('customer','admin','manager','viewer')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- vehicles
-- cover_media_id is added AFTER media exists (deferred FK below).
create table if not exists public.vehicles (
  id                bigint generated always as identity primary key,
  slug              text not null unique,
  status            text not null default 'draft'
                    check (status in ('draft','published','reserved','sold')),
  brand             text not null,
  model             text not null,
  year              int  not null,
  price             numeric(14,2) not null default 0,
  currency          text not null default 'USD',
  mileage           int,
  engine            text,
  transmission      text,
  fuel              text,
  body_type         text,
  exterior_color    text,
  interior_color    text,
  vin               text,
  condition         text,
  registration      text,
  location          text,
  description       text,
  features          jsonb not null default '[]',
  safety_features   jsonb not null default '[]',
  ownership_info    text,
  inspection_status text   not null default 'none',
  inspection_report text,
  category          text not null default 'sedan',
  is_featured       boolean not null default false,
  views             bigint  not null default 0,
  cover             text,
  cover_full        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists vehicles_public_idx   on vehicles (status, is_featured desc, created_at desc);
create index if not exists vehicles_category_idx on vehicles (category, status);
create index if not exists vehicles_brand_idx    on vehicles (brand, model);
create index if not exists vehicles_vin_idx      on vehicles (vin);

-- keep flexible: values must match what the dashboard offers
alter table public.vehicles drop constraint if exists vehicles_category_check;
alter table public.vehicles add constraint vehicles_category_check
  check (category in ('sedan','suv','sports','luxury','electric','truck','family','commercial'));

alter table public.vehicles drop constraint if exists vehicles_inspection_status_check;
alter table public.vehicles add constraint vehicles_inspection_status_check
  check (inspection_status in ('none','dealership_inspected','third_party_inspected'));

-- ------------------------------------------------------------------- media
create table if not exists public.media (
  id             bigint generated always as identity primary key,
  vehicle_id     bigint not null references public.vehicles (id) on delete cascade,
  type           text not null check (type in ('image','video')),
  url            text not null,
  thumb_url      text not null default '',
  caption        text not null default '',
  category       text not null default 'exterior',
  position       int  not null default 0,
  is_video_cover boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists media_vehicle_idx on media (vehicle_id, position);

alter table public.media drop constraint if exists media_category_check;
alter table public.media add constraint media_category_check
  check (category in ('exterior','interior','engine','dashboard','boot','wheel','damage','detail','video'));

-- now the deferred ring-closure: vehicles.cover_media_id → media.id
alter table public.vehicles drop constraint if exists vehicles_cover_media_fkey;
alter table public.vehicles
  add column if not exists cover_media_id bigint
  references public.media (id) on delete set null;

-- --------------------------------------------------------------- enquiries
create table if not exists public.enquiries (
  id          bigint generated always as identity primary key,
  vehicle_id  bigint references public.vehicles (id) on delete set null,
  user_id     uuid references auth.users (id) on delete set null,
  type        text not null default 'question',
  name        text not null,
  email       text not null,
  phone       text not null default '',
  message     text not null default '',
  status      text not null default 'new',
  admin_notes text not null default '',
  ip          text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists enquiries_status_idx on enquiries (status, created_at desc);
create index if not exists enquiries_email_idx  on enquiries (email, created_at desc);

alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries add constraint enquiries_status_check
  check (status in ('new','contacted','in_progress','responded','quoted','won','lost','closed'));

create table if not exists public.enquiry_messages (
  id         bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries (id) on delete cascade,
  sender     text not null check (sender in ('customer','staff')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists enquiry_messages_enq_idx on enquiry_messages (enquiry_id, created_at);

-- -------------------------------------------------------------- favourites
create table if not exists public.favourites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  vehicle_id bigint not null references public.vehicles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

-- ------------------------------------------------------------------ orders
create table if not exists public.orders (
  id         bigint generated always as identity primary key,
  vehicle_id bigint not null references public.vehicles (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  type       text not null default 'reservation'
             check (type in ('reservation','purchase')),
  amount     numeric(14,2) not null default 0,
  currency   text not null default 'USD',
  status     text not null default 'new'
             check (status in ('new','deposit_paid','in_progress','completed','cancelled')),
  notes      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists orders_vehicle_idx on orders (vehicle_id);

-- ----------------------------------------------------------------- banners
create table if not exists public.banners (
  id         bigint generated always as identity primary key,
  title      text not null,
  subtitle   text not null default '',
  image      text not null,
  link       text not null default '/',
  position   int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ testimonials
create table if not exists public.testimonials (
  id            bigint generated always as identity primary key,
  name          text not null,
  location      text not null default '',
  body          text not null,
  rating        int  not null default 5 check (rating between 1 and 5),
  vehicle_label text not null default '',
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------- notifications
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  body       text not null default '',
  link       text not null default '/',
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, is_read, created_at desc);

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ activity log
create table if not exists public.activity_logs (
  id         bigint generated always as identity primary key,
  actor      text not null default 'system',
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_time_idx on activity_logs (created_at desc);

-- ============================================================================
-- Helpers (security definer so RLS on profiles never recurses)
-- ============================================================================
create or replace function public.my_role () returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid ();
$$;

create or replace function public.is_staff () returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce (
    (select role in ('admin','manager','viewer') from public.profiles where id = auth.uid ()),
    false);
$$;

create or replace function public.is_manager () returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce ((select role in ('admin','manager') from public.profiles where id = auth.uid ()), false);
$$;

create or replace function public.is_admin () returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce ((select role = 'admin' from public.profiles where id = auth.uid ()), false);
$$;

-- New user bootstrap: every signup gets a profile (customer). The FIRST
-- registered account becomes the dealership admin (owner bootstrap).
create or replace function public.handle_new_user () returns trigger
language plpgsql security definer set search_path = public as $$
declare
  staff_count int;
begin
  select count (*) into staff_count
    from public.profiles where role in ('admin','manager','viewer');
  insert into public.profiles (id, email, name, role)
    values (
      new.id,
      new.email,
      coalesce (new.raw_user_meta_data ->> 'name', split_part (new.email, '@', 1)),
      case when staff_count = 0 then 'admin' else 'customer' end);
  insert into public.notifications (user_id, title, body, link)
    values (new.id, 'Welcome to DM Motor Group',
      'Your customer account is ready. Save favourites, track enquiries and follow the vehicles you love.',
      '/account');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

-- Default settings the owner personalises in the admin dashboard.
-- Keys match exactly what admin.js renders (site + payments + legal notes).
insert into public.settings (key, value) values
  ('dealership_name',        'DM Motor Group'),
  ('tagline',                'Premium international automobile dealership'),
  ('phone',                  ''),
  ('phone_alt',              ''),
  ('whatsapp',               ''),
  ('email',                  ''),
  ('address',                ''),
  ('city',                   ''),
  ('country',                ''),
  ('opening_hours',          'Mon – Sat · 9:00 – 19:00'),
  ('instagram',              ''),
  ('facebook',               ''),
  ('youtube',                ''),
  ('tiktok',                 ''),
  ('payment_info',           ''),
  ('inspection_note',        ''),
  ('trade_license',          ''),
  ('currency',               'USD'),
  ('dev_reset_tokens',       '0'),
  ('site_url',               'https://dmmotorgroup.com')
on conflict (key) do nothing;
