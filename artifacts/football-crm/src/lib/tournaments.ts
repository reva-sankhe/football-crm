import type { Match, MatchStage } from "./types";

// ── Match stage styling ───────────────────────────────────────────────────────
export interface StageCfg {
  label: string;
  short: string;
  text: string;
  bg: string;
  border: string;
}

export const STAGE_CFG: Record<MatchStage, StageCfg> = {
  "Group Stage":   { label: "Group Stage",   short: "GRP", text: "text-slate-400",   bg: "bg-slate-500/15",   border: "border-slate-500/30"   },
  "Round of 16":   { label: "Round of 16",   short: "R16", text: "text-sky-400",     bg: "bg-sky-500/15",     border: "border-sky-500/30"     },
  "Quarter Final": { label: "Quarter Final", short: "QF",  text: "text-blue-400",    bg: "bg-blue-500/15",    border: "border-blue-500/30"    },
  "Semi Final":    { label: "Semi Final",    short: "SF",  text: "text-violet-400",  bg: "bg-violet-500/15",  border: "border-violet-500/30"  },
  "Third Place":   { label: "Third Place",   short: "3rd", text: "text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/30"  },
  "Final":         { label: "Final",         short: "F",   text: "text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/30"   },
  "Friendly":      { label: "Friendly",      short: "FR",  text: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
};

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
  W: { label: "Win",  text: "text-emerald-400", bg: "bg-emerald-500/20" },
  D: { label: "Draw", text: "text-amber-400",   bg: "bg-amber-500/20"   },
  L: { label: "Loss", text: "text-red-400",     bg: "bg-red-500/20"     },
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
