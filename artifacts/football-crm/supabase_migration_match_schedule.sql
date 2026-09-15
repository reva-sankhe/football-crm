-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Match kickoff time
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- sessions already carries date/duration for every Training, Match and Lecture
-- row; start_time adds a kickoff/start clock time alongside it, so a match
-- scheduled ahead of time can say "when" as well as "which day" — the basis for
-- an upcoming-matches view (and eventually a calendar) without inventing a
-- separate schedule entity. Plain "HH:MM" text, same simple-typing convention
-- as the rest of this schema (see format/stage — no enum, no TIME-type
-- serialization quirks). matches.notes (already a column, never yet exposed in
-- the UI) is reused for per-match instructions — no new column needed there.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS start_time TEXT;
