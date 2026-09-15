-- ────────────────────────────────────────────────────────────────────────────
-- Migration: League tournaments
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Adds a competition_type to tournaments ("knockout" is the existing bracket
-- behaviour, "league" is a flat points table), a matching "League" match
-- stage, and a lightweight table for logging the results of matches the club
-- didn't play — the rest of the division's fixtures, needed to complete a
-- standings table. Both sides reference `opponents` so two spellings of the
-- same club never split into two rows in the table.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS competition_type TEXT NOT NULL DEFAULT 'knockout'
    CHECK (competition_type IN ('knockout', 'league'));

-- Widen the match stage check constraint to also allow 'League'. Postgres's
-- default constraint name for an inline CHECK is "<table>_<column>_check";
-- no prior migration has renamed it.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_stage_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_stage_check CHECK (stage IN (
    'Group Stage', 'Round of 16', 'Quarter Final', 'Semi Final',
    'Third Place', 'Final', 'Friendly', 'League'
  ));

CREATE TABLE IF NOT EXISTS league_other_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id     UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_date        DATE,
  home_opponent_id  UUID NOT NULL REFERENCES opponents(id) ON DELETE RESTRICT,
  away_opponent_id  UUID NOT NULL REFERENCES opponents(id) ON DELETE RESTRICT,
  home_goals        INTEGER NOT NULL CHECK (home_goals >= 0),
  away_goals        INTEGER NOT NULL CHECK (away_goals >= 0),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (home_opponent_id <> away_opponent_id)
);

CREATE INDEX IF NOT EXISTS idx_league_other_matches_tournament_id
  ON league_other_matches (tournament_id);

-- Matches the access rule every other table in this schema uses
ALTER TABLE league_other_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all" ON league_other_matches;
CREATE POLICY "anon all" ON league_other_matches
  FOR ALL TO anon USING (true) WITH CHECK (true);
