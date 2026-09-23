#!/usr/bin/env node
// Diagnostic for the Load Trend chart's "usual session range" band: how wide
// is it per player, and how many of the plotted days does it actually
// contain? A band that covers everything excludes nothing and so says
// nothing — this is the report that decides whether the definition holds.
//
// Compares four candidate definitions on the same real data:
//   iqr    — the interquartile range (25th–75th percentile) — WHAT SHIPS
//   sd1.5  — mean ± 1.5 sd — the original definition, kept for comparison
//   sd1.0  — mean ± 1.0 sd
//   p10_90 — the 10th–90th percentile
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/usualSessionRangeAudit.mjs

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

// Must match PlayerDetail's own constants, or this reports a band the page
// does not draw.
const LOAD_WINDOW_DAYS = 35;
const USUAL_RANGE_BASELINE_DAYS = 56;
const LOAD_HISTORY_DAYS = LOAD_WINDOW_DAYS + USUAL_RANGE_BASELINE_DAYS;
const USUAL_SESSION_MIN_DAYS = 10;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

const isoOfLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); return isoOfLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n)); };

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

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    n, mean, sd, min: sorted[0], max: sorted[n - 1],
    median: quantile(sorted, 0.5),
    bands: {
      sd1_5:  [mean - 1.5 * sd, mean + 1.5 * sd],
      sd1_0:  [mean - 1.0 * sd, mean + 1.0 * sd],
      iqr:    [quantile(sorted, 0.25), quantile(sorted, 0.75)],
      p10_90: [quantile(sorted, 0.10), quantile(sorted, 0.90)],
    },
  };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const band = ([lo, hi]) => `${Math.round(Math.max(0, lo))}–${Math.round(hi)}`;

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { buildLoadRows, collapseLoadByDay } = report;

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

  const historySince = daysAgo(LOAD_HISTORY_DAYS);
  const windowSince = daysAgo(LOAD_WINDOW_DAYS);
  const activePlayers = players.filter((p) => p.is_active);

  console.log(`Usual session range audit — ${activePlayers.length} active players`);
  console.log(`History ${historySince} → today (${LOAD_HISTORY_DAYS}d) · plotted window from ${windowSince} (${LOAD_WINDOW_DAYS}d)`);
  console.log(`Baseline = training-session days in [${historySince}, ${windowSince}) · min ${USUAL_SESSION_MIN_DAYS} days\n`);

  const rows = [];
  const skipped = [];
  for (const player of activePlayers) {
    const pid = player.id;
    const all = buildLoadRows(
      rpe.filter((r) => r.player_id === pid),
      matchStats.filter((m) => m.player_id === pid),
      attendance.filter((a) => a.player_id === pid),
      sessions,
    ).filter((r) => r.date != null && r.date >= historySince);

    const sessionDays = collapseLoadByDay(all.filter((r) => r.source === "session"))
      .filter((r) => r.date != null);
    const baseline = sessionDays.filter((r) => r.date < windowSince).map((r) => r.load_au);
    if (baseline.length < USUAL_SESSION_MIN_DAYS) { skipped.push({ name: player.name, n: baseline.length }); continue; }

    // What the band is judged against: the session days actually plotted.
    const plotted = sessionDays.filter((r) => r.date >= windowSince).map((r) => r.load_au);
    const s = stats(baseline);
    const covers = (b) => plotted.length === 0 ? null
      : plotted.filter((v) => v >= Math.max(0, b[0]) && v <= b[1]).length / plotted.length;

    rows.push({ name: player.name, s, plotted: plotted.length, covers });
  }

  if (rows.length === 0) {
    console.log("No active player has enough session history to draw a band.");
  } else {
    // Widest band first — the question this report exists to answer is how
    // wide the worst case is, not how tidy the best one looks.
    const width = (r, key) => r.s.bands[key][1] - Math.max(0, r.s.bands[key][0]);
    rows.sort((a, b) => width(b, "iqr") - width(a, "iqr"));
    console.log("Per player — baseline session days, and the IQR band that ships vs the old sd1.5 one:\n");
    console.log("player                    n   min   max   IQR band     width   covers    old sd1.5 band  width");
    console.log("───────────────────────────────────────────────────────────────────────────────────────────────");
    for (const r of rows) {
      const cov = r.covers(r.s.bands.iqr);
      console.log(
        `${r.name.slice(0, 24).padEnd(24)} ${String(r.s.n).padStart(3)} ${String(Math.round(r.s.min)).padStart(5)} ${String(Math.round(r.s.max)).padStart(5)}  ${band(r.s.bands.iqr).padEnd(12)} ${String(Math.round(width(r, "iqr"))).padStart(5)}   ${cov === null ? "  n/a" : pct(cov).padStart(5)}    ${band(r.s.bands.sd1_5).padEnd(13)} ${String(Math.round(width(r, "sd1_5"))).padStart(5)}`,
      );
    }
    if (skipped.length > 0) {
      console.log(`\nNo band drawn for ${skipped.length} active player(s) — under the ${USUAL_SESSION_MIN_DAYS}-day minimum:`);
      for (const sk of skipped) console.log(`  ${sk.name.slice(0, 24).padEnd(24)} ${sk.n} session day(s) in the baseline window`);
    }

    console.log("\nHow much of each player's plotted session days each definition contains:\n");
    console.log("definition   median width   median coverage of plotted days");
    console.log("──────────────────────────────────────────────────────────────");
    for (const key of ["iqr", "sd1_5", "sd1_0", "p10_90"]) {
      const widths = rows.map((r) => r.s.bands[key][1] - Math.max(0, r.s.bands[key][0])).sort((a, b) => a - b);
      const covs = rows.map((r) => r.covers(r.s.bands[key])).filter((c) => c !== null).sort((a, b) => a - b);
      console.log(
        `${key.padEnd(12)} ${String(Math.round(quantile(widths, 0.5))).padStart(8)} AU   ${covs.length ? pct(quantile(covs, 0.5)) : "n/a"}`,
      );
    }

    const cvs = rows.map((r) => r.s.sd / r.s.mean).sort((a, b) => a - b);
    console.log(`\nCoefficient of variation across players: median ${pct(quantile(cvs, 0.5))}, range ${pct(cvs[0])}–${pct(cvs[cvs.length - 1])}`);
    console.log("A band is only informative if its coverage is well under 100% — that is the number to read.");
  }
} finally {
  await vite.close();
}
