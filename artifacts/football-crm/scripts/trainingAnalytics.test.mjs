import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

function row(playerId, date, load, extra = {}) {
  return { player_id: playerId, date, load_au: load, source: "session", rpe: 6, estimated: false, planned_load_au: null, ...extra };
}
function player(id, name, isActive = true) {
  return { id, name, is_active: isActive, code: name.toUpperCase(), team: "Sharks" };
}
function approxEqual(actual, expected, msg, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg} (got ${actual}, expected ${expected})`);
}

try {
  const ta = await vite.ssrLoadModule("/src/lib/trainingAnalytics.ts");
  const {
    buildSquadWeeklyLoad, computeSquadUsualLoadRange, buildLoadToWatch, buildSquadTable,
    buildDataQualityPanel, interpretSquadWeeklyLoad, interpretLoadToWatch, interpretSquadTable,
    interpretDataQuality, weeksAgo, withinWeeks,
  } = ta;

  // ── buildSquadWeeklyLoad: dense tiling with real zeros ─────────────────────
  // 3-week window: week 1 has load, week 2 is a genuine gap, week 3 has load.
  const start = new Date(2026, 7, 3);   // Mon 2026-08-03
  const end = new Date(2026, 7, 23);    // Sun 2026-08-23 — exactly 3 full weeks
  const squadSize = 5;
  const weeklyRows = [
    row("p1", "2026-08-04", 200), row("p2", "2026-08-06", 200), // week 1: 2 players, 400 total
    // week 2 (08-10..16): nothing at all — a genuine team gap
    row("p1", "2026-08-20", 500), // week 3
  ];
  const weekly = buildSquadWeeklyLoad(weeklyRows, start, end, squadSize);

  assert.equal(weekly.length, 3, "every week in range gets an entry, including the empty one");
  assert.deepEqual(weekly.map((w) => [w.weekStart, w.weekEnd]), [
    ["2026-08-03", "2026-08-09"], ["2026-08-10", "2026-08-16"], ["2026-08-17", "2026-08-23"],
  ]);
  assert.equal(weekly[1].totalAu, 0, "the empty week is a real zero, not omitted");
  assert.equal(weekly[1].players, 0);
  assert.equal(weekly.every((w) => !w.isPartial), true, "an exact multiple of 7 days has no partial week");

  // perPlayerAu divides by the constant squad size, not by turnout.
  assert.equal(weekly[0].totalAu, 400);
  assert.equal(weekly[0].players, 2, "informational turnout count");
  approxEqual(weekly[0].perPlayerAu, 400 / squadSize, "divided by squad size (5), not by the 2 players who actually logged");

  // Week-on-week: null for the first week; null across the zero week (previous perPlayerAu is 0); real value into week 3.
  assert.equal(weekly[0].weekOnWeekPerPlayerPct, null, "no preceding week");
  approxEqual(weekly[1].weekOnWeekPerPlayerPct, -100, "week 1 had real load, so dropping to 0 in week 2 is a legitimate -100%");
  assert.equal(weekly[2].weekOnWeekPerPlayerPct, null, "previous week (week 2) had 0 load — pct is null, not a huge/invalid jump off a zero baseline");

  // ── Partial trailing week ───────────────────────────────────────────────────
  const partialEnd = new Date(2026, 7, 12); // Wed, 3 days into week 2
  const partial = buildSquadWeeklyLoad(weeklyRows, start, partialEnd, squadSize);
  assert.equal(partial.length, 2);
  assert.equal(partial[1].isPartial, true);
  assert.equal(partial[1].weekEnd, "2026-08-12");
  assert.equal(partial[1].weekOnWeekPerPlayerPct, null, "a partial week is excluded from week-on-week comparison entirely");

  // estimatedAu / estimatedShare
  const estimatedRows = [row("p1", "2026-08-04", 300, { estimated: true }), row("p2", "2026-08-04", 100, { estimated: false })];
  const estimatedWeekly = buildSquadWeeklyLoad(estimatedRows, new Date(2026, 7, 3), new Date(2026, 7, 9), 5);
  assert.equal(estimatedWeekly[0].estimatedAu, 300);
  approxEqual(estimatedWeekly[0].estimatedShare, 300 / 400);

  // ── computeSquadUsualLoadRange ──────────────────────────────────────────────
  // Fewer than 8 prior complete weeks: null band.
  assert.equal(computeSquadUsualLoadRange(weekly.slice(0, 2)), null, "only 1 prior week — below Z_SCORE_MIN_WEEKS");

  // Build 9 clean weeks (8 history + 1 current), constant perPlayerAu, to get a clean band.
  const nineWeeksRows = [];
  for (let i = 0; i < 9; i++) {
    nineWeeksRows.push(row("p1", new Date(2026, 5, 1 + i * 7).toISOString().slice(0, 10), 100 * squadSize));
  }
  const nineWeekStart = new Date(2026, 5, 1);
  const nineWeekEnd = new Date(2026, 5, 1 + 8 * 7 + 6); // 9 full weeks
  const nineWeekly = buildSquadWeeklyLoad(nineWeeksRows, nineWeekStart, nineWeekEnd, squadSize);
  assert.equal(nineWeekly.length, 9);
  const flatRange = computeSquadUsualLoadRange(nineWeekly);
  assert.ok(flatRange !== null, "8 prior complete weeks is enough for a band");
  approxEqual(flatRange.low, 100, "flat history: band collapses to the constant value itself");
  approxEqual(flatRange.high, 100);

  // A 13th-oldest week outside the 12-week cap must not move the band.
  const tenWeeksRows = [row("p1", "2026-01-01", 999999 * squadSize), ...nineWeeksRows];
  // Shift everything so the huge outlier falls outside the most-recent-12 window relative to the same final week.
  const withOutlier = buildSquadWeeklyLoad(tenWeeksRows, new Date(2026, 0, 1), nineWeekEnd, squadSize);
  const outlierRange = computeSquadUsualLoadRange(withOutlier.slice(-9)); // only look at the same trailing 9-week slice
  approxEqual(outlierRange.low, flatRange.low, "an outlier week outside the 12-week cap doesn't affect the band");

  // ── buildLoadToWatch ────────────────────────────────────────────────────────
  // anchor = 2026-08-30 (a Sunday): baseline window is [2026-08-03, 2026-08-23],
  // acute window is [2026-08-24, 2026-08-30]. Every fixture's baseline rows
  // are placed inside that real window (plus one row before baselineStart, so
  // firstLogged <= baselineStart and hasBaseline is actually true) — a player
  // whose last real load predates the baseline window reads "Building", not
  // "Low", same rule already confirmed for EWMA; this is rolling ACWR's own
  // version of that same guard, not a special case for this function.
  const players3 = [player("p1", "Spiky"), player("p2", "Quiet"), player("p3", "Steady")];
  const anchor = new Date(2026, 7, 30); // Sunday 2026-08-30
  const allRows = [
    // Spiky: real baseline, then a big acute-week jump -> Spike.
    row("p1", "2026-07-22", 400), row("p1", "2026-07-29", 400), row("p1", "2026-08-05", 400),
    row("p1", "2026-08-12", 400), row("p1", "2026-08-19", 400), row("p1", "2026-08-26", 3000),
    // Quiet: the same real baseline, but a light acute week -> Low.
    row("p2", "2026-07-22", 400), row("p2", "2026-07-29", 400), row("p2", "2026-08-05", 400),
    row("p2", "2026-08-12", 400), row("p2", "2026-08-19", 400), row("p2", "2026-08-26", 50),
    // Steady: identical load every week, including the acute week -> Typical.
    row("p3", "2026-07-22", 400), row("p3", "2026-07-29", 400), row("p3", "2026-08-05", 400),
    row("p3", "2026-08-12", 400), row("p3", "2026-08-19", 400), row("p3", "2026-08-26", 400),
  ];
  const teamDates = [];
  const watch = buildLoadToWatch(allRows, players3, anchor, teamDates);
  const watchNames = watch.map((w) => w.player.name);
  assert.ok(watchNames.includes("Spiky"), "a genuine acute-week spike is on the watch list");
  assert.ok(watchNames.includes("Quiet"), "a real baseline with an unusually light acute week shows up as Low");
  assert.ok(!watchNames.includes("Steady"), "a perfectly flat player is Typical, not on the watch list");
  assert.equal(watch.find((w) => w.player.name === "Spiky").status, "spike");
  assert.equal(watch.find((w) => w.player.name === "Quiet").status, "low");
  assert.ok(watch.findIndex((w) => w.player.name === "Spiky") < watch.findIndex((w) => w.player.name === "Quiet"),
    "Spike sorts before Low");
  for (const w of watch) {
    if (w.acwr !== null) approxEqual(w.pctVsUsual, (w.acwr - 1) * 100, "pctVsUsual formula");
  }

  // ── buildSquadTable ─────────────────────────────────────────────────────────
  const table = buildSquadTable(allRows, allRows, players3, anchor, teamDates);
  assert.equal(table.length, 3, "every active player gets a row, including one with zero windowed load");
  const quietRow = table.find((r) => r.player.name === "Quiet");
  assert.ok(quietRow, "a quiet player still gets a table row");
  assert.equal(quietRow.sessionsLogged, 6, "sessionsLogged counts their real rated-session rows in the window");

  const noDataPlayer = [player("p4", "Brand New")];
  const emptyTable = buildSquadTable([], [], noDataPlayer, anchor, teamDates);
  assert.equal(emptyTable.length, 1);
  assert.equal(emptyTable[0].sessionsLogged, 0);
  assert.equal(emptyTable[0].estimatedShare, 0, "no load at all is 0 estimated share, not NaN");
  assert.ok(Array.isArray(emptyTable[0].monotonySparkline), "sparkline is always an array, even with no data");

  // ── buildDataQualityPanel ───────────────────────────────────────────────────
  const sessions = [
    { id: "s1", date: "2026-08-05", session_type: "Training" },
    { id: "s2", date: "2026-08-07", session_type: "Training" },
    { id: "s3", date: "2026-08-09", session_type: "Lecture" }, // excluded from scope entirely
  ];
  const attendance = [
    { session_id: "s1", player_id: "p1", status: "Present" },
    { session_id: "s2", player_id: "p1", status: "Present" },
  ];
  const rpe = [{ session_id: "s1", player_id: "p1" }]; // s2 has attendance but no RPE from anyone
  const dqWindow = [row("p1", "2026-08-05", 300, { estimated: false }), row("p1", "2026-08-07", 100, { estimated: true })];
  const dq = buildDataQualityPanel(sessions, attendance, rpe, dqWindow, new Date(2026, 7, 3), new Date(2026, 7, 9));
  assert.equal(dq.totalSessions, 2, "Lecture is excluded from the non-Lecture scope");
  assert.equal(dq.sessionsWithNoRpe, 1, "s2 has attendance but zero RPE from anyone");
  approxEqual(dq.estimatedSharePct, Math.round((100 / 400) * 100));

  const emptyDq = buildDataQualityPanel([], [], [], [], new Date(2026, 7, 3), new Date(2026, 7, 9));
  assert.equal(emptyDq.estimatedSharePct, 0, "no load in the window is 0%, not NaN");

  // ── Interpretation one-liners: smoke tests ──────────────────────────────────
  assert.equal(interpretSquadWeeklyLoad([]), "No load logged in this window.");
  assert.match(interpretSquadWeeklyLoad(partial), /in progress/, "a partial current week says so");
  assert.equal(interpretLoadToWatch([]), "Nobody is outside their usual load range right now.");
  assert.match(interpretLoadToWatch(watch), /outside their usual range/);
  assert.match(interpretSquadTable(table), /of 3 players logged load this week/);
  assert.match(interpretDataQuality(dq), /no RPE logged from anyone/);
  assert.equal(interpretDataQuality(emptyDq), "No sessions in this window yet.", "zero sessions in the window (all-Lecture or genuinely empty) reads distinctly from zero-with-issues");

  // ── weeksAgo / withinWeeks still work as before ────────────────────────────
  assert.equal(weeksAgo(null, new Date(2026, 7, 1)), null, "all-time has no cutoff");
  approxEqual(weeksAgo(2, new Date(2026, 7, 15)).getTime(), new Date(2026, 7, 1).getTime());
  assert.equal(withinWeeks([row("p1", "2026-07-01", 100)], 2, new Date(2026, 7, 15)).length, 0, "outside the 2-week cutoff");
  assert.equal(withinWeeks([row("p1", "2026-08-10", 100)], 2, new Date(2026, 7, 15)).length, 1, "inside the cutoff");

  console.log("Training analytics (Overview rebuild) checks passed.");
} finally {
  await vite.close();
}
