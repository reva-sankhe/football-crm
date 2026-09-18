import {
  computeAcwr, collapseLoadByDay, teamSessionDatesFrom, computeWeeklyMonotonyStrain,
  computeZScore, usualRangeFor, Z_SCORE_MIN_WEEKS, CHRONIC_LOAD_FLOOR,
  type AcwrResult, type LoadRow, type UsualRange, type WeeklyMonotonyStrain,
} from "./report";
import { computeSessionCompleteness } from "./dataCompleteness";
import type { Player, TrainingSession } from "./types";

/**
 * Team training-load analytics — the figures behind Training → Overview.
 *
 * Pure: no Supabase imports. It takes `LoadRow`s, which means it inherits the
 * one definition of load the rest of the app already uses — `buildLoadRows` in
 * lib/report.ts folds rated sessions and match minutes together, using player
 * match RPE where available and a marked fallback where it is not. The player
 * profile, the printed report and the Dashboard alerts all read the same rows,
 * so the team view here cannot disagree with any of them.
 *
 * The `interpret*` functions are deterministic and written from the figures they
 * name. Change a threshold and change the sentence that reports it.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The Monday of the week a date falls in, as ISO. Weeks start Monday here. */
function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const offset = (d.getDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isoOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Date `weeks` × 7 days before `end`. null `weeks` (all time) has no cutoff. */
export function weeksAgo(weeks: number | null, end: Date): Date | null {
  if (!weeks) return null;
  return new Date(end.getTime() - weeks * 7 * 86_400_000);
}

/** Rows inside the last `weeks` weeks. null keeps everything. */
export function withinWeeks(rows: LoadRow[], weeks: number | null, now: Date = new Date()): LoadRow[] {
  const cutoff = weeksAgo(weeks, now);
  if (!cutoff) return rows;
  const cutoffIso = isoOfDate(cutoff);
  return rows.filter((r) => r.date != null && r.date >= cutoffIso);
}

// ── Weekly team load ──────────────────────────────────────────────────────────
export interface WeekLoad {
  /** ISO date of the Monday. Sorts correctly as a string. */
  weekStart: string;
  label: string;
  totalAu: number;
  /** Spread over the players who actually did something that week. */
  perPlayerAu: number;
  players: number;
  /** Distinct days trained or played. */
  days: number;
}

/**
 * One point per week, oldest first. Weeks nobody worked are omitted rather than
 * plotted at zero — a blank week in the calendar is not a week of no training,
 * it is usually a week nobody logged.
 */
export function buildWeeklyTeamLoad(rows: LoadRow[]): WeekLoad[] {
  const byWeek = new Map<string, { total: number; players: Set<string>; days: Set<string> }>();

  for (const r of rows) {
    if (r.date == null) continue; // an undated row has no week to belong to
    const key = weekStart(r.date);
    const held = byWeek.get(key) ?? { total: 0, players: new Set<string>(), days: new Set<string>() };
    held.total += r.load_au;
    held.players.add(r.player_id);
    held.days.add(r.date);
    byWeek.set(key, held);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartIso, v]) => ({
      weekStart: weekStartIso,
      label: weekLabel(weekStartIso),
      totalAu: Math.round(v.total),
      perPlayerAu: Math.round(v.total / v.players.size),
      players: v.players.size,
      days: v.days.size,
    }));
}

// ── Player load distribution ──────────────────────────────────────────────────
export interface PlayerLoadLine {
  player: Player;
  totalAu: number;
  /** Per day worked, not per calendar day — a rest day isn't a light day. */
  perDayAu: number;
  days: number;
  /** Share of the load that came from matches rather than rated sessions. */
  matchShare: number;
  /** Share of total load estimated from match minutes because a player RPE was missing. */
  estimatedMatchShare: number;
  acwr: AcwrResult;
}

/**
 * One line per player who did anything in the window, heaviest first.
 *
 * The workload ratio is computed from the *whole* set of rows for that player,
 * not the windowed ones: it needs 28 days behind the anchor, and a 4-week
 * display window must not truncate that history.
 */
export function buildPlayerLoadDistribution(
  windowed: LoadRow[],
  all: LoadRow[],
  players: Player[],
  now: Date = new Date(),
  sessions: Pick<TrainingSession, "date" | "session_type">[] = [],
): PlayerLoadLine[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const teamSessionDates = teamSessionDatesFrom(sessions);

  const grouped = new Map<string, LoadRow[]>();
  for (const r of windowed) {
    const list = grouped.get(r.player_id);
    if (list) list.push(r);
    else grouped.set(r.player_id, [r]);
  }

  const allByPlayer = new Map<string, LoadRow[]>();
  for (const r of all) {
    const list = allByPlayer.get(r.player_id);
    if (list) list.push(r);
    else allByPlayer.set(r.player_id, [r]);
  }

  const lines: PlayerLoadLine[] = [];
  for (const [playerId, rows] of grouped) {
    const player = byId.get(playerId);
    if (!player) continue; // a row whose player has since left the squad

    const days = collapseLoadByDay(rows);
    const totalAu = rows.reduce((s, r) => s + r.load_au, 0);
    const matchAu = rows.reduce((s, r) => (r.source === "match" ? s + r.load_au : s), 0);
    const estimatedMatchAu = rows.reduce(
      (s, r) => (r.source === "match" && r.estimated ? s + r.load_au : s),
      0,
    );

    lines.push({
      player,
      totalAu: Math.round(totalAu),
      perDayAu: days.length > 0 ? Math.round(totalAu / days.length) : 0,
      days: days.length,
      matchShare: totalAu > 0 ? matchAu / totalAu : 0,
      estimatedMatchShare: totalAu > 0 ? estimatedMatchAu / totalAu : 0,
      acwr: computeAcwr(collapseLoadByDay(allByPlayer.get(playerId) ?? []), now, undefined, teamSessionDates),
    });
  }

  return lines.sort((a, b) => b.totalAu - a.totalAu || a.player.name.localeCompare(b.player.name));
}

// ── Readings ──────────────────────────────────────────────────────────────────
/** What the weekly line says: the shape of the block, and any spike in it. */
export function interpretWeeklyLoad(weeks: WeekLoad[]): string {
  if (weeks.length === 0) {
    return "No load logged in this window. Rate a session or log match minutes and this fills in.";
  }

  const latest = weeks[weeks.length - 1];
  const parts: string[] = [
    `${plural(weeks.length, "week")} with load on record. The most recent, from ${latest.label}, `
    + `came to ${latest.totalAu.toLocaleString()} AU across ${plural(latest.players, "player")} `
    + `and ${plural(latest.days, "day")} — ${latest.perPlayerAu.toLocaleString()} AU each.`,
  ];

  if (weeks.length > 1) {
    const previous = weeks[weeks.length - 2];
    const change = previous.perPlayerAu > 0
      ? Math.round(((latest.perPlayerAu - previous.perPlayerAu) / previous.perPlayerAu) * 100)
      : null;
    // Per player, not total: a week with twice the turnout isn't twice the work
    if (change !== null) {
      parts.push(
        Math.abs(change) < 10
          ? `That's level with the week before (${previous.perPlayerAu.toLocaleString()} AU each).`
          : `That's ${Math.abs(change)}% ${change > 0 ? "up on" : "down on"} the week before `
            + `(${previous.perPlayerAu.toLocaleString()} AU each).`,
      );
    }

    const peak = [...weeks].sort((a, b) => b.perPlayerAu - a.perPlayerAu)[0];
    parts.push(
      peak.weekStart === latest.weekStart
        ? "That is the heaviest week per player in the window."
        : `The heaviest week per player was ${peak.label} at ${peak.perPlayerAu.toLocaleString()} AU.`,
    );
  }

  return parts.join(" ");
}

/** Who is carrying the load, and whose current week is above their recent baseline. */
export function interpretLoadDistribution(lines: PlayerLoadLine[]): string {
  if (lines.length === 0) {
    return "Nobody has load logged in this window.";
  }

  const parts: string[] = [];
  const total = lines.reduce((s, l) => s + l.totalAu, 0);
  const heaviest = lines[0];
  const lightest = lines[lines.length - 1];

  parts.push(
    `${plural(lines.length, "player")} carried ${total.toLocaleString()} AU between them. `
    + `${heaviest.player.name} took the most at ${heaviest.totalAu.toLocaleString()} AU across `
    + `${plural(heaviest.days, "day")} (${heaviest.perDayAu.toLocaleString()} AU a day).`,
  );

  if (lines.length > 1) {
    parts.push(
      `${lightest.player.name} the least at ${lightest.totalAu.toLocaleString()} AU across `
      + `${plural(lightest.days, "day")}.`,
    );
    const topThird = lines.slice(0, Math.max(1, Math.ceil(lines.length / 3)));
    const share = Math.round((topThird.reduce((s, l) => s + l.totalAu, 0) / total) * 100);
    parts.push(
      share >= 50
        ? `The busiest third took ${share}% of all load — it is being carried by a small group.`
        : `The busiest third took ${share}% of all load, so it is spread reasonably wide.`,
    );
  }

  const flagged = lines.filter((l) => l.acwr.status === "elevated" || l.acwr.status === "spike");
  if (flagged.length > 0) {
    parts.push(
      `${flagged.map((l) => `${l.player.name} (${round1(l.acwr.acwr ?? 0)})`).join(", ")} `
      + `${flagged.length === 1 ? "is" : "are"} above their typical workload range — the last seven days `
      + "are high against their own previous three-week baseline.",
    );
  } else {
    parts.push("Nobody with a completed baseline is above their typical workload range.");
  }

  const matchHeavy = lines.filter((l) => l.estimatedMatchShare > 0);
  if (matchHeavy.length > 0) {
    parts.push(
      `${plural(matchHeavy.length, "player")} have match load estimated at RPE 7 because their match RPE was not logged.`,
    );
  }

  return parts.join(" ");
}

// ── Training Overview rebuild ────────────────────────────────────────────────
// Everything below is new, additive data-layer support for the rebuilt tab —
// none of it is wired into any page yet. Kept alongside the functions above
// (buildWeeklyTeamLoad, buildPlayerLoadDistribution, and their interpretations)
// rather than replacing them in place, so the currently-live page keeps
// working unchanged until the new layout actually swaps over to these.

/** How many of a squad-weekly series' preceding weeks feed the "usual range" band. */
const USUAL_RANGE_MAX_WEEKS = 12;

export interface SquadWeekLoad {
  /** ISO date of the Monday this tile starts on. Sorts correctly as a string. */
  weekStart: string;
  /** ISO date this tile actually ends on — weekStart + 6 days, or `end` if partial. */
  weekEnd: string;
  label: string;
  totalAu: number;
  /**
   * Total ÷ the active squad size (a constant across every week), not ÷ the
   * number of players who happened to log something that week. Dividing by
   * turnout would just move the "well-attended week looks heavier" distortion
   * from the numerator to the denominator — a week where only the five
   * hardest trainers logged would still read as a uniquely heavy week.
   */
  perPlayerAu: number;
  /** Distinct players who logged anything this week — informational, not the perPlayerAu divisor. */
  players: number;
  /** Distinct calendar days with any load logged. */
  days: number;
  estimatedAu: number;
  /** estimatedAu ÷ totalAu, as a 0–1 fraction. 0 when totalAu is 0. */
  estimatedShare: number;
  /**
   * True for a week cut short by `end` — at most the last entry in a series
   * can be true. A partial week is real progress worth showing, not worth
   * comparing: `weekOnWeekPerPlayerPct` is null on a partial week, and it
   * should never be used as either side of any other week's comparison.
   */
  isPartial: boolean;
  /** vs the immediately preceding (always-complete) week's perPlayerAu. Null for the first week, a partial week, or when the preceding week was 0. */
  weekOnWeekPerPlayerPct: number | null;
}

/**
 * One entry per non-overlapping calendar week (Monday–Sunday) from `start`
 * through `end`, inclusive — every week in range gets an entry, including a
 * genuine zero for a week nobody logged anything. This is a deliberate
 * reversal of `buildWeeklyTeamLoad`'s sparse, omit-empty-weeks behavior: a
 * vanished week can hide a real gap (a team break should be visible on the
 * chart, not silently absent from it), and a dense series is what makes an
 * unbroken "oldest first" axis and an explicit partial trailing week
 * possible at all.
 *
 * `squadSize` is the active roster count used as the constant `perPlayerAu`
 * divisor — pass the count of active players, not `players.length` filtered
 * by anything week-specific.
 */
export function buildSquadWeeklyLoad(
  rows: LoadRow[],
  start: Date,
  end: Date,
  squadSize: number,
): SquadWeekLoad[] {
  const out: SquadWeekLoad[] = [];
  let previousPerPlayerAu: number | null = null;

  const firstMonday = weekStart(isoOfDate(start));
  for (
    let weekStartDate = new Date(firstMonday + "T00:00:00");
    weekStartDate <= end;
    weekStartDate = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 7)
  ) {
    const fullWeekEnd = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate() + 6);
    const isPartial = fullWeekEnd > end;
    const weekEndDate = isPartial ? end : fullWeekEnd;
    const weekStartIso = isoOfDate(weekStartDate);
    const weekEndIso = isoOfDate(weekEndDate);

    const weekRows = rows.filter((r) => r.date != null && r.date >= weekStartIso && r.date <= weekEndIso);
    const totalAu = weekRows.reduce((s, r) => s + r.load_au, 0);
    const estimatedAu = weekRows.reduce((s, r) => (r.estimated ? s + r.load_au : s), 0);
    const players = new Set(weekRows.map((r) => r.player_id)).size;
    const days = new Set(weekRows.map((r) => r.date)).size;
    const perPlayerAu = squadSize > 0 ? totalAu / squadSize : 0;

    const weekOnWeekPerPlayerPct = !isPartial && previousPerPlayerAu !== null && previousPerPlayerAu > 0
      ? ((perPlayerAu - previousPerPlayerAu) / previousPerPlayerAu) * 100
      : null;

    out.push({
      weekStart: weekStartIso,
      weekEnd: weekEndIso,
      label: weekLabel(weekStartIso),
      totalAu: Math.round(totalAu),
      perPlayerAu: Math.round(perPlayerAu),
      players,
      days,
      estimatedAu: Math.round(estimatedAu),
      estimatedShare: totalAu > 0 ? estimatedAu / totalAu : 0,
      isPartial,
      weekOnWeekPerPlayerPct,
    });
    previousPerPlayerAu = perPlayerAu;
  }

  return out;
}

/**
 * One fixed "usual range" band for the weekly-load chart — computed once
 * from the most recent (up to `USUAL_RANGE_MAX_WEEKS`) *complete* weeks
 * strictly before the series' final entry, and drawn as a constant shaded
 * region across the whole chart. Deliberately not a rolling, week-by-week
 * band: a single reference region is what "a shaded usual-range band"
 * (singular) describes, and is far simpler to read than a ribbon that
 * reshapes underneath every point.
 *
 * Null below `Z_SCORE_MIN_WEEKS` (8) of preceding complete weeks — the
 * explicit "not enough history yet" state from `usualRangeFor`, propagated
 * up: a chart with fewer than 8 prior weeks shows a bare trend line, no band.
 */
export function computeSquadUsualLoadRange(weekly: SquadWeekLoad[]): UsualRange | null {
  if (weekly.length < 2) return null;
  const current = weekly[weekly.length - 1];
  const history = weekly
    .slice(0, weekly.length - 1)
    .slice(-USUAL_RANGE_MAX_WEEKS)
    .map((w) => w.perPlayerAu);
  if (history.length < Z_SCORE_MIN_WEEKS) return null;
  return usualRangeFor(computeZScore(current.perPlayerAu, history));
}

// ── Load to watch ─────────────────────────────────────────────────────────────
/** Ordered worst-first: Spike, then Elevated, then Low. Low Base and Building are never watch-list material — there's no trustworthy ratio to act on yet. */
const WATCH_TIER: Partial<Record<AcwrResult["status"], number>> = { spike: 0, elevated: 1, low: 2 };

export interface LoadToWatchRow {
  player: Player;
  status: AcwrResult["status"];
  /** (acwr − 1) × 100 — how far above/below the player's own usual load this reads, e.g. 65 for "65% above usual". Null when acwr itself is null. */
  pctVsUsual: number | null;
  acwr: number | null;
  weeklyAu: number;
  weekOnWeekPct: number | null;
}

/**
 * Every active player whose current ratio sits meaningfully outside their
 * own usual range — too high (Spike, Elevated) or too low (Low). A player
 * well under their usual load is as worth a coach's attention as one running
 * hot (returning too cautiously from injury, quietly disengaging, an
 * attendance problem), so this deliberately isn't a "risk" list scoped to
 * overload alone.
 *
 * Computed from `all` (each player's full history) rather than a windowed
 * slice, and over every active player rather than only those who logged
 * something recently — a player who has gone quiet is exactly the case a
 * "Low" watch entry exists to catch, and they would otherwise be invisible
 * to any calculation that only looks at players with recent rows.
 */
export function buildLoadToWatch(
  all: LoadRow[],
  players: Player[],
  anchor: Date,
  teamSessionDates: string[],
): LoadToWatchRow[] {
  const allByPlayer = new Map<string, LoadRow[]>();
  for (const r of all) {
    const list = allByPlayer.get(r.player_id);
    if (list) list.push(r);
    else allByPlayer.set(r.player_id, [r]);
  }

  const rows: LoadToWatchRow[] = [];
  for (const player of players) {
    const acwr = computeAcwr(collapseLoadByDay(allByPlayer.get(player.id) ?? []), anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
    if (WATCH_TIER[acwr.status] === undefined) continue;
    rows.push({
      player,
      status: acwr.status,
      pctVsUsual: acwr.acwr !== null ? (acwr.acwr - 1) * 100 : null,
      acwr: acwr.acwr,
      weeklyAu: Math.round(acwr.acute),
      weekOnWeekPct: acwr.weekOnWeekPct,
    });
  }

  return rows.sort((a, b) => {
    const tierDiff = WATCH_TIER[a.status]! - WATCH_TIER[b.status]!;
    if (tierDiff !== 0) return tierDiff;
    // Worst-first inside a tier: furthest below 1.0 for Low, furthest above for Spike/Elevated.
    return a.status === "low" ? (a.acwr ?? 0) - (b.acwr ?? 0) : (b.acwr ?? 0) - (a.acwr ?? 0);
  });
}

export function interpretLoadToWatch(rows: LoadToWatchRow[]): string {
  if (rows.length === 0) return "Nobody is outside their usual load range right now.";
  const counts = { spike: 0, elevated: 0, low: 0 } as Record<"spike" | "elevated" | "low", number>;
  for (const r of rows) counts[r.status as "spike" | "elevated" | "low"]++;
  const parts = [
    counts.spike > 0 ? plural(counts.spike, "spiking") : null,
    counts.elevated > 0 ? plural(counts.elevated, "elevated") : null,
    counts.low > 0 ? `${plural(counts.low, "player")} well below usual` : null,
  ].filter((p): p is string => p !== null);
  return `${plural(rows.length, "player")} outside their usual range: ${parts.join(", ")}.`;
}

// ── Squad table ───────────────────────────────────────────────────────────────
export interface SquadTableRow {
  player: Player;
  weeklyAu: number;
  weekOnWeekPct: number | null;
  status: AcwrResult["status"];
  /** Rated-session rows (not match rows) logged in the display window. */
  sessionsLogged: number;
  /** Share of the window's total load that was estimated rather than rated, 0–1. 0 when the player logged nothing. */
  estimatedShare: number;
  /** Up to the last 12 complete weeks ending at `anchor`, oldest first — a sparkline shape, not a flagged metric here. */
  monotonySparkline: { weekStart: string; monotony: number | null }[];
}

/**
 * Every active player, one row each, for the sortable squad table replacing
 * the deleted scatter — status and weekly figures from the *full* history
 * (same reasoning as `buildLoadToWatch`: a quiet player is a real row, not
 * an absence), while sessionsLogged/estimatedShare are scoped to `windowed`,
 * the currently-selected display window.
 */
export function buildSquadTable(
  windowed: LoadRow[],
  all: LoadRow[],
  players: Player[],
  anchor: Date,
  teamSessionDates: string[],
): SquadTableRow[] {
  const allByPlayer = new Map<string, LoadRow[]>();
  for (const r of all) {
    const list = allByPlayer.get(r.player_id);
    if (list) list.push(r);
    else allByPlayer.set(r.player_id, [r]);
  }
  const windowedByPlayer = new Map<string, LoadRow[]>();
  for (const r of windowed) {
    const list = windowedByPlayer.get(r.player_id);
    if (list) list.push(r);
    else windowedByPlayer.set(r.player_id, [r]);
  }

  // 12 clean Monday-aligned weeks ending exactly at `anchor` (always a Sunday
  // — see pinnedWeeklyAnchor) — no partial trailing week in the sparkline.
  const sparklineStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - (12 * 7 - 1));

  return players.map((player) => {
    const full = allByPlayer.get(player.id) ?? [];
    const windowedRows = windowedByPlayer.get(player.id) ?? [];
    const acwr = computeAcwr(collapseLoadByDay(full), anchor, CHRONIC_LOAD_FLOOR, teamSessionDates);
    const totalAu = windowedRows.reduce((s, r) => s + r.load_au, 0);
    const estimatedAu = windowedRows.reduce((s, r) => (r.estimated ? s + r.load_au : s), 0);
    const monotonyWeeks: WeeklyMonotonyStrain[] = computeWeeklyMonotonyStrain(full, sparklineStart, anchor);

    return {
      player,
      weeklyAu: Math.round(acwr.acute),
      weekOnWeekPct: acwr.weekOnWeekPct,
      status: acwr.status,
      sessionsLogged: windowedRows.filter((r) => r.source === "session").length,
      estimatedShare: totalAu > 0 ? estimatedAu / totalAu : 0,
      monotonySparkline: monotonyWeeks.map((w) => ({ weekStart: w.weekStart, monotony: w.monotony })),
    };
  });
}

export function interpretSquadTable(rows: SquadTableRow[]): string {
  if (rows.length === 0) return "No active players.";
  const loggedThisWeek = rows.filter((r) => r.weeklyAu > 0).length;
  return `${loggedThisWeek} of ${plural(rows.length, "player")} logged load this week.`;
}

export function interpretSquadWeeklyLoad(weekly: SquadWeekLoad[]): string {
  if (weekly.length === 0) return "No load logged in this window.";
  const latest = weekly[weekly.length - 1];
  if (latest.isPartial) {
    return `${latest.perPlayerAu.toLocaleString()} AU per player so far this week (in progress).`;
  }
  if (latest.weekOnWeekPerPlayerPct === null) {
    return `${latest.perPlayerAu.toLocaleString()} AU per player this week.`;
  }
  const pct = Math.round(latest.weekOnWeekPerPlayerPct);
  return Math.abs(pct) < 10
    ? `${latest.perPlayerAu.toLocaleString()} AU per player this week, level with last week.`
    : `${latest.perPlayerAu.toLocaleString()} AU per player this week, ${Math.abs(pct)}% ${pct > 0 ? "up on" : "down on"} last week.`;
}

// ── Data quality ──────────────────────────────────────────────────────────────
export interface DataQualityPanel {
  sessionsWithNoRpe: number;
  /** Non-Lecture sessions in the window — the same scope computeSessionCompleteness uses. */
  totalSessions: number;
  /** 0–100, rounded. 0 when there's no load in the window at all. */
  estimatedSharePct: number;
}

export function buildDataQualityPanel(
  sessions: TrainingSession[],
  attendance: { session_id: string; player_id: string; status: string }[],
  rpe: { session_id: string; player_id: string }[],
  windowedLoadRows: LoadRow[],
  start: Date,
  end: Date,
): DataQualityPanel {
  const startIso = isoOfDate(start);
  const endIso = isoOfDate(end);
  const windowedSessions = sessions.filter((s) => s.date >= startIso && s.date <= endIso);
  const completeness = computeSessionCompleteness(windowedSessions, attendance, rpe);
  const totalAu = windowedLoadRows.reduce((s, r) => s + r.load_au, 0);
  const estimatedAu = windowedLoadRows.reduce((s, r) => (r.estimated ? s + r.load_au : s), 0);

  return {
    sessionsWithNoRpe: completeness.filter((c) => c.rpeMissingEntirely).length,
    totalSessions: completeness.length,
    estimatedSharePct: totalAu > 0 ? Math.round((estimatedAu / totalAu) * 100) : 0,
  };
}

export function interpretDataQuality(panel: DataQualityPanel): string {
  if (panel.totalSessions === 0) return "No sessions in this window yet.";
  return panel.sessionsWithNoRpe === 0
    ? `Every session has at least one RPE logged, and ${panel.estimatedSharePct}% of squad load this period is estimated rather than rated.`
    : `${panel.sessionsWithNoRpe} of ${plural(panel.totalSessions, "session")} have no RPE logged from anyone, and ${panel.estimatedSharePct}% of squad load this period is estimated rather than rated.`;
}
