-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Calendar events
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Adds a lightweight `events` table for the team calendar (training, match,
-- birthday, lecture, event, tournament). Deliberately not linked to
-- `sessions`/`matches` — this is a simple announcements calendar players
-- subscribe to via an ICS feed, not the training-load/attendance system.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'training', 'match', 'birthday', 'lecture', 'event', 'tournament'
  )),
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ,
  location    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_start_time ON events (start_time);

-- Matches the access rule every other table in this schema uses
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all" ON events;
CREATE POLICY "anon all" ON events
  FOR ALL TO anon USING (true) WITH CHECK (true);
