import type { Match, MatchStage } from "./types";
import { STATUS_TEXT } from "./viz";

// ── Match stage styling ───────────────────────────────────────────────────────
export interface StageCfg {
  label: string;
  short: string;
}

export const STAGE_CFG: Record<MatchStage, StageCfg> = {
  "Group Stage":   { label: "Group Stage",   short: "GRP" },
  "Round of 16":   { label: "Round of 16",   short: "R16" },
  "Quarter Final": { label: "Quarter Final", short: "QF"  },
  "Semi Final":    { label: "Semi Final",    short: "SF"  },
  "Third Place":   { label: "Third Place",   short: "3rd" },
  "Final":         { label: "Final",         short: "F"   },
  "Friendly":      { label: "Friendly",      short: "FR"  },
};

/**
 * Game sizes a tournament can be played at, smallest first. Mirrors the CHECK
 * constraint on `tournaments.format` — keep the two in step.
 */
export const MATCH_FORMATS = [
  "5-a-side",
  "6-a-side",
  "7-a-side",
  "8-a-side",
  "9-a-side",
  "11-a-side",
] as const;

/** Bracket order — also the order the stage dropdown offers. */
export const MATCH_STAGES: MatchStage[] = [
  "Group Stage",
  "Round of 16",
  "Quarter Final",
  "Semi Final",
  "Third Place",
  "Final",
  "Friendly",
];

// ── Results ───────────────────────────────────────────────────────────────────
export type MatchResult = "W" | "D" | "L";

export const RESULT_CFG: Record<MatchResult, { label: string; text: string; bg: string }> = {
  W: { label: "Win",  text: STATUS_TEXT.good,     bg: "bg-[#0ca30c]/15" },
  D: { label: "Draw", text: "text-muted-foreground", bg: "bg-muted"     },
  L: { label: "Loss", text: STATUS_TEXT.critical, bg: "bg-[#d03b3b]/15" },
};

/** null when the score hasn't been entered yet — a fixture, not a result. */
export function matchResult(m: Pick<Match, "goals_for" | "goals_against">): MatchResult | null {
  if (m.goals_for == null || m.goals_against == null) return null;
  if (m.goals_for > m.goals_against) return "W";
  if (m.goals_for < m.goals_against) return "L";
  return "D";
}

/** A knockout tie is settled on the day; a group game or friendly can end level. */
export function isKnockoutStage(stage: MatchStage): boolean {
  return stage !== "Group Stage" && stage !== "Friendly";
}

export type OutcomeMatch = Pick<
  Match, "stage" | "goals_for" | "goals_against" | "went_to_penalties" | "pens_for" | "pens_against"
>;

/**
 * The result as the bracket sees it — what a knockout round actually settled.
 *
 * Identical to `matchResult` everywhere except a drawn knockout tie, which the
 * shootout decides: there is no such thing as a drawn semi-final. The two are
 * kept apart on purpose. `matchResult` counts goals and nothing else, which is
 * what the head-to-head views (`v_opponent_h2h`) and the per-90 rates mirror in
 * SQL — moving a shootout into those totals would misreport a 1–1 as a win and
 * put the app out of step with the database. Use this one for anything a
 * bracket owns: badges, stage records, the tournament's own W/D/L.
 */
export function matchOutcome(m: OutcomeMatch): MatchResult | null {
  const r = matchResult(m);
  if (r !== "D" || !isKnockoutStage(m.stage)) return r;
  // Level and no shootout logged yet — still genuinely undecided
  if (!m.went_to_penalties || m.pens_for == null || m.pens_against == null) return r;
  if (m.pens_for === m.pens_against) return r; // shootout unfinished
  return m.pens_for > m.pens_against ? "W" : "L";
}

// ── Where the team finished ───────────────────────────────────────────────────
/**
 * Derived from the bracket rather than stored, so it can never disagree with the
 * results. Only the three placings a knockout actually settles are recognised —
 * a group-stage exit has no position to report.
 */
export type TournamentFinish = "Winners" | "Runners-up" | "Third";

/**
 * The medal is what's shown on screen; `label` is what's read out and what the
 * printed report uses, so the placing is never carried by the glyph alone.
 */
export const FINISH_CFG: Record<TournamentFinish, { label: string; medal: string }> = {
  "Winners":    { label: "Winners",    medal: "🥇" },
  "Runners-up": { label: "Runners-up", medal: "🥈" },
  "Third":      { label: "Third",      medal: "🥉" },
};

/** Bracket order — how stages sort, and the order stage groups are shown in. */
export function stageRank(stage: MatchStage): number {
  const i = MATCH_STAGES.indexOf(stage);
  return i === -1 ? MATCH_STAGES.length : i;
}

/** Who won a knockout tie — the shootout included, since that is what settles it. */
function tieWon(m: OutcomeMatch): boolean | null {
  const r = matchOutcome(m);
  return r === "W" ? true : r === "L" ? false : null;
}

/** null when the bracket doesn't say — no final logged, or it wasn't played. */
export function tournamentFinish(matches: OutcomeMatch[]): TournamentFinish | null {
  const final = matches.find((m) => m.stage === "Final");
  const won = final ? tieWon(final) : null;
  if (won === true) return "Winners";
  if (won === false) return "Runners-up";

  // No final, or we weren't in it — a third-place playoff still settles a medal
  const third = matches.find((m) => m.stage === "Third Place");
  if (third && tieWon(third) === true) return "Third";
  return null;
}

/** The club, as it should be named alongside the other teams on a podium. */
export const CLUB_NAME = "Bombay Gymkhana";

/** A match plus who it was against — a placing has to name the other team. */
export type PlacingMatch = OutcomeMatch & { opponents: { name: string } | null };

/**
 * Who finished first, second and third — us and the sides we played.
 *
 * Read off the bracket like `tournamentFinish`, and just as limited: the only
 * results in the database are our own, so a placing is knowable exactly when we
 * played the tie that settled it. Win or lose the final and both of the top two
 * are named; go out at the semi and nobody knows who lifted it, so those stay
 * null rather than being guessed at.
 */
export interface TournamentPlacings {
  first: string | null;
  second: string | null;
  third: string | null;
}

export function tournamentPlacings(
  matches: PlacingMatch[],
  us: string = CLUB_NAME,
): TournamentPlacings {
  const placings: TournamentPlacings = { first: null, second: null, third: null };
  const opponent = (m: PlacingMatch) => m.opponents?.name ?? null;

  const final = matches.find((m) => m.stage === "Final");
  if (final) {
    const won = tieWon(final);
    if (won === true) { placings.first = us; placings.second = opponent(final); }
    else if (won === false) { placings.first = opponent(final); placings.second = us; }
  }

  // A third-place playoff settles its own medal, whether or not we were in the final
  const third = matches.find((m) => m.stage === "Third Place");
  if (third) {
    const won = tieWon(third);
    if (won === true) placings.third = us;
    else if (won === false) placings.third = opponent(third);
  }

  return placings;
}

export interface TournamentRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * `resultOf` decides how a level scoreline is counted. The default counts goals
 * only, which is right for friendlies and for anything that has to agree with
 * the SQL head-to-head views; a bracket passes `matchOutcome` so a knockout
 * settled on pens lands in the W or L column instead of D.
 */
export function tournamentRecord(
  matches: OutcomeMatch[],
  resultOf: (m: OutcomeMatch) => MatchResult | null = matchResult,
): TournamentRecord {
  const rec: TournamentRecord = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const m of matches) {
    const r = resultOf(m);
    if (!r) continue; // unplayed fixture
    rec.played += 1;
    if (r === "W") rec.won += 1;
    else if (r === "D") rec.drawn += 1;
    else rec.lost += 1;
    rec.goalsFor += m.goals_for ?? 0;
    rec.goalsAgainst += m.goals_against ?? 0;
  }
  return rec;
}

// ── Player match stat aggregation ────────────────────────────────────────────
// Uses a structural type to avoid importing from queries.ts.
interface StatRow {
  minutes_played: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  injured: boolean;
}

export interface Totals {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  injuries: number;
}

function didPlay(r: StatRow): boolean {
  return r.minutes_played > 0 || r.goals > 0 || r.assists > 0 || r.yellow_cards > 0 || r.red_cards > 0;
}

export function sumStats(rows: StatRow[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      appearances: acc.appearances + (didPlay(r) ? 1 : 0),
      minutes: acc.minutes + r.minutes_played,
      goals: acc.goals + r.goals,
      assists: acc.assists + r.assists,
      yellow: acc.yellow + r.yellow_cards,
      red: acc.red + r.red_cards,
      injuries: acc.injuries + (r.injured ? 1 : 0),
    }),
    { appearances: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, injuries: 0 },
  );
}

/** "12 Apr – 20 Apr 2026", or a single date, or null when neither is set. */
export function formatDateRange(start: string | null, end: string | null): string | null {
  const fmt = (iso: string, withYear: boolean) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (start && end) {
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
  }
  if (start) return fmt(start, true);
  if (end) return fmt(end, true);
  return null;
}
