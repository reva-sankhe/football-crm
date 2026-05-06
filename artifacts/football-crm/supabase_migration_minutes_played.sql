-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Add minutes_played to session_rpe
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- minutes_played stores how long each individual player was on the pitch.
-- This replaces the session duration in the load_au calculation:
--   load_au = rpe × minutes_played   (instead of rpe × session.duration_mins)
-- This enables accurate per-player training load and analytics.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE session_rpe
  ADD COLUMN IF NOT EXISTS minutes_played INTEGER
    CHECK (minutes_played > 0 AND minutes_played <= 300);

-- Index for analytics queries (e.g. avg minutes per player per month)
CREATE INDEX IF NOT EXISTS idx_session_rpe_player_id
  ON session_rpe (player_id);
