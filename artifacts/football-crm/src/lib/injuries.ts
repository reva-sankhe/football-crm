import type {
  Injury, InjuryCategory, InjuryContext, InjuryMechanism, InjuryOnset, InjurySide,
  InjuryStage, InjuryStageName, InjuryWithStatus,
} from "./types";
import { formatDateShort } from "./attendance";

/**
 * Injuries and illnesses — the vocabulary, and everything derived from a
 * stage history. Pure: no Supabase.
 *
 * The model follows the football consensus (Fuller et al. 2006). An injury is
 * over when the player is match fit — cleared for full training *and*
 * available for selection — so that date, not "back training", ends it and
 * sets its severity. A setback before then is a stage change on the same
 * injury; breaking down again after it is a new injury linked back through
 * `recurrence_of`. The database enforces the same rules
 * (supabase_migration_injuries.sql); the checks here exist so a form can say
 * what is wrong before it round-trips.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────
/** Must match the body_area CHECK constraint exactly. */
export const BODY_AREAS = [
  "Head/face", "Neck", "Shoulder", "Arm/elbow", "Wrist/hand", "Chest/ribs",
  "Abdomen", "Back", "Hip/groin", "Hamstring", "Quadriceps", "Knee",
  "Calf/shin", "Achilles", "Ankle", "Foot/toe",
] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

/**
 * Only migrated rows use this — a legacy "Injured" mark carries no location.
 * The entry forms never offer it.
 */
export const UNSPECIFIED_AREA = "Unspecified";

/** Areas with a left and a right. Everything else is midline and stored as "n/a". */
const LATERAL_AREAS: ReadonlySet<string> = new Set([
  "Shoulder", "Arm/elbow", "Wrist/hand", "Hip/groin", "Hamstring", "Quadriceps",
  "Knee", "Calf/shin", "Achilles", "Ankle", "Foot/toe",
]);

export function isLateral(area: string | null): boolean {
  return area != null && LATERAL_AREAS.has(area);
}

export const SIDES: { value: Exclude<InjurySide, "n/a">; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "both", label: "Both" },
];

export const CATEGORIES: { value: InjuryCategory; label: string }[] = [
  { value: "injury", label: "Injury" },
  { value: "illness", label: "Illness" },
];

export const CONTEXTS: { value: InjuryContext; label: string }[] = [
  { value: "training", label: "Training" },
  { value: "match", label: "Match" },
  { value: "outside", label: "Outside football" },
];

export const MECHANISMS: { value: InjuryMechanism; label: string }[] = [
  { value: "contact", label: "Contact" },
  { value: "non_contact", label: "Non-contact" },
];

export const ONSETS: { value: InjuryOnset; label: string; hint: string }[] = [
  { value: "acute", label: "Acute", hint: "a specific moment" },
  { value: "overuse", label: "Overuse", hint: "came on gradually" },
];

// ── Stages ────────────────────────────────────────────────────────────────────
export const STAGE_ORDER: InjuryStageName[] = ["out", "modified", "full_training", "match_fit"];

export const STAGE_CFG: Record<InjuryStageName, { label: string; short: string; description: string }> = {
  out:           { label: "Out",               short: "Out",      description: "Not training" },
  modified:      { label: "Modified training", short: "Modified", description: "Training with restrictions" },
  full_training: { label: "Full training",     short: "Full",     description: "Training fully, not yet ready for a match" },
  match_fit:     { label: "Match fit",         short: "Fit",      description: "Available for selection — the injury is over" },
};

/**
 * The stage a new injury starts at. Match fit is allowed and means the player
 * carried on — no time lost, a "slight" injury.
 */
export const INITIAL_STAGES: { value: InjuryStageName; label: string }[] = [
  { value: "out", label: "Out" },
  { value: "modified", label: "Modified training" },
  { value: "full_training", label: "Full training" },
  { value: "match_fit", label: "Played on — no time lost" },
];

function byDate(stages: InjuryStage[]): InjuryStage[] {
  return [...stages].sort((a, b) => a.effective_on.localeCompare(b.effective_on));
}

/** The latest stage, which is where the player stands now. */
export function currentStage(stages: InjuryStage[]): InjuryStageName | null {
  const sorted = byDate(stages);
  return sorted.length ? sorted[sorted.length - 1].stage : null;
}

/** The date the player became match fit, or null while the injury is open. */
export function returnedOn(stages: InjuryStage[]): string | null {
  return stages.find((s) => s.stage === "match_fit")?.effective_on ?? null;
}

/**
 * Why a stage can't be added, or null if it can. Mirrors the insert rules in
 * `injury_stages_guard`: on or after the injury date, after the latest stage,
 * and never once match fit (undo that first).
 */
export function stageInsertProblem(
  occurredOn: string,
  stages: InjuryStage[],
  effectiveOn: string,
): string | null {
  if (effectiveOn < occurredOn) return `A stage can't start before the injury (${occurredOn}).`;
  const fit = returnedOn(stages);
  if (fit) return `Already match fit on ${fit} — undo that stage to reopen the injury.`;
  const sorted = byDate(stages);
  const latest = sorted[sorted.length - 1];
  if (latest && effectiveOn <= latest.effective_on) {
    return `Must be dated after the latest stage (${latest.effective_on}).`;
  }
  return null;
}

/**
 * Why the latest stage can't be undone, or null if it can. Mirrors the delete
 * rules: the injury always keeps one stage, and a match fit that a later
 * recurrence depends on stays put.
 */
export function undoProblem(stages: InjuryStage[], hasRecurrence: boolean): string | null {
  if (stages.length <= 1) return "An injury keeps at least one stage — delete the injury instead.";
  if (currentStage(stages) === "match_fit" && hasRecurrence) {
    return "A later injury is recorded as a recurrence of this one, so it can't be reopened.";
  }
  return null;
}

// ── Severity ──────────────────────────────────────────────────────────────────
export type Severity = "slight" | "minimal" | "mild" | "moderate" | "severe";

/**
 * Fuller et al. 2006, by days lost — from withdrawing from full participation
 * to match fit (see `daysLost`). The upper bound is
 * inclusive; severe is anything beyond 28. Change a band here and the
 * sentence that reports it changes with it — nothing else holds a copy.
 */
export const SEVERITY_BANDS: { severity: Severity; label: string; maxDays: number }[] = [
  { severity: "slight",   label: "Slight",   maxDays: 0 },
  { severity: "minimal",  label: "Minimal",  maxDays: 3 },
  { severity: "mild",     label: "Mild",     maxDays: 7 },
  { severity: "moderate", label: "Moderate", maxDays: 28 },
  { severity: "severe",   label: "Severe",   maxDays: Infinity },
];

export function severityFor(daysLost: number): Severity {
  return SEVERITY_BANDS.find((b) => daysLost <= b.maxDays)!.severity;
}

export function severityLabel(s: Severity): string {
  return SEVERITY_BANDS.find((b) => b.severity === s)!.label;
}

/** Whole days between two ISO dates, b − a. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

/**
 * When the player stopped taking full part: the first stage before match fit.
 * Usually the day of the injury, but not always — a player can carry one for
 * weeks before it stops them (Ibreez's back: from 15 Aug, out 12 Sep). Null
 * when they played on and lost no time.
 */
export function withdrewOn(stages: InjuryStage[]): string | null {
  return byDate(stages).find((s) => s.stage !== "match_fit")?.effective_on ?? null;
}

/**
 * Days lost, as Fuller counts them: from withdrawing to match fit — or to
 * `today` while still open — not from `occurred_on`. Counting from the injury
 * date would make a 19-day absence after weeks of playing through read as
 * severe.
 */
export function daysLost(
  injury: Pick<InjuryWithStatus, "returned_on">,
  stages: InjuryStage[],
  today: string,
): number {
  const from = withdrewOn(stages);
  if (!from) return 0;
  return Math.max(0, daysBetween(from, injury.returned_on ?? today));
}

/**
 * Severity as it can honestly be stated: final once resolved; while open, only
 * a floor — "at least mild" — since the injury may still run on. `stages` are
 * this injury's own.
 */
export function describeSeverity(
  injury: Pick<InjuryWithStatus, "status" | "returned_on" | "migrated">,
  stages: InjuryStage[],
  today: string,
): string {
  const days = daysLost(injury, stages, today);
  if (injury.status === "resolved") {
    const label = severityLabel(severityFor(days));
    return `${label}${injury.migrated ? " (approx.)" : ""} · ${plural(days, "day")} lost`;
  }
  return `At least ${severityLabel(severityFor(days)).toLowerCase()} · ${plural(days, "day")} so far`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ── Labels ────────────────────────────────────────────────────────────────────
/** "Knee (left)", "Back", "Illness". The one-line name used everywhere. */
export function injuryLabel(i: Pick<Injury, "category" | "body_area" | "side">): string {
  if (i.category === "illness") return "Illness";
  const area = i.body_area ?? UNSPECIFIED_AREA;
  return i.side && i.side !== "n/a" ? `${area} (${i.side})` : area;
}

// ── Recurrence ────────────────────────────────────────────────────────────────
/**
 * Earlier injuries a new one could be a recurrence of: same player and body
 * area, already over (match fit) on or before the new date. Most recent first.
 * An open injury in the same area is deliberately excluded — that is a setback
 * on it, recorded as a stage, not a new injury.
 */
export function recurrenceCandidates(
  injuries: InjuryWithStatus[],
  bodyArea: string | null,
  occurredOn: string,
): InjuryWithStatus[] {
  if (!bodyArea) return [];
  return injuries
    .filter((i) => i.category === "injury" && i.body_area === bodyArea
      && i.returned_on != null && i.returned_on <= occurredOn)
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
}

/**
 * Injuries in the same area that were open on `occurredOn` — the form warns
 * that this may be a setback on one. One that started later can't be, and one
 * that has healed since still counts: it was open then.
 */
export function openInSameArea(
  injuries: InjuryWithStatus[],
  bodyArea: string | null,
  occurredOn: string,
): InjuryWithStatus[] {
  if (!bodyArea) return [];
  return injuries.filter((i) => i.category === "injury" && i.body_area === bodyArea && openOn(i, occurredOn));
}

// ── Entry ─────────────────────────────────────────────────────────────────────
/** What every entry form collects. The link fields are filled by where it was opened. */
export interface InjuryDraft {
  category: InjuryCategory;
  body_area: string;
  side: InjurySide | "";
  context: InjuryContext | "";
  mechanism: InjuryMechanism | "";
  onset: InjuryOnset | "";
  stage: InjuryStageName;
  expected_return_on: string;
  recurrence_of: string;
  notes: string;
}

export function emptyInjuryDraft(context: InjuryContext | "" = ""): InjuryDraft {
  return {
    category: "injury", body_area: "", side: "", context, mechanism: "", onset: "",
    stage: "out", expected_return_on: "", recurrence_of: "", notes: "",
  };
}

/**
 * Field → problem, empty when the draft can be saved. The database allows
 * nulls for these (migrated rows have none); the forms don't.
 */
export function injuryDraftProblems(d: InjuryDraft, occurredOn: string): Record<string, string> {
  const p: Record<string, string> = {};
  if (!d.context) p.context = "Where did it happen?";
  if (d.category === "injury") {
    if (!d.body_area) p.body_area = "Pick a body area";
    else if (isLateral(d.body_area) && !d.side) p.side = "Which side?";
    if (!d.mechanism) p.mechanism = "Contact or non-contact?";
    if (!d.onset) p.onset = "Acute or overuse?";
    if (d.onset === "overuse" && d.mechanism === "contact") {
      p.mechanism = "An overuse injury has no single contact to attribute it to";
    }
  }
  if (d.expected_return_on && d.expected_return_on < occurredOn) {
    p.expected_return_on = "Expected return is before the injury date";
  }
  return p;
}

/** An existing injury as a draft, for editing its details. `stage` is unused there. */
export function draftFromInjury(i: InjuryWithStatus): InjuryDraft {
  return {
    category: i.category,
    body_area: i.body_area ?? "",
    side: i.side ?? "",
    context: i.context ?? "",
    mechanism: i.mechanism ?? "",
    onset: i.onset ?? "",
    stage: i.current_stage ?? "out",
    expected_return_on: i.expected_return_on ?? "",
    recurrence_of: i.recurrence_of ?? "",
    notes: i.notes ?? "",
  };
}

/**
 * What stops an edit — only what the database would refuse, or a date that
 * contradicts the stages. Unlike a new entry, unknowns stay allowed: a
 * migrated injury's mechanism is filled in when the coaches know it, not
 * before, and editing its notes mustn't wait for that.
 */
export function injuryEditProblems(
  d: InjuryDraft,
  occurredOn: string,
  stages: InjuryStage[],
  today: string,
): Record<string, string> {
  const p: Record<string, string> = {};
  if (d.category === "injury" && !d.body_area) p.body_area = "An injury needs a body area";
  if (d.category === "injury" && d.onset === "overuse" && d.mechanism === "contact") {
    p.mechanism = "An overuse injury has no single contact to attribute it to";
  }
  if (!occurredOn) p.occurred_on = "Pick a date";
  else if (occurredOn > today) p.occurred_on = "An injury can't be in the future";
  else {
    const first = byDate(stages)[0]?.effective_on;
    if (first && occurredOn > first) p.occurred_on = `Can't be after its first stage (${formatDateShort(first)})`;
  }
  if (d.expected_return_on && occurredOn && d.expected_return_on < occurredOn) {
    p.expected_return_on = "Expected return is before the injury date";
  }
  return p;
}

/** The insert payload for `injuries`, from a draft that has passed injuryDraftProblems. */
export function injuryRowFromDraft(
  d: InjuryDraft,
  link: { player_id: string; occurred_on: string; session_id?: string | null; match_id?: string | null },
): Omit<Injury, "id" | "created_at" | "reviewed_on" | "migrated"> {
  const injury = d.category === "injury";
  return {
    player_id: link.player_id,
    occurred_on: link.occurred_on,
    category: d.category,
    body_area: injury ? d.body_area : null,
    side: injury ? (isLateral(d.body_area) ? (d.side || null) : "n/a") : null,
    context: d.context || null,
    mechanism: injury ? (d.mechanism || null) : null,
    onset: injury ? (d.onset || null) : null,
    recurrence_of: injury && d.recurrence_of ? d.recurrence_of : null,
    expected_return_on: d.expected_return_on || null,
    session_id: link.session_id ?? null,
    match_id: link.match_id ?? null,
    notes: d.notes.trim() || null,
  };
}

// ── Availability ──────────────────────────────────────────────────────────────
/** Not-yet-fit stages, worst first. Match fit means available, so it has no rank. */
const STAGE_RANK: Record<InjuryStageName, number> = { out: 3, modified: 2, full_training: 1, match_fit: 0 };

/** The stage one injury had reached on `date`; null before it began or once match fit. */
export function stageOfInjuryOn(
  injury: Pick<Injury, "occurred_on">,
  stages: InjuryStage[],
  date: string,
): InjuryStageName | null {
  if (date < injury.occurred_on) return null;
  let current: InjuryStage | null = null;
  for (const s of stages) {
    if (s.effective_on <= date && (!current || s.effective_on > current.effective_on)) current = s;
  }
  return current && current.stage !== "match_fit" ? current.stage : null;
}

/**
 * Whether an injury was still open on `date`: it had happened, and the player
 * wasn't match fit yet. `status` answers this for today only — a past session
 * or match has to ask about its own date.
 */
export function openOn(injury: Pick<InjuryWithStatus, "occurred_on" | "returned_on">, date: string): boolean {
  return injury.occurred_on <= date && (injury.returned_on == null || injury.returned_on > date);
}

export interface PlayerAvailability {
  /** The worst stage across the injuries in effect. */
  stage: InjuryStageName;
  /** Those injuries, worst first. */
  injuries: InjuryWithStatus[];
  /** Injury id → the day it stopped them (see withdrewOn) — "out since", not "injured since". */
  since: Record<string, string>;
}

export interface Availability {
  /** Where a player stood on a date, or null if nothing was keeping them out. */
  on(playerId: string, date: string): PlayerAvailability | null;
  /** Every player not yet match fit on `date`. */
  unavailableOn(date: string): Map<string, PlayerAvailability>;
  /** When an injury stopped the player (see withdrewOn); null if they played on. */
  withdrewOn(injuryId: string): string | null;
}

/**
 * Availability derived from injuries and their stage histories — never
 * stored. One answer for every screen: attendance, alerts, lineups and the
 * player page all ask this, so none can disagree about who was out when.
 */
export function buildAvailability(injuries: InjuryWithStatus[], stages: InjuryStage[]): Availability {
  const stagesByInjury = new Map<string, InjuryStage[]>();
  for (const s of stages) {
    const list = stagesByInjury.get(s.injury_id);
    if (list) list.push(s);
    else stagesByInjury.set(s.injury_id, [s]);
  }
  const byPlayer = new Map<string, InjuryWithStatus[]>();
  for (const i of injuries) {
    const list = byPlayer.get(i.player_id);
    if (list) list.push(i);
    else byPlayer.set(i.player_id, [i]);
  }

  const on = (playerId: string, date: string): PlayerAvailability | null => {
    const hits: { injury: InjuryWithStatus; stage: InjuryStageName }[] = [];
    for (const injury of byPlayer.get(playerId) ?? []) {
      const stage = stageOfInjuryOn(injury, stagesByInjury.get(injury.id) ?? [], date);
      if (stage) hits.push({ injury, stage });
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || b.injury.occurred_on.localeCompare(a.injury.occurred_on));
    const since: Record<string, string> = {};
    for (const h of hits) since[h.injury.id] = withdrewOn(stagesByInjury.get(h.injury.id) ?? []) ?? h.injury.occurred_on;
    return { stage: hits[0].stage, injuries: hits.map((h) => h.injury), since };
  };

  return {
    on,
    unavailableOn(date) {
      const out = new Map<string, PlayerAvailability>();
      for (const playerId of byPlayer.keys()) {
        const a = on(playerId, date);
        if (a) out.set(playerId, a);
      }
      return out;
    },
    withdrewOn: (injuryId) => withdrewOn(stagesByInjury.get(injuryId) ?? []),
  };
}

/** An availability with nobody injured — for callers whose injury data hasn't loaded. */
export const NO_INJURIES: Availability = buildAvailability([], []);

/** "Out · Knee (left)" — the short line lineups and rosters show. */
export function availabilityLabel(a: PlayerAvailability): string {
  return `${STAGE_CFG[a.stage].short} · ${a.injuries.map(injuryLabel).join(", ")}`;
}

/**
 * What an attendance alert says about injury: the injuries the player had in
 * the window, so a coach can tell a commitment problem from an injury —
 * "out with knee (right) since 2 Aug", or "was out with ankle (left)
 * 1 Sept–15 Sept" for one that has ended. Empty when there were none.
 *
 * It explains the figure and never changes it: an injured player is expected
 * to come and sit out, so a missed session counts like any other.
 */
export function injuryAttendanceNote(
  injuries: InjuryWithStatus[],
  from: string,
  today: string,
  /** When each stopped the player; defaults to the injury date. */
  outFrom: (i: InjuryWithStatus) => string = (i) => i.occurred_on,
): string {
  const lower = (i: InjuryWithStatus) => {
    const label = injuryLabel(i);
    return label.charAt(0).toLowerCase() + label.slice(1);
  };
  return injuries
    .filter((i) => outFrom(i) <= today && (i.returned_on == null || i.returned_on > from))
    .sort((a, b) => outFrom(a).localeCompare(outFrom(b)))
    .map((i) => {
      if (i.returned_on != null && i.returned_on <= today) {
        return `was out with ${lower(i)} ${formatDateShort(outFrom(i))}–${formatDateShort(i.returned_on)}`;
      }
      const lead = i.current_stage === "modified" ? "on modified training with"
        : i.current_stage === "full_training" ? "back in full training after"
        : "out with";
      return `${lead} ${lower(i)} since ${formatDateShort(outFrom(i))}`;
    })
    .join("; ");
}

// ── Closing prompts ───────────────────────────────────────────────────────────
/**
 * Coaches don't keep a daily status, so an open injury is closed by asking at
 * the moments there's something to go on — never by closing it automatically.
 */
export const STALE_PROMPT_DAYS = 14;

export type ClosingPromptKind = "played" | "trained" | "expected" | "stale";

export interface ClosingPrompt {
  kind: ClosingPromptKind;
  injury: InjuryWithStatus;
  /** Where the player stands now. */
  stage: InjuryStageName;
  /** The stage and date to pre-fill; the coach can change either. */
  suggestStage: InjuryStageName;
  suggestDate: string;
  message: string;
}

/** What the player has done that says something about their injury. */
export interface ActivityEvidence {
  /** Dates of sessions the player rated themselves — backfilled estimates excluded. */
  ratedDates: string[];
  /** Match appearances with minutes on the pitch. */
  played: { date: string; minutes: number }[];
}

/**
 * The one question worth asking about an open injury today, or null. First
 * match wins:
 *
 * 1. **played** — minutes in a match while not match fit: were they fit?
 * 2. **trained** — rated a session while out: back in modified training?
 * 3. **expected** — the expected return date has passed.
 * 4. **stale** — no stage change or "still out" answer for STALE_PROMPT_DAYS,
 *    and no expected return still ahead. An expected return in the future is
 *    what keeps a long injury (an ACL) from asking every fortnight.
 *
 * Evidence only counts after the latest stage change or "still out" answer —
 * whatever came before it has already been answered.
 */
export function closingPrompt(
  injury: InjuryWithStatus,
  stages: InjuryStage[],
  evidence: ActivityEvidence,
  today: string,
): ClosingPrompt | null {
  if (injury.status !== "open") return null;
  const stage = currentStage(stages);
  if (!stage || stage === "match_fit") return null;
  const sorted = byDate(stages);
  const lastChange = sorted[sorted.length - 1].effective_on;
  const answeredOn = [lastChange, injury.reviewed_on ?? ""].sort().pop()!;
  const base = { injury, stage };

  const played = evidence.played
    .filter((p) => p.minutes > 0 && p.date > answeredOn && p.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (played) {
    return {
      ...base, kind: "played", suggestStage: "match_fit", suggestDate: played.date,
      message: `Played ${played.minutes}′ on ${shortDate(played.date)} while ${STAGE_CFG[stage].label.toLowerCase()} — match fit from then?`,
    };
  }

  if (stage === "out") {
    const trained = evidence.ratedDates.filter((d) => d > answeredOn && d <= today).sort()[0];
    if (trained) {
      return {
        ...base, kind: "trained", suggestStage: "modified", suggestDate: trained,
        message: `Rated a session on ${shortDate(trained)} while out — back in modified training?`,
      };
    }
  }

  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1];
  const expected = injury.expected_return_on;
  if (expected && expected <= today && !(injury.reviewed_on && injury.reviewed_on >= expected)) {
    return {
      ...base, kind: "expected", suggestStage: next, suggestDate: today,
      message: `Expected back ${shortDate(expected)} — where do they stand?`,
    };
  }

  if (daysBetween(answeredOn, today) >= STALE_PROMPT_DAYS && !(expected && expected > today)) {
    return {
      ...base, kind: "stale", suggestStage: next, suggestDate: today,
      message: `No update for ${daysBetween(answeredOn, today)} days — still ${STAGE_CFG[stage].label.toLowerCase()}?`,
    };
  }
  return null;
}

/** Every open injury's prompt, most recent injury first. */
export function closingPrompts(
  injuries: InjuryWithStatus[],
  stages: InjuryStage[],
  evidenceFor: (playerId: string) => ActivityEvidence,
  today: string,
): ClosingPrompt[] {
  const stagesByInjury = new Map<string, InjuryStage[]>();
  for (const s of stages) (stagesByInjury.get(s.injury_id) ?? stagesByInjury.set(s.injury_id, []).get(s.injury_id)!).push(s);
  return injuries
    .filter((i) => i.status === "open")
    .map((i) => closingPrompt(i, stagesByInjury.get(i.id) ?? [], evidenceFor(i.player_id), today))
    .filter((p): p is ClosingPrompt => p !== null)
    .sort((a, b) => b.injury.occurred_on.localeCompare(a.injury.occurred_on));
}

function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Per-player evidence from raw rows: sessions a player rated themselves, and
 * match minutes. An estimated RPE row is a backfill, not the player saying
 * they trained, so it isn't evidence.
 */
export function buildEvidence(
  rated: { player_id: string; date: string | null | undefined; estimated?: boolean }[],
  played: { player_id: string; date: string | null | undefined; minutes: number | null }[],
): (playerId: string) => ActivityEvidence {
  const map = new Map<string, ActivityEvidence>();
  const get = (pid: string) => map.get(pid) ?? map.set(pid, { ratedDates: [], played: [] }).get(pid)!;
  for (const r of rated) if (r.date && !r.estimated) get(r.player_id).ratedDates.push(r.date);
  for (const p of played) if (p.date && (p.minutes ?? 0) > 0) get(p.player_id).played.push({ date: p.date, minutes: p.minutes! });
  return (pid) => map.get(pid) ?? { ratedDates: [], played: [] };
}
