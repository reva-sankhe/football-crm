import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true } });

function isoOfLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

try {
  const report = await vite.ssrLoadModule("/src/lib/report.ts");
  const { pinnedWeeklyAnchor } = report;

  // 2026-09-14 is a Monday, 2026-09-13 the Sunday before it.
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 14))), "2026-09-13", "Monday snaps to yesterday's Sunday");
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 15))), "2026-09-13", "Tuesday snaps to the same Sunday as Monday");
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 16))), "2026-09-13", "Wednesday, same Sunday");
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 19))), "2026-09-13", "Saturday, still the same Sunday — the whole week reads identically");
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 20))), "2026-09-20", "Sunday itself snaps to today, not last week");

  // Every day within one calendar week (Mon–Sun) must resolve to the exact
  // same anchor — this is the whole point: stable all week, one shared value.
  const mondayAnchor = isoOfLocal(pinnedWeeklyAnchor(new Date(2026, 8, 14)));
  for (let i = 0; i < 6; i++) {
    const d = new Date(2026, 8, 14 + i);
    assert.equal(isoOfLocal(pinnedWeeklyAnchor(d)), mondayAnchor, `day ${i} after that Monday still pins to ${mondayAnchor}`);
  }

  // Time-of-day is irrelevant — only the calendar date matters.
  const withTime = new Date(2026, 8, 16, 23, 59, 59);
  assert.equal(isoOfLocal(pinnedWeeklyAnchor(withTime)), "2026-09-13", "time-of-day is stripped, same as any other Wednesday");

  // Default argument uses the real current date — just confirm it runs and
  // returns a Sunday (getDay() === 0) without a supplied argument.
  const defaulted = pinnedWeeklyAnchor();
  assert.equal(defaulted.getDay(), 0, "the result is always a Sunday");

  console.log("Pinned weekly anchor checks passed.");
} finally {
  await vite.close();
}
