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

function isoOfLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function trainingSession(id, date, extra = {}) {
  return {
    id, date, day: "Monday", session_type: "Training",
    duration_mins: 60, planned_rpe: 5, planned_load_au: 300,
    notes: null, created_at: "2026-08-24T00:00:00.000Z",
    ...extra,
  };
}

function attend(playerId, sessionId, status = "Present") {
  return { player_id: playerId, session_id: sessionId, status };
}

/** A real RPE submission for an arbitrary player — trainingRpe() always uses "player". */
function submittedRpe(playerId, sessionId, effort, date = "2026-08-24") {
  return {
    id: `rpe-${sessionId}-${playerId}`, player_id: playerId, session_id: sessionId,
    rpe: effort, minutes_played: 60, load_au: effort * 60, notes: null,
    created_at: "2026-08-24T00:00:00.000Z",
    sessions: { id: sessionId, date, session_type: "Training" },
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
  // Same-weekly-scale check: this only equals exactly 2 because baselineWeeklyAvg
  // is a genuine weekly figure (21-day sum ÷ 3), not the raw 21-day sum compared
  // against a 7-day sum — get that wrong and this ratio comes out as 2/3, not 2.

  // A baseline of literal zero must not produce Infinity/NaN — it falls back to
  // "building", same as an incomplete history, rather than a broken ratio.
  const zeroBaseline = report.computeAcwr([
    row("2026-07-28", 0),
    row("2026-08-04", 0),
    row("2026-08-11", 0),
    row("2026-08-18", 500),
  ], anchor);
  assert.equal(zeroBaseline.baselineWeeklyAvg, 0, "a baseline of literal zero load");
  assert.equal(zeroBaseline.acwr, null, "a zero baseline cannot form a ratio");
  assert.equal(zeroBaseline.status, "building", "zero baseline falls back to building, not a broken ratio");

  // Neutral bands: Low < 0.8, Typical [0.8, 1.3), Elevated [1.3, 1.5], Spike > 1.5.
  // The boundary values at exactly 0.8, 1.3 and 1.5 are deliberately asymmetric
  // (1.3 moved into Elevated; 1.5 stays in Elevated, not Spike) — locked in here.
  // Floor explicitly 0: establishedRows' baseline (100 AU/week) is below the
  // real CHRONIC_LOAD_FLOOR (300), so this isolates band boundaries from the
  // low_base mechanism, which gets its own tests below.
  for (const [ratio, expectedStatus] of [
    [0.79, "low"],
    [0.8, "typical"],
    [1.29, "typical"],
    [1.3, "elevated"],
    [1.5, "elevated"],
    [1.51, "spike"],
    [2, "spike"],
  ]) {
    const result = report.computeAcwr(establishedRows(ratio * 100), anchor, 0);
    assert.equal(result.status, expectedStatus, `ratio ${ratio} is ${expectedStatus}`);
  }

  // low_base: only ever replaces what would otherwise be Spike — never Low,
  // Typical or Elevated, even with a baseline well under the floor. Strict "<".
  const belowFloorTypical = report.computeAcwr(establishedRows(100), anchor, 150);
  assert.equal(belowFloorTypical.status, "typical", "a Typical reading stays Typical even under a floor");

  const belowFloorSpike = report.computeAcwr(establishedRows(200), anchor, 150);
  assert.equal(belowFloorSpike.status, "low_base", "a Spike reading becomes low_base when baseline is under the floor");

  const atFloor = report.computeAcwr(establishedRows(200), anchor, 100);
  assert.equal(atFloor.status, "spike", "baseline exactly at the floor does not trigger low_base — strictly less than");

  const floorDisabled = report.computeAcwr(establishedRows(200), anchor, 0);
  assert.equal(floorDisabled.status, "spike", "floor: 0 explicitly disables low_base, even with a near-zero baseline");

  // Production default: CHRONIC_LOAD_FLOOR is now the fixed rule (300 AU/week,
  // ~one light session), not a 0 placeholder — so the default (no floor param
  // passed at all) must actually engage low_base on a sub-300 baseline.
  const defaultFloorEngages = report.computeAcwr(establishedRows(200), anchor);
  assert.equal(report.CHRONIC_LOAD_FLOOR, 300, "CHRONIC_LOAD_FLOOR is the fixed 300 AU/week rule");
  assert.equal(defaultFloorEngages.status, "low_base", "the real default floor (300) fires on establishedRows' 100 AU/week baseline with no floor param passed");

  // Week-on-week: the single prior week, not the 3-week baseline average.
  const wow = report.computeAcwr([
    row("2026-08-11", 500), // the week immediately before the acute week
    row("2026-08-18", 750),
  ], anchor);
  assert.equal(wow.previousWeekAu, 500, "previous week is the single week right before acute, not the 3-week baseline");
  assert.equal(wow.weekOnWeekPct, 50, "750 vs 500 is a 50% week-on-week increase");

  const wowNoPriorWeek = report.computeAcwr([row("2026-08-18", 750)], anchor);
  assert.equal(wowNoPriorWeek.weekOnWeekPct, null, "no row at all in the previous week means no percentage, not Infinity");

  // Same null outcome when a row exists but its AU is literally 0 — not just when
  // the previous week has no rows at all (the two are numerically identical but
  // worth locking down as distinct scenarios).
  const wowZeroPriorWeek = report.computeAcwr([
    row("2026-08-14", 0),
    row("2026-08-18", 750),
  ], anchor);
  assert.equal(wowZeroPriorWeek.previousWeekAu, 0, "a logged-but-zero previous week");
  assert.equal(wowZeroPriorWeek.weekOnWeekPct, null, "zero AU in the previous week means no percentage, not Infinity");

  // Previous week is exactly days 8–14 back from anchor (Aug 24): Aug 11–Aug 17,
  // immediately before the acute week (Aug 18–24) and the baseline's first week
  // (also Aug 11–17, since the baseline is the 3 weeks before acute — the two
  // windows overlap on purpose, previousWeekAu is just a narrower read of the
  // same first baseline week). A row one day outside each edge must not count.
  const wowBoundary = report.computeAcwr([
    row("2026-08-10", 999), // 15 days back — just outside the previous week
    row("2026-08-11", 100), // 14 days back — first day in
    row("2026-08-17", 200), // 8 days back — last day in
    row("2026-08-18", 999), // 7 days back — already the acute week, not previous
  ], anchor);
  assert.equal(wowBoundary.previousWeekAu, 300, "previous week includes exactly Aug 11–17");

  // ── Fixture hand-check: a realistic mixed week of training + one match,
  // run through the full pipeline (buildLoadRows → collapseLoadByDay →
  // computeAcwr), with every number below independently verifiable by hand.
  //
  // Baseline (3 full weeks before the acute week), 2 training sessions/week,
  // each week summing to exactly 700 AU:
  //   Jul 28: RPE 5 × 40min = 200  |  Jul 30: RPE 10 × 50min = 500  → 700
  //   Aug  4: RPE 7 × 50min = 350  |  Aug  6: RPE  7 × 50min = 350  → 700
  //   Aug 11: RPE 4 × 75min = 300  |  Aug 13: RPE  8 × 50min = 400  → 700
  //   baseline total = 2100, baselineWeeklyAvg = 2100 ÷ 3 = 700
  //
  // Acute week (Aug 18–24): 2 training sessions + 1 rated match:
  //   Aug 20: RPE 6 × 60min = 360  |  Aug 22: RPE 8 × 60min = 480  → 840 training
  //   Aug 18: match, RPE 6 × 70min = 420 (player-rated, not estimated)
  //   acute total = 840 + 420 = 1260
  //
  // acwr = 1260 ÷ 700 = 1.8 → Spike (> 1.5).
  const fixtureRpe = [
    trainingRpe("b1", "2026-07-28", 5, 40),
    trainingRpe("b2", "2026-07-30", 10, 50),
    trainingRpe("b3", "2026-08-04", 7, 50),
    trainingRpe("b4", "2026-08-06", 7, 50),
    trainingRpe("b5", "2026-08-11", 4, 75),
    trainingRpe("b6", "2026-08-13", 8, 50),
    trainingRpe("a1", "2026-08-20", 6, 60),
    trainingRpe("a2", "2026-08-22", 8, 60),
    matchRpe("fixture-match", 6, 70),
  ];
  const fixtureMatchStats = [matchStat("fixture-match", 70, "2026-08-18")];
  const fixtureLoad = report.collapseLoadByDay(report.buildLoadRows(fixtureRpe, fixtureMatchStats));
  const fixtureResult = report.computeAcwr(fixtureLoad, anchor);
  assert.equal(fixtureResult.acute, 1260, "acute week: 840 training + 420 rated match");
  assert.equal(fixtureResult.baselineWeeklyAvg, 700, "baseline: (700 + 700 + 700) ÷ 3");
  assert.equal(fixtureResult.acwr, 1.8, "1260 ÷ 700 = 1.8, hand-verifiable");
  assert.equal(fixtureResult.status, "spike", "1.8 is above the 1.5 Spike threshold");

  const rated = report.buildLoadRows([matchRpe("rated", 5, 90)], [matchStat("rated", 90)]);
  assert.equal(rated.length, 1, "grid + RPE records are counted once");
  assert.equal(rated[0].load_au, 450, "known match RPE is paired with grid minutes");
  assert.equal(rated[0].estimated, false, "player-rated match load is not estimated");

  const fallback = report.buildLoadRows([], [matchStat("fallback", 90)]);
  assert.equal(fallback[0].load_au, 630, "missing match RPE falls back to RPE 7");
  assert.equal(fallback[0].estimated, true, "RPE 7 fallback is marked estimated");

  const rpeOnly = report.buildLoadRows([matchRpe("rpe-only", 6, 20)], []);
  assert.equal(rpeOnly[0].load_au, 120, "an ungridded match RPE uses the player's own logged minutes and RPE");
  assert.equal(rpeOnly[0].estimated, false, "a real, self-reported RPE-and-minutes row is not estimated");

  // The self-reported path only fires when minutes_played is actually > 0 —
  // a rated match RPE with no minutes logged is not enough to fabricate load.
  const rpeNoMinutes = report.buildLoadRows([matchRpe("rpe-no-minutes", 6, 0)], []);
  assert.equal(rpeNoMinutes.length, 0, "a rated match RPE with minutes_played = 0 produces no load");
  const rpeNullMinutes = report.buildLoadRows([{ ...matchRpe("rpe-null-minutes", 6, 0), minutes_played: null }], []);
  assert.equal(rpeNullMinutes.length, 0, "a rated match RPE with minutes_played = null produces no load");

  assert.deepEqual(report.buildLoadRows([], []), [], "attendance alone cannot create a full-match workload");

  // ── Match-side: no lineup row means no load, full stop ──────────────────
  // Present with neither a grid row nor a rated RPE — no lineup row, so no
  // load at all. There is no coarse duration-based fallback any more.
  const ungriddedMatch = trainingSession("ungridded-match", "2026-09-09", { session_type: "Match", duration_mins: 90, planned_rpe: 0 });
  const ungriddedRows = report.buildLoadRows([], [], [attend("target", "ungridded-match", "Present")], [ungriddedMatch]);
  assert.equal(ungriddedRows.filter((r) => r.player_id === "target").length, 0,
    "a Present player with no lineup row gets zero match load, not an estimate");

  // An unused sub (a real grid row recording 0 minutes) is a deliberate
  // signal, not missing data — must not be re-estimated as a full match.
  const subMatch = trainingSession("sub-match", "2026-09-10", { session_type: "Match", duration_mins: 90, planned_rpe: 0 });
  const subRows = report.buildLoadRows(
    [], [matchStat("sub-match", 0, "2026-09-10")],
    [attend("player", "sub-match", "Present")],
    [subMatch],
  );
  assert.equal(subRows.filter((r) => r.player_id === "player").length, 0,
    "a grid row recording 0 minutes played is not re-estimated as a full match");

  // A rated-but-ungridded match already produces a real row — must not also
  // get any other estimate on top of it.
  const ratedNoGridMatch = trainingSession("rated-no-grid", "2026-09-11", { session_type: "Match", duration_mins: 90, planned_rpe: 0 });
  const ratedNoGridRows = report.buildLoadRows(
    [matchRpe("rated-no-grid", 6, 70)], [],
    [attend("player", "rated-no-grid", "Present")],
    [ratedNoGridMatch],
  );
  const ratedNoGridForPlayer = ratedNoGridRows.filter((r) => r.player_id === "player");
  assert.equal(ratedNoGridForPlayer.length, 1, "a rated-but-ungridded match produces exactly one row, never also another estimate");
  assert.equal(ratedNoGridForPlayer[0].estimated, false, "the real RPE-based row is not marked estimated");

  // A real grid row — even one recording 0 minutes for an unused sub — must
  // win over a rated match RPE with its own minutes, not stack with it.
  const gridWinsMatch = trainingSession("grid-wins", "2026-09-13", { session_type: "Match", duration_mins: 90, planned_rpe: 0 });
  const gridWinsRows = report.buildLoadRows(
    [matchRpe("grid-wins", 6, 70)], [matchStat("grid-wins", 0, "2026-09-13")],
    [attend("player", "grid-wins", "Present")],
    [gridWinsMatch],
  );
  assert.equal(gridWinsRows.filter((r) => r.player_id === "player").length, 0,
    "a real 0-minute grid row suppresses the self-reported RPE-and-minutes path entirely");

  // ── Training-side missing-RPE estimate ──────────────────────────────────
  const noFallbackSession = trainingSession("no-fallback", "2026-09-01", { planned_rpe: 0, duration_mins: 60 });
  const noFallbackRows = report.buildLoadRows(
    [submittedRpe("teammate1", "no-fallback", 6)], // only 1 other submission — below the median threshold
    [], [attend("target", "no-fallback", "Present")], [noFallbackSession],
  );
  assert.equal(noFallbackRows.filter((r) => r.player_id === "target").length, 0,
    "no planned_rpe and fewer than 3 teammate submissions produces no row at all");

  // A Lecture carries no physical load by design — a missed Lecture RPE is
  // never estimated, even with a planned_rpe and full attendance set up.
  const lectureSession = trainingSession("lecture1", "2026-09-08", { session_type: "Lecture", planned_rpe: 5, duration_mins: 60 });
  const lectureRows = report.buildLoadRows([], [], [attend("target", "lecture1", "Present")], [lectureSession]);
  assert.equal(lectureRows.filter((r) => r.player_id === "target").length, 0,
    "a missed Lecture RPE is never estimated — lectures carry no physical load");

  const twoSubsSession = trainingSession("two-subs", "2026-09-02", { planned_rpe: 4, duration_mins: 50 });
  const twoSubsRows = report.buildLoadRows(
    [submittedRpe("t1", "two-subs", 8), submittedRpe("t2", "two-subs", 10)], // median would be 9
    [], [attend("target", "two-subs", "Present")], [twoSubsSession],
  );
  const twoSubsEst = twoSubsRows.find((r) => r.player_id === "target");
  assert.ok(twoSubsEst, "exactly 2 submissions still falls through to planned_rpe");
  assert.equal(twoSubsEst.rpe, 4, "uses planned_rpe (4), not the median of only 2 submissions (9)");
  assert.equal(twoSubsEst.load_au, 200, "4 × 50min = 200");
  assert.equal(twoSubsEst.estimated, true);

  const threeSubsSession = trainingSession("three-subs", "2026-09-03", { planned_rpe: 4, duration_mins: 50 });
  const threeSubsRows = report.buildLoadRows(
    [submittedRpe("t1", "three-subs", 6), submittedRpe("t2", "three-subs", 8), submittedRpe("t3", "three-subs", 10)],
    [], [attend("target", "three-subs", "Present")], [threeSubsSession],
  );
  const threeSubsEst = threeSubsRows.find((r) => r.player_id === "target");
  assert.equal(threeSubsEst.rpe, 8, "median of [6, 8, 10] is 8, overriding planned_rpe once there are 3+ submissions");
  assert.equal(threeSubsEst.load_au, 400, "8 × 50min = 400");

  const lateSession = trainingSession("late-session", "2026-09-04", { planned_rpe: 5, duration_mins: 90 });
  const lateRows = report.buildLoadRows([], [], [attend("target", "late-session", "Late")], [lateSession]);
  const lateEst = lateRows.find((r) => r.player_id === "target");
  assert.equal(lateEst.load_au, 450, "a Late player is estimated at the full 90 minutes (5 × 90), not prorated");

  const absentSession = trainingSession("absent-session", "2026-09-05", { planned_rpe: 5, duration_mins: 60 });
  const absentRows = report.buildLoadRows([], [], [attend("target", "absent-session", "Absent")], [absentSession]);
  assert.equal(absentRows.filter((r) => r.player_id === "target").length, 0, "an Absent player never gets an estimated row");

  const realSession = trainingSession("real-session", "2026-09-06", { planned_rpe: 5, duration_mins: 60 });
  const realRows = report.buildLoadRows(
    [submittedRpe("target", "real-session", 9)],
    [], [attend("target", "real-session", "Present")], [realSession],
  );
  const realForTarget = realRows.filter((r) => r.player_id === "target");
  assert.equal(realForTarget.length, 1, "a real submission produces exactly one row, never also an estimate");
  assert.equal(realForTarget[0].estimated, false, "a real submission is never marked estimated");

  // Two sessions same day, one missing RPE — real + estimated must merge correctly.
  const sameDayA = trainingSession("same-day-a", "2026-09-07", { planned_rpe: 5, duration_mins: 60 });
  const sameDayB = trainingSession("same-day-b", "2026-09-07", { planned_rpe: 6, duration_mins: 40 });
  const mixedRows = report.buildLoadRows(
    [submittedRpe("target", "same-day-a", 7, "2026-09-07")], // real: 7 × 60 = 420
    [],
    [attend("target", "same-day-a", "Present"), attend("target", "same-day-b", "Present")], // B has no RPE
    [sameDayA, sameDayB],
  );
  const mixedDaily = report.collapseLoadByDay(mixedRows);
  const mixedDay = mixedDaily.find((r) => r.player_id === "target" && r.date === "2026-09-07");
  assert.equal(mixedDay.load_au, 420 + 240, "real (420) + estimated (6 × 40 = 240, planned_rpe fallback) = 660");
  assert.equal(mixedDay.estimated, true, "the day keeps the estimated marker even though the first-merged row was real");

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

  // ── Real-data fixture: one player's actual Query 8 export, hand-verified
  // against both a fallback-off and fallback-on computation before this test
  // was written — see the project notes for the full row-by-row arithmetic.
  // This player has no teammates on any of these sessions, so every fallback
  // here falls straight to planned_rpe.
  {
    const FX = "fx-player";
    const fixtureAnchor = new Date(2026, 8, 12); // 12 Sep 2026

    // date, type, duration, planned_rpe, attendance status, [rpe, minutes] | null, hasGrid
    const coreRows = [
      ["2026-08-16", "Training", 90, 4.0, "Present", null,       false],
      ["2026-08-19", "Training", 90, 7.5, "Present", [7, 90],    false],
      ["2026-08-21", "Training", 90, 7.0, "Absent",  null,       false],
      ["2026-08-23", "Training", 90, 6.5, "Present", [8, 90],    false],
      ["2026-08-26", "Training", 90, 7.0, "Present", null,       false],
      ["2026-08-28", "Training", 90, 6.0, "Present", null,       false],
      ["2026-08-30", "Training", 80, 7.0, "Present", [9, 40],    false],
      ["2026-09-02", "Training", 90, 7.0, "Present", [5, 90],    false],
      ["2026-09-04", "Training", 90, 5.0, "Present", null,       false],
      ["2026-09-06", "Match",    90, 7.0, "Present", null,       true],
      ["2026-09-09", "Training", 90, 7.5, "Present", [5, 90],    false],
      ["2026-09-10", "Lecture",  90, 0.0, "Present", null,       false],
      ["2026-09-11", "Training", 90, 3.5, "Present", [2, 90],    false],
      ["2026-09-12", "Match",    90, 0.0, "Present", null,       true],
    ];
    // Outside every window for this anchor (2 days before baselineStart) —
    // exists only to give `firstLogged` something real to land on, so it
    // doesn't affect any acute/baseline/previous-week total.
    const historyAnchorRow = ["2026-08-14", "Training", 90, 3.0, "Present", [2, 90], false];

    function buildFixture(rows) {
      const sessions = [], attendance = [], rpe = [], matchStats = [];
      rows.forEach(([date, type, duration, planned, status, r, hasGrid], i) => {
        const sid = `fx-${i}`;
        sessions.push(trainingSession(sid, date, { session_type: type, duration_mins: duration, planned_rpe: planned }));
        attendance.push(attend(FX, sid, status));
        if (r) {
          const [effort, minutes] = r;
          rpe.push({
            id: `fx-rpe-${i}`, player_id: FX, session_id: sid,
            rpe: effort, minutes_played: minutes, load_au: effort * minutes,
            notes: null, created_at: "2026-09-12T00:00:00.000Z",
            sessions: { id: sid, date, session_type: type },
          });
        }
        if (hasGrid) {
          matchStats.push({
            id: `fx-stat-${i}`, player_id: FX, minutes_played: 90,
            matches: { sessions: { id: sid, date, duration_mins: duration } },
          });
        }
      });
      return { sessions, attendance, rpe, matchStats };
    }

    // ── With the history-anchor row: matches the originally reported numbers ──
    const withAnchor = buildFixture([historyAnchorRow, ...coreRows]);

    const fxOff = report.computeAcwr(report.collapseLoadByDay(report.buildLoadRows(withAnchor.rpe, withAnchor.matchStats)), fixtureAnchor);
    assert.equal(fxOff.acute, 1890, "real fixture, fallback off: acute");
    assert.equal(fxOff.previousWeekAu, 810, "real fixture, fallback off: previous week");
    assert.equal(fxOff.baselineWeeklyAvg, 720, "real fixture, fallback off: baseline (2160 ÷ 3)");
    assert.equal(Math.round(fxOff.acwr * 100) / 100, 2.63, "real fixture, fallback off: ACWR");
    assert.equal(fxOff.status, "spike", "real fixture, fallback off: status");
    assert.equal(Math.round(fxOff.weekOnWeekPct), 133, "real fixture, fallback off: week-on-week %");

    const fxOn = report.computeAcwr(
      report.collapseLoadByDay(report.buildLoadRows(withAnchor.rpe, withAnchor.matchStats, withAnchor.attendance, withAnchor.sessions)),
      fixtureAnchor,
    );
    assert.equal(fxOn.acute, 1890, "real fixture, fallback on: acute is unchanged — none of the acute week's gaps are ungridded Training");
    assert.equal(fxOn.previousWeekAu, 1260, "real fixture, fallback on: previous week");
    assert.equal(fxOn.baselineWeeklyAvg, 1380, "real fixture, fallback on: baseline (4140 ÷ 3)");
    assert.equal(Math.round(fxOn.acwr * 100) / 100, 1.37, "real fixture, fallback on: ACWR");
    assert.equal(fxOn.status, "elevated", "real fixture, fallback on: status");
    assert.equal(Math.round(fxOn.weekOnWeekPct), 50, "real fixture, fallback on: week-on-week %");

    // ── Without it: documents that missing RPE can delay baseline eligibility
    // itself, not just the numbers, when the fallback is off. Row 1 of
    // coreRows lands exactly on baselineStart (2026-08-16) with no RPE, so
    // without the fallback the earliest *real* row is 3 days too late to
    // satisfy `firstLogged <= baselineStart` — status is "building", not a
    // wrong ACWR. With the fallback, row 1 gets a planned_rpe estimate dated
    // exactly on baselineStart, satisfies it, and resolves the same as above.
    const noAnchor = buildFixture(coreRows);

    const fxOffNoAnchor = report.computeAcwr(report.collapseLoadByDay(report.buildLoadRows(noAnchor.rpe, noAnchor.matchStats)), fixtureAnchor);
    assert.equal(fxOffNoAnchor.status, "building", "without a pre-window row, fallback off is 3 days short of a baseline — building, not a wrong Spike");
    assert.equal(fxOffNoAnchor.acwr, null, "building status carries no ratio");

    const fxOnNoAnchor = report.computeAcwr(
      report.collapseLoadByDay(report.buildLoadRows(noAnchor.rpe, noAnchor.matchStats, noAnchor.attendance, noAnchor.sessions)),
      fixtureAnchor,
    );
    assert.equal(fxOnNoAnchor.status, "elevated", "with the fallback, row 1's estimate lands exactly on baselineStart and resolves the same as the anchored version");
  }

  // ── denseDailyLoad ───────────────────────────────────────────────────────
  const dense = report.denseDailyLoad(
    [row("2026-09-02", 300), row("2026-09-04", 150)],
    new Date(2026, 8, 1), new Date(2026, 8, 5),
  );
  assert.deepEqual(dense.map((d) => d.date), ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
    "every calendar day in range, inclusive of both ends");
  assert.deepEqual(dense.map((d) => d.load_au), [0, 300, 0, 150, 0], "rest days are real zeros, not absent");

  // ── playerActivityBounds ─────────────────────────────────────────────────
  const windowEnd = new Date(2026, 8, 30);

  const activeBounds = report.playerActivityBounds(
    "2026-08-01T00:00:00.000Z",
    [{ date: "2026-08-05", status: "Present" }],
    ["2026-08-10"],
    true, // still active
    windowEnd,
  );
  assert.deepEqual([activeBounds.start.getFullYear(), activeBounds.start.getMonth(), activeBounds.start.getDate()], [2026, 7, 1],
    "start is the earliest signal — here, created_at");
  assert.equal(activeBounds.end.getTime(), windowEnd.getTime(), "an active player's window extends to windowEnd, not their last activity");

  const midWindowJoiner = report.playerActivityBounds(
    "2026-08-20T00:00:00.000Z", // row created the day they joined
    [{ date: "2026-08-20", status: "Present" }],
    ["2026-08-22"],
    true,
    windowEnd,
  );
  assert.deepEqual([midWindowJoiner.start.getFullYear(), midWindowJoiner.start.getMonth(), midWindowJoiner.start.getDate()], [2026, 7, 20],
    "a mid-window joiner's start is their own first signal, not the window start — no fabricated pre-join days");

  const inactiveNormal = report.playerActivityBounds(
    "2026-08-01T00:00:00.000Z",
    [{ date: "2026-08-05", status: "Present" }, { date: "2026-08-15", status: "Present" }],
    ["2026-08-10"],
    false, // inactive
    windowEnd,
  );
  assert.deepEqual([inactiveNormal.end.getFullYear(), inactiveNormal.end.getMonth(), inactiveNormal.end.getDate()], [2026, 7, 15],
    "an inactive player's window ends at their last real activity, not windowEnd");

  const inactiveTrailingAbsence = report.playerActivityBounds(
    "2026-08-01T00:00:00.000Z",
    [
      { date: "2026-08-05", status: "Present" },
      { date: "2026-08-12", status: "Present" }, // last real presence
      { date: "2026-08-19", status: "Absent" },  // later, but not presence
      { date: "2026-08-26", status: "Injured" }, // later still, also not presence
    ],
    [],
    false,
    windowEnd,
  );
  assert.deepEqual(
    [inactiveTrailingAbsence.end.getFullYear(), inactiveTrailingAbsence.end.getMonth(), inactiveTrailingAbsence.end.getDate()],
    [2026, 7, 12],
    "trailing Absent/Injured rows are ignored for the end date — it uses the last actual Present/Late",
  );

  // ── Team-wide break reset ────────────────────────────────────────────────
  // Reusing establishedRows(100) (anchor 2026-08-24) — on its own this
  // resolves to a normal "typical" ratio; these tests confirm a team-wide
  // gap in the *squad's* session calendar overrides that, while a gap in
  // this one player's *own* data never does.

  // Two sessions 22 calendar days apart = 21 empty days between them —
  // exactly GAP_RESET_DAYS. Resume date 2026-08-10 is only 14 days before
  // the 2026-08-24 anchor, so still inside the post-break rebuild window.
  const teamBreak22 = report.computeAcwr(
    establishedRows(100), anchor, 0,
    ["2026-07-19", "2026-08-10", "2026-08-15", "2026-08-20"],
  );
  assert.equal(teamBreak22.status, "building", "a 22-day team-wide gap (21 empty days) forces building");
  assert.equal(teamBreak22.acwr, null, "building status carries no ratio, even though the underlying rows would compute one");

  // Same shape, but only 20 days apart (19 empty days) — under the threshold.
  const teamBreak20 = report.computeAcwr(
    establishedRows(100), anchor, 0,
    ["2026-07-21", "2026-08-10", "2026-08-15", "2026-08-20"],
  );
  assert.equal(teamBreak20.status, "typical", "a 20-day team-wide gap (19 empty days) does not reach the threshold — normal status");

  // A player's own 30-day absence from the sport (no rows at all in that
  // stretch) must never trigger this — only the team's calendar can.
  // teamSessionDates here is weekly, continuous, no gap anywhere near 21 days.
  const continuousTeamDates = [];
  for (let d = new Date(2026, 5, 1); d <= new Date(2026, 7, 24); d.setDate(d.getDate() + 7)) {
    continuousTeamDates.push(isoOfLocal(d));
  }
  const individualAbsence = report.computeAcwr(
    [
      row("2026-06-01", 100), row("2026-06-08", 100), // some early load, then this player goes quiet
      // a 30-day personal gap with no rows at all
      row("2026-08-04", 100), row("2026-08-11", 100), row("2026-08-18", 500), // resumes, own recent history
    ],
    anchor, 0, continuousTeamDates,
  );
  assert.notEqual(individualAbsence.status, "building", "an individual's own 30-day absence does not force building when the team calendar has no gap");

  // ── Team break: "building" must persist until the ENTIRE 28-day window
  // (baselineStart through end) clears the break, not just GAP_RESET_DAYS
  // (21) days after resume — otherwise the baseline still quietly includes
  // break days. Team resumes 2026-07-01 after a long gap from 2026-05-01.
  const teamDatesAfterLongBreak = ["2026-05-01", "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"];
  const rebuildRows = [
    row("2026-07-01", 100), row("2026-07-08", 100), row("2026-07-15", 100), row("2026-07-22", 100),
  ];

  // 2026-07-22: matches the reported case exactly — baselineStart (2026-06-25)
  // is still 6 days before the resume date, so the baseline would otherwise
  // include 25–30 June (break days).
  const midRebuild = report.computeAcwr(rebuildRows, new Date(2026, 6, 22), 0, teamDatesAfterLongBreak);
  assert.equal(midRebuild.status, "building", "baseline still reaches into the break — stays building");
  assert.equal(midRebuild.acwr, null, "building carries no ratio");

  // 2026-07-27: baselineStart (2026-06-30) is one day before the resume date —
  // still building. Locks in the exact boundary, one day either side.
  const stillOneDayShort = report.computeAcwr(rebuildRows, new Date(2026, 6, 27), 0, teamDatesAfterLongBreak);
  assert.equal(stillOneDayShort.status, "building", "baselineStart one day before resume — still building");

  // 2026-07-28: baselineStart (2026-07-01) lands exactly on the resume date —
  // the full 28-day window is now entirely post-break, ratio resumes.
  const fullyRebuilt = report.computeAcwr(rebuildRows, new Date(2026, 6, 28), 0, teamDatesAfterLongBreak);
  assert.equal(fullyRebuilt.status, "typical", "baselineStart reaches the resume date — the window has fully cleared the break");
  assert.equal(fullyRebuilt.acwr, 1, "acute (the 07-22 row) matches the now-clean baseline");

  // ── Team break: a week with zero team Training/Match sessions in the
  // acute window must read as "building", never a ratio computed from a
  // genuinely empty week (which reads as a deceptively calm "Low (0.00)").
  // Reported case: mid-break weeks like 2026-06-03 showing Low (0.00).
  const deadWeekTeamDates = ["2026-05-20", "2026-07-01"]; // nothing between them
  const deadWeekRows = [
    row("2026-05-07", 100), row("2026-05-14", 100), row("2026-05-21", 100), // a real baseline, pre-break
  ];
  const deadAcuteWeek = report.computeAcwr(deadWeekRows, new Date(2026, 5, 3), 0, deadWeekTeamDates);
  assert.equal(deadAcuteWeek.status, "building", "zero team sessions in the acute week forces building, not Low (0.00)");
  assert.equal(deadAcuteWeek.acwr, null, "building carries no ratio, even though acute=0 vs a real baseline would otherwise compute one");

  // teamSessionDates: [] (the default, "team-break detection off") must NOT
  // trigger this — an empty array means "no team data supplied", not "the
  // team did nothing this week".
  const noTeamDatesSupplied = report.computeAcwr(deadWeekRows, new Date(2026, 5, 3), 0);
  assert.notEqual(noTeamDatesSupplied.status, "building", "an empty teamSessionDates means detection is off, not a dead week");

  console.log("Workload ratio checks passed.");
} finally {
  await vite.close();
}