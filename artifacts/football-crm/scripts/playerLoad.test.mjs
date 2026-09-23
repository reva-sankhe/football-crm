import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

function row(date, load, extra = {}) {
  return { player_id: "p1", date, load_au: load, source: "session", rpe: 6, estimated: false, planned_load_au: null, ...extra };
}
const match = (date, load) => row(date, load, { source: "match", rpe: 7, estimated: true });

function approxEqual(actual, expected, msg, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg} (got ${actual}, expected ${expected})`);
}

try {
  const pl = await vite.ssrLoadModule("/src/lib/playerLoad.ts");
  const { computeUsualSessionRange, buildVariationTrend, interpretVariationTrend } = pl;
  const { USUAL_RANGE_SD } = await vite.ssrLoadModule("/src/lib/report.ts");

  // ── computeUsualSessionRange ───────────────────────────────────────────────
  const WINDOW = "2026-09-01"; // the first day the chart plots
  const days = (loads, startDay = 10) =>
    loads.map((load, i) => row(`2026-08-${String(startDay + i).padStart(2, "0")}`, load));

  // The band is the interquartile range, not mean ± sd: twelve identical
  // 400 AU days collapse onto 400.
  const flat = days(Array(12).fill(400));
  const flatBand = computeUsualSessionRange(flat, WINDOW, 10);
  assert.ok(flatBand, "12 session days clears the minimum");
  approxEqual(flatBand.low, 400, "zero-spread band collapses to the value (low)");
  approxEqual(flatBand.high, 400, "zero-spread band collapses to the value (high)");

  // Below the minimum day count there is no band at all — not a band built
  // from too little to mean anything.
  assert.equal(
    computeUsualSessionRange(flat.slice(0, 9), WINDOW, 10), null,
    "9 session days is under the 10-day minimum, so no band",
  );

  // Quartiles of a known series: 0,100,...,1100 has Q1 275 and Q3 825 under
  // the linear-interpolation convention used throughout the workload maths.
  const ramp = computeUsualSessionRange(days([0,100,200,300,400,500,600,700,800,900,1000,1100]), WINDOW, 10);
  approxEqual(ramp.low, 275, "low edge is the 25th percentile");
  approxEqual(ramp.high, 825, "high edge is the 75th percentile");

  // The reason for the IQR: a long tail of very light days inflates an sd
  // band but cannot move the quartiles much. Ten 500 AU days plus two 60 AU
  // ones keep the band on the main cluster.
  const tailed = computeUsualSessionRange(days([...Array(10).fill(500), 60, 60]), WINDOW, 10);
  approxEqual(tailed.low, 500, "a light-day tail does not drag the low edge down");
  approxEqual(tailed.high, 500, "nor the high edge");

  // Days inside the plotted window never set the mark they are judged against.
  const unmoved = computeUsualSessionRange(
    [...flat, row("2026-09-05", 5000), row("2026-09-06", 5000)], WINDOW, 10,
  );
  approxEqual(unmoved.high, 400, "days on/after the window start are excluded from the baseline");

  // Matches are excluded, so a fixture cannot widen the band.
  const matchless = computeUsualSessionRange(
    [...flat, match("2026-08-25", 900), match("2026-08-27", 950)], WINDOW, 10,
  );
  approxEqual(matchless.high, 400, "match days are excluded from the usual session range");

  // Two sessions on one calendar day are one day's work, not two data points.
  const sameDay = computeUsualSessionRange([...flat, row("2026-08-09", 100), row("2026-08-09", 300)], WINDOW, 10);
  const asOneDay = computeUsualSessionRange([...flat, row("2026-08-09", 400)], WINDOW, 10);
  approxEqual(sameDay.low, asOneDay.low, "two rows on one date collapse into a single 400 AU day");

  // ── buildVariationTrend ────────────────────────────────────────────────────
  // Monotony is mean ÷ sd of a week's daily loads, which is scale-invariant:
  // three equal sessions give 0.866 whether they are 300 AU or 900 AU. Only
  // the *shape* of a week moves it, so the fixture varies the day pattern.
  const PATTERNS = [
    [[2, 400], [4, 400], [6, 400]],
    [[2, 300], [4, 500], [6, 400]],
    [[2, 600], [5, 300]],
    [[1, 200], [3, 400], [5, 300], [6, 500]],
  ];
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekRows = (weekIndex, pattern) => {
    const monday = new Date(2026, 5, 1 + weekIndex * 7);
    return pattern.map(([offset, load]) =>
      row(iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)), load));
  };

  const vStart = new Date(2026, 5, 1);   // Mon 2026-06-01
  const vEnd = new Date(2026, 7, 30);    // Sun 2026-08-30 — 13 complete weeks
  const vRows = [];
  for (let w = 0; w < 12; w++) vRows.push(...weekRows(w, PATTERNS[w % PATTERNS.length]));
  vRows.push(...weekRows(12, [[2, 1200]])); // week 13: the whole week on one day

  const variation = buildVariationTrend(vRows, vStart, vEnd);
  assert.equal(variation.length, 13, "13 complete weeks tiled from the Monday");
  assert.equal(variation[0].weekStart, "2026-06-01", "weeks start on the Monday");
  assert.ok(!("strain" in variation[0]), "no raw strain figure is carried on the week");

  // The series warms up: nothing is scored until Z_SCORE_MIN_WEEKS priors exist.
  assert.deepEqual(
    variation.slice(0, 8).map((w) => w.monotonyZ), Array(8).fill(null),
    "the first 8 weeks have no prior baseline and so no z-score",
  );
  assert.ok(variation[8].monotonyZ !== null, "the 9th week is the first that can be scored");
  assert.ok(variation[8].strainZ !== null, "strain warms up on the same schedule");

  // `flagged` is exactly "either z-score is outside the band the chart draws"
  // — no second, quietly different threshold.
  for (const [i, w] of variation.entries()) {
    const outside = (z) => z !== null && Math.abs(z) > USUAL_RANGE_SD;
    assert.equal(
      w.flagged, outside(w.monotonyZ) || outside(w.strainZ),
      `week ${i}'s flag agrees with its own z-scores`,
    );
  }

  // Week 13 puts a whole week's load on a single day — a genuine departure
  // from this player's own pattern, and the most extreme week in the series.
  assert.ok(variation[12].flagged, "a week unlike this player's own pattern is flagged");
  assert.ok(
    variation[12].monotonyZ < -USUAL_RANGE_SD,
    "a one-day week is far less evenly spread than usual, so monotony reads low",
  );
  assert.equal(
    Math.min(...variation.filter((w) => w.monotonyZ !== null).map((w) => w.monotonyZ)),
    variation[12].monotonyZ,
    "and no scored week departs further than it does",
  );

  // A flat, unvarying routine has no spread to score against, so it reports
  // unscored rather than dividing by float noise. Before SD_EPSILON these
  // produced z-scores of order 1e15 and flagged every week.
  const flatRows = [];
  for (let w = 0; w < 13; w++) flatRows.push(...weekRows(w, PATTERNS[0]));
  const flatVariation = buildVariationTrend(flatRows, vStart, vEnd);
  assert.deepEqual(
    flatVariation.slice(8).map((w) => w.monotonyZ), Array(5).fill(null),
    "an identical prior routine has no spread to score monotony against",
  );
  assert.deepEqual(
    flatVariation.slice(8).map((w) => w.strainZ), Array(5).fill(null),
    "the same holds for strain, whose magnitude is ~1e4 rather than ~1",
  );
  assert.ok(!flatVariation.some((w) => w.flagged), "an unbroken routine flags nothing");

  // A trailing partial week is never scored and never flagged: a three-day
  // week carries less and varies less than a seven-day one.
  const partial = buildVariationTrend(vRows, vStart, new Date(2026, 7, 26));
  const last = partial[partial.length - 1];
  assert.ok(last.isPartial, "the trailing week is partial");
  assert.equal(last.monotonyZ, null, "a partial week gets no monotony z-score");
  assert.equal(last.strainZ, null, "a partial week gets no strain z-score");
  assert.equal(last.flagged, false, "a partial week is never flagged");

  // ── interpretVariationTrend ────────────────────────────────────────────────
  assert.match(
    interpretVariationTrend([]), /Not enough history/,
    "an unscored series says so plainly",
  );
  assert.match(
    interpretVariationTrend(flatVariation), /Not enough history/,
    "a series where nothing could be scored says the same",
  );
  assert.match(
    interpretVariationTrend(variation), /most recently 24 Aug/,
    "the most recent standout week is the one named",
  );
  assert.match(
    interpretVariationTrend([variation[12]]), /^1 week stood out/,
    "a single standout is phrased in the singular",
  );

  console.log("Player load checks passed.");
} finally {
  await vite.close();
}
