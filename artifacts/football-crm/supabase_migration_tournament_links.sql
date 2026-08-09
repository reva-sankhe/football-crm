-- ────────────────────────────────────────────────────────────────────────────
-- Migration: Tournament links archive
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- A tournament collects material that lives elsewhere — a Drive folder of
-- photos, a fixture list, a results page. Each row is one titled link,
-- cascading with its tournament so deleting a tournament leaves nothing behind.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournament_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournament_links_tournament_id
  ON tournament_links (tournament_id);

-- Matches the access rule every other table in this schema uses
ALTER TABLE tournament_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all" ON tournament_links;
CREATE POLICY "anon all" ON tournament_links
  FOR ALL TO anon USING (true) WITH CHECK (true);
