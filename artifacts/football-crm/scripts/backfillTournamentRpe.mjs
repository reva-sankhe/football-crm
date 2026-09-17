#!/usr/bin/env node
// One-time backfill: RPE 8 for every player with a lineup row in the
// 2026-08-01 / 2026-08-02 tournament matches, using each player's own
// minutes_played (load = 8 × minutes_played), flagged estimated. Requires
// the `estimated` column on session_rpe — run
// supabase_migration_estimated_rpe.sql first.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillTournamentRpe.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillTournamentRpe.mjs --dry-run

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
  process.exit(1);
}
const DRY_RUN = process.argv.includes("--dry-run");
const TOURNAMENT_DATES = ["2026-08-01", "2026-08-02"];
const RPE = 8;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: sessions, error: e1 } = await supabase.from("sessions").select("*").in("date", TOURNAMENT_DATES);
if (e1) { console.error("Failed to fetch sessions:", e1.message); process.exit(1); }
const { data: matches, error: e2 } = await supabase.from("matches").select("*").in("session_id", sessions.map((s) => s.id));
if (e2) { console.error("Failed to fetch matches:", e2.message); process.exit(1); }
const { data: matchStats, error: e3 } = await supabase.from("match_player_stats").select("*").in("match_id", matches.map((m) => m.id));
if (e3) { console.error("Failed to fetch match_player_stats:", e3.message); process.exit(1); }
const { data: existingRpe, error: e4 } = await supabase.from("session_rpe").select("session_id, player_id").in("session_id", sessions.map((s) => s.id));
if (e4) { console.error("Failed to fetch session_rpe:", e4.message); process.exit(1); }

const sessionById = new Map(sessions.map((s) => [s.id, s]));
const existingKeys = new Set(existingRpe.map((r) => `${r.session_id}:${r.player_id}`));

const skipped = sessions.filter((s) => !matches.some((m) => m.session_id === s.id));

const rows = [];
const perMatchCounts = [];
for (const match of matches) {
  const session = sessionById.get(match.session_id);
  const gridRows = matchStats.filter((m) => m.match_id === match.id);
  let created = 0, alreadyRated = 0;
  for (const g of gridRows) {
    if (existingKeys.has(`${session.id}:${g.player_id}`)) { alreadyRated++; continue; }
    rows.push({
      session_id: session.id,
      player_id: g.player_id,
      rpe: RPE,
      minutes_played: g.minutes_played,
      load_au: Math.round(RPE * g.minutes_played),
      estimated: true,
    });
    created++;
  }
  perMatchCounts.push({ date: session.date, matchId: match.id, gridRows: gridRows.length, created, alreadyRated });
}

console.log(`── Skipped (no matches row) ──`);
if (skipped.length === 0) console.log("  None — every session in this date range has a matches row.");
for (const s of skipped) console.log(`  ${s.date}  session ${s.id}`);

console.log(`\n── Per-match row counts ──`);
for (const c of perMatchCounts.sort((a, b) => a.date.localeCompare(b.date))) {
  console.log(`  ${c.date}  match ${c.matchId}  lineup_rows=${c.gridRows}  will_create=${c.created}${c.alreadyRated ? `  already_rated=${c.alreadyRated}` : ""}`);
}
console.log(`\nTotal rows to create: ${rows.length}`);

if (DRY_RUN || rows.length === 0) {
  console.log(DRY_RUN ? "Dry run — nothing written." : "Nothing to do.");
  process.exit(0);
}

const { error } = await supabase.from("session_rpe").insert(rows);
if (error) { console.error("Insert failed:", error.message); process.exit(1); }
console.log(`\nInserted ${rows.length} session_rpe rows.`);
