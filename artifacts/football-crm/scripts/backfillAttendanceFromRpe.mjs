#!/usr/bin/env node
// One-time backfill: for every (session, player) pair with an RPE row but no
// attendance row, write Present with auto_marked = true. Requires the
// auto_marked column — run supabase_migration_auto_attendance.sql first.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillAttendanceFromRpe.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillAttendanceFromRpe.mjs --dry-run

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
const DRY_RUN = process.argv.includes("--dry-run");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

try {
  const attendance = await vite.ssrLoadModule("/src/lib/attendance.ts");
  const { playersNeedingAutoPresent } = attendance;

  // PostgREST silently truncates an unpaginated select at 1000 rows — no
  // error, just a short payload. session_attendance passed 1000 in Aug 2026.
  const PAGE_SIZE = 1000;
  async function fetchAllRows(supabase, table, select) {
    const out = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
      if (error) return { data: null, error };
      out.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return { data: out, error: null };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [{ data: rpe, error: e1 }, { data: existing, error: e2 }] = await Promise.all([
    fetchAllRows(supabase, "session_rpe", "session_id, player_id"),
    fetchAllRows(supabase, "session_attendance", "session_id, player_id"),
  ]);
  if (e1) { console.error("Failed to fetch session_rpe:", e1.message); process.exit(1); }
  if (e2) { console.error("Failed to fetch session_attendance:", e2.message); process.exit(1); }

  const existingBySession = new Map();
  for (const a of existing) {
    if (!existingBySession.has(a.session_id)) existingBySession.set(a.session_id, []);
    existingBySession.get(a.session_id).push(a.player_id);
  }
  const rpePlayersBySession = new Map();
  for (const r of rpe) {
    if (!rpePlayersBySession.has(r.session_id)) rpePlayersBySession.set(r.session_id, new Set());
    rpePlayersBySession.get(r.session_id).add(r.player_id);
  }

  const rows = [];
  for (const [sessionId, playerIds] of rpePlayersBySession) {
    const need = playersNeedingAutoPresent(existingBySession.get(sessionId) ?? [], [...playerIds]);
    for (const playerId of need) rows.push({ session_id: sessionId, player_id: playerId, status: "Present", auto_marked: true });
  }

  console.log(`${rows.length} attendance rows to create.`);
  if (DRY_RUN || rows.length === 0) {
    console.log(DRY_RUN ? "Dry run — nothing written." : "Nothing to do.");
    process.exit(0);
  }

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("session_attendance")
      .upsert(batch, { onConflict: "session_id,player_id", ignoreDuplicates: true });
    if (error) { console.error(`Batch ${i}-${i + batch.length} failed:`, error.message); process.exit(1); }
    console.log(`  wrote rows ${i + 1}-${i + batch.length}`);
  }
  console.log("Done.");
} finally {
  await vite.close();
}
