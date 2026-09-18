#!/usr/bin/env node
// One-time pre-switch safety check: compares the rolling-window ACWR status
// (computeAcwr) against the EWMA ACWR status (computeEwmaAcwrStatus) across
// every week of the current season, for every active player, using the same
// "with fallback" load data the app already shows (buildLoadRows with
// attendance+sessions, same as buildPlayerReport / workloadAudit's "on"
// case). Run manually — this is a report you read before deciding whether
// to switch the UI to EWMA, not a test that passes/fails.
//
// Scope: active players only (is_active = true), current season only
// (SEASON_START below).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ewmaComparisonAudit.mjs

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

// Same stand-in as workloadAudit.mjs — see that file's comment.
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

const PAGE_SIZE = 1000;
async function fetchAllRows(supabase, table, select) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const { count, error: countError } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (countError) return { data: null, error: countError };
  if (count !== out.length) {
    return { data: null, error: { message: `Row count mismatch on ${table}: fetched ${out.length} rows but count query reports ${count}.` } };
  }
  return { data: out, error: null };
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const {
    buildLoadRows, collapseLoadByDay, computeAcwr, computeEwmaAcwrStatus,
    teamSessionDatesFrom, CHRONIC_LOAD_FLOOR, ACWR_CONFIG,
  } = report;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [
    { data: players, error: playersErr },
    { data: sessions, error: sessionsErr },
    { data: rpe, error: rpeErr },
    { data: attendance, error: attErr },
    { data: matchStats, error: statsErr },
  ] = await Promise.all([
    fetchAllRows(supabase, "players", "*"),
    fetchAllRows(supabase, "sessions", "*"),
    fetchAllRows(supabase, "session_rpe", "*, sessions(*)"),
    fetchAllRows(supabase, "session_attendance", "*"),
    fetchAllRows(supabase, "match_player_stats", "*, matches(id, session_id, sessions(*))"),
  ]);
  for (const [name, err] of [["players", playersErr], ["sessions", sessionsErr], ["session_rpe", rpeErr], ["session_attendance", attErr], ["match_player_stats", statsErr]]) {
    if (err) { console.error(`Failed to fetch ${name}:`, err.message); process.exit(1); }
  }

  const now = new Date();
  const seasonStart = toLocalDate(SEASON_START);
  const activePlayers = players.filter((p) => p.is_active);
  const teamSessionDates = teamSessionDatesFrom(sessions);

  console.log(`EWMA vs rolling ACWR comparison — ${activePlayers.length} active players, season ${SEASON_START} → ${isoOfLocal(now)}`);
  console.log(`Chronic load floor: ${CHRONIC_LOAD_FLOOR} AU/week\n`);

  const diffsByPlayer = [];
  let totalWeeksChecked = 0;
  let totalDiffs = 0;
  // Confirms items 4/5's claims mechanically, not just by construction:
  // acute and weekOnWeekPct must be byte-for-byte identical regardless of
  // which status path a caller reads them alongside.
  let acuteOrWowMismatch = 0;

  for (const player of activePlayers) {
    const pid = player.id;
    const playerRpe = rpe.filter((r) => r.player_id === pid);
    const playerAttendance = attendance.filter((a) => a.player_id === pid);
    const playerMatchStats = matchStats.filter((m) => m.player_id === pid);
    const rowsAll = collapseLoadByDay(buildLoadRows(playerRpe, playerMatchStats, playerAttendance, sessions));

    const playerDiffs = [];
    for (let anchor = new Date(seasonStart); anchor <= now; anchor = addDays(anchor, 7)) {
      totalWeeksChecked++;
      const rolling = computeAcwr(rowsAll, anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
      const ewma = computeEwmaAcwrStatus(rowsAll, anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);

      // Recompute acute/weekOnWeekPct fresh here too — proves they don't
      // depend on which status function ran, not just that the EWMA path
      // leaves them untouched in code.
      const rollingAgain = computeAcwr(rowsAll, anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
      if (rolling.acute !== rollingAgain.acute || rolling.weekOnWeekPct !== rollingAgain.weekOnWeekPct) {
        acuteOrWowMismatch++;
      }

      if (rolling.status !== ewma.status) {
        totalDiffs++;
        playerDiffs.push({
          date: isoOfLocal(anchor),
          rollingStatus: ACWR_CONFIG[rolling.status].label,
          rollingAcwr: rolling.acwr,
          ewmaStatus: ACWR_CONFIG[ewma.status].label,
          ewmaAcwr: ewma.ewmaAcwr,
          acute: rolling.acute,
          weekOnWeekPct: rolling.weekOnWeekPct,
        });
      }
    }
    if (playerDiffs.length > 0) diffsByPlayer.push({ player: player.name, diffs: playerDiffs });
  }

  console.log(`── Every player/week where rolling and EWMA status disagree ──`);
  if (diffsByPlayer.length === 0) {
    console.log("  None — rolling and EWMA agree on status for every player, every week this season.");
  }
  for (const p of diffsByPlayer.sort((a, b) => b.diffs.length - a.diffs.length)) {
    console.log(`  ${p.player}:`);
    for (const d of p.diffs) {
      const fmt = (v) => (v === null ? "—" : v.toFixed(2));
      console.log(
        `    ${d.date}  rolling: ${d.rollingStatus} (${fmt(d.rollingAcwr)})  →  ewma: ${d.ewmaStatus} (${fmt(d.ewmaAcwr)})` +
        `   [acute=${Math.round(d.acute)} AU, wow=${d.weekOnWeekPct === null ? "—" : d.weekOnWeekPct.toFixed(1) + "%"}]`,
      );
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`  Weeks checked (players × anchors): ${totalWeeksChecked}`);
  console.log(`  Weeks where status differs: ${totalDiffs} (${((totalDiffs / totalWeeksChecked) * 100).toFixed(1)}%)`);
  console.log(`  Players affected: ${diffsByPlayer.length} of ${activePlayers.length}`);
  console.log(
    acuteOrWowMismatch === 0
      ? "  acute / weekOnWeekPct: identical on every check — unaffected by which status function ran."
      : `  ⚠ acute / weekOnWeekPct differed on ${acuteOrWowMismatch} checks — investigate before switching.`,
  );

  console.log("\nDone.");
} finally {
  await vite.close();
}
