#!/usr/bin/env node
// Injury migration — DRY RUN. Reads live data, prints what converting the
// legacy injury records would write and what it would change. Writes nothing.
//
// The legacy records are the 13 `session_attendance` rows with status
// Injured and the 8 `match_player_stats` rows flagged `injured` with a note.
// Each becomes (part of) one row in `injuries`, marked `migrated`, with a
// stage history inferred from the data: out from the day it happened, match
// fit at the first sign of activity afterwards (a rated session or match
// minutes), or still open.
//
// The plan is written out by hand below — 21 rows are few enough to review
// one by one, and a heuristic would hide the judgement calls. Every call that
// needs a coach's answer is a named DECISION with its options; the script
// prints the consequence of each option, and uses `answer` once it is filled
// in. Nothing here applies anything: the apply step is written after every
// decision has an answer.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/injuryMigrationDryRun.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const TODAY = new Date().toISOString().slice(0, 10);

// ── Decisions ────────────────────────────────────────────────────────────────
// `answer: null` means waiting on the coaches. Options are keyed; `answer`
// takes a key (and, where noted, extra fields).
const DECISIONS = {
  zarastyn: {
    question: "Zarastyn — knee (2 Aug). Absent from every session since. Is she still out?",
    options: {
      open: "Still out since 2 Aug — every absence since is excused",
      returned: "Back on a date the coaches give (set `returnedOn`) — absences until then excused",
      other: "Knock only; she stopped coming for another reason — match fit 2 Aug, no absences excused",
    },
    answer: null, // e.g. "open", or { key: "returned", returnedOn: "2026-08-20" }
  },
  ibreez: {
    question: "Ibreez — back: 30 Aug, 6 Sep, 12 Sep (+ Injured 16 Sep). One ongoing problem, or separate knocks?",
    options: {
      chain: "Three injuries: 30 Aug and 6 Sep played through (slight), 12 Sep a recurrence she is still out with",
      single: "One injury from 30 Aug, full training while playing through, out from 12 Sep",
    },
    answer: null,
  },
  atiriya: {
    question: "Atiriya — hand (12 Sep, off at 61'). Were the 16 and 18 Sep absences because of it?",
    options: {
      yes: "Out 12 Sep, match fit 21 Sep (her next session) — 16 and 18 Sep excused",
      no: "Played on — match fit 12 Sep, nothing excused",
    },
    answer: null,
  },
  hansika: {
    question: "Hansika — Injured 9 and 11 Sep, absent from every session since. Still out? Body area?",
    options: {
      open: "Still out since 9 Sep (set `bodyArea`)",
      returned: "Back on a date the coaches give (set `returnedOn`, `bodyArea`)",
    },
    answer: null,
  },
  kirti: {
    question: "Kirti — Injured 16 Sep, absent since. Still out? Body area?",
    options: {
      open: "Still out since 16 Sep (set `bodyArea`)",
      returned: "Back on a date the coaches give (set `returnedOn`, `bodyArea`)",
    },
    answer: null,
  },
  april: {
    question: "The six CSV-imported rows (5 and 20 Apr) — the sheet's column meant 'injured/unavailable'. Injuries, or plain Absent?",
    options: {
      absent: "Plain Absent, no injury — they count against April attendance again",
      injuries: "Unspecified injuries, match fit at each player's next session",
    },
    answer: null,
  },
  mechanism: {
    question: "Contact or non-contact for Hiba (ACL), Zarastyn (knee), Atiriya (hand), Ibreez (back)?",
    options: {},
    answer: null, // { hiba: "contact" | "non_contact", zarastyn: …, atiriya: …, ibreez: … }
  },
  hiba: {
    question: "Hiba — ACL: which knee, and an expected return date? (Her 6 Sep minutes are also blank.)",
    options: {},
    answer: null, // { side: "left" | "right", expectedReturn: "2027-06-01" }
  },
};

const pick = (d) => (d.answer == null ? null : typeof d.answer === "string" ? d.answer : d.answer.key);

// ── Data ─────────────────────────────────────────────────────────────────────
async function all(table, select, filter = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(select)).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const [players, sessions, attendance, rpe, stats, matches, existing] = await Promise.all([
  all("players", "id, name"),
  all("sessions", "id, date, session_type"),
  all("session_attendance", "id, session_id, player_id, status, auto_marked"),
  all("session_rpe", "id, session_id, player_id, estimated"),
  all("match_player_stats", "id, match_id, player_id, minutes_played, injured, injury_note, injury_id"),
  all("matches", "id, session_id, stage"),
  all("injuries", "id, player_id, occurred_on, migrated"),
]);

const playerByName = (fragment) => {
  const hits = players.filter((p) => p.name.toLowerCase().includes(fragment.toLowerCase()));
  if (hits.length !== 1) throw new Error(`"${fragment}" matches ${hits.length} players`);
  return hits[0];
};
const sessionById = new Map(sessions.map((s) => [s.id, s]));
const matchById = new Map(matches.map((m) => [m.id, m]));
const dateOfMatch = (matchId) => sessionById.get(matchById.get(matchId)?.session_id)?.date;

const legacyAttendance = attendance.filter((a) => a.status === "Injured");
const legacyStats = stats.filter((s) => s.injured && s.injury_id == null);

/** First date after `after` with a rated session (not a backfill) or match minutes. */
function firstActivityAfter(playerId, after) {
  const dates = [
    ...rpe.filter((r) => r.player_id === playerId && !r.estimated).map((r) => sessionById.get(r.session_id)?.date),
    ...stats.filter((s) => s.player_id === playerId && (s.minutes_played ?? 0) > 0).map((s) => dateOfMatch(s.match_id)),
  ].filter((d) => d && d > after).sort();
  return dates[0] ?? null;
}

/**
 * Absences that `window` would excuse for a player, split into those already
 * excused today (a legacy Injured mark) and those newly excused. Match days
 * count once, however many fixtures they held.
 */
function excusedBy(playerId, from, to) {
  const seen = new Set();
  const newly = [];
  const already = [];
  for (const a of attendance) {
    if (a.player_id !== playerId) continue;
    const s = sessionById.get(a.session_id);
    if (!s || s.date < from || (to && s.date >= to)) continue;
    if (a.status === "Present" || a.status === "Late") continue;
    const key = s.session_type === "Match" ? `M:${s.date}` : s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    (a.status === "Injured" ? already : newly).push(`${s.date.slice(5)} ${s.session_type[0]}`);
  }
  return { newly: newly.sort(), already: already.sort() };
}

// ── Plan ─────────────────────────────────────────────────────────────────────
const plan = [];
const consumedAtt = new Set();
const consumedStats = new Set();

function statRows(name, date) {
  const p = playerByName(name);
  const rows = legacyStats.filter((s) => s.player_id === p.id && dateOfMatch(s.match_id) === date);
  rows.forEach((r) => consumedStats.add(r.id));
  return rows;
}
function attRows(name, dates) {
  const p = playerByName(name);
  const rows = legacyAttendance.filter((a) => a.player_id === p.id && dates.includes(sessionById.get(a.session_id)?.date));
  rows.forEach((r) => consumedAtt.add(r.id));
  return rows;
}

/**
 * One proposed injury. `stages` is [[stage, date], …]; the last entry decides
 * whether it's open. `variants` maps a decision's option → an alternative
 * shape, printed side by side until the decision is answered.
 */
function propose(key, spec) { plan.push({ key, ...spec }); }

const resolvedAt = (name, occurred, fallback = null) => firstActivityAfter(playerByName(name).id, occurred) ?? fallback;

// Zarastyn — knee, two fixtures on 2 Aug (a group game and the final)
{
  const rows = statRows("Zarastyn", "2026-08-02");
  const base = { player: "Zarastyn", occurred: "2026-08-02", area: "Knee", side: null, context: "match", onset: "acute",
    mechanismKey: "zarastyn", sources: rows.map((r) => `match ${matchById.get(r.match_id)?.stage} "${r.injury_note}" (${r.minutes_played}')`) };
  const z = DECISIONS.zarastyn.answer;
  propose("zarastyn", { ...base, decision: "zarastyn", variants: {
    open: { stages: [["out", "2026-08-02"]] },
    returned: { stages: [["out", "2026-08-02"], ["match_fit", z?.returnedOn ?? "<date from coaches>"]] },
    other: { stages: [["match_fit", "2026-08-02"]] },
  } });
}

// Ibreez — hamstring, 1 Aug
{
  const rows = statRows("Ibreez", "2026-08-01");
  propose("ibreez-hamstring", { player: "Ibreez", occurred: "2026-08-01", area: "Hamstring", side: null, context: "match",
    onset: "acute", sources: rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}')`),
    stages: [["out", "2026-08-01"], ["match_fit", resolvedAt("Ibreez", "2026-08-01")]] });
}

// Ibreez — back
{
  const r30 = statRows("Ibreez", "2026-08-30");
  const r06 = statRows("Ibreez", "2026-09-06");
  const r12 = statRows("Ibreez", "2026-09-12");
  const a16 = attRows("Ibreez", ["2026-09-16"]);
  const src = (rows) => rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}')`);
  const back = { player: "Ibreez", area: "Back", side: "n/a", context: "match", mechanismKey: "ibreez" };
  const ans = pick(DECISIONS.ibreez);
  if (ans !== "single") {
    propose("ibreez-back-30aug", { ...back, occurred: "2026-08-30", onset: "acute", sources: src(r30),
      stages: [["match_fit", "2026-08-30"]], decision: ans ? undefined : "ibreez", variantNote: "chain (proposed)" });
    propose("ibreez-back-6sep", { ...back, occurred: "2026-09-06", onset: "acute", recurrenceOf: "ibreez-back-30aug", sources: src(r06),
      stages: [["match_fit", "2026-09-06"]] });
    propose("ibreez-back-12sep", { ...back, occurred: "2026-09-12", onset: "acute", recurrenceOf: "ibreez-back-6sep",
      sources: [...src(r12), ...a16.map(() => "attendance Injured 16 Sep")], stages: [["out", "2026-09-12"]] });
  }
  if (ans !== "chain") {
    propose("ibreez-back-single", { ...back, occurred: "2026-08-30", onset: "overuse",
      sources: [...src(r30), ...src(r06), ...src(r12), ...a16.map(() => "attendance Injured 16 Sep")],
      stages: [["full_training", "2026-08-30"], ["out", "2026-09-12"]], variantNote: "single (alternative)" });
  }
}

// Hiba — ACL, 6 Sep
{
  const rows = statRows("Hiba", "2026-09-06");
  const h = DECISIONS.hiba.answer;
  propose("hiba-acl", { player: "Hiba", occurred: "2026-09-06", area: "Knee", side: h?.side ?? null, context: "match",
    onset: "acute", mechanismKey: "hiba", notes: "ACL tear", expectedReturn: h?.expectedReturn ?? null,
    sources: rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}' — minutes never entered)`),
    stages: [["out", "2026-09-06"]] });
}

// Atiriya — hand, 12 Sep
{
  const rows = statRows("Atiriya", "2026-09-12");
  propose("atiriya-hand", { player: "Atiriya", occurred: "2026-09-12", area: "Wrist/hand", side: null, context: "match",
    onset: "acute", mechanismKey: "atiriya", decision: "atiriya",
    sources: rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}')`),
    variants: {
      yes: { stages: [["out", "2026-09-12"], ["match_fit", resolvedAt("Atiriya", "2026-09-12")]] },
      no: { stages: [["match_fit", "2026-09-12"]] },
    } });
}

// Hansika — 26 Aug (one day), then 9 + 11 Sep
{
  const a26 = attRows("Hansika", ["2026-08-26"]);
  propose("hansika-26aug", { player: "Hansika", occurred: "2026-08-26", area: "Unspecified", side: null, context: "training",
    sources: a26.map(() => "attendance Injured 26 Aug"), stages: [["out", "2026-08-26"], ["match_fit", resolvedAt("Hansika", "2026-08-26")]] });
  const a09 = attRows("Hansika", ["2026-09-09", "2026-09-11"]);
  const h = DECISIONS.hansika.answer;
  propose("hansika-9sep", { player: "Hansika", occurred: "2026-09-09", area: h?.bodyArea ?? "Unspecified", side: null,
    context: "training", decision: "hansika", sources: a09.map((a) => `attendance Injured ${sessionById.get(a.session_id).date.slice(5)}`),
    variants: {
      open: { stages: [["out", "2026-09-09"]] },
      returned: { stages: [["out", "2026-09-09"], ["match_fit", h?.returnedOn ?? "<date from coaches>"]] },
    } });
}

// Kirti — 16 Sep
{
  const a = attRows("Kirti", ["2026-09-16"]);
  const k = DECISIONS.kirti.answer;
  propose("kirti-16sep", { player: "Kirti", occurred: "2026-09-16", area: k?.bodyArea ?? "Unspecified", side: null,
    context: "training", decision: "kirti", sources: a.map(() => "attendance Injured 16 Sep"),
    variants: {
      open: { stages: [["out", "2026-09-16"]] },
      returned: { stages: [["out", "2026-09-16"], ["match_fit", k?.returnedOn ?? "<date from coaches>"]] },
    } });
}

// Single days: Kimberly 30 Aug, Gabrielle 4 Sep
for (const [name, date] of [["Kimberly", "2026-08-30"], ["Gabrielle", "2026-09-04"]]) {
  const a = attRows(name, [date]);
  propose(`${name.toLowerCase()}-${date.slice(5)}`, { player: name, occurred: date, area: "Unspecified", side: null,
    context: "training", sources: a.map(() => `attendance Injured ${date.slice(5)}`),
    stages: [["out", date], ["match_fit", resolvedAt(name, date)]] });
}

// April CSV rows
{
  const april = legacyAttendance.filter((a) => (sessionById.get(a.session_id)?.date ?? "").startsWith("2026-04"));
  april.forEach((a) => consumedAtt.add(a.id));
  for (const a of april) {
    const p = players.find((x) => x.id === a.player_id);
    const date = sessionById.get(a.session_id).date;
    propose(`april-${p.name.split(" ")[0].toLowerCase()}-${date.slice(5)}`, { player: p.name.split(" ")[0], occurred: date,
      area: "Unspecified", side: null, context: null, decision: "april",
      sources: [`attendance Injured ${date.slice(5)} (CSV import)`],
      variants: {
        absent: { stages: null },
        // No activity since at all leaves it open — say so rather than invent a return
        injuries: { stages: resolvedAt(p.name.split(" ")[0], date)
          ? [["out", date], ["match_fit", resolvedAt(p.name.split(" ")[0], date)]]
          : [["out", date]] },
      } });
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const line = (s = "") => console.log(s);
const DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const band = (d) => (d === 0 ? "slight" : d <= 3 ? "minimal" : d <= 7 ? "mild" : d <= 28 ? "moderate" : "severe");

line(`Injury migration — DRY RUN, ${TODAY}. Nothing is written.`);
line(`Legacy records: ${legacyAttendance.length} Injured attendance rows, ${legacyStats.length} flagged match rows.`);
if (existing.some((i) => i.migrated)) line(`!! ${existing.filter((i) => i.migrated).length} migrated injuries already exist — an apply would duplicate them.`);
const unplanned = [
  ...legacyAttendance.filter((a) => !consumedAtt.has(a.id)).map((a) => `attendance ${a.id}`),
  ...legacyStats.filter((s) => !consumedStats.has(s.id)).map((s) => `match row ${s.id}`),
];
line(unplanned.length ? `!! Not covered by the plan: ${unplanned.join(", ")}` : "Every legacy row is covered by the plan.");
line();

function describe(entry, stages) {
  const p = playerByName(entry.player);
  const mech = entry.mechanismKey ? (DECISIONS.mechanism.answer?.[entry.mechanismKey] ?? "<mechanism?>") : null;
  const last = stages[stages.length - 1];
  const open = last[0] !== "match_fit";
  const returned = open ? null : last[1];
  const firstOut = stages.find(([s]) => s === "out" || s === "modified");
  const until = returned && !returned.startsWith("<") ? returned : null;
  const ex = firstOut ? excusedBy(p.id, firstOut[1], until) : { newly: [], already: [] };
  const placeholder = returned?.startsWith("<");
  const n = returned && !placeholder ? days(entry.occurred, returned) : null;
  const lostTxt = n != null
    ? `${band(n)}, ${n} day${n === 1 ? "" : "s"} (approx.)`
    : open ? `open — at least ${band(days(entry.occurred, TODAY))} so far${firstActivityAfter(p.id, entry.occurred) ? "" : ", no activity since"}`
    : "severity once the date is given";
  line(`      stages: ${stages.map(([s, d]) => `${s} ${d.startsWith("<") ? d : d.slice(5)}`).join(" → ")}   [${lostTxt}]`);
  line(`      excuses${placeholder ? " (up to the return date; shown through today)" : ""}: ${ex.newly.length ? ex.newly.join(", ") : "nothing new"}${ex.already.length ? `   (already excused by their Injured mark: ${ex.already.join(", ")})` : ""}`);
  if (mech) line(`      mechanism: ${mech}`);
}

for (const e of plan) {
  const tag = e.variantNote ? `  [${e.variantNote}]` : "";
  line(`• ${e.player} — ${e.area}${e.side ? ` (${e.side})` : ""}, ${e.occurred}${e.context ? `, ${e.context}` : ""}${e.onset ? `, ${e.onset}` : ""}${tag}`);
  if (e.recurrenceOf) line(`      recurrence of: ${e.recurrenceOf}`);
  if (e.notes) line(`      notes: ${e.notes}`);
  if (e.expectedReturn !== undefined) line(`      expected return: ${e.expectedReturn ?? "<from coaches>"}`);
  line(`      from: ${e.sources.join("; ") || "(none)"}`);
  if (e.variants) {
    const chosen = pick(DECISIONS[e.decision]);
    for (const [k, v] of Object.entries(e.variants)) {
      if (chosen && chosen !== k) continue;
      line(`    ${chosen ? "→" : "?"} ${k}: ${DECISIONS[e.decision].options[k]}`);
      if (v.stages) describe(e, v.stages);
      else line(`      no injury; the row becomes Absent and counts against attendance`);
    }
  } else {
    describe(e, e.stages);
  }
  line();
}

line("Also on apply: each legacy Injured attendance row becomes Absent (its injury is what excuses it now),");
line("and each flagged match row gets injury_id set; its note is kept.");
line();
const pending = Object.entries(DECISIONS).filter(([, d]) => d.answer == null);
line(pending.length ? `Waiting on ${pending.length} decision(s) — no apply until all are answered:` : "All decisions answered.");
for (const [k, d] of pending) line(`  [${k}] ${d.question}`);
