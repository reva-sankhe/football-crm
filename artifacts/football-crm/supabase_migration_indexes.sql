-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Indexes for foreign keys and hot filter/sort columns
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Postgres does NOT automatically index a foreign key column — only primary
-- keys and UNIQUE constraints get one for free. An unindexed FK means every
-- lookup by that column (and every cascade delete through it) does a full
-- table scan. This adds the ones this app's own queries.ts actually filters
-- or sorts by, skipping any column already covered:
--   - by an earlier migration (session_rpe.player_id, session_attendance's
--     session_id/player_id, tournament_links.tournament_id,
--     league_other_matches.tournament_id, events.start_time), or
--   - implicitly by a UNIQUE constraint whose leftmost column already serves
--     single-column lookups (squad_players, match_player_stats and
--     match_penalty_kicks each have one over their FK pair — see the
--     "(squad_id, player_id) unique index" / "(match_id, ...) unique index"
--     comments in queries.ts).
--
-- Every statement is IF NOT EXISTS, so it's safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- Foreign keys
CREATE INDEX IF NOT EXISTS idx_test_results_session_id ON test_results (session_id);
CREATE INDEX IF NOT EXISTS idx_test_results_player_id ON test_results (player_id);
CREATE INDEX IF NOT EXISTS idx_session_rpe_session_id ON session_rpe (session_id);
CREATE INDEX IF NOT EXISTS idx_squads_tournament_id ON squads (tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON matches (tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_session_id ON matches (session_id);
CREATE INDEX IF NOT EXISTS idx_matches_squad_id ON matches (squad_id);
CREATE INDEX IF NOT EXISTS idx_matches_opponent_id ON matches (opponent_id);
CREATE INDEX IF NOT EXISTS idx_league_other_matches_home_opponent_id ON league_other_matches (home_opponent_id);
CREATE INDEX IF NOT EXISTS idx_league_other_matches_away_opponent_id ON league_other_matches (away_opponent_id);

-- Hot sort/filter columns — both are the primary "list everything, newest
-- first" ordering for their table, queried on every page load of Training
-- and Fitness respectively.
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions (date);
CREATE INDEX IF NOT EXISTS idx_test_sessions_test_date ON test_sessions (test_date);
