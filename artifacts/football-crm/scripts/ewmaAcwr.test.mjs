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

// 2026-08-01 + n days, as an ISO date string.
function dayN(n) {
  const d = new Date(2026, 7, 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function approxEqual(actual, expected, msg, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg} (got ${actual}, expected ${expected})`);
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { computeEwmaAcwr } = report;

  // ── No data at all ──────────────────────────────────────────────────────
  const noData = computeEwmaAcwr([], new Date(2026, 7, 28));
  assert.equal(noData.ewmaAcwr, null);
  assert.equal(noData.hasBaseline, false);
  assert.equal(noData.historyDays, 0);

  // ── First logged day is after the anchor — same as no data yet ────────────
  const futureOnly = computeEwmaAcwr([row("2026-09-01", 500)], new Date(2026, 7, 28));
  assert.equal(futureOnly.ewmaAcwr, null);
  assert.equal(futureOnly.historyDays, 0);

  // ── Fewer than 28 days of history: no chronic seed yet, ratio stays null ──
  const tenDays = Array.from({ length: 10 }, (_, i) => row(dayN(i), 100));
  const shortHistory = computeEwmaAcwr(tenDays, new Date(2026, 7, 10)); // day index 9 = 10th day
  assert.equal(shortHistory.historyDays, 10);
  assert.equal(shortHistory.hasBaseline, false);
  assert.equal(shortHistory.ewmaChronic, 0, "chronic has no value at all before the 28-day seed window closes");
  assert.equal(shortHistory.ewmaAcwr, null);
  assert.ok(shortHistory.ewmaAcute > 0, "acute still tracks from day one, independent of chronic's seed");

  // ── Exactly 28 days, constant load: both EWMAs settle at that constant ────
  // A constant series is a fixed point of exponential smoothing (x*λ + x*(1-λ) = x),
  // so acute stays 100 throughout, and the chronic seed (a plain mean) is also 100.
  const constant28 = Array.from({ length: 28 }, (_, i) => row(dayN(i), 100));
  const anchorDay28 = new Date(2026, 7, 1 + 27); // the 28th day (index 27)
  const flat = computeEwmaAcwr(constant28, anchorDay28);
  assert.equal(flat.historyDays, 28);
  assert.equal(flat.hasBaseline, true);
  approxEqual(flat.ewmaAcute, 100, "constant series is a fixed point for acute");
  approxEqual(flat.ewmaChronic, 100, "plain mean of 28 identical values is that same value");
  approxEqual(flat.ewmaAcwr, 1.0, "acute == chronic on a perfectly flat history");

  // ── The chronic seed is a genuine plain average, not recency-weighted ─────
  // 27 zero days then one 2800 day still averages to 100 — same seed value as
  // the constant-100 case above, even though the shape is completely different.
  // This is what distinguishes "seed with the first 28-day average" from
  // seeding the recursive formula at day 1 and letting it converge slowly.
  const spikyAtEnd = [...Array.from({ length: 27 }, (_, i) => row(dayN(i), 0)), row(dayN(27), 2800)];
  const spiky = computeEwmaAcwr(spikyAtEnd, anchorDay28);
  approxEqual(spiky.ewmaChronic, 100, "same 28-day average as the flat case, despite a totally different shape");
  // Acute has no special seeding: it's zero for 27 days, then reacts hard to
  // the single 2800 day: 2800*0.25 + 0*0.75 = 700.
  approxEqual(spiky.ewmaAcute, 700, "acute's naive day-1 seed lets it react immediately, unlike chronic");
  approxEqual(spiky.ewmaAcwr, 700 / 100, "acute has already spiked while chronic (just seeded) has not yet");

  // ── Day 29: chronic starts recursing forward from its day-28 seed ─────────
  // First 28 days constant at 100 (chronic seed = 100), day 29 jumps to 800.
  const day29Rows = [...constant28, row(dayN(28), 800)];
  const anchorDay29 = new Date(2026, 7, 1 + 28);
  const day29 = computeEwmaAcwr(day29Rows, anchorDay29);
  assert.equal(day29.historyDays, 29);
  const lambdaChronic = 2 / 29;
  const lambdaAcute = 2 / 8;
  const expectedChronic = 800 * lambdaChronic + 100 * (1 - lambdaChronic);
  const expectedAcute = 800 * lambdaAcute + 100 * (1 - lambdaAcute); // acute was steady at 100 through day 28
  approxEqual(day29.ewmaChronic, expectedChronic, "one recursive step past the seed");
  approxEqual(day29.ewmaAcute, expectedAcute, "acute's fast decay reacts more to the same jump");
  approxEqual(day29.ewmaAcwr, expectedAcute / expectedChronic, "acute reacts faster than chronic to the same spike — ratio rises above 1");
  assert.ok(day29.ewmaAcwr > 1, "a jump right after a flat baseline should read as a rise, not a fall");

  console.log("EWMA ACWR checks passed.");
} finally {
  await vite.close();
}
