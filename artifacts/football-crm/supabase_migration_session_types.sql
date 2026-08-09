-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Session types become Training / Match / Lecture
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Gym and Recovery are retired and folded into Training — both were physical
-- pitch/gym sessions and already counted in the training bucket for every
-- attendance and load figure, so no reported number changes.
--
-- Also widens the planned_rpe range to allow 0. Matches carry no planned RPE
-- and store 0 as the "no plan" sentinel (the app reads > 0 as "planned"), which
-- the original 1..10 CHECK rejected.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE sessions SET session_type = 'Training' WHERE session_type IN ('Gym', 'Recovery');

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_session_type_check
  CHECK (session_type IN ('Training', 'Match', 'Lecture'));

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_planned_rpe_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_planned_rpe_check
  CHECK (planned_rpe >= 0 AND planned_rpe <= 10);
