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

const anchor = new Date(2026, 7, 24); // 24 Aug 2026

function row(date, load, extra = {}) {
  return {
    player_id: "player",
    date,
    load_au: load,
    source: "session",
    rpe: 6,
    estimated: false,
    planned_load_au: null,
    ...extra,
  };
}

function establishedRows(acute) {
  return [
    row("2026-07-28", 100),
    row("2026-08-04", 100),
    row("2026-08-11", 100),
    row("2026-08-18", acute),
  ];
}

function matchRpe(sessionId, effort, minutes) {
  return {
    id: `rpe-${sessionId}`,
    player_id: "player",
    session_id: sessionId,
    rpe: effort,
    minutes_played: minutes,
    load_au: effort * minutes,
    notes: null,
    created_at: "2026-08-24T00:00:00.000Z",
    sessions: { id: sessionId, date: "2026-08-24", session_type: "Match" },
  };
}

function matchStat(sessionId, minutes, date = "2026-08-24") {
  return {
    id: `stat-${sessionId}`,
    player_id: "player",
    minutes_played: minutes,
    matches: { sessions: { id: sessionId, date, duration_mins: 90 } },
  };
}

function trainingRpe(sessionId, date, effort = 5, minutes = 20) {
  return {
    id: `rpe-${sessionId}`,
    player_id: "player",
    session_id: sessionId,
    rpe: effort,
    minutes_played: minutes,
    load_au: effort * minutes,
    notes: null,
    created_at: "2026-08-24T00:00:00.000Z",
    sessions: {
      id: sessionId,
      date,
      day: "Monday",
      session_type: "Training",
      duration_mins: minutes,
      planned_rpe: 5,
      planned_load_au: effort * minutes,
      notes: null,
      created_at: "2026-08-24T00:00:00.000Z",
    },
  };
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");

  // Exact inclusive date windows: acute is 18–24 Aug, baseline is 28 Jul–17 Aug.
  const boundary = report.computeAcwr([
    row("2026-07-27", 999), // outside the 28-day history window
    row("2026-07-28", 100),
    row("2026-08-17", 200),
    row("2026-08-18", 300),
    row("2026-08-24", 400),
  ], anchor);
  assert.equal(boundary.acute, 700, "acute includes exactly 18–24 Aug");
  assert.equal(boundary.baselineWeeklyAvg, 100, "baseline includes exactly 28 Jul–17 Aug");

  const tooShort = report.computeAcwr([
    row("2026-07-29", 100),
    row("2026-08-05", 100),
    row("2026-08-12", 100),
    row("2026-08-18", 100),
  ], anchor);
  assert.equal(tooShort.historyDays, 27, "history counts calendar days inclusively");
  assert.equal(tooShort.status, "building", "27 days cannot receive a workload classification");
  assert.equal(tooShort.acwr, null, "short history does not create a ratio");

  const exactHistory = report.computeAcwr(establishedRows(100), anchor);
  assert.equal(exactHistory.historyDays, 28, "28-day history starts on 28 Jul");
  assert.equal(exactHistory.status, "typical", "exactly 28 days can establish a baseline");
  assert.equal(exactHistory.acwr, 1, "acute equals the prior weekly baseline");

  const uncoupled = report.computeAcwr([
    row("2026-07-28", 600),
    row("2026-08-04", 600),
    row("2026-08-11", 600),
    row("2026-08-18", 1200),
  ], anchor);
  assert.equal(uncoupled.baselineWeeklyAvg, 600, "current acute week is excluded from baseline");
  assert.equal(uncoupled.acwr, 2, "a 1,200 AU week is twice a 600 AU prior baseline");

  for (const [ratio, expectedStatus] of [
    [0.79, "below_baseline"],
    [0.8, "typical"],
    [1.3, "typical"],
    [1.31, "elevated"],
    [1.5, "elevated"],
    [1.51, "high_spike"],
    [2, "high_spike"],
    [2.01, "very_high_spike"],
  ]) {
    const result = report.computeAcwr(establishedRows(ratio * 100), anchor);
    assert.equal(result.status, expectedStatus, `ratio ${ratio} is ${expectedStatus}`);
  }

  const rated = report.buildLoadRows([matchRpe("rated", 5, 90)], [matchStat("rated", 90)]);
  assert.equal(rated.length, 1, "grid + RPE records are counted once");
  assert.equal(rated[0].load_au, 450, "known match RPE is paired with grid minutes");
  assert.equal(rated[0].estimated, false, "player-rated match load is not estimated");

  const fallback = report.buildLoadRows([], [matchStat("fallback", 90)]);
  assert.equal(fallback[0].load_au, 630, "missing match RPE falls back to RPE 7");
  assert.equal(fallback[0].estimated, true, "RPE 7 fallback is marked estimated");

  const rpeOnly = report.buildLoadRows([matchRpe("rpe-only", 6, 20)], []);
  assert.equal(rpeOnly[0].load_au, 120, "an ungridded match RPE uses logged minutes and RPE");
  assert.equal(rpeOnly[0].estimated, false, "an RPE-backed fallback is not estimated");

  assert.deepEqual(report.buildLoadRows([], []), [], "attendance alone cannot create a full-match workload");

  const sameDay = report.collapseLoadByDay([
    row("2026-08-24", 300),
    { ...fallback[0], date: "2026-08-24" },
  ]);
  assert.equal(sameDay.length, 1, "multiple activities on one date collapse into one daily load");
  assert.equal(sameDay[0].load_au, 930, "daily load preserves the combined total");
  assert.equal(sameDay[0].estimated, true, "a day keeps the estimated-match marker");

  // A printed report must retain estimate provenance even when the selected
  // reporting period has no match, but its workload-ratio baseline does.
  const reportWithBaselineEstimate = report.buildPlayerReport(
    { id: "player", name: "Player" },
    {
      sessions: [
        trainingRpe("first", "2026-07-28").sessions,
        trainingRpe("second", "2026-08-11").sessions,
        trainingRpe("acute", "2026-08-18").sessions,
      ],
      attendance: [],
      results: [],
      rpe: [
        trainingRpe("first", "2026-07-28"),
        trainingRpe("second", "2026-08-11"),
        trainingRpe("acute", "2026-08-18"),
      ],
      matchStats: [matchStat("baseline-estimate", 90, "2026-08-04")],
      finishes: new Map(),
    },
    { from: "2026-08-18", to: "2026-08-24" },
  );
  assert.equal(reportWithBaselineEstimate.load.matchCount, 0, "selected period contains no match");
  assert.equal(
    reportWithBaselineEstimate.load.baselineEstimatedMatchAu,
    630,
    "report preserves an RPE 7 estimate that affects only the ratio baseline",
  );

  console.log("Workload ratio checks passed.");
} finally {
  await vite.close();
}