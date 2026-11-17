-- ============================================================================
-- MIGRATION 3 - vehicle_frames: decorative screenshots captured from a
-- vehicle's OWN video and stored so every visitor gets them instantly.
-- File: 00009_vehicle_frames.sql
--
-- Run this AFTER 00008_security_hardening.sql. Every statement is idempotent
-- and safe to re-run.
--
-- Why this exists: the VIEW DETAILS page decorates its section banners and
-- prose information cards with frames taken directly from the vehicle's own
-- main video. Previously each visitor's browser had to extract those frames
-- itself on first view. With this table the frames are created ONCE (by the
-- admin's browser at upload time, or backfilled later by the site), stored
-- in the public storage bucket under frames/<vehicle_id>/, and served to
-- every visitor immediately.
--
-- The extracted frames are decorative only; the original videos are never
-- modified and remain the primary vehicle presentation.
-- ============================================================================

create table if not exists public.vehicle_frames (
  id         bigint generated always as identity primary key,
  vehicle_id bigint not null references public.vehicles (id) on delete cascade,
  url        text        not null,
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

-- one frame per slot; the worker upserts by replacing all slots for a video
create unique index if not exists vehicle_frames_vehicle_position_uidx
  on public.vehicle_frames (vehicle_id, position);
create index if not exists vehicle_frames_vehicle_idx
  on public.vehicle_frames (vehicle_id);

alter table public.vehicle_frames enable row level security;

-- Public may read frames of the same vehicles they may see on the site
-- (published/reserved, or staff for anything else).
drop policy if exists "vehicle_frames: public reads published vehicles" on public.vehicle_frames;
create policy "vehicle_frames: public reads published vehicles" on public.vehicle_frames
  for select using (
    public.is_staff ()
    or exists (
      select 1 from public.vehicles v
      where v.id = vehicle_frames.vehicle_id and v.status in ('published', 'reserved')
    )
  );

-- Deliberately NO insert/update/delete policy for anon or authenticated
-- roles: frames are written and replaced only by the Worker with the
-- service role (POST /api/admin/vehicles/:id/frames), which validates
-- uploads server-side.

-- ============================================================================
-- End of migration 3.
-- ============================================================================
