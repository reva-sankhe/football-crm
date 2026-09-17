-- ────────────────────────────────────────────────────────────────────────────
-- Migration: estimated flag on session_rpe
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Backs a real, persisted "this RPE was backfilled, not player-reported" flag
-- — for example the tournament weekend load backfilled at a flat RPE 8 per
-- lineup player, using their own minutes_played. Without this column,
-- buildLoadRows has no way to tell a backfilled row from a genuine
-- submission once it's written, and the estimated-load-share reporting
-- would silently start counting backfilled rows as real ones.
--
-- Safe to re-run — IF NOT EXISTS makes this idempotent.
-- ────────────────────────────────────────────────────────────────────────────

alter table session_rpe
  add column if not exists estimated boolean not null default false;
