-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Add format to tournaments
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- format records the size of the game a tournament is played at — "5-a-side"
-- through "11-a-side". It is nullable so existing tournaments stay valid until
-- someone sets one, and it is a plain text column rather than an enum so a new
-- format never needs a migration to add.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS format TEXT
    CHECK (format IN ('5-a-side', '6-a-side', '7-a-side', '8-a-side', '9-a-side', '11-a-side'));
