-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Create session_attendance table
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists session_attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  status      text not null default 'Present'
              check (status in ('Present', 'Absent', 'Late', 'Injured')),
  notes       text,
  created_at  timestamptz not null default now(),
  unique (session_id, player_id)
);

-- Index for fast lookups by session
create index if not exists idx_session_attendance_session_id
  on session_attendance (session_id);

-- Index for fast lookups by player
create index if not exists idx_session_attendance_player_id
  on session_attendance (player_id);

-- Enable Row Level Security (optional but recommended)
alter table session_attendance enable row level security;

-- Allow all operations for authenticated and anonymous users
-- (adjust to match your existing RLS policy style)
create policy "allow_all_session_attendance"
  on session_attendance
  for all
  using (true)
  with check (true);
