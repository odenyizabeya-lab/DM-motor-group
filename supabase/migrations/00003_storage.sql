-- ============================================================================
-- Storage buckets: vehicle media (images + full-length videos) and banners.
-- Buckets are public-read (CDN-cached, HTTP Range → smooth video streaming);
-- writes are restricted to staff sessions / the service-role Worker.
-- Idempotent.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vehicle-media', 'vehicle-media', true, 2147483648, null),   -- 2 GB cap per object
  ('banners',       'banners',       true, 10485760,
     array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- -------------------------------------------------------- vehicle-media p/l
drop policy if exists "vehicle-media: public read" on storage.objects;
create policy "vehicle-media: public read" on storage.objects
  for select using (bucket_id = 'vehicle-media');

drop policy if exists "vehicle-media: staff upload" on storage.objects;
create policy "vehicle-media: staff upload" on storage.objects
  for insert with check (bucket_id = 'vehicle-media' and public.is_staff ());

drop policy if exists "vehicle-media: staff update" on storage.objects;
create policy "vehicle-media: staff update" on storage.objects
  for update using (bucket_id = 'vehicle-media' and public.is_staff ());

drop policy if exists "vehicle-media: staff delete" on storage.objects;
create policy "vehicle-media: staff delete" on storage.objects
  for delete using (bucket_id = 'vehicle-media' and public.is_staff ());

-- --------------------------------------------------------------- banners p/l
drop policy if exists "banners: public read" on storage.objects;
create policy "banners: public read" on storage.objects
  for select using (bucket_id = 'banners');

drop policy if exists "banners: staff upload" on storage.objects;
create policy "banners: staff upload" on storage.objects
  for insert with check (bucket_id = 'banners' and public.is_staff ());

drop policy if exists "banners: staff update" on storage.objects;
create policy "banners: staff update" on storage.objects
  for update using (bucket_id = 'banners' and public.is_staff ());

drop policy if exists "banners: staff delete" on storage.objects;
create policy "banners: staff delete" on storage.objects
  for delete using (bucket_id = 'banners' and public.is_staff ());
