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

function dayN(n) {
  const d = new Date(2026, 7, 1 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { computeEwmaAcwrStatus, computeAcwr } = report;

  // ── Same numeric bands as the rolling ratio ────────────────────────────────
  // 28 flat days at 100, then a day-29 jump big enough to push the EWMA ratio
  // past 1.5 (spike) while chronic (still near the pre-jump baseline, well
  // above the floor) doesn't demote it to Low Base.
  const constant28 = Array.from({ length: 28 }, (_, i) => row(dayN(i), 400));
  const spikeRows = [...constant28, row(dayN(28), 3000)];
  const anchorDay29 = new Date(2026, 7, 1 + 28);
  const spikeResult = computeEwmaAcwrStatus(spikeRows, anchorDay29);
  assert.ok(spikeResult.ewmaAcwr > 1.5, "sanity: the constructed jump does push the ratio past 1.5");
  assert.equal(spikeResult.status, "spike", "same >1.5 band as the rolling version");

  // ── Floor: chronic below CHRONIC_LOAD_FLOOR (300/wk) demotes Spike to Low Base ──
  // Low flat baseline (7 AU/day ≈ 49 AU/week, well under the 300 floor), then a
  // single big day — the ratio spikes, but chronic never clears the floor.
  const lowBaseline = Array.from({ length: 28 }, (_, i) => row(dayN(i), 7));
  const lowBaseSpike = [...lowBaseline, row(dayN(28), 500)];
  const lowBaseResult = computeEwmaAcwrStatus(lowBaseSpike, anchorDay29);
  assert.ok(lowBaseResult.ewmaChronic * 7 < 300, "sanity: weekly-equivalent chronic is under the floor");
  assert.equal(lowBaseResult.status, "low_base", "a low chronic baseline demotes Spike to Low Base, same rule as rolling");
  assert.ok(lowBaseResult.ewmaAcwr !== null, "low_base still carries a real ratio value, same as the rolling version");

  // ── Team break: a genuine team-wide gap forces Building, same as rolling ──
  // Reuses the exact fixture shape from workloadRatio.test.mjs's own team-break
  // tests: real, recent load reaching right up to the anchor (so the baseline-
  // window-emptiness check from above can't be what's forcing building here —
  // this isolates the team-break mechanism specifically).
  const teamDatesAfterLongBreak = ["2026-05-01", "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"];
  const rebuildRows = [
    row("2026-07-01", 100), row("2026-07-08", 100), row("2026-07-15", 100), row("2026-07-22", 100),
  ];
  // Mid-rebuild: baselineStart (2026-06-25) still reaches into the break.
  const rollingDuringBreak = computeAcwr(rebuildRows, new Date(2026, 6, 22), 0, teamDatesAfterLongBreak);
  const ewmaDuringBreak = computeEwmaAcwrStatus(rebuildRows, new Date(2026, 6, 22), 0, teamDatesAfterLongBreak);
  assert.equal(rollingDuringBreak.status, "building", "sanity: rolling forces building mid-rebuild");
  assert.equal(ewmaDuringBreak.status, "building", "EWMA forces building under the identical team-break rule");
  assert.equal(ewmaDuringBreak.ewmaAcwr, null, "forcedBuilding nulls the ratio, same as rolling");

  // Fully rebuilt: baselineStart (2026-07-01) now lands exactly on the resume
  // date — both should resume reporting a real status.
  const rollingRebuilt = computeAcwr(rebuildRows, new Date(2026, 6, 28), 0, teamDatesAfterLongBreak);
  const ewmaRebuilt = computeEwmaAcwrStatus(rebuildRows, new Date(2026, 6, 28), 0, teamDatesAfterLongBreak);
  assert.notEqual(rollingRebuilt.status, "building", "sanity: rolling has fully cleared the break here");
  assert.notEqual(ewmaRebuilt.status, "building", "EWMA also clears the break at the identical boundary");

  // No team dates supplied (detection off) must not trigger this on its own —
  // same rows, but with continuous recent load and no gap fixture at all, so
  // there's nothing here for either mechanism to legitimately fire on.
  const noTeamDates = computeEwmaAcwrStatus(rebuildRows, new Date(2026, 6, 28), 0);
  assert.notEqual(noTeamDates.status, "building", "no teamSessionDates supplied and a real recent baseline — nothing should force building");

  // ── Insufficient history: building, same label as rolling's "not enough data" ──
  const fewDays = [row(dayN(0), 400), row(dayN(1), 400)];
  const short = computeEwmaAcwrStatus(fewDays, new Date(2026, 7, 2));
  assert.equal(short.status, "building");
  assert.equal(short.ewmaAcwr, null);

  // ── Real bug caught against live data: a player with a long personal gap
  // after establishing real history must also force Building — not report a
  // decaying-but-real-looking ratio. Real months of training (well over 28
  // days), then total silence for 6+ weeks — rolling forces Building because
  // its 21-day baseline window is empty, even though it has plenty of older
  // history; EWMA's own historyDays/hasBaseline check alone would NOT catch
  // this (total history is still huge), so this needs its own check.
  const longHistory = Array.from({ length: 90 }, (_, i) => row(dayN(i), 300)); // 90 real days
  const anchorSixWeeksLater = new Date(2026, 7, 1 + 89 + 42); // +42 days of total silence
  const goneQuiet = computeEwmaAcwrStatus(longHistory, anchorSixWeeksLater, 300, []);
  assert.equal(goneQuiet.status, "building", "a long personal gap forces building even with a huge total history");
  assert.equal(goneQuiet.ewmaAcwr, null, "the ratio is nulled, not left to report a stale decaying number");
  // Confirm this really would have been the bug without the fix: the raw
  // (unclassified) EWMA numbers are still real, nonzero, decaying values —
  // it's specifically the status/ewmaAcwr override that's needed.
  const rawEwma = report.computeEwmaAcwr(longHistory, anchorSixWeeksLater);
  assert.ok(rawEwma.ewmaAcwr !== null && rawEwma.ewmaAcwr >= 0, "sanity: the raw EWMA function alone doesn't know about this gap");

  // A gap where the 21-day baseline window still contains one real day of
  // load must NOT force building — only a fully empty baseline window should.
  // anchor = day 119: baseline window is [day 92, day 112], which contains
  // the single extra row at day 99 (and excludes the original day 0-89 run).
  const shortGapRows = [...longHistory, row(dayN(99), 300)];
  const shortGapAnchor = new Date(2026, 7, 1 + 119);
  const shortGap = computeEwmaAcwrStatus(shortGapRows, shortGapAnchor, 300, []);
  assert.notEqual(shortGap.status, "building", "a baseline window with at least one real day of load isn't forced to building");

  // ── acute / weekOnWeekPct are untouched — still come from computeAcwr, unchanged ──
  const rollingHere = computeAcwr(spikeRows, anchorDay29);
  assert.ok(!("acute" in spikeResult), "EwmaAcwrStatusResult doesn't duplicate acute — it stays on the rolling result");
  assert.ok(!("weekOnWeekPct" in spikeResult), "same for weekOnWeekPct");
  assert.ok(typeof rollingHere.acute === "number" && typeof rollingHere.weekOnWeekPct !== "undefined",
    "the rolling result callers already use for these two fields is unaffected by the EWMA switch");

  console.log("EWMA ACWR status checks passed.");
} finally {
  await vite.close();
}
