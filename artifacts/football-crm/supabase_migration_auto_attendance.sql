-- ────────────────────────────────────────────────────────────────────────────
-- Migration: auto_marked flag on session_attendance
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Backs the new auto-Present behavior: a player gets a Present row written
-- for them automatically when they submit training/match RPE or are added to
-- a match lineup with no attendance row yet on record. `auto_marked` marks
-- that row as system-written rather than coach-entered, so the UI can badge
-- it, and so a coach explicitly changing that player's status (or re-saving
-- the roster without touching them) can tell an auto row from a real one.
--
-- Safe to re-run — IF NOT EXISTS makes this idempotent.
-- ────────────────────────────────────────────────────────────────────────────

alter table session_attendance
  add column if not exists auto_marked boolean not null default false;
