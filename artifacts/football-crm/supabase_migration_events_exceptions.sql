-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Recurring event exceptions
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Lets one occurrence of a recurring series be deleted without deleting the
-- whole series — the RFC 5545 EXDATE mechanism. Each entry is the excluded
-- occurrence's exact start_time (ISO datetime, matching how it was computed
-- for display), not just a bare date.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS excluded_dates TEXT[] NOT NULL DEFAULT '{}';
