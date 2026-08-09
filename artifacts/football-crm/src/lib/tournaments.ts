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

export interface TournamentRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

export function tournamentRecord(
  matches: Pick<Match, "goals_for" | "goals_against">[]
): TournamentRecord {
  const rec: TournamentRecord = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const m of matches) {
    const r = matchResult(m);
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
