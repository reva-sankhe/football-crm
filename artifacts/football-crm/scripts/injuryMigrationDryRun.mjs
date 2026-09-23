#!/usr/bin/env node
// Injury migration — DRY RUN. Reads live data, prints what converting the
// legacy injury records would write and what it would change. Writes nothing.
//
// Only four injuries are migrated, the ones the coaches answered for:
// Zarastyn, Hiba, Ibreez (back) and Atiriya. Every other legacy record — the
// Injured attendance marks and Ibreez's 1 Aug hamstring note — is left exactly
// as it is: nobody needs those logged, and an Injured mark already counts as a
// missed session, so leaving it changes no figure.
//
// The plan is written out by hand below, and a heuristic would hide the
// judgement calls. Every call that
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
    question: "Atiriya — hand (12 Sep, off at 61', resolved). Were the 16 and 18 Sep absences because of it?",
    options: {
      yes: "Out 12 Sep, match fit 21 Sep (her next session)",
      no: "Played on — match fit 12 Sep",
    },
    // Coaches, 23 Sep: it didn't keep her out; 16 and 18 Sep were unrelated
    answer: "no",
  },
  mechanism: {
    question: "Contact or non-contact for Zarastyn (knee), Atiriya (hand), Ibreez (back)? (Hiba: contact.)",
    options: {},
    // Partial: Hiba's came with her record. The rest are saved empty and filled
    // in later through the app — the migration doesn't wait for them.
    answer: { hiba: "contact" }, // zarastyn, atiriya, ibreez: "contact" | "non_contact"
    optional: true,
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
  // Two fixtures that day: which one isn't known, so no match link — the session if they share one
  const sessionsOf = [...new Set(rows.map((r) => matchById.get(r.match_id)?.session_id))];
  Object.assign(base, { statIds: rows.map((r) => r.id), attIds: [], sessionId: sessionsOf.length === 1 ? sessionsOf[0] : null, matchId: null });
  propose("zarastyn", { ...base, decision: "zarastyn", variants: {
    open: { stages: [["out", "2026-08-02"]] },
    returned: { stages: [["out", "2026-08-02"], ["match_fit", z?.returnedOn ?? "<date from coaches>"]] },
    other: { stages: [["match_fit", "2026-08-02"]] },
  } });
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
    notes: "Played through: 30 Aug (35'), 6 Sep (15'), 12 Sep (69', subbed off). Out from 12 Sep.",
    statIds: [...r30, ...r06, ...r12].map((r) => r.id), attIds: a16.map((a) => a.id), sessionId: null, matchId: null,
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
    stages: [["out", "2026-09-06"]], linkExisting: true, statIds: rows.map((r) => r.id), attIds: [] });
}

// Atiriya — hand, 12 Sep
{
  const rows = statRows("Atiriya", "2026-09-12");
  propose("atiriya-hand", { player: "Atiriya", occurred: "2026-09-12", area: "Wrist/hand", side: null, context: "match",
    onset: "acute", mechanismKey: "atiriya", decision: "atiriya",
    statIds: rows.map((r) => r.id), attIds: [],
    matchId: rows.length === 1 ? rows[0].match_id : null,
    sessionId: rows.length === 1 ? matchById.get(rows[0].match_id)?.session_id ?? null : null,
    sources: rows.map((r) => `match "${r.injury_note}" (${r.minutes_played}')`),
    variants: {
      yes: { stages: [["out", "2026-09-12"], ["match_fit", resolvedAt("Atiriya", "2026-09-12")]] },
      no: { stages: [["match_fit", "2026-09-12"]] },
    } });
}

// ── Report ───────────────────────────────────────────────────────────────────
const line = (s = "") => console.log(s);
const DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const band = (d) => (d === 0 ? "slight" : d <= 3 ? "minimal" : d <= 7 ? "mild" : d <= 28 ? "moderate" : "severe");

const APPLY = process.argv.includes("--apply");
line(`Injury migration — ${APPLY ? "APPLY" : "DRY RUN"}, ${TODAY}.${APPLY ? "" : " Nothing is written."}`);
line(`Legacy records: ${legacyAttendance.length} Injured attendance rows, ${legacyStats.length} flagged match rows.`);
if (existing.some((i) => i.migrated)) line(`!! ${existing.filter((i) => i.migrated).length} migrated injuries already exist — an apply would duplicate them.`);
const unplanned = [
  ...legacyAttendance.filter((a) => !consumedAtt.has(a.id)).map((a) => `attendance ${a.id}`),
  ...legacyStats.filter((s) => !consumedStats.has(s.id)).map((s) => `match row ${s.id}`),
];
// Deliberately out of scope — listed so it's plain what an apply leaves alone
const describeLeft = [
  ...legacyAttendance.filter((a) => !consumedAtt.has(a.id)).map((a) => {
    const p = players.find((x) => x.id === a.player_id); const d = sessionById.get(a.session_id)?.date;
    return `${p?.name.split(" ")[0]} Injured mark ${d}`;
  }),
  ...legacyStats.filter((r) => !consumedStats.has(r.id)).map((r) => {
    const p = players.find((x) => x.id === r.player_id);
    return `${p?.name.split(" ")[0]} match note "${r.injury_note}" ${dateOfMatch(r.match_id)}`;
  }),
].sort();
line(unplanned.length
  ? `Left as they are (${unplanned.length}): ${describeLeft.join("; ")}`
  : "Every legacy row is covered by the plan.");
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
  // Days lost run from withdrawing — the first stage before match fit — as the app counts them
  const withdrew = stages.find(([st]) => st !== "match_fit")?.[1] ?? null;
  const n = returned && !placeholder ? (withdrew ? days(withdrew, returned) : 0) : null;
  const lostTxt = n != null
    ? `${band(n)}, ${n} day${n === 1 ? "" : "s"}${entry.linkExisting ? "" : " (approx.)"}`
    : open ? `open — ${days(withdrew, TODAY)} days out so far${withdrew !== entry.occurred ? ` (out from ${withdrew}; played through before)` : ""}${entry.expectedReturn ? `, ${days(withdrew, entry.expectedReturn)} at the expected return (${band(days(withdrew, entry.expectedReturn))})` : ""}`
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
  if (open && noted) line(`                  attendance alert note (if an alert fires): "out with ${label} since ${short(withdrew)}"`);
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

line("Also on apply: each flagged match row above gets injury_id set, its note kept, and Ibreez's 16 Sep");
line("Injured mark becomes Absent — no attendance % changes, since an Injured mark already counts as missed.");
line();
const isPending = ([, d]) => d.answer == null && !d.optional;
const pending = Object.entries(DECISIONS).filter(isPending);
line(pending.length ? `Waiting on ${pending.length} decision(s) — no apply until all are answered:` : "All decisions answered.");
for (const [k, d] of pending) line(`  [${k}] ${d.question}`);

// ── Apply ────────────────────────────────────────────────────────────────────
// `--apply` writes exactly what the report above describes. It refuses to
// start unless every decision is answered and the live data still matches the
// plan; if a write fails partway, it undoes what it wrote. There is no
// transaction over the REST API, so the undo is explicit.
if (APPLY) {
  line();
  const refuse = (why) => { line(`!! Not applied: ${why}`); process.exit(1); };
  if (pending.length) refuse(`${pending.length} decision(s) unanswered.`);
  if (existing.some((i) => i.migrated)) refuse("migrated injuries already exist — this has run before.");

  // Re-read what will be touched: nothing may have changed since the plan was made
  const statIds = plan.flatMap((e) => e.statIds ?? []);
  const attIds = plan.flatMap((e) => e.attIds ?? []);
  const { data: liveStats, error: e1 } = await db.from("match_player_stats").select("id, injured, injury_id").in("id", statIds);
  const { data: liveAtt, error: e2 } = await db.from("session_attendance").select("id, status").in("id", attIds.length ? attIds : ["00000000-0000-0000-0000-000000000000"]);
  if (e1 || e2) refuse((e1 ?? e2).message);
  if (liveStats.length !== statIds.length || liveStats.some((r) => !r.injured || r.injury_id != null)) refuse("a match row has changed since the plan was made.");
  if (liveAtt.length !== attIds.length || liveAtt.some((r) => r.status !== "Injured")) refuse("an attendance row has changed since the plan was made.");

  const createdInjuries = [];
  const linkedStats = [];
  const changedAtt = [];
  try {
    for (const e of plan) {
      const p = playerByName(e.player);
      let injuryId;
      if (e.linkExisting) {
        const rec = existing.find((i) => !i.migrated && i.player_id === p.id && i.body_area === e.area && i.occurred_on === e.occurred);
        if (!rec) throw new Error(`${e.player}: the existing record on ${e.occurred} is gone`);
        injuryId = rec.id;
        line(`• ${e.player}: linking to the existing record ${injuryId}`);
      } else {
        const chosen = e.variants ? e.variants[pick(DECISIONS[e.decision])] : null;
        const stages = chosen ? chosen.stages : e.stages;
        const row = {
          player_id: p.id, occurred_on: e.occurred, category: "injury", body_area: e.area,
          side: e.side, context: e.context, onset: e.onset,
          mechanism: e.mechanismKey ? DECISIONS.mechanism.answer?.[e.mechanismKey] ?? null : null,
          expected_return_on: stages[stages.length - 1][0] === "match_fit" ? null : e.expectedReturn ?? null,
          notes: e.notes ?? null, session_id: e.sessionId ?? null, match_id: e.matchId ?? null, migrated: true,
        };
        const { data: inj, error } = await db.from("injuries").insert(row).select().single();
        if (error) throw new Error(`${e.player}: ${error.message}`);
        createdInjuries.push(inj.id);
        injuryId = inj.id;
        for (const [stage, effective_on] of stages) {
          const { error: se } = await db.from("injury_stages").insert({ injury_id: inj.id, stage, effective_on });
          if (se) throw new Error(`${e.player} stage ${stage} ${effective_on}: ${se.message}`);
        }
        line(`• ${e.player}: injury ${inj.id} + ${stages.map(([st, d]) => `${st} ${d}`).join(" → ")}`);
      }
      for (const id of e.statIds ?? []) {
        const { error } = await db.from("match_player_stats").update({ injury_id: injuryId }).eq("id", id).is("injury_id", null);
        if (error) throw new Error(`${e.player} match row ${id}: ${error.message}`);
        linkedStats.push(id);
      }
      for (const id of e.attIds ?? []) {
        const { error } = await db.from("session_attendance").update({ status: "Absent" }).eq("id", id).eq("status", "Injured");
        if (error) throw new Error(`${e.player} attendance ${id}: ${error.message}`);
        changedAtt.push(id);
      }
      if ((e.statIds ?? []).length || (e.attIds ?? []).length) {
        line(`    linked ${(e.statIds ?? []).length} match row(s)${(e.attIds ?? []).length ? `, ${(e.attIds ?? []).length} Injured mark(s) → Absent` : ""}`);
      }
    }
  } catch (err) {
    line(`!! ${err.message} — undoing`);
    if (linkedStats.length) await db.from("match_player_stats").update({ injury_id: null }).in("id", linkedStats);
    if (changedAtt.length) await db.from("session_attendance").update({ status: "Injured" }).in("id", changedAtt);
    if (createdInjuries.length) await db.from("injuries").delete().in("id", createdInjuries);
    line("Undone. Nothing was left half-written.");
    process.exit(1);
  }
  line();
  line(`Applied: ${createdInjuries.length} injuries created, ${linkedStats.length} match rows linked, ${changedAtt.length} attendance marks → Absent.`);
}
