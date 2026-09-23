import type {
  Injury, InjuryCategory, InjuryContext, InjuryMechanism, InjuryOnset, InjurySide,
  InjuryStage, InjuryStageName, InjuryWithStatus,
} from "./types";

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
 * Fuller et al. 2006, by days from the injury to match fit. The upper bound is
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

/** Days lost so far on an open injury, counted to `today` (local ISO date). */
export function daysLostSoFar(injury: Pick<Injury, "occurred_on">, today: string): number {
  return Math.max(0, daysBetween(injury.occurred_on, today));
}

/**
 * Severity as it can honestly be stated: final once resolved; while open, only
 * a floor — "at least mild" — since the injury may still run on.
 */
export function describeSeverity(
  injury: Pick<InjuryWithStatus, "occurred_on" | "status" | "days_lost" | "migrated">,
  today: string,
): string {
  if (injury.status === "resolved" && injury.days_lost != null) {
    const label = severityLabel(severityFor(injury.days_lost));
    return `${label}${injury.migrated ? " (approx.)" : ""} · ${plural(injury.days_lost, "day")} lost`;
  }
  const days = daysLostSoFar(injury, today);
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
 * Open injuries in the same area that had already begun by `occurredOn` — the
 * form warns that this may be a setback on one. One that started later can't be.
 */
export function openInSameArea(
  injuries: InjuryWithStatus[],
  bodyArea: string | null,
  occurredOn: string,
): InjuryWithStatus[] {
  if (!bodyArea) return [];
  return injuries.filter((i) => i.status === "open" && i.category === "injury"
    && i.body_area === bodyArea && i.occurred_on <= occurredOn);
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
