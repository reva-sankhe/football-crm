-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Restore the baseline RLS policy on every table the app uses
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- This app has no real Supabase Auth — every request from the browser uses
-- just the anon key, with "admin"/"player" being a client-side UI gate only
-- (see AuthContext.tsx), not something Postgres knows about. So every table
-- the frontend reads or writes needs RLS ENABLED *with* a permissive policy
-- for the `anon` role — not RLS disabled. Enabling RLS with zero policies
-- defaults to denying everything, which is exactly what just broke session
-- creation (and would silently break every other table's inserts/updates
-- the same way, if RLS got turned on for them too without this).
--
-- Safe to re-run any time: every statement is idempotent, and re-applying
-- this to a table that already has the policy is a no-op.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'players',
    'test_sessions',
    'test_results',
    'sessions',
    'session_rpe',
    'session_attendance',
    'tournaments',
    'tournament_links',
    'squads',
    'squad_players',
    'opponents',
    'matches',
    'match_player_stats',
    'match_penalty_kicks',
    'league_other_matches',
    'events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "anon all" ON %I', t);
    EXECUTE format('CREATE POLICY "anon all" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- v_player_match_totals and v_player_vs_opponent are SQL views, not tables —
-- RLS doesn't apply to them directly; they're governed by the policies on
-- the tables above, which this migration already covers.
