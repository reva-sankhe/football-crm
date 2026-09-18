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

function approxEqual(actual, expected, msg, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg} (got ${actual}, expected ${expected})`);
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { computeZScore, computeWorkloadZScores, Z_SCORE_MIN_WEEKS, Z_SCORE_MAX_WEEKS } = report;

  assert.equal(Z_SCORE_MIN_WEEKS, 8);
  assert.equal(Z_SCORE_MAX_WEEKS, 12);

  // ── Fewer than the minimum: null zScore, but mean/sd/weeksUsed still reported ──
  const fiveWeeks = [10, 20, 30, 40, 50];
  const short = computeZScore(60, fiveWeeks);
  assert.equal(short.weeksUsed, 5);
  assert.equal(short.zScore, null, "below Z_SCORE_MIN_WEEKS, the ratio isn't considered meaningful yet");
  approxEqual(short.mean, 30, "mean is still reported even when the window is too short to score");
  assert.ok(short.sd > 0, "sd is still computed for the informational fields");

  // ── Exactly the minimum, hand-computed ─────────────────────────────────────
  // [10,20,30,40,50,60,70,80]: mean=45, population variance=4200/8=525.
  const eightWeeks = [10, 20, 30, 40, 50, 60, 70, 80];
  const atMin = computeZScore(90, eightWeeks);
  assert.equal(atMin.weeksUsed, 8);
  approxEqual(atMin.mean, 45);
  approxEqual(atMin.sd, Math.sqrt(525));
  approxEqual(atMin.zScore, (90 - 45) / Math.sqrt(525), "z-score at exactly the minimum window size");

  // ── Current value equal to the mean scores exactly 0 ───────────────────────
  const atMean = computeZScore(45, eightWeeks);
  approxEqual(atMean.zScore, 0);

  // ── More than 12 supplied: only the most recent 12 are used ────────────────
  // A huge outlier prepended before the 12-week cutoff must not move mean/sd/zScore.
  const twelveWeeks = Array.from({ length: 12 }, (_, i) => 100); // flat except one bump below
  twelveWeeks[11] = 200; // most recent of the 12
  const withOldOutlier = [999999, ...twelveWeeks]; // 13 entries — the huge value falls outside the window
  const trimmed = computeZScore(50, withOldOutlier);
  const untrimmed = computeZScore(50, twelveWeeks);
  assert.equal(trimmed.weeksUsed, 12, "capped at Z_SCORE_MAX_WEEKS even though 13 were supplied");
  approxEqual(trimmed.mean, untrimmed.mean, "the 13th-oldest value (outside the 12-week window) must not affect the mean");
  approxEqual(trimmed.sd, untrimmed.sd);
  approxEqual(trimmed.zScore, untrimmed.zScore);

  // ── sd of 0 (every prior week identical): null, not Infinity ───────────────
  const flatHistory = Array.from({ length: 10 }, () => 100);
  const flat = computeZScore(150, flatHistory);
  assert.equal(flat.sd, 0);
  assert.equal(flat.zScore, null, "an undefined ratio, same rule as monotony and EWMA ACWR");

  // ── No prior weeks at all ───────────────────────────────────────────────────
  const noHistory = computeZScore(100, []);
  assert.equal(noHistory.weeksUsed, 0);
  assert.equal(noHistory.mean, 0);
  assert.equal(noHistory.zScore, null);

  // ── computeWorkloadZScores: bundles the three named metrics ────────────────
  const bundled = computeWorkloadZScores(
    { weeklyLoad: 90, acwr: 1.5, strain: 500 },
    { weeklyLoad: eightWeeks, acwr: eightWeeks.map((v) => v / 50), strain: eightWeeks.map((v) => v * 5) },
  );
  approxEqual(bundled.weeklyLoad.zScore, atMin.zScore, "weeklyLoad delegates straight to computeZScore");
  assert.ok(bundled.acwr.zScore !== null, "acwr scored normally when a current value and history exist");
  assert.ok(bundled.strain.zScore !== null, "strain scored normally when a current value and history exist");

  // A null current value (e.g. ACWR still building baseline) must not throw —
  // it comes back as an explicit no-history result instead.
  const stillBuilding = computeWorkloadZScores(
    { weeklyLoad: 90, acwr: null, strain: null },
    { weeklyLoad: eightWeeks, acwr: [], strain: [] },
  );
  assert.equal(stillBuilding.acwr.zScore, null);
  assert.equal(stillBuilding.acwr.weeksUsed, 0, "a null current value short-circuits before touching priorWeeks");
  assert.equal(stillBuilding.strain.zScore, null);
  assert.ok(stillBuilding.weeklyLoad.zScore !== null, "weeklyLoad is unaffected by acwr/strain being unavailable");

  console.log("Z-score checks passed.");
} finally {
  await vite.close();
}
