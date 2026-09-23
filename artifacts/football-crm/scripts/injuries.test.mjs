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

function stage(stage, effective_on) {
  return { id: `${stage}-${effective_on}`, injury_id: "i", stage, effective_on, created_at: effective_on };
}

function injury(overrides) {
  return {
    id: "i", player_id: "p", occurred_on: "2026-09-06", category: "injury", body_area: "Knee",
    side: "left", context: "match", mechanism: "contact", onset: "acute", recurrence_of: null,
    expected_return_on: null, reviewed_on: null, session_id: null, match_id: null, notes: null,
    migrated: false, created_at: "2026-09-06", current_stage: "out", status: "open",
    returned_on: null, days_lost: null, ...overrides,
  };
}

try {
  const inj = await vite.ssrLoadModule("/src/lib/injuries.ts");

  // ── Severity: Fuller et al. 2006 ──────────────────────────────────────────
  const cases = [[0, "slight"], [1, "minimal"], [3, "minimal"], [4, "mild"], [7, "mild"],
    [8, "moderate"], [28, "moderate"], [29, "severe"], [270, "severe"]];
  for (const [days, want] of cases) {
    assert.equal(inj.severityFor(days), want, `${days} days lost is ${want}`);
  }

  assert.equal(inj.daysBetween("2026-08-01", "2026-08-09"), 8);
  assert.equal(inj.daysBetween("2026-02-27", "2026-03-02"), 3, "crosses a month end");
  assert.equal(inj.daysBetween("2026-10-24", "2026-10-26"), 2, "DST-free: counted on UTC dates");

  assert.equal(
    inj.describeSeverity(injury({ status: "resolved", days_lost: 8 }), "2026-09-23"),
    "Moderate · 8 days lost",
  );
  assert.equal(
    inj.describeSeverity(injury({ status: "resolved", days_lost: 0, migrated: true }), "2026-09-23"),
    "Slight (approx.) · 0 days lost",
    "a migrated injury's dates are inferred, and it says so",
  );
  assert.equal(
    inj.describeSeverity(injury({ occurred_on: "2026-09-06" }), "2026-09-23"),
    "At least moderate · 17 days so far",
    "an open injury only has a floor",
  );

  // ── Stage history ─────────────────────────────────────────────────────────
  const history = [stage("modified", "2026-09-09"), stage("out", "2026-09-06")];
  assert.equal(inj.currentStage(history), "modified", "latest by date, whatever the array order");
  assert.equal(inj.currentStage([]), null);
  assert.equal(inj.returnedOn(history), null);
  assert.equal(inj.returnedOn([...history, stage("match_fit", "2026-09-20")]), "2026-09-20");

  assert.equal(inj.stageInsertProblem("2026-09-06", history, "2026-09-12"), null);
  assert.match(inj.stageInsertProblem("2026-09-06", history, "2026-09-01"), /before the injury/);
  assert.match(inj.stageInsertProblem("2026-09-06", history, "2026-09-09"), /after the latest/,
    "one stage per day — same date as the latest is refused");
  assert.match(
    inj.stageInsertProblem("2026-09-06", [...history, stage("match_fit", "2026-09-20")], "2026-09-25"),
    /undo that stage/,
    "match fit is final until undone",
  );

  // ── Undo ──────────────────────────────────────────────────────────────────
  const fit = [...history, stage("match_fit", "2026-09-20")];
  assert.equal(inj.undoProblem(fit, false), null, "a mistaken match fit can be undone");
  assert.match(inj.undoProblem(fit, true), /recurrence/, "not when a recurrence depends on it");
  assert.match(inj.undoProblem([stage("out", "2026-09-06")], false), /at least one stage/);
  assert.equal(inj.undoProblem(history, true), null, "the recurrence rule only guards match fit");

  // ── Recurrence ────────────────────────────────────────────────────────────
  const backAug = injury({ id: "a", body_area: "Back", side: "n/a", occurred_on: "2026-08-30",
    status: "resolved", returned_on: "2026-08-30", days_lost: 0 });
  const backOpen = injury({ id: "b", body_area: "Back", side: "n/a", occurred_on: "2026-09-12" });
  const knee = injury({ id: "k", body_area: "Knee", occurred_on: "2026-08-02",
    status: "resolved", returned_on: "2026-08-20", days_lost: 18 });
  const all = [backAug, backOpen, knee];
  assert.deepEqual(inj.recurrenceCandidates(all, "Back", "2026-09-06").map((i) => i.id), ["a"],
    "same area, already over — the open one is a setback, not a candidate");
  assert.deepEqual(inj.recurrenceCandidates(all, "Knee", "2026-08-10").map((i) => i.id), [],
    "not over yet on the new date");
  assert.deepEqual(inj.openInSameArea(all, "Back", "2026-09-20").map((i) => i.id), ["b"]);
  assert.deepEqual(inj.openInSameArea(all, "Back", "2026-09-10").map((i) => i.id), [],
    "an injury that began after the new date can't be what this is a setback on");

  // ── Labels ────────────────────────────────────────────────────────────────
  assert.equal(inj.injuryLabel({ category: "injury", body_area: "Knee", side: "left" }), "Knee (left)");
  assert.equal(inj.injuryLabel({ category: "injury", body_area: "Back", side: "n/a" }), "Back");
  assert.equal(inj.injuryLabel({ category: "injury", body_area: null, side: null }), "Unspecified");
  assert.equal(inj.injuryLabel({ category: "illness", body_area: null, side: null }), "Illness");

  // ── Drafts ────────────────────────────────────────────────────────────────
  const draft = { ...inj.emptyInjuryDraft("match"), body_area: "Knee" };
  assert.deepEqual(Object.keys(inj.injuryDraftProblems(draft, "2026-09-06")).sort(),
    ["mechanism", "onset", "side"], "a knee needs a side; every injury needs mechanism and onset");
  const back = { ...inj.emptyInjuryDraft("match"), body_area: "Back", mechanism: "non_contact", onset: "acute" };
  assert.deepEqual(inj.injuryDraftProblems(back, "2026-09-06"), {}, "midline areas need no side");
  assert.equal(inj.injuryRowFromDraft(back, { player_id: "p", occurred_on: "2026-09-06" }).side, "n/a");
  assert.ok(inj.injuryDraftProblems({ ...back, mechanism: "contact", onset: "overuse" }, "2026-09-06").mechanism,
    "overuse + contact is refused, as the CHECK constraint does");
  assert.ok(inj.injuryDraftProblems({ ...back, expected_return_on: "2026-09-01" }, "2026-09-06").expected_return_on);

  const illness = { ...inj.emptyInjuryDraft("outside"), category: "illness", body_area: "Knee", side: "left", mechanism: "contact" };
  assert.deepEqual(inj.injuryDraftProblems(illness, "2026-09-06"), {}, "an illness needs only a context");
  const illnessRow = inj.injuryRowFromDraft(illness, { player_id: "p", occurred_on: "2026-09-06" });
  assert.deepEqual([illnessRow.body_area, illnessRow.side, illnessRow.mechanism, illnessRow.onset],
    [null, null, null, null], "leftover anatomy from a switched category is dropped, as the CHECK requires");

  assert.deepEqual(inj.injuryDraftProblems(inj.emptyInjuryDraft(""), "2026-09-06").context !== undefined, true);

  console.log("injuries tests passed");
} finally {
  await vite.close();
}
