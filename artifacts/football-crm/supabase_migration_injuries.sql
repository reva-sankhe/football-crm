-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Injuries, their stage history, and the match-grid link
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- One row per injury or illness, not per missed session. Where a player
-- stands on the way back (out → modified → full training → match fit) is a
-- dated history in `injury_stages`, not a column: status, return date and
-- days lost are all derived from it in `v_injury_status`, so there is no
-- second copy that can disagree.
--
-- Definitions follow the football consensus (Fuller et al. 2006):
--   * an injury is over when the player is match fit — cleared for full
--     training *and* available for selection — so `returned_on` is the date
--     of the match_fit stage, and days lost run from `occurred_on` to it;
--   * a setback before that is a stage change on the same injury; breaking
--     down again after it is a new injury whose `recurrence_of` points back.
--
-- Stage rows are append-only. A stage entered in error is corrected by
-- deleting the latest row (the app's "undo last stage") and adding the right
-- one — never by editing a row in place. That is also how a match_fit marked
-- by mistake is reopened.
--
-- The trigger functions follow the hardening the existing four use:
-- `search_path = ''`, so every table reference is schema-qualified.
--
-- Safe to re-run — every statement is idempotent.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.injuries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  occurred_on         DATE NOT NULL,
  category            TEXT NOT NULL CHECK (category IN ('injury', 'illness')),
  body_area           TEXT CHECK (body_area IN (
                        'Head/face', 'Neck', 'Shoulder', 'Arm/elbow', 'Wrist/hand', 'Chest/ribs',
                        'Abdomen', 'Back', 'Hip/groin', 'Hamstring', 'Quadriceps', 'Knee',
                        'Calf/shin', 'Achilles', 'Ankle', 'Foot/toe', 'Unspecified')),
  side                TEXT CHECK (side IN ('left', 'right', 'both', 'n/a')),
  context             TEXT CHECK (context IN ('training', 'match', 'outside')),
  mechanism           TEXT CHECK (mechanism IN ('contact', 'non_contact')),
  onset               TEXT CHECK (onset IN ('acute', 'overuse')),
  recurrence_of       UUID,
  expected_return_on  DATE,
  -- Last "still out" answer to a closing prompt; snoozes the next one.
  reviewed_on         DATE,
  session_id          UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  match_id            UUID REFERENCES public.matches(id)  ON DELETE SET NULL,
  notes               TEXT,
  -- Converted from the old Injured attendance rows / match-grid notes. Its
  -- dates are inferred, so its severity is approximate.
  migrated            BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Target of the recurrence FK below: a recurrence can only point at an
  -- injury belonging to the same player.
  CONSTRAINT injuries_id_player_key UNIQUE (id, player_id),
  -- SET NULL (recurrence_of) clears just that column; a plain SET NULL would
  -- null player_id too and fail its NOT NULL. Needs Postgres 15+.
  CONSTRAINT injuries_recurrence_fkey FOREIGN KEY (recurrence_of, player_id)
    REFERENCES public.injuries (id, player_id) ON DELETE SET NULL (recurrence_of),
  CONSTRAINT injuries_recurrence_not_self CHECK (recurrence_of <> id),
  CONSTRAINT injuries_injury_has_area CHECK (category = 'illness' OR body_area IS NOT NULL),
  CONSTRAINT injuries_illness_has_no_anatomy CHECK (
    category = 'injury'
    OR (body_area IS NULL AND side IS NULL AND mechanism IS NULL AND onset IS NULL)),
  -- An overuse injury has no single contact event to attribute it to
  CONSTRAINT injuries_overuse_not_contact CHECK (NOT (onset = 'overuse' AND mechanism = 'contact'))
);

CREATE INDEX IF NOT EXISTS idx_injuries_player_id     ON public.injuries (player_id);
CREATE INDEX IF NOT EXISTS idx_injuries_recurrence_of ON public.injuries (recurrence_of);

CREATE TABLE IF NOT EXISTS public.injury_stages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  injury_id     UUID NOT NULL REFERENCES public.injuries(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('out', 'modified', 'full_training', 'match_fit')),
  effective_on  DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One stage per day: the latest row is unambiguous, which "undo last" needs
  CONSTRAINT injury_stages_one_per_day UNIQUE (injury_id, effective_on)
);

ALTER TABLE public.match_player_stats
  ADD COLUMN IF NOT EXISTS injury_id UUID REFERENCES public.injuries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_match_player_stats_injury_id ON public.match_player_stats (injury_id);

-- ── Stage rules ───────────────────────────────────────────────────────────────
-- Insert: on or after the injury date, after every existing stage, and never
--   after match_fit (that is final — undo it to reopen).
-- Update: refused. Correct by deleting the latest row and adding a new one.
-- Delete: only the latest row, never the last remaining one (delete the
--   injury instead), and not a match_fit another injury recurs from — that
--   would reopen an injury the recurrence says had already ended.
-- A cascade from deleting the injury itself skips all of this.
CREATE OR REPLACE FUNCTION public.injury_stages_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_occurred   date;
  v_latest     date;
  v_fit        date;
  v_remaining  integer;
  v_recurrence date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Injury stages cannot be edited — undo the latest stage and add the correct one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT occurred_on INTO v_occurred FROM public.injuries WHERE id = NEW.injury_id;
    IF NEW.effective_on < v_occurred THEN
      RAISE EXCEPTION 'A stage cannot start (%) before the injury occurred (%)', NEW.effective_on, v_occurred
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT effective_on INTO v_fit
      FROM public.injury_stages WHERE injury_id = NEW.injury_id AND stage = 'match_fit';
    IF v_fit IS NOT NULL THEN
      RAISE EXCEPTION 'This injury ended when the player was match fit on % — undo that stage to reopen it', v_fit
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT max(effective_on) INTO v_latest FROM public.injury_stages WHERE injury_id = NEW.injury_id;
    IF v_latest IS NOT NULL AND NEW.effective_on <= v_latest THEN
      RAISE EXCEPTION 'A new stage must be dated after the latest one (%)', v_latest
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE. If the injury is gone this is its cascade: let it through.
  IF NOT EXISTS (SELECT 1 FROM public.injuries WHERE id = OLD.injury_id) THEN
    RETURN OLD;
  END IF;

  SELECT max(effective_on), count(*) INTO v_latest, v_remaining
    FROM public.injury_stages WHERE injury_id = OLD.injury_id;
  IF OLD.effective_on < v_latest THEN
    RAISE EXCEPTION 'Only the latest stage (%) can be undone', v_latest
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_remaining <= 1 THEN
    RAISE EXCEPTION 'An injury keeps at least one stage — delete the injury instead'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.stage = 'match_fit' THEN
    SELECT min(occurred_on) INTO v_recurrence FROM public.injuries WHERE recurrence_of = OLD.injury_id;
    IF v_recurrence IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot reopen: a recurrence on % is recorded against this injury having ended', v_recurrence
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS injury_stages_guard ON public.injury_stages;
CREATE TRIGGER injury_stages_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.injury_stages
  FOR EACH ROW EXECUTE FUNCTION public.injury_stages_guard();

-- ── Injury rules ──────────────────────────────────────────────────────────────
-- A recurrence needs the earlier injury to have ended (match fit) on or before
-- the new one occurred; otherwise it is the same injury, and a setback is a
-- stage change on it. Moving occurred_on may not strand an existing stage
-- before it.
CREATE OR REPLACE FUNCTION public.injuries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_prev_fit    date;
  v_first_stage date;
BEGIN
  IF NEW.recurrence_of IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.recurrence_of IS DISTINCT FROM OLD.recurrence_of
          OR NEW.occurred_on <> OLD.occurred_on) THEN
    SELECT effective_on INTO v_prev_fit
      FROM public.injury_stages WHERE injury_id = NEW.recurrence_of AND stage = 'match_fit';
    IF v_prev_fit IS NULL THEN
      RAISE EXCEPTION 'The earlier injury is still open — record a setback as a stage on it, not a recurrence'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_prev_fit > NEW.occurred_on THEN
      RAISE EXCEPTION 'The earlier injury only ended on %, after this one occurred (%)', v_prev_fit, NEW.occurred_on
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.occurred_on <> OLD.occurred_on THEN
    SELECT min(effective_on) INTO v_first_stage FROM public.injury_stages WHERE injury_id = NEW.id;
    IF v_first_stage IS NOT NULL AND NEW.occurred_on > v_first_stage THEN
      RAISE EXCEPTION 'The injury date cannot move after its first stage (%)', v_first_stage
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS injuries_guard ON public.injuries;
CREATE TRIGGER injuries_guard
  BEFORE INSERT OR UPDATE ON public.injuries
  FOR EACH ROW EXECUTE FUNCTION public.injuries_guard();

-- ── Derived status ────────────────────────────────────────────────────────────
-- current_stage is the latest stage row; the injury is resolved exactly when
-- that is match_fit. days_lost runs from withdrew_on (the first stage before
-- match fit) to match fit, per Fuller, and is only set once resolved — a
-- running count for an open injury depends on "today", which the app computes
-- in local time (daysLost in lib/injuries.ts).
-- `i.*` is expanded when the view is created: re-run this statement after
-- adding a column to injuries.
CREATE OR REPLACE VIEW public.v_injury_status
WITH (security_invoker = on) AS
SELECT
  i.*,
  cur.stage                                              AS current_stage,
  CASE WHEN cur.stage = 'match_fit' THEN 'resolved' ELSE 'open' END AS status,
  fit.effective_on                                       AS returned_on,
  -- From withdrawing (the first stage before match fit), not from occurred_on:
  -- a player can carry an injury for weeks before it stops them. Played on
  -- (no stage before match fit) is 0.
  CASE WHEN fit.effective_on IS NOT NULL
       THEN fit.effective_on - COALESCE(wd.effective_on, fit.effective_on)
  END                                                    AS days_lost,
  wd.effective_on                                        AS withdrew_on
FROM public.injuries i
LEFT JOIN LATERAL (
  SELECT s.stage FROM public.injury_stages s
  WHERE s.injury_id = i.id
  ORDER BY s.effective_on DESC
  LIMIT 1
) cur ON true
LEFT JOIN LATERAL (
  SELECT s.effective_on FROM public.injury_stages s
  WHERE s.injury_id = i.id AND s.stage = 'match_fit'
) fit ON true
LEFT JOIN LATERAL (
  SELECT min(s.effective_on) AS effective_on FROM public.injury_stages s
  WHERE s.injury_id = i.id AND s.stage <> 'match_fit'
) wd ON true;

-- ── Access ────────────────────────────────────────────────────────────────────
-- Matches the rule every other table uses (see supabase_migration_rls_baseline.sql)
ALTER TABLE public.injuries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injury_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all" ON public.injuries;
CREATE POLICY "anon all" ON public.injuries
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon all" ON public.injury_stages;
CREATE POLICY "anon all" ON public.injury_stages
  FOR ALL TO anon USING (true) WITH CHECK (true);
