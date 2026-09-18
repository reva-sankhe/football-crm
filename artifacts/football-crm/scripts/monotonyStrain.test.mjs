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

function approxEqual(actual, expected, msg, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg} (got ${actual}, expected ${expected})`);
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { computeWeeklyMonotonyStrain } = report;

  // ── Rest days are zero-filled, not absent: one hard day, six untouched days ──
  // 2026-08-03..09, load only on the first day.
  const spikyWeek = computeWeeklyMonotonyStrain([row("2026-08-03", 700)], new Date(2026, 7, 3), new Date(2026, 7, 9));
  assert.equal(spikyWeek.length, 1);
  const w1 = spikyWeek[0];
  assert.equal(w1.loadAu, 700, "the week's total is just the one session");
  approxEqual(w1.meanDailyLoad, 100, "mean over 7 days, six of them zero");
  // variance = ((700-100)^2 + 6*(0-100)^2) / 7 = 420000/7 = 60000
  approxEqual(w1.sdDailyLoad, Math.sqrt(60000), "population SD over all 7 days, rest days counted as 0");
  approxEqual(w1.monotony, 100 / Math.sqrt(60000), "mean / sd");
  approxEqual(w1.strain, 700 * (100 / Math.sqrt(60000)), "loadAu * monotony");
  assert.equal(w1.highMonotony, false, "a spiky week is low monotony, not flagged");
  assert.equal(w1.isPartial, false);

  // ── SD of 0 → monotony and strain are null, not Infinity ──────────────────
  const uniformRows = [row("2026-08-03", 100), row("2026-08-04", 100)];
  const uniformWeek = computeWeeklyMonotonyStrain(uniformRows, new Date(2026, 7, 3), new Date(2026, 7, 4));
  assert.equal(uniformWeek[0].sdDailyLoad, 0, "identical daily loads have zero spread");
  assert.equal(uniformWeek[0].monotony, null, "sd=0 is an undefined ratio, not Infinity");
  assert.equal(uniformWeek[0].strain, null, "nothing to multiply when monotony is null");
  assert.equal(uniformWeek[0].highMonotony, false, "a null monotony is never flagged high");

  // An all-zero week (no rows at all) hits the same sd=0 rule.
  const emptyWeek = computeWeeklyMonotonyStrain([], new Date(2026, 7, 3), new Date(2026, 7, 9));
  assert.equal(emptyWeek[0].sdDailyLoad, 0);
  assert.equal(emptyWeek[0].monotony, null, "an entirely empty week is also sd=0, not a divide-by-zero throw");

  // ── Monotony boundary: exactly 2.0 is not flagged, just above it is ───────
  // Two-day window, values [50, 150]: mean=100, population sd=50, monotony=2.0 exactly.
  const exactlyTwo = computeWeeklyMonotonyStrain(
    [row("2026-08-03", 50), row("2026-08-04", 150)],
    new Date(2026, 7, 3), new Date(2026, 7, 4),
  );
  approxEqual(exactlyTwo[0].monotony, 2.0, "hand-picked values give exactly 2.0");
  assert.equal(exactlyTwo[0].highMonotony, false, "the flag is strictly 'above' 2.0, not 'at or above'");

  // Two-day window, values [51, 149]: mean=100, population sd=49, monotony≈2.0408.
  const justAboveTwo = computeWeeklyMonotonyStrain(
    [row("2026-08-03", 51), row("2026-08-04", 149)],
    new Date(2026, 7, 3), new Date(2026, 7, 4),
  );
  approxEqual(justAboveTwo[0].monotony, 100 / 49, "slightly less spread pushes monotony just past 2.0");
  assert.equal(justAboveTwo[0].highMonotony, true, "just over the threshold is flagged");

  // ── Strain scales with both volume and monotony ────────────────────────────
  // Same shape as justAboveTwo but at 10x the load — same monotony, 10x the strain.
  const scaledUp = computeWeeklyMonotonyStrain(
    [row("2026-08-03", 510), row("2026-08-04", 1490)],
    new Date(2026, 7, 3), new Date(2026, 7, 4),
  );
  approxEqual(scaledUp[0].monotony, justAboveTwo[0].monotony, "monotony is scale-invariant (same shape, 10x load)");
  approxEqual(scaledUp[0].strain, justAboveTwo[0].strain * 10, "strain scales linearly with load at fixed monotony");

  // ── Trailing partial week: still computed over however many days exist ────
  const partial = computeWeeklyMonotonyStrain(
    [row("2026-08-03", 100), row("2026-08-04", 300)],
    new Date(2026, 7, 3), new Date(2026, 7, 4), // a 2-day window, not a full week
  );
  assert.equal(partial.length, 1);
  assert.equal(partial[0].isPartial, true, "shorter than 7 days is flagged partial");
  approxEqual(partial[0].meanDailyLoad, 200, "mean over just the 2 days present");

  console.log("Monotony/strain checks passed.");
} finally {
  await vite.close();
}
