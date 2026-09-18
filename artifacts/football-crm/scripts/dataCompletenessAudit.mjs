#!/usr/bin/env node
// Data-completeness report — which non-Lecture sessions are missing
// attendance, RPE, or have a Match with no lineup at all. Run manually, read
// the output; this changes nothing.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dataCompletenessAudit.mjs
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment, the
// same as scripts/workloadAudit.mjs.

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

// PostgREST silently truncates an unpaginated select at 1000 rows — no
// error, just a short payload. session_attendance passed 1000 in Aug 2026,
// so every fetch here pages through the whole table rather than risk it.
const PAGE_SIZE = 1000;
async function fetchAllRows(supabase, table, select) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  // Belt-and-suspenders against the exact bug this paging exists to avoid:
  // if paging itself ever under-reads (a bad tiebreak, a row mutated mid-scan),
  // this catches it instead of silently shipping a short report.
  const { count, error: countError } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (countError) return { data: null, error: countError };
  if (count !== out.length) {
    return {
      data: null,
      error: { message: `Row count mismatch on ${table}: fetched ${out.length} rows but count query reports ${count}.` },
    };
  }
  return { data: out, error: null };
}

try {
  const dataCompleteness = await vite.ssrLoadModule("/src/lib/dataCompleteness.ts");
  const { computeSessionCompleteness, matchesWithoutLineup } = dataCompleteness;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [
    { data: sessions, error: e1 },
    { data: attendance, error: e2 },
    { data: rpe, error: e3 },
    { data: matches, error: e4 },
    { data: matchStats, error: e5 },
    { data: players, error: e6 },
  ] = await Promise.all([
    fetchAllRows(supabase, "sessions", "*"),
    fetchAllRows(supabase, "session_attendance", "session_id, player_id, status"),
    fetchAllRows(supabase, "session_rpe", "session_id, player_id"),
    fetchAllRows(supabase, "matches", "id, session_id"),
    fetchAllRows(supabase, "match_player_stats", "match_id"),
    fetchAllRows(supabase, "players", "id, name"),
  ]);
  for (const [name, err] of [["sessions", e1], ["session_attendance", e2], ["session_rpe", e3], ["matches", e4], ["match_player_stats", e5], ["players", e6]]) {
    if (err) { console.error(`Failed to fetch ${name}:`, err.message); process.exit(1); }
  }
  const playerName = new Map(players.map((p) => [p.id, p.name]));

  const completeness = computeSessionCompleteness(sessions, attendance, rpe)
    .sort((a, b) => a.session.date.localeCompare(b.session.date));

  console.log(`Data completeness — ${sessions.length} sessions total, ${completeness.length} non-Lecture in scope\n`);

  console.log("── Attendance missing (non-Lecture) ──");
  const attMissing = completeness.filter((c) => c.attendanceMissing);
  if (attMissing.length === 0) console.log("  None.");
  for (const c of attMissing) {
    console.log(`  ${c.session.date}  ${c.session.session_type.padEnd(8)} rpe_rows=${c.rpeCount}  id=${c.session.id}`);
  }

  console.log("\n── RPE missing entirely (no one logged anything) ──");
  const rpeMissing = completeness.filter((c) => c.rpeMissingEntirely);
  if (rpeMissing.length === 0) console.log("  None.");
  for (const c of rpeMissing) {
    console.log(`  ${c.session.date}  ${c.session.session_type.padEnd(8)} attendance_rows=${c.attendanceCount}  id=${c.session.id}`);
  }

  console.log("\n── Partial RPE (attendance taken, some attended players missing RPE) ──");
  const rpePartial = completeness.filter((c) => c.rpePartial);
  if (rpePartial.length === 0) console.log("  None.");
  for (const c of rpePartial) {
    const names = c.missingRpePlayerIds.map((id) => playerName.get(id) ?? id).join(", ");
    console.log(`  ${c.session.date}  ${c.session.session_type.padEnd(8)} ${c.missingRpePlayerIds.length} missing: ${names}`);
  }

  console.log("\n── Match sessions with a matches row but zero lineup rows ──");
  const noLineup = matchesWithoutLineup(sessions, matches, matchStats)
    .sort((a, b) => a.session.date.localeCompare(b.session.date));
  if (noLineup.length === 0) console.log("  None.");
  for (const m of noLineup) {
    console.log(`  ${m.session.date}  match ${m.matchId}  session ${m.session.id}`);
  }

  console.log("\nDone.");
} finally {
  await vite.close();
}
