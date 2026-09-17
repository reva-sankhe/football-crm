#!/usr/bin/env node
// One-time pre-ship safety check: compares the training missing-RPE fallback
// OFF vs ON across every week of the current season, and separately reports
// where the CHRONIC_LOAD_FLOOR (300 AU/week) reclassifies a Spike as Low
// base. Run manually — this is a report you read, not a test that
// passes/fails.
//
// Scope: active players only (is_active = true), current season only
// (SEASON_START below). Inactive players and prior-season data are excluded
// from every section.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/workloadAudit.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/workloadAudit.mjs --no-fallback
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/workloadAudit.mjs --no-team-break
//
// --no-fallback runs the whole report using only real submitted data (no
// estimated rows at all) — useful to see the "as if the fallback didn't
// exist" picture on its own, without the off-vs-on comparison.
//
// --no-team-break runs every pass with no team-session dates fed into
// computeAcwr, so the squad-wide gap reset never fires — useful to see its
// effect in isolation by diffing this run's output against a normal run's.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment —
// no --env-file flag needed, so this runs as-is against Replit Secrets (a
// service role key, not the anon key, since this needs to read every
// player's data regardless of RLS policy).

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
  process.exit(1);
}
const NO_FALLBACK_ONLY = process.argv.includes("--no-fallback");
const NO_TEAM_BREAK = process.argv.includes("--no-team-break");

// The earliest real session date in the live data (2026-04-01) — there is no
// real season-boundary concept in the app yet (see roadmap item 10), so this
// is a stand-in, not a rule. Confirm or change before trusting this report.
const SEASON_START = "2026-04-01";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

function isoOfLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toLocalDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { buildLoadRows, collapseLoadByDay, computeAcwr, teamSessionDatesFrom, CHRONIC_LOAD_FLOOR, ACWR_CONFIG } = report;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [
    { data: players, error: playersErr },
    { data: sessions, error: sessionsErr },
    { data: rpe, error: rpeErr },
    { data: attendance, error: attErr },
    { data: matchStats, error: statsErr },
  ] = await Promise.all([
    supabase.from("players").select("*"),
    supabase.from("sessions").select("*"),
    supabase.from("session_rpe").select("*, sessions(*)"),
    supabase.from("session_attendance").select("*"),
    supabase.from("match_player_stats").select("*, matches(id, session_id, sessions(*))"),
  ]);
  for (const [name, err] of [["players", playersErr], ["sessions", sessionsErr], ["session_rpe", rpeErr], ["session_attendance", attErr], ["match_player_stats", statsErr]]) {
    if (err) { console.error(`Failed to fetch ${name}:`, err.message); process.exit(1); }
  }

  const now = new Date();
  const seasonStart = toLocalDate(SEASON_START);
  const activePlayers = players.filter((p) => p.is_active);
  // Team-break detection reads the FULL session history (a break spanning
  // the season boundary must still be seen), but every reported week and
  // every aggregate below is season-scoped.
  const teamSessionDates = NO_TEAM_BREAK ? [] : teamSessionDatesFrom(sessions);
  const seasonSessions = sessions.filter((s) => s.date >= SEASON_START);
  const trainingSessions = seasonSessions.filter((s) => s.session_type === "Training");

  console.log(`Workload audit — ${activePlayers.length} active players, season ${SEASON_START} → ${isoOfLocal(now)}`);
  console.log(NO_FALLBACK_ONLY ? "Mode: fallback OFF only" : "Mode: comparing fallback OFF vs ON");
  console.log(NO_TEAM_BREAK ? "Team break reset: OFF (ignored for this run)" : "Team break reset: ON");
  console.log(`Chronic load floor: ${CHRONIC_LOAD_FLOOR} AU/week\n`);

  const complianceRows = [];
  const seasonReport = [];

  for (const player of activePlayers) {
    const pid = player.id;
    const playerRpe = rpe.filter((r) => r.player_id === pid);
    const playerAttendance = attendance.filter((a) => a.player_id === pid);
    const playerMatchStats = matchStats.filter((m) => m.player_id === pid);

    // ── Compliance: attended Training sessions this season, with RPE, without RPE ──
    const trainingIds = new Set(trainingSessions.map((s) => s.id));
    const attendedTrainingIds = new Set(
      playerAttendance
        .filter((a) => trainingIds.has(a.session_id) && (a.status === "Present" || a.status === "Late"))
        .map((a) => a.session_id),
    );
    const rpeSessionIds = new Set(playerRpe.map((r) => r.session_id));
    const withRpe = [...attendedTrainingIds].filter((sid) => rpeSessionIds.has(sid)).length;
    complianceRows.push({
      player: player.name,
      attended: attendedTrainingIds.size,
      withRpe,
      withoutRpe: attendedTrainingIds.size - withRpe,
    });

    if (NO_FALLBACK_ONLY) continue;

    // ── Weekly off-vs-on and floor-effect check, every 7 days across the season ──
    // Full history feeds the baseline (same as production, where the ratio
    // never truncates at a display window) — SEASON_START only bounds which
    // anchor weeks get reported below.
    const offRowsAll = collapseLoadByDay(buildLoadRows(playerRpe, playerMatchStats));
    const onRawRowsAll = buildLoadRows(playerRpe, playerMatchStats, playerAttendance, sessions);
    const onRowsAll = collapseLoadByDay(onRawRowsAll);

    const statusChangeWeeks = [];
    const floorEffectWeeks = [];
    for (let anchor = new Date(seasonStart); anchor <= now; anchor = addDays(anchor, 7)) {
      const offResult = computeAcwr(offRowsAll, anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
      const onResult = computeAcwr(onRowsAll, anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
      const onNoFloorResult = computeAcwr(onRowsAll, anchor, 0, teamSessionDates);

      if (offResult.status !== onResult.status) {
        statusChangeWeeks.push({
          date: isoOfLocal(anchor),
          off: `${ACWR_CONFIG[offResult.status].label} (${offResult.acwr?.toFixed(2) ?? "—"})`,
          on: `${ACWR_CONFIG[onResult.status].label} (${onResult.acwr?.toFixed(2) ?? "—"})`,
        });
      }
      if (onNoFloorResult.status === "spike" && onResult.status === "low_base") {
        floorEffectWeeks.push({ date: isoOfLocal(anchor), acwr: onNoFloorResult.acwr?.toFixed(2) ?? "—" });
      }
    }

    // ── Estimated share of the whole season's load ──────────────────────
    const seasonRows = onRowsAll.filter((r) => r.date && r.date >= SEASON_START && r.date <= isoOfLocal(now));
    const seasonTotalAu = seasonRows.reduce((s, r) => s + r.load_au, 0);
    const seasonEstimatedAu = seasonRows.filter((r) => r.estimated).reduce((s, r) => s + r.load_au, 0);

    seasonReport.push({
      player: player.name,
      statusChangeWeeks,
      floorEffectWeeks,
      seasonTotalAu: Math.round(seasonTotalAu),
      seasonEstimatedAu: Math.round(seasonEstimatedAu),
      seasonSharePct: seasonTotalAu > 0 ? Math.round((seasonEstimatedAu / seasonTotalAu) * 100) : 0,
    });
  }

  // ── Print ────────────────────────────────────────────────────────────────
  console.log("── Training compliance this season (attended, with RPE, without RPE) ──");
  for (const c of complianceRows.sort((a, b) => b.withoutRpe - a.withoutRpe)) {
    console.log(`  ${c.player.padEnd(24)} attended ${String(c.attended).padStart(3)}  with RPE ${String(c.withRpe).padStart(3)}  without RPE ${String(c.withoutRpe).padStart(3)}`);
  }

  if (!NO_FALLBACK_ONLY) {
    console.log(`\n── Weeks where status changes, fallback off → on (weekly anchors, ${SEASON_START} → ${isoOfLocal(now)}) ──`);
    for (const p of seasonReport) {
      if (p.statusChangeWeeks.length === 0) continue;
      console.log(`  ${p.player}:`);
      for (const w of p.statusChangeWeeks) {
        console.log(`    ${w.date}  ${w.off}  →  ${w.on}`);
      }
    }
    if (seasonReport.every((p) => p.statusChangeWeeks.length === 0)) {
      console.log("  None — the training fallback didn't change any player's classification on any weekly anchor this season.");
    }

    console.log(`\n── Weeks where the ${CHRONIC_LOAD_FLOOR} AU/week floor turns Spike into Low base ──`);
    for (const p of seasonReport) {
      if (p.floorEffectWeeks.length === 0) continue;
      console.log(`  ${p.player}:`);
      for (const w of p.floorEffectWeeks) {
        console.log(`    ${w.date}  would be Spike (${w.acwr}) without the floor`);
      }
    }
    if (seasonReport.every((p) => p.floorEffectWeeks.length === 0)) {
      console.log("  None — no player's chronic baseline fell under the floor on a Spike week this season.");
    }

    console.log("\n── Estimated share of the whole season's load, per player ──");
    for (const p of seasonReport.slice().sort((a, b) => b.seasonSharePct - a.seasonSharePct)) {
      if (p.seasonTotalAu === 0) continue;
      console.log(`  ${p.player.padEnd(24)} ${p.seasonSharePct}% estimated  (${p.seasonEstimatedAu} of ${p.seasonTotalAu} AU)`);
    }
  }

  console.log("\nDone.");
} finally {
  await vite.close();
}
