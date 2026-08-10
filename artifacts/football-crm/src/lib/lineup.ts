import type {
  Match, MatchPenaltyKick, MatchStatInput, SubPolicy, Tournament,
} from "./types";

/**
 * Lineup, substitution-policy and shootout logic.
 *
 * Pure functions only — no Supabase imports — so the minutes arithmetic can be
 * reasoned about (and tested) on its own.
 */

// ── Substitution policy ───────────────────────────────────────────────────────
/** Used when neither the match nor its tournament says otherwise. */
export const DEFAULT_SUB_POLICY: SubPolicy = "limited";
export const DEFAULT_MAX_SUBS = 5;

/** Fallback match length — a friendly has no tournament to inherit one from. */
export const DEFAULT_MATCH_MINS = 90;

export const SUB_POLICIES: { value: SubPolicy; label: string; hint: string }[] = [
  { value: "limited", label: "Limited", hint: "A fixed number of subs; once off, a player stays off." },
  { value: "rolling", label: "Rolling", hint: "Players can come off and return. No cap enforced." },
];

export interface ResolvedSubPolicy {
  policy: SubPolicy;
  /** null means uncapped — always the case for rolling subs. */
  maxSubs: number | null;
  /** Where the value came from, so the UI can say "inherited from tournament". */
  source: "match" | "tournament" | "default";
}

/**
 * Match override beats tournament default beats app default. A standalone match
 * has no tournament at all, which is why the final fallback exists.
 */
export function resolveSubPolicy(
  match: Pick<Match, "sub_policy" | "max_subs"> | null | undefined,
  tournament: Pick<Tournament, "sub_policy" | "max_subs"> | null | undefined,
): ResolvedSubPolicy {
  if (match?.sub_policy) {
    return {
      policy: match.sub_policy,
      maxSubs: match.sub_policy === "rolling" ? null : match.max_subs ?? DEFAULT_MAX_SUBS,
      source: "match",
    };
  }
  if (tournament?.sub_policy) {
    return {
      policy: tournament.sub_policy,
      maxSubs: tournament.sub_policy === "rolling" ? null : tournament.max_subs ?? DEFAULT_MAX_SUBS,
      source: "tournament",
    };
  }
  return { policy: DEFAULT_SUB_POLICY, maxSubs: DEFAULT_MAX_SUBS, source: "default" };
}

/** A sub is "used" when someone comes off the bench — i.e. has an on minute. */
export function subsUsed(rows: Pick<MatchStatInput, "started" | "on_minute">[]): number {
  return rows.filter((r) => !r.started && r.on_minute != null).length;
}

/**
 * True when a capped policy has been exceeded. This is only ever a warning —
 * recording what actually happened matters more than the rulebook, and formats
 * vary more than the schema can usefully model.
 */
export function subsExceeded(
  rows: Pick<MatchStatInput, "started" | "on_minute">[],
  resolved: ResolvedSubPolicy,
): boolean {
  return resolved.maxSubs != null && subsUsed(rows) > resolved.maxSubs;
}

// ── Minutes ───────────────────────────────────────────────────────────────────
/** A player's spell on the pitch, as the row records it. */
export type Spell = Pick<MatchStatInput, "started" | "on_minute" | "off_minute">;

/**
 * Minutes on the pitch, from one player's own row.
 *
 * A starter's clock runs from 0; a substitute's from `on_minute`. Either way it
 * stops at `off_minute`, or at full time when that's blank. Someone who neither
 * started nor came on didn't play.
 *
 * One spell per player: a genuine re-entry is handled by overriding the minutes
 * by hand, which is what let the substitution event table go away.
 */
export function playerMinutes(row: Spell, durationMins: number): number {
  const duration = Math.max(0, durationMins);
  if (!row.started && row.on_minute == null) return 0;

  const clamp = (m: number) => Math.max(0, Math.min(duration, m));
  const on = row.started ? 0 : clamp(row.on_minute ?? 0);
  const off = clamp(row.off_minute ?? duration);
  return Math.max(0, off - on);
}

/** A spell that ends before it starts — surfaced inline rather than blocking a save. */
export function spellInvalid(row: Spell): boolean {
  return row.on_minute != null && row.off_minute != null && row.off_minute < row.on_minute;
}

// ── Goal methods ──────────────────────────────────────────────────────────────
/** How a goal was scored. Open play is the default and carries no label. */
export type GoalMethod = "open" | "fk" | "pen";

export type GoalCounts = Pick<MatchStatInput, "goals" | "goals_free_kick" | "goals_penalty">;

/** Open-play goals are whatever isn't a free kick or a penalty. */
export function onFieldGoals(row: GoalCounts): number {
  return Math.max(0, row.goals - row.goals_free_kick - row.goals_penalty);
}

/**
 * Logs (or removes) one goal of a given method.
 *
 * `goals` is recomputed as the sum of the three methods rather than tracked
 * separately, so the DB's `goals_free_kick + goals_penalty <= goals` constraint
 * holds by construction — no sequence of clicks can produce an invalid row.
 */
export function applyGoal(row: GoalCounts, method: GoalMethod, delta: number): GoalCounts {
  const open = Math.max(0, onFieldGoals(row)   + (method === "open" ? delta : 0));
  const fk   = Math.max(0, row.goals_free_kick + (method === "fk"   ? delta : 0));
  const pen  = Math.max(0, row.goals_penalty   + (method === "pen"  ? delta : 0));
  return { goals: open + fk + pen, goals_free_kick: fk, goals_penalty: pen };
}

/** The three method counts, for rendering a picker. */
export function goalCountsByMethod(row: GoalCounts): Record<GoalMethod, number> {
  return { open: onFieldGoals(row), fk: row.goals_free_kick, pen: row.goals_penalty };
}

/**
 * "3 (1 FK, 1 P)" — open-play goals carry no suffix, so a plain finish reads as
 * just the number.
 */
export function formatGoalBreakdown(
  row: Pick<MatchStatInput, "goals" | "goals_free_kick" | "goals_penalty">,
): string {
  if (row.goals === 0) return "0";
  const parts: string[] = [];
  if (row.goals_free_kick > 0) parts.push(`${row.goals_free_kick} FK`);
  if (row.goals_penalty > 0) parts.push(`${row.goals_penalty} P`);
  return parts.length ? `${row.goals} (${parts.join(", ")})` : `${row.goals}`;
}

/** True when the method counters claim more goals than were actually scored. */
export function goalMethodsValid(
  row: Pick<MatchStatInput, "goals" | "goals_free_kick" | "goals_penalty">,
): boolean {
  return row.goals_free_kick + row.goals_penalty <= row.goals;
}

// ── Penalty shootouts ─────────────────────────────────────────────────────────
/**
 * Who won the shootout — deliberately separate from `matchResult()` in
 * lib/tournaments.ts. A shootout never changes goals for/against, so the match
 * itself stays a draw and head-to-head totals are unaffected.
 */
export function shootoutResult(
  m: Pick<Match, "went_to_penalties" | "pens_for" | "pens_against">,
): "W" | "L" | null {
  if (!m.went_to_penalties) return null;
  if (m.pens_for == null || m.pens_against == null) return null;
  if (m.pens_for > m.pens_against) return "W";
  if (m.pens_for < m.pens_against) return "L";
  return null; // a tied shootout is unfinished, not a draw
}

/** "won 4–3 on pens", for the line beside the result badge. */
export function formatShootout(
  m: Pick<Match, "went_to_penalties" | "pens_for" | "pens_against">,
): string | null {
  const r = shootoutResult(m);
  if (!r) return null;
  return `${r === "W" ? "won" : "lost"} ${m.pens_for}–${m.pens_against} on pens`;
}

/** Per-player shootout tally from the kick list — "1/1", "2/3". */
export function shootoutRecord(
  kicks: Pick<MatchPenaltyKick, "player_id" | "scored">[],
): Map<string, { taken: number; scored: number }> {
  const out = new Map<string, { taken: number; scored: number }>();
  for (const k of kicks) {
    const entry = out.get(k.player_id) ?? { taken: 0, scored: 0 };
    entry.taken += 1;
    if (k.scored) entry.scored += 1;
    out.set(k.player_id, entry);
  }
  return out;
}

/** Shootout score implied by the kicks logged, for cross-checking the entered score. */
export function kicksScored(kicks: Pick<MatchPenaltyKick, "scored">[]): number {
  return kicks.filter((k) => k.scored).length;
}
