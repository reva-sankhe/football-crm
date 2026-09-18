import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: { middlewareMode: true },
});

function row(date, load) {
  return { player_id: "player", date, load_au: load, source: "session", rpe: 6, estimated: false, planned_load_au: null };
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { computeWeeklyLoad } = report;

  // ── Basic tiling: three full weeks, no partial trailing week ──────────────
  const rows = [
    row("2026-08-03", 100), row("2026-08-05", 50),   // week 1: 2026-08-03..09
    row("2026-08-10", 200),                          // week 2: 2026-08-10..16
    row("2026-08-17", 100), row("2026-08-23", 100),  // week 3: 2026-08-17..23
  ];
  const start = new Date(2026, 7, 3);   // 2026-08-03, a Monday
  const end = new Date(2026, 7, 23);    // 2026-08-23 — exactly three full weeks
  const weeks = computeWeeklyLoad(rows, start, end);

  assert.equal(weeks.length, 3, "three full 7-day weeks, no trailing partial");
  assert.deepEqual(weeks.map((w) => [w.weekStart, w.weekEnd]), [
    ["2026-08-03", "2026-08-09"],
    ["2026-08-10", "2026-08-16"],
    ["2026-08-17", "2026-08-23"],
  ], "weeks tile in 7-day blocks from start, inclusive");
  assert.deepEqual(weeks.map((w) => w.loadAu), [150, 200, 200], "each row's load lands in its own week and sums correctly");
  assert.equal(weeks[2].loadAu, 200, "2026-08-23 (the boundary date) belongs to week 3, not spilling into a 4th week");
  assert.equal(weeks.every((w) => !w.isPartial), true, "an exact multiple of 7 days produces no partial week");

  // ── Week-on-week %: first week is null, later weeks compare to the one before ──
  assert.equal(weeks[0].weekOnWeekPct, null, "no previous week for the first entry");
  assert.equal(weeks[1].weekOnWeekPct, ((200 - 150) / 150) * 100, "week 2 vs week 1");
  assert.equal(weeks[2].weekOnWeekPct, ((200 - 200) / 200) * 100, "week 3 vs week 2 (flat)");

  // ── Previous week with zero load: pct is null, not a divide-by-zero artifact ──
  const zeroPrevRows = [row("2026-08-10", 100)]; // nothing in week 1 at all
  const zeroPrevWeeks = computeWeeklyLoad(zeroPrevRows, start, end);
  assert.equal(zeroPrevWeeks[0].loadAu, 0, "week 1 genuinely has no load");
  assert.equal(zeroPrevWeeks[1].loadAu, 100, "week 2 has the one row");
  assert.equal(zeroPrevWeeks[1].weekOnWeekPct, null, "previous week's load was 0 — pct is null, not Infinity");

  // ── Trailing partial week: shorter window, still emitted, flagged ─────────
  const partialEnd = new Date(2026, 7, 12); // 2026-08-12 — 3 days into week 2
  const partialWeeks = computeWeeklyLoad(rows, start, partialEnd);
  assert.equal(partialWeeks.length, 2, "a started-but-unfinished week is still emitted");
  assert.equal(partialWeeks[0].isPartial, false, "week 1 is a complete 7-day span");
  assert.equal(partialWeeks[1].isPartial, true, "week 2 is cut short by end");
  assert.equal(partialWeeks[1].weekEnd, "2026-08-12", "partial week's weekEnd is the query's end date, not weekStart+6");
  assert.equal(partialWeeks[1].loadAu, 200, "the one row inside the partial window still counts");

  // ── Window shorter than a single week: one partial entry, no previous week ──
  const tinyWeeks = computeWeeklyLoad(rows, start, new Date(2026, 7, 4));
  assert.equal(tinyWeeks.length, 1, "a 2-day window is exactly one (partial) week");
  assert.equal(tinyWeeks[0].isPartial, true);
  assert.equal(tinyWeeks[0].weekOnWeekPct, null, "the only week has no predecessor");

  // ── Undated rows are ignored, not thrown ───────────────────────────────────
  const undatedRow = { player_id: "player", date: null, load_au: 999, source: "session", rpe: 6, estimated: false, planned_load_au: null };
  const withUndated = computeWeeklyLoad([...rows, undatedRow], start, end);
  assert.deepEqual(withUndated.map((w) => w.loadAu), [150, 200, 200], "a null-dated row contributes to no week");

  console.log("Weekly load checks passed.");
} finally {
  await vite.close();
}
