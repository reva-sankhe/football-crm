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

function player(id, name) {
  return {
    id,
    name,
    code: id.toUpperCase(),
    is_active: true,
    primary_position: "Forward",
    age_range: "18-24",
  };
}

const sessions = [
  { id: "first", test_date: "2026-01-01", test_name: "January" },
  { id: "latest", test_date: "2026-02-01", test_name: "February" },
];

function sprintResults(playerId, first, latest) {
  return [
    { id: `${playerId}-first`, player_id: playerId, session_id: "first", ten_m_1: first, mas_ms: null },
    { id: `${playerId}-latest`, player_id: playerId, session_id: "latest", ten_m_1: latest, mas_ms: null },
  ];
}

try {
  const analytics = await vite.ssrLoadModule("/src/lib/fitnessAnalytics.ts");
  const athlete = player("athlete", "Athlete");

  for (const [latest, expectedDelta, expectedGroup] of [
    [1.76, 0.04, "steady"],
    [1.75, 0.05, "steady"],
    [1.74, 0.06, "improved"],
  ]) {
    const lines = analytics.buildFitnessLines(
      [athlete],
      sprintResults(athlete.id, 1.8, latest),
      sessions,
      "10m",
    );
    assert.equal(lines[0].deltaSecs, expectedDelta, `1.80s → ${latest}s preserves hundredths`);
    assert.equal(analytics.formatMetricDelta(expectedDelta, "10m"), `−${expectedDelta.toFixed(2)}s`);
    assert.equal(analytics.movers(lines)[expectedGroup].length, 1, `${expectedDelta}s is ${expectedGroup}`);
  }

  const faster = analytics.buildFitnessLines(
    [player("faster", "Faster")],
    sprintResults("faster", 1.8, 1.75),
    sessions,
    "10m",
  )[0];
  const slower = analytics.buildFitnessLines(
    [player("slower", "Slower")],
    sprintResults("slower", 1.8, 1.8),
    sessions,
    "10m",
  )[0];
  assert.match(
    analytics.interpretCompare([faster, slower], "10m"),
    /0\.05s ahead/,
    "player comparison preserves a hundredth-second sprint gap",
  );

  console.log("Fitness sprint precision checks passed.");
} finally {
  await vite.close();
}