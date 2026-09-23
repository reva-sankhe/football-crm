-- ────────────────────────────────────────────────────────────────────────────
-- Migration: count days lost from withdrawal, not from the injury date
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Fuller et al. 2006: days lost run from when the player withdraws from full
-- participation to when they are match fit. Ibreez's back started on 15 Aug
-- but she played through it until 12 Sep; counting from 15 Aug made a 19-day
-- absence read as severe. For every injury where the player went out on the
-- day it happened, nothing changes.
--
-- Only the view changes: days_lost is recomputed and withdrew_on is added at
-- the end. The app already counts this way itself (daysLost in
-- lib/injuries.ts), so this keeps the view's column in step with it.
--
-- Safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

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
