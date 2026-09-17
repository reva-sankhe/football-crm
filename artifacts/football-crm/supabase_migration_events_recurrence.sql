-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Recurring calendar events
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Adds an optional recurrence rule to `events`. Stored as a bare RFC 5545
-- RRULE value (e.g. "FREQ=WEEKLY;COUNT=10", no "RRULE:" prefix) so it can be
-- handed straight to the `ics` feed generator, which lets Google Calendar
-- itself expand the series — and parsed client-side to expand occurrences
-- onto the month grid. A recurring event is one row for the whole series
-- (like Google's own model), not one row per occurrence.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;
