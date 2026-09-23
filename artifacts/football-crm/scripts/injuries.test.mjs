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

  // Days lost run from withdrawing (the first stage before match fit), not occurred_on
  const outFit = (out, fit) => [stage("out", out), ...(fit ? [stage("match_fit", fit)] : [])];
  assert.equal(
    inj.describeSeverity(injury({ occurred_on: "2026-08-01", status: "resolved", returned_on: "2026-08-09" }), outFit("2026-08-01", "2026-08-09"), "2026-09-23"),
    "Moderate · 8 days lost",
  );
  assert.equal(
    inj.describeSeverity(injury({ occurred_on: "2026-09-12", status: "resolved", returned_on: "2026-09-12", migrated: true }),
      [stage("match_fit", "2026-09-12")], "2026-09-23"),
    "Slight (approx.) · 0 days lost",
    "played on (Atiriya's hand): no withdrawal, no days lost — and a migrated injury says it's approximate",
  );
  assert.equal(
    inj.describeSeverity(injury({ occurred_on: "2026-09-06" }), outFit("2026-09-06"), "2026-09-23"),
    "At least moderate · 17 days so far",
    "out on the day of the injury (Hiba, Zarastyn): identical to counting from occurred_on",
  );
  // Ibreez: back from 15 Aug, played through, out from the 12 Sep substitution, back 1 Oct
  const ibreez = injury({ occurred_on: "2026-08-15", body_area: "Back", side: "n/a" });
  assert.equal(inj.withdrewOn(outFit("2026-09-12")), "2026-09-12");
  assert.equal(inj.daysLost(ibreez, outFit("2026-09-12"), "2026-09-23"), 11, "open: withdrawal to today");
  assert.equal(inj.daysLost({ ...ibreez, returned_on: "2026-10-01" }, outFit("2026-09-12", "2026-10-01"), "2026-10-05"), 19,
    "19 days out — moderate, not the 47 counted from 15 Aug");
  assert.equal(inj.severityFor(19), "moderate");
  assert.equal(inj.withdrewOn([stage("match_fit", "2026-09-12")]), null, "played on: never withdrew");
  assert.equal(inj.withdrewOn([stage("modified", "2026-09-03"), stage("match_fit", "2026-09-10")]), "2026-09-03",
    "an injury that starts at modified training is already time-loss");

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
  assert.deepEqual(inj.openInSameArea(all, "Knee", "2026-08-10").map((i) => i.id), ["k"],
    "healed since, but open on the new date — still a possible setback");

  // ── Open on a date, not today ─────────────────────────────────────────────
  // What a past session or match offers as "still out with" / "same as"
  assert.equal(inj.openOn(knee, "2026-08-10"), true, "open then, though resolved now");
  assert.equal(inj.openOn(knee, "2026-08-20"), false, "match fit that day");
  assert.equal(inj.openOn(knee, "2026-08-01"), false, "hadn't happened yet");
  assert.equal(inj.openOn(backOpen, "2026-09-06"), false, "an open injury from after the date");
  assert.equal(inj.openOn(backOpen, "2026-09-12"), true, "open from the day it occurred");

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

  // ── Editing an existing injury ────────────────────────────────────────────
  // Only what the database refuses blocks an edit; unknowns may stay empty
  const migratedKnee = injury({ occurred_on: "2026-08-02", side: null, mechanism: null, context: "match", migrated: true });
  const kneeStages = [stage("out", "2026-08-02")];
  const d0 = inj.draftFromInjury(migratedKnee);
  assert.equal(d0.mechanism, "", "a missing mechanism comes through as empty");
  assert.deepEqual(inj.injuryEditProblems({ ...d0, notes: "ACL tear" }, "2026-08-02", kneeStages, "2026-09-23"), {},
    "notes can be edited while mechanism and side are still unknown");
  assert.ok(inj.injuryEditProblems(d0, "2026-08-03", kneeStages, "2026-09-23").occurred_on,
    "the injury date can't move after its first stage (the trigger refuses it too)");
  assert.deepEqual(inj.injuryEditProblems(d0, "2026-08-01", kneeStages, "2026-09-23"), {}, "earlier is fine");
  assert.ok(inj.injuryEditProblems(d0, "2026-09-24", [], "2026-09-23").occurred_on, "not in the future");
  assert.ok(inj.injuryEditProblems({ ...d0, onset: "overuse", mechanism: "contact" }, "2026-08-02", kneeStages, "2026-09-23").mechanism);
  assert.ok(inj.injuryEditProblems({ ...d0, body_area: "" }, "2026-08-02", kneeStages, "2026-09-23").body_area);
  assert.ok(inj.injuryEditProblems({ ...d0, expected_return_on: "2026-07-01" }, "2026-08-02", kneeStages, "2026-09-23").expected_return_on);
  const asIllness = inj.injuryRowFromDraft({ ...d0, category: "illness" }, { player_id: "p", occurred_on: "2026-08-02" });
  assert.deepEqual([asIllness.body_area, asIllness.side, asIllness.mechanism, asIllness.onset], [null, null, null, null],
    "switching to illness clears the anatomy, as the CHECK requires");

  // ── Availability ──────────────────────────────────────────────────────────
  // Hiba-shaped: ACL on 6 Sep, out, modified from 1 Oct. Plus an old hamstring
  // that ended on 9 Aug, and an illness on 10 Sep, full training from the 12th.
  const acl = injury({ id: "acl", player_id: "hiba", occurred_on: "2026-09-06" });
  const ham = injury({ id: "ham", player_id: "hiba", body_area: "Hamstring", occurred_on: "2026-08-01",
    status: "resolved", returned_on: "2026-08-09", days_lost: 8 });
  const flu = injury({ id: "flu", player_id: "kirti", category: "illness", body_area: null, side: null,
    occurred_on: "2026-09-10" });
  const stages = [
    { ...stage("out", "2026-09-06"), injury_id: "acl" },
    { ...stage("modified", "2026-10-01"), injury_id: "acl" },
    { ...stage("out", "2026-08-01"), injury_id: "ham" },
    { ...stage("match_fit", "2026-08-09"), injury_id: "ham" },
    { ...stage("out", "2026-09-10"), injury_id: "flu" },
    { ...stage("full_training", "2026-09-12"), injury_id: "flu" },
  ];
  const av = inj.buildAvailability([acl, ham, flu], stages);
  assert.equal(av.on("hiba", "2026-09-05"), null, "nothing before the ACL");
  assert.equal(av.on("hiba", "2026-09-06").stage, "out", "out from the day it happened");
  assert.equal(av.on("hiba", "2026-10-02").stage, "modified");
  assert.equal(av.on("hiba", "2026-08-05").stage, "out", "resolved injuries still answer for their own dates");
  assert.equal(av.on("hiba", "2026-08-09"), null, "match fit is available");
  assert.equal(av.on("kirti", "2026-09-12").stage, "full_training");
  assert.deepEqual([...av.unavailableOn("2026-09-11").keys()].sort(), ["hiba", "kirti"]);
  assert.equal(inj.availabilityLabel(av.on("hiba", "2026-09-10")), "Out · Knee (left)");

  const overlap = inj.buildAvailability(
    [acl, injury({ id: "ank", player_id: "hiba", body_area: "Ankle", occurred_on: "2026-09-20" })],
    [{ ...stage("out", "2026-09-06"), injury_id: "acl" }, { ...stage("modified", "2026-09-15"), injury_id: "acl" },
     { ...stage("out", "2026-09-20"), injury_id: "ank" }],
  );
  assert.equal(overlap.on("hiba", "2026-09-21").stage, "out", "two injuries: the worst stage wins");
  assert.deepEqual(overlap.on("hiba", "2026-09-21").injuries.map((i) => i.id), ["ank", "acl"]);

  // ── Attendance is never adjusted for injury ───────────────────────────────
  // Injured players are expected to come and sit out: an absence while out
  // counts like any other, and a legacy Injured mark counts as missed
  const att = await vite.ssrLoadModule("/src/lib/attendance.ts");
  assert.equal(att.isExcusedAbsence, undefined, "no excused-absence rule");
  assert.equal(att.countsAsAttended("Injured"), false, "a legacy Injured mark is a missed session");
  const msess = (id, date) => ({ id, date, day: "", session_type: "Match", duration_mins: 70, start_time: null,
    planned_rpe: 0, planned_load_au: 0, notes: null, created_at: date });
  const md = att.matchDayAttendance(
    [msess("a", "2026-09-06"), msess("b", "2026-09-12"), msess("c", "2026-09-12"), msess("d", "2026-08-30")],
    (id) => id === "d",
  );
  assert.deepEqual([md.days, md.daysAttended, md.total, md.attended, md.pct], [3, 1, 4, 1, 33],
    "every match day counts, injured or not");

  // ── The injury beside an attendance alert ─────────────────────────────────
  const zKnee = injury({ id: "zk", player_id: "z", body_area: "Knee", side: "right", occurred_on: "2026-08-02" });
  assert.equal(inj.injuryAttendanceNote([zKnee], "2026-09-01", "2026-09-23"), "out with knee (right) since 2 Aug");
  const zMod = { ...zKnee, current_stage: "modified" };
  assert.equal(inj.injuryAttendanceNote([zMod], "2026-09-01", "2026-09-23"), "on modified training with knee (right) since 2 Aug");
  const healed = injury({ id: "h", body_area: "Ankle", side: "left", occurred_on: "2026-09-01",
    status: "resolved", current_stage: "match_fit", returned_on: "2026-09-15", days_lost: 14 });
  assert.equal(inj.injuryAttendanceNote([healed], "2026-09-01", "2026-09-23"), "was out with ankle (left) 1 Sept–15 Sept");
  const august = { ...healed, occurred_on: "2026-08-01", returned_on: "2026-08-20" };
  assert.equal(inj.injuryAttendanceNote([august], "2026-09-01", "2026-09-23"), "", "over before the month began");
  const ill = injury({ id: "i", category: "illness", body_area: null, side: null, mechanism: null, onset: null, occurred_on: "2026-09-18" });
  assert.equal(inj.injuryAttendanceNote([zKnee, ill], "2026-09-01", "2026-09-23"),
    "out with knee (right) since 2 Aug; out with illness since 18 Sept");
  const ibBack = injury({ id: "ib", body_area: "Back", side: "n/a", occurred_on: "2026-08-15" });
  assert.equal(inj.injuryAttendanceNote([ibBack], "2026-09-01", "2026-09-23", () => "2026-09-12"),
    "out with back since 12 Sept", "out since the day it stopped her, not the day it started");

  // ── Closing prompts ───────────────────────────────────────────────────────
  const openBack = injury({ id: "bk", body_area: "Back", side: "n/a", occurred_on: "2026-09-12" });
  const outOnly = [{ ...stage("out", "2026-09-12"), injury_id: "bk" }];
  const none = { ratedDates: [], played: [] };
  const today = "2026-09-23";

  let p = inj.closingPrompt(openBack, outOnly, { ratedDates: ["2026-09-18"], played: [{ date: "2026-09-20", minutes: 45 }] }, today);
  assert.equal(p.kind, "played", "minutes in a match outrank a rated session");
  assert.deepEqual([p.suggestStage, p.suggestDate], ["match_fit", "2026-09-20"]);

  p = inj.closingPrompt(openBack, outOnly, { ratedDates: ["2026-09-10", "2026-09-18", "2026-09-21"], played: [{ date: "2026-09-19", minutes: 0 }] }, today);
  assert.equal(p.kind, "trained", "a 0-minute appearance is not evidence");
  assert.deepEqual([p.suggestStage, p.suggestDate], ["modified", "2026-09-18"], "the first rating after the injury, not before it");

  const modified = [...outOnly, { ...stage("modified", "2026-09-19"), injury_id: "bk" }];
  assert.equal(inj.closingPrompt(openBack, modified, { ratedDates: ["2026-09-21"], played: [] }, today), null,
    "training while on modified training is expected — no prompt");
  assert.equal(inj.closingPrompt(openBack, modified, { ratedDates: [], played: [{ date: "2026-09-18", minutes: 70 }] }, today), null,
    "evidence before the latest stage change was already answered");

  assert.equal(inj.closingPrompt(openBack, outOnly, none, today), null, "11 days: not stale yet");
  p = inj.closingPrompt(openBack, outOnly, none, "2026-09-26");
  assert.equal(p.kind, "stale");
  assert.deepEqual([p.suggestStage, p.suggestDate], ["modified", "2026-09-26"]);
  assert.equal(inj.closingPrompt({ ...openBack, reviewed_on: "2026-09-24" }, outOnly, none, "2026-09-26"), null,
    "a 'still out' answer resets the fortnight");

  const aclLong = injury({ id: "acl", occurred_on: "2026-09-06", expected_return_on: "2027-06-01" });
  const aclStages = [{ ...stage("out", "2026-09-06"), injury_id: "acl" }];
  assert.equal(inj.closingPrompt(aclLong, aclStages, none, "2026-12-01"), null,
    "an expected return still ahead suppresses the stale prompt — the ACL doesn't nag");
  p = inj.closingPrompt(aclLong, aclStages, none, "2027-06-02");
  assert.equal(p.kind, "expected");
  assert.equal(inj.closingPrompt({ ...aclLong, reviewed_on: "2027-06-02" }, aclStages, none, "2027-06-03"), null,
    "answered after the expected date passed");

  const done = injury({ id: "bk", status: "resolved", returned_on: "2026-09-20" });
  assert.equal(inj.closingPrompt(done, [...outOnly, { ...stage("match_fit", "2026-09-20"), injury_id: "bk" }], none, today), null);

  const listed = inj.closingPrompts([openBack, aclLong, done], [...outOnly, ...aclStages], () => none, "2026-09-26");
  assert.deepEqual(listed.map((x) => x.injury.id), ["bk"],
    "only open injuries with something to ask: the stale back, not the ACL with a return date ahead");

  console.log("injuries tests passed");
} finally {
  await vite.close();
}
