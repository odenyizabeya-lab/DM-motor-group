-- ============================================================================
-- Server-side helpers the Cloudflare Worker calls as single round-trips.
-- ============================================================================
create or replace function public.admin_counts () returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'published',              (select count(*) from vehicles where status='published'),
    'drafts',                 (select count(*) from vehicles where status='draft'),
    'reserved',               (select count(*) from vehicles where status='reserved'),
    'sold',                   (select count(*) from vehicles where status='sold'),
    'enquiriesNew',           (select count(*) from enquiries e where e.status='new'),
    'enquiriesTotal',         (select count(*) from enquiries),
    'customers',              (select count(*) from profiles where role='customer'),
    'photos',                 (select count(*) from media where type='image'),
    'videos',                 (select count(*) from media where type='video'),
    'testimonialsPending',    (select count(*) from testimonials where status='pending')
  );
$$;

create or replace function public.vehicle_viewed (p_id bigint) returns void
language sql volatile security definer set search_path = public as $$
  update vehicles set views = views + 1 where id = p_id;
$$;

create or replace function public.enquiry_dup (p_ip text, p_message text, p_minutes int default 30)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enquiries
    where ip = p_ip and message = p_message
      and created_at > now () - (p_minutes || ' minutes')::interval);
$$;

create or replace function public.set_settings (p jsonb) returns void
language sql volatile security definer set search_path = public as $$
  insert into settings (key, value)
  select key, value from jsonb_each_text (p)
  on conflict (key) do update set value = excluded.value, updated_at = now ();
$$;

create or replace function public.reorder_media (p_vehicle bigint, p_ids bigint[])
returns void language sql volatile security definer set search_path = public as $$
  with ord as (
    select i.id, o.position
    from unnest (p_ids) with ordinality as o (id, position)
    join media i on i.id = o.id
    where i.vehicle_id = p_vehicle)
  update media set position = ord.position from ord where media.id = ord.id;
$$;

create or replace function public.customers_list () returns json
language sql stable security definer set search_path = public as $$
  select coalesce (json_agg (row), '[]'::json) from (
    select p.id, p.email, p.name, p.phone, p.role, p.address, p.created_at,
      (select count(*) from favourites f where f.user_id = p.id) as favourites
    from profiles p
    order by case p.role when 'admin' then 0 when 'manager' then 1 when 'viewer' then 2 else 3 end,
      p.created_at desc) row;
$$;

create or replace function public.distinct_brands () returns table (brand text)
language sql stable security definer set search_path = public as $$
  select distinct brand from vehicles where status = 'published' order by brand;
$$;

create or replace function public.distinct_locations () returns table (location text)
language sql stable security definer set search_path = public as $$
  select distinct location from vehicles
  where status = 'published' and location is not null and location <> '' order by location;
$$;

create or replace function public.public_price_range () returns json
language sql stable security definer set search_path = public as $$
  select json_build_object ('min', coalesce (min (price), 0), 'max', coalesce (max (price), 0))
  from vehicles where status = 'published';
$$;
