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
      open: "Still out since 2 Aug",
      returned: "Back on a date the coaches give (set `returnedOn`)",
      other: "Knock only; she stopped coming for another reason — match fit 2 Aug",
    },
    // Coaches, 23 Sep: ACL tear, out 8 months, a single injury
    answer: { key: "open", expectedReturn: "2027-04-02", notes: "ACL tear" },
  },
  ibreez: {
    question: "Ibreez — back: 30 Aug, 6 Sep, 12 Sep (+ Injured 16 Sep). One ongoing problem, or separate knocks?",
    options: {
      single: "One back injury from 15 Aug (coaches' date — before any note), played through, out from the 12 Sep substitution",
    },
    // Coaches, 23 Sep: one injury, 15 Aug, back 1 Oct; supersedes the chain of three
    answer: { key: "single", occurred: "2026-08-15", expectedReturn: "2026-10-01" },
  },
  atiriya: {
    // Coaches, 23 Sep: "resolved, she is fine now" — true of both options, so still open
    question: "Atiriya — hand (12 Sep, off at 61', resolved). Were the 16 and 18 Sep absences because of it?",
    options: {
      yes: "Out 12 Sep, match fit 21 Sep (her next session)",
      no: "Played on — match fit 12 Sep",
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
    question: "The six CSV-imported rows — Fatima, Hansika, Isabelle, Reva on 5 Apr; Hansika and Gabrielle on 20 Apr. Injuries, or plain Absent?",
    options: {
      absent: "Plain Absent, no injury",
      injuries: "Unspecified injuries, match fit at each player's next session",
    },
    answer: null,
  },
  mechanism: {
    question: "Contact or non-contact for Zarastyn (knee), Atiriya (hand), Ibreez (back)? (Hiba: contact.)",
    options: {},
    // Partial: Hiba's came with her record. The rest are still with the coaches.
    answer: { hiba: "contact" }, // zarastyn, atiriya, ibreez: "contact" | "non_contact"
  },
  hiba: {
    question: "Hiba — ACL: which knee, and an expected return date? (Her 6 Sep minutes are also blank.)",
    options: {},
    // Entered through the app and corrected to 6 Sep — the migration links to it
    answer: { side: "right", expectedReturn: "2027-03-01" },
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
  all("injuries", "id, player_id, occurred_on, body_area, side, notes, migrated"),
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
  if (z) { base.expectedReturn = z.expectedReturn ?? null; base.notes = z.notes; base.sideNote = "side not given"; }
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

// Ibreez — back: one injury (coaches, 23 Sep), dated before any note. She
// played through it — 35', 15', 69' — so no stage covers that stretch: she
// was available, and a not-fit stage there would badge the lineups she played
// in. Out from the 12 Sep substitution (off at 69', "back"); 16 Sep was the
// next session, so starting at 16 Sep instead would change only the length.
{
  const r30 = statRows("Ibreez", "2026-08-30");
  const r06 = statRows("Ibreez", "2026-09-06");
  const r12 = statRows("Ibreez", "2026-09-12");
  const a16 = attRows("Ibreez", ["2026-09-16"]);
  const src = (rows) => rows.map((r) => `match ${dateOfMatch(r.match_id).slice(5)} "${r.injury_note}" (${r.minutes_played}')`);
  const ans = DECISIONS.ibreez.answer;
  propose("ibreez-back", { player: "Ibreez", area: "Back", side: "n/a", context: null, onset: null, mechanismKey: "ibreez",
    occurred: ans.occurred, expectedReturn: ans.expectedReturn,
    sources: [...src(r30), ...src(r06), ...src(r12), ...a16.map(() => "attendance Injured 16 Sep")],
    stages: [["out", "2026-09-12"]] });
}

// Hiba — ACL, 6 Sep. Already on record (entered through the app, corrected to
// 6 Sep): the migration creates nothing, only links her 6 Sep grid row to it.
{
  const rows = statRows("Hiba", "2026-09-06");
  const h = DECISIONS.hiba.answer;
  propose("hiba-acl", { player: "Hiba", occurred: "2026-09-06", area: "Knee", side: h?.side ?? null, context: "match",
    onset: "acute", mechanismKey: "hiba", notes: "ACL tear", expectedReturn: h?.expectedReturn ?? null,
    sources: rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}' — minutes never entered)`),
    stages: [["out", "2026-09-06"]], linkExisting: true });
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

const LATERAL = new Set(["Shoulder", "Arm/elbow", "Wrist/hand", "Hip/groin", "Hamstring", "Quadriceps", "Knee", "Calf/shin", "Achilles", "Ankle", "Foot/toe"]);
const STAGE_WORD = { out: "Out", modified: "Modified", full_training: "Full" };
const short = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthStart = TODAY.slice(0, 7) + "-01";

function describe(entry, stages) {
  const p = playerByName(entry.player);
  const mech = entry.mechanismKey ? DECISIONS.mechanism.answer?.[entry.mechanismKey] ?? null : null;
  const last = stages[stages.length - 1];
  const open = last[0] !== "match_fit";
  const returned = open ? null : last[1];
  const placeholder = returned?.startsWith("<");
  const n = returned && !placeholder ? days(entry.occurred, returned) : null;
  const lostTxt = n != null
    ? `${band(n)}, ${n} day${n === 1 ? "" : "s"}${entry.linkExisting ? "" : " (approx.)"}`
    : open ? `open — ${days(entry.occurred, TODAY)} days so far${entry.expectedReturn ? `, ${days(entry.occurred, entry.expectedReturn)} at the expected return (${band(days(entry.occurred, entry.expectedReturn))})` : ""}`
    : "severity once the date is given";

  // ── What gets written ──
  const matchRows = entry.sources.filter((x) => x.startsWith("match")).length;
  const attRowsN = entry.sources.filter((x) => x.startsWith("attendance")).length;
  if (entry.linkExisting) line(`      writes: nothing new — the injury is already on record`);
  else line(`      writes: 1 injury (migrated) + ${stages.length} stage${stages.length === 1 ? "" : "s"}: ${stages.map(([st, d]) => `${st} ${d.startsWith("<") ? d : d.slice(5)}`).join(" → ")}`);
  const links = [
    matchRows && `${matchRows} match row${matchRows === 1 ? "" : "s"} linked (injury_id)`,
    attRowsN && `${attRowsN} Injured attendance row${attRowsN === 1 ? "" : "s"} → Absent (no % change)`,
  ].filter(Boolean);
  if (links.length) line(`              ${links.join("; ")}`);
  line(`      length: ${lostTxt}`);

  // ── What the app shows once it's in ──
  const windows = [];
  for (let i = 0; i < stages.length; i++) {
    const [st, from] = stages[i];
    if (st === "match_fit") continue;
    const to = stages[i + 1]?.[1];
    windows.push(`${STAGE_WORD[st]} ${short(from)}–${to ? (to.startsWith("<") ? "?" : short(to)) : "now"}`);
  }
  if (windows.length) {
    line(`      in the app: lineup badge ${windows.join(", ")}; load alerts ${stages.some(([st]) => st === "out") ? "off while out" : "labelled returning"}`);
  } else {
    line(`      in the app: no badge (no time lost)`);
  }
  // The alert names an injury in effect on one of this month's session days, or today
  const inEffect = (d) => stages.some(([st, from], i) => st !== "match_fit" && d >= from
    && (!stages[i + 1] || stages[i + 1][1].startsWith("<") || d < stages[i + 1][1]));
  const noted = [...sessions.filter((x) => x.date >= monthStart && x.date <= TODAY).map((x) => x.date), TODAY].some(inEffect);
  const label = `${entry.area === "Unspecified" ? "unspecified" : entry.area.toLowerCase()}${entry.side && entry.side !== "n/a" ? ` (${entry.side})` : ""}`;
  if (open && noted) line(`                  attendance alert note (if an alert fires): "out with ${label} since ${short(entry.occurred)}"`);
  // An injury with no time lost is never "in effect", so it adds no note
  else if (noted && !placeholder) line(`                  attendance alert note (if an alert fires): "was out with ${label} ${short(entry.occurred)}–${short(returned)}"`);
  if (open) {
    const lastChange = stages[stages.length - 1][1];
    const evidence = firstActivityAfter(p.id, lastChange);
    const prompt = evidence ? `"activity on ${short(evidence)} while ${STAGE_WORD[last[0]].toLowerCase()} — back?"`
      : entry.expectedReturn && entry.expectedReturn > TODAY ? `none until the expected return (${short(entry.expectedReturn)})`
      : entry.expectedReturn ? `"expected back ${short(entry.expectedReturn)} — where do they stand?"`
      : days(lastChange, TODAY) >= 14 ? `"no update for ${days(lastChange, TODAY)} days — still out?" (straight away)`
      : "none yet";
    line(`                  closing prompt: ${prompt}`);
  }

  // ── Still missing ──
  const missing = [];
  if (entry.area !== "Unspecified" && LATERAL.has(entry.area) && !entry.side) missing.push("side");
  if (entry.area !== "Unspecified" && entry.mechanismKey !== undefined && !mech) missing.push("mechanism");
  if (entry.area !== "Unspecified" && !entry.onset) missing.push("onset");
  if (!entry.context) missing.push("context");
  if (entry.area === "Unspecified") missing.push("body area");
  if (missing.length) line(`      missing: ${missing.join(", ")}${entry.linkExisting ? "" : " — saved empty if still unknown at apply"}`);
}

for (const e of plan) {
  const tag = e.variantNote ? `  [${e.variantNote}]` : "";
  line(`• ${e.player} — ${e.area}${e.side && e.side !== "n/a" ? ` (${e.side})` : ""}, ${e.occurred}${e.context ? `, ${e.context}` : ""}${e.onset ? `, ${e.onset}` : ""}${tag}`);
  if (e.notes) line(`      notes: ${e.notes}`);
  if (e.expectedReturn !== undefined) line(`      expected return: ${e.expectedReturn ?? "<from coaches>"}`);
  line(`      from: ${e.sources.join("; ") || "(none)"}`);
  // Entered through the app since injuries went live — converting the legacy
  // row as well would record the same injury twice
  if (!e.linkExisting) {
    const onRecord = existing.filter((i) => !i.migrated && i.player_id === playerByName(e.player).id
      && (e.area === "Unspecified" || i.body_area === e.area));
    for (const i of onRecord) {
      line(`      !! already on record: ${i.body_area ?? "illness"}${i.side && i.side !== "n/a" ? ` (${i.side})` : ""} from ${i.occurred_on}${i.notes ? ` "${i.notes}"` : ""} — likely the same injury; converting would duplicate it`);
    }
  } else {
    const rec = existing.find((i) => !i.migrated && i.player_id === playerByName(e.player).id && i.body_area === e.area && i.occurred_on === e.occurred);
    line(rec ? `      links to: the record entered through the app (${rec.occurred_on}, "${rec.notes}")` : `      !! expected an existing record on ${e.occurred} — none found; an apply must not proceed`);
  }
  if (e.variants) {
    const chosen = pick(DECISIONS[e.decision]);
    for (const [k, v] of Object.entries(e.variants)) {
      if (chosen && chosen !== k) continue;
      line(`    ${chosen ? "→" : "?"} ${k}: ${DECISIONS[e.decision].options[k]}`);
      if (v.stages) describe(e, v.stages);
      else line(`      no injury; the row becomes Absent — it already counts as missed`);
    }
  } else {
    describe(e, e.stages);
  }
  line();
}

line("Also on apply: each legacy Injured attendance row becomes Absent — no attendance % changes, since an");
line("Injured mark already counts as a missed session — and each flagged match row gets injury_id set;");
line("its note is kept.");
line();
const MECHANISM_FOR = ["hiba", "zarastyn", "atiriya", "ibreez"];
const isPending = ([k, d]) => d.answer == null || (k === "mechanism" && MECHANISM_FOR.some((p) => !d.answer[p]));
const pending = Object.entries(DECISIONS).filter(isPending);
line(pending.length ? `Waiting on ${pending.length} decision(s) — no apply until all are answered:` : "All decisions answered.");
for (const [k, d] of pending) line(`  [${k}] ${d.question}`);
