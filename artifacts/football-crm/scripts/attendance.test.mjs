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

function session(id, date, session_type = "Training") {
  return { id, date, day: "Monday", session_type, duration_mins: 90, start_time: null, planned_rpe: 5, planned_load_au: 450, notes: null, created_at: date };
}

try {
  const attendance = await vite.ssrLoadModule("/src/lib/attendance.ts");
  const { playersNeedingAutoPresent, resolveAutoMarked, needsAttendanceFlag } = attendance;
  const dataCompleteness = await vite.ssrLoadModule("/src/lib/dataCompleteness.ts");
  const { computeSessionCompleteness, matchesWithoutLineup } = dataCompleteness;

  // ── playersNeedingAutoPresent ─────────────────────────────────────────────
  assert.deepEqual(
    playersNeedingAutoPresent(["a", "b"], ["a", "b", "c"]),
    ["c"],
    "only the player with no existing row needs an auto-Present row",
  );
  assert.deepEqual(
    playersNeedingAutoPresent([], ["a"]),
    ["a"],
    "no existing rows at all — everyone named needs one",
  );
  assert.deepEqual(
    playersNeedingAutoPresent(["a"], ["a"]),
    [],
    "an existing row, auto or not, is never re-created",
  );
  // The status of an existing row is irrelevant here by construction — the
  // check is "does a row exist for this player at all", never "is it
  // Present". A coach's Absent or Injured call is exactly such a row, so it
  // can never be swept up and turned into Present, whether the trigger is an
  // RPE save or — since bulkUpsertMatchStats calls this same function on
  // every save, not just the first — a lineup being re-saved after the fact.
  assert.deepEqual(
    playersNeedingAutoPresent(["absent-player", "injured-player"], ["absent-player", "injured-player", "new-player"]),
    ["new-player"],
    "an existing Absent or Injured row is left alone; only a player with no row at all gets auto-Present",
  );

  // ── resolveAutoMarked ──────────────────────────────────────────────────────
  assert.equal(
    resolveAutoMarked("p1", new Set(["p1"]), { p1: true }),
    false,
    "a coach touching the player always clears the auto flag, even if it was true",
  );
  assert.equal(
    resolveAutoMarked("p1", new Set(), { p1: true }),
    true,
    "untouched and previously auto — stays auto",
  );
  assert.equal(
    resolveAutoMarked("p1", new Set(), { p1: false }),
    false,
    "untouched and never auto — stays not-auto",
  );
  assert.equal(
    resolveAutoMarked("p1", new Set(), {}),
    false,
    "untouched with no prior record at all defaults to not-auto",
  );

  // ── needsAttendanceFlag ────────────────────────────────────────────────────
  assert.equal(needsAttendanceFlag("Training", false), true, "a Training session with no attendance needs the flag");
  assert.equal(needsAttendanceFlag("Training", true), false, "attendance already taken — no flag");
  assert.equal(needsAttendanceFlag("Match", false), true, "a Match with no attendance needs the flag too");
  assert.equal(needsAttendanceFlag("Lecture", false), false, "Lectures are exempt regardless of attendance");

  // ── computeSessionCompleteness ─────────────────────────────────────────────
  const s1 = session("s1", "2026-05-01"); // fully missing: no attendance, no RPE
  const s2 = session("s2", "2026-05-02"); // attendance taken, everyone has RPE
  const s3 = session("s3", "2026-05-03"); // attendance taken, one attended player missing RPE
  const lecture = session("lecture1", "2026-05-04", "Lecture"); // excluded regardless of gaps

  const rows = computeSessionCompleteness(
    [s1, s2, s3, lecture],
    [
      { session_id: "s2", player_id: "p1", status: "Present" },
      { session_id: "s2", player_id: "p2", status: "Present" },
      { session_id: "s3", player_id: "p1", status: "Present" },
      { session_id: "s3", player_id: "p2", status: "Present" },
      { session_id: "s3", player_id: "p3", status: "Absent" }, // absent — not counted as needing RPE
    ],
    [
      { session_id: "s2", player_id: "p1" },
      { session_id: "s2", player_id: "p2" },
      { session_id: "s3", player_id: "p1" },
    ],
  );

  assert.equal(rows.length, 3, "the Lecture session is excluded entirely");
  assert.ok(!rows.some((r) => r.session.id === "lecture1"), "Lecture never appears in the output");

  const r1 = rows.find((r) => r.session.id === "s1");
  assert.equal(r1.attendanceMissing, true, "s1 has zero attendance rows");
  assert.equal(r1.rpeMissingEntirely, true, "s1 has zero RPE rows");
  assert.equal(r1.rpePartial, false, "partial requires attendance to exist first");

  const r2 = rows.find((r) => r.session.id === "s2");
  assert.equal(r2.attendanceMissing, false);
  assert.equal(r2.rpeMissingEntirely, false);
  assert.equal(r2.rpePartial, false, "everyone who attended has RPE — not partial");

  const r3 = rows.find((r) => r.session.id === "s3");
  assert.equal(r3.attendanceMissing, false);
  assert.equal(r3.rpeMissingEntirely, false, "p1 has RPE, so it's not entirely missing");
  assert.equal(r3.rpePartial, true, "p2 attended but has no RPE");
  assert.deepEqual(r3.missingRpePlayerIds, ["p2"], "only the attended-but-unrated player is named, not the absent one");

  // ── matchesWithoutLineup ────────────────────────────────────────────────────
  const matchSessions = [session("ms1", "2026-06-01", "Match"), session("ms2", "2026-06-02", "Match")];
  const noLineup = matchesWithoutLineup(
    matchSessions,
    [{ id: "m1", session_id: "ms1" }, { id: "m2", session_id: "ms2" }],
    [{ match_id: "m2" }], // only m2 has a lineup row
  );
  assert.equal(noLineup.length, 1, "only the match with zero lineup rows is flagged");
  assert.equal(noLineup[0].matchId, "m1");

  console.log("Attendance completeness checks passed.");
} finally {
  await vite.close();
}
