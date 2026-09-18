import {
  collapseMatchDays, countsAsAttended, matchDayAttendance, type MatchDayAttendance,
} from "./attendance";
import { STATUS, ordinal, type Mode } from "./viz";
import { sumStats, type Totals, type TournamentFinish } from "./tournaments";
import { getBroncoTier, type BroncoTier } from "./types";
import type {
  Player, SessionAttendance, SessionRPE, TestResult, TrainingSession,
} from "./types";
import type { PlayerMatchStat } from "./queries";

/** Inclusive ISO date range; null means "all time". */
export interface ReportRange {
  from: string;
  to: string;
}

type ResultRow = TestResult & {
  test_sessions?: { test_date: string; test_name: string; type: string | null } | null;
  players?: { team?: string | null } | null;
};
type RpeRow = SessionRPE & { sessions?: TrainingSession | null };
type AttendanceRow = Pick<SessionAttendance, "player_id" | "session_id" | "status">;

/** Everything the report page needs, fetched once and shared across players. */
export interface ReportData {
  sessions: TrainingSession[];
  attendance: AttendanceRow[];
  results: (ResultRow & { player_id: string })[];
  rpe: RpeRow[];
  matchStats: PlayerMatchStat[];
  /** tournament id → where the team finished, derived from the bracket. */
  finishes: Map<string, TournamentFinish>;
}

export interface MonthlyAttendance {
  month: string;
  total: number;
  attended: number;
  pct: number;
}

export interface AttendanceSlice {
  total: number;
  attended: number;
  /** null when there were no sessions to attend. */
  pct: number | null;
}

/** Matches are availability, not training turnout — they are counted apart. */
export function isMatchSession(s: { session_type: string }): boolean {
  return s.session_type === "Match";
}

export interface AcwrResult {
  acwr: number | null;
  /** This week's total load — the latest 7 calendar days. Same value as `acute`. */
  acute: number;
  /** The single week immediately before the acute week (not the 3-week baseline). */
  previousWeekAu: number;
  /** (acute − previousWeekAu) ÷ previousWeekAu × 100. Null when the previous week had no load. */
  weekOnWeekPct: number | null;
  /** Average weekly load over the 21 days before the acute week. */
  baselineWeeklyAvg: number;
  /** Calendar days from the first logged workload through the anchor date. */
  historyDays: number;
  /** A ratio is only meaningful after a complete 28-day workload history. */
  hasBaseline: boolean;
  /**
   * "low_base" takes priority over the ratio-derived bands whenever
   * `baselineWeeklyAvg` is below `CHRONIC_LOAD_FLOOR` (once a baseline exists
   * at all) — a small absolute increase on a near-zero baseline can otherwise
   * read as a dramatic ratio. `acwr` stays populated either way; only the
   * classification is suppressed.
   */
  status: "building" | "low_base" | "low" | "typical" | "elevated" | "spike";
  /** The date the rolling windows were measured back from. */
  asAt: string;
}

export interface WorkloadRatioWindows {
  end: Date;
  acuteStart: Date;
  baselineStart: Date;
  baselineEnd: Date;
}

export interface PlayerReport {
  player: Player;
  range: ReportRange | null;
  attendance: {
    /** Every session type — what the monthly chart and table below report on. */
    total: number;
    attended: number;
    pct: number | null;
    monthly: MonthlyAttendance[];
    /** Training, gym and recovery — the sessions a player is expected at. */
    training: AttendanceSlice;
    /**
     * Match-day availability, reported separately from turning up to train.
     * `attended`/`total` count fixtures; `pct` counts days — see
     * `matchDayAttendance`.
     */
    match: MatchDayAttendance;
    /**
     * Unscoped figures, so an all-time report leads with the same numbers the
     * player profile does rather than a lifetime average.
     */
    currentMonthTraining: AttendanceSlice & { month: string };
    currentMonthMatch: MatchDayAttendance;
  };
  matches: Totals & {
    callUps: number;
    byTournament: { name: string; totals: Totals; finish?: TournamentFinish }[];
    /** Current calendar year, matching the profile's Goals/Appearances tiles. */
    thisYear: Totals & { callUps: number };
  };
  fitness: {
    tested: number;
    bestBronco: number | null;
    latestBronco: number | null;
    /** Test date of the latest recorded bronco, for the "Mar 26" sub-line. */
    latestBroncoDate: string | null;
    teamBand: TeamBand | null;
    bestMas: number | null;
    latestMas: number | null;
    bestTen: number | null;
    latestTen: number | null;
    bestTwenty: number | null;
    latestTwenty: number | null;
    tier: BroncoTier | null;
    series: { label: string; mins: number }[];
  };
  load: {
    /** Rated sessions and match minutes together. */
    totalAu: number;
    /** Sum of the planned ("set") load. Matches carry no plan, so they add nothing. */
    plannedAu: number;
    sessionCount: number;
    /** Fixtures contributing minutes, counted apart from rated sessions. */
    matchCount: number;
    /** Estimated match load inside the selected report range. */
    estimatedMatchAu: number;
    estimatedMatchCount: number;
    /** Estimated match load affecting the current ratio, by ratio window. */
    acuteEstimatedMatchAu: number;
    baselineEstimatedMatchAu: number;
  } & AcwrResult;
}

// ── Team band ─────────────────────────────────────────────────────────────────
export interface TeamBand {
  label: string;
  color: string;
}

const BAND_LABELS = ["Top 25%", "Upper Mid", "Lower Mid", "Bottom 25%"] as const;

/**
 * Where a bronco time sits against the squad's latest times. Shared by the
 * player profile and the printed report so the two can never disagree; the
 * report passes "light" because it always prints on white.
 */
export function teamBandFor(
  bronco: number | null | undefined,
  squadBroncos: number[],
  mode: Mode,
): TeamBand | null {
  if (bronco == null || squadBroncos.length === 0) return null;
  const sorted = [...squadBroncos].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (idx - lo) * ((sorted[hi] ?? sorted[lo]) - sorted[lo]);
  };
  // Lower is faster, so quartile 1 is the top band.
  const i = bronco <= q(25) ? 0 : bronco <= q(50) ? 1 : bronco <= q(75) ? 2 : 3;
  return { label: BAND_LABELS[i], color: ordinal(mode, 4, i) };
}

// ── Range helpers ─────────────────────────────────────────────────────────────
function inRange(date: string | null | undefined, range: ReportRange | null): boolean {
  // An all-time report keeps rows whose joined date failed to load — dropping
  // them would silently under-count tests and matches.
  if (!range) return true;
  if (!date) return false;
  return date >= range.from && date <= range.to;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses an ISO date string as a local-midnight Date — never UTC. */
function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Load ──────────────────────────────────────────────────────────────────────
/**
 * Fallback used only when minutes are known but that player did not submit a
 * match RPE. Kept in one place so estimated match load is consistent everywhere.
 */
export const MATCH_RPE = 7;

/**
 * One unit of load, wherever it came from. Training carries the player's own
 * rating; matches use the player's RPE when it is logged, otherwise a clearly
 * marked `MATCH_RPE × minutes` estimate.
 */
export interface LoadRow {
  player_id: string;
  date: string | null;
  load_au: number;
  /** "match" rows use known match minutes; "session" rows are rated sessions. */
  source: "session" | "match";
  /** Individual RPE used for this row; 7 only when an estimated match fallback was used. */
  rpe: number | null;
  /** True when a match has minutes but no player-rated match RPE. */
  estimated: boolean;
  /** What the session was planned for. Matches carry no plan. */
  planned_load_au: number | null;
}

/**
 * Folds rated sessions and match minutes into one list.
 *
 * The match grid (`match_player_stats`) is the primary source of match
 * minutes: a grid row's minutes are paired with that player's own logged
 * match RPE when they submitted one, else MATCH_RPE (7). A real grid row
 * always wins, even one recording 0 minutes for an unused sub — that's a
 * deliberate signal, not missing data.
 *
 * A player who submitted a match RPE with their own `minutes_played` but has
 * no grid row for that match still counts — that's reported data, not a
 * fabricated estimate — but only when that self-reported minutes figure is
 * greater than 0. Attendance alone never establishes minutes played and so
 * never creates match load on its own; nor does a match with no grid row
 * and no self-reported minutes.
 *
 * `estimated` on the resulting row means "not the player's own genuine
 * rating", which is broader than "no rating at all": a `session_rpe` row can
 * itself carry `estimated: true` — a flat backfilled figure (a tournament
 * weekend rated at a single RPE after the fact, say) rather than something
 * the player reported — and that flag always survives onto the load row it
 * produces, on both the match and training side.
 *
 * Training works differently: a non-Match session has no per-player minutes
 * grid, only whether they attended. A player who attended but never submitted
 * RPE gets an estimate — the session's own team median RPE (needs at least 3
 * other submissions to be a meaningful signal, not one teammate's rating
 * standing in for "the team"), else the session's `planned_rpe`, else no row
 * at all — same "don't fabricate data" principle as the match side. A `Late`
 * player is estimated at the session's full `duration_mins`, not a prorated
 * one; a deliberate simplification, not a bug.
 */
export function buildLoadRows(
  rpe: RpeRow[],
  matchStats: PlayerMatchStat[],
  attendance: AttendanceRow[] = [],
  sessions: TrainingSession[] = [],
): LoadRow[] {
  const out: LoadRow[] = [];
  /** (player, session) pairs already accounted for by a real grid row. */
  const fromGrid = new Set<string>();
  /** A player-rated match RPE, keyed so the match grid can supply its minutes. */
  const ratedMatchRpe = new Map<string, RpeRow>();

  for (const row of rpe) {
    if (!row.sessions || !isMatchSession(row.sessions) || row.rpe <= 0) continue;
    ratedMatchRpe.set(`${row.player_id}:${row.session_id}`, row);
  }

  for (const s of matchStats) {
    const sessionId = s.matches?.sessions?.id;
    if (!sessionId) continue;
    const key = `${s.player_id}:${sessionId}`;
    fromGrid.add(key);
    if (s.minutes_played <= 0) continue; // named in the squad but didn't play
    const rated = ratedMatchRpe.get(key);
    const effort = rated?.rpe ?? MATCH_RPE;
    out.push({
      player_id: s.player_id,
      date: s.matches?.sessions?.date ?? null,
      load_au: Math.round(effort * s.minutes_played),
      source: "match",
      rpe: effort,
      // No player rating at all falls back to MATCH_RPE — always an
      // estimate. A real rating can itself be a backfilled figure (e.g. a
      // flat tournament RPE) rather than something the player reported.
      estimated: rated === undefined || rated.estimated === true,
      planned_load_au: null,
    });
  }

  for (const r of rpe) {
    const isMatch = r.sessions ? isMatchSession(r.sessions) : false;
    if (isMatch) {
      // A logged match RPE with the player's own minutes is real, reported
      // data — used only when no grid row already accounts for this player
      // in this match, and only when their own minutes are actually > 0.
      if (fromGrid.has(`${r.player_id}:${r.session_id}`)) continue;
      if (!r.minutes_played || r.minutes_played <= 0) continue;
      out.push({
        player_id: r.player_id,
        date: r.sessions?.date ?? null,
        load_au: Math.round(r.rpe * r.minutes_played),
        source: "match",
        rpe: r.rpe,
        estimated: r.estimated === true,
        planned_load_au: null,
      });
      continue;
    }
    out.push({
      player_id: r.player_id,
      date: r.sessions?.date ?? null,
      load_au: r.load_au,
      source: "session",
      rpe: r.rpe,
      estimated: r.estimated === true,
      planned_load_au: r.sessions?.planned_load_au ?? null,
    });
  }

  // ── Training-side missing-RPE estimate ─────────────────────────────────
  const submittedKeys = new Set(rpe.map((r) => `${r.player_id}:${r.session_id}`));
  const rpeBySession = new Map<string, number[]>();
  for (const r of rpe) {
    if (r.sessions && isMatchSession(r.sessions)) continue; // matches use their own fallback, above
    if (!rpeBySession.has(r.session_id)) rpeBySession.set(r.session_id, []);
    rpeBySession.get(r.session_id)!.push(r.rpe);
  }
  const median = (nums: number[]): number => {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  for (const session of sessions) {
    // Strictly "Training" — not just "not a Match". A Lecture carries no
    // physical load by design (see SessionsTab.tsx: "a lecture carries no
    // physical load — it's an attendance record"), so estimating an RPE×
    // duration load for a missed Lecture RPE would fabricate load that was
    // never supposed to exist in the first place.
    if (session.session_type !== "Training") continue;
    const attendedPlayerIds = attendance
      .filter((a) => a.session_id === session.id && countsAsAttended(a.status))
      .map((a) => a.player_id);
    if (attendedPlayerIds.length === 0) continue;
    const sessionRpes = rpeBySession.get(session.id) ?? [];

    for (const playerId of attendedPlayerIds) {
      if (submittedKeys.has(`${playerId}:${session.id}`)) continue; // already has a real row

      const effort = sessionRpes.length >= 3 ? median(sessionRpes)
        : session.planned_rpe > 0 ? session.planned_rpe
        : null;
      if (effort === null) continue;

      out.push({
        player_id: playerId,
        date: session.date,
        load_au: Math.round(effort * session.duration_mins),
        source: "session",
        rpe: effort,
        estimated: true,
        planned_load_au: session.planned_load_au ?? null,
      });
    }
  }

  return out;
}

/**
 * One row per date, loads summed.
 *
 * A tournament day is four or five fixtures, and a player's body doesn't
 * experience those as separate sessions — it experiences one hard day. Left
 * uncollapsed, the load chart repeats the same date across several points and
 * the rolling average silently becomes "last four fixtures" instead of "last
 * four days". Totals are unchanged, so the workload ratio is identical either way; this is
 * about the unit the load is expressed in.
 *
 * A day carrying any match load is marked `"match"`. Its `estimated` flag
 * stays true when any row folded into it — match or training — used an
 * estimated fallback, regardless of which row happened to be first.
 */
export function collapseLoadByDay(rows: LoadRow[]): LoadRow[] {
  const byDay = new Map<string, LoadRow>();
  const undated: LoadRow[] = [];

  for (const r of rows) {
    if (r.date == null) { undated.push(r); continue; }
    const key = `${r.player_id}:${r.date}`;
    const day = byDay.get(key);
    if (!day) {
      byDay.set(key, { ...r });
      continue;
    }
    day.load_au += r.load_au;
    if (r.planned_load_au != null) {
      day.planned_load_au = (day.planned_load_au ?? 0) + r.planned_load_au;
    }
    if (r.source === "match") {
      day.source = "match";
    }
    day.estimated ||= r.estimated;
  }

  return [...byDay.values(), ...undated];
}

// ── Dense daily series (for monotony/strain — not wired into any page yet) ────
export interface DenseDayLoad {
  date: string;
  load_au: number;
}

/**
 * Every calendar day in [start, end], zero where `dayRows` (already
 * collapsed to one row per day, per player — see collapseLoadByDay) has no
 * entry for it. ACWR is a sum, so a sparse series works fine for it; a real
 * per-day standard deviation (monotony, strain) needs rest days to actually
 * be zeros, not silently absent.
 */
export function denseDailyLoad(dayRows: LoadRow[], start: Date, end: Date): DenseDayLoad[] {
  const byDate = new Map<string, number>();
  for (const r of dayRows) {
    if (r.date == null) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.load_au);
  }
  const out: DenseDayLoad[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    const key = isoOf(cur);
    out.push({ date: key, load_au: byDate.get(key) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * A player's activity window for `denseDailyLoad` — not their squad tenure,
 * just the earliest/latest dates there's actual signal for.
 *
 * Start: the earliest of their row's `created_at`, or any attendance/RPE/
 * match date — `created_at` alone is an imperfect proxy, since a player's DB
 * row can post-date their real first activity.
 *
 * End: `windowEnd` while still active — the window keeps going. Once
 * inactive, the latest of their RPE/match dates or a Present/Late attendance
 * date; Absent and Injured attendance dates are excluded, since neither is
 * evidence the player was actually there.
 *
 * Dates outside [start, end] are meant to be left out of a dense series
 * entirely, never zeroed — zeroing them would fabricate a "rest day" for
 * someone not yet (or no longer) on the squad, distorting monotony's mean
 * for a mid-window joiner or leaver.
 */
export function playerActivityBounds(
  createdAt: string,
  attendance: { date: string; status: string }[],
  rpeAndMatchDates: string[],
  isActive: boolean,
  windowEnd: Date,
): { start: Date; end: Date } {
  const earliest = (dates: Date[]): Date => dates.reduce((a, b) => (b < a ? b : a));
  const latest = (dates: Date[]): Date => dates.reduce((a, b) => (b > a ? b : a));

  const start = earliest([
    toLocalDate(createdAt),
    ...attendance.map((a) => toLocalDate(a.date)),
    ...rpeAndMatchDates.map(toLocalDate),
  ]);

  if (isActive) return { start, end: windowEnd };

  const presenceDates = [
    ...attendance.filter((a) => a.status === "Present" || a.status === "Late").map((a) => toLocalDate(a.date)),
    ...rpeAndMatchDates.map(toLocalDate),
  ];
  // No real activity at all beyond their own row existing — a degenerate
  // single-day window rather than an empty or reversed range.
  const end = presenceDates.length > 0 ? latest(presenceDates) : start;
  return { start, end };
}

// ── Weekly load (standalone — not coupled to the ACWR baseline) ────────────────
export interface WeeklyLoad {
  weekStart: string;
  weekEnd: string;
  loadAu: number;
  /**
   * True when this window is cut short by `end` — fewer than 7 days, so its
   * `loadAu` isn't comparable to a full week's. Only the final entry can be
   * partial; every entry before it is a full 7-day week by construction.
   */
  isPartial: boolean;
  /** (loadAu − previous week's loadAu) ÷ previous week's loadAu × 100. Null for the first week, or when the previous week had no load. */
  weekOnWeekPct: number | null;
}

/**
 * One row per non-overlapping 7-day week from `start` through `end`
 * (inclusive) — week 1 is [start, start+6], week 2 is [start+7, start+13],
 * and so on, tiled the same way the season's own weekly anchors are already
 * stepped elsewhere (workloadAudit.mjs's status-change loop). A trailing
 * partial week is still emitted (see `isPartial`) rather than dropped, so a
 * trend chart can show "this week so far".
 *
 * Deliberately standalone: this is the same acute-window load `computeAcwr`
 * reports as `.acute` for one week ending at its anchor, generalized into a
 * full series with no baseline, floor, or team-break logic attached — a
 * trend chart or a z-score against a player's own history needs the raw
 * weekly numbers, not an ACWR classification.
 */
export function computeWeeklyLoad(rows: LoadRow[], start: Date, end: Date): WeeklyLoad[] {
  const at = (r: LoadRow) => (r.date ? new Date(r.date + "T00:00:00") : null);
  const dated = rows.flatMap((r) => {
    const date = at(r);
    return date ? [{ ...r, at: date }] : [];
  });

  const out: WeeklyLoad[] = [];
  let previousLoadAu: number | null = null;
  for (
    let weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    weekStart <= end;
    weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
  ) {
    const fullWeekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const isPartial = fullWeekEnd > end;
    const weekEnd = isPartial ? end : fullWeekEnd;
    const loadAu = dated.reduce((sum, row) =>
      row.at >= weekStart && row.at <= weekEnd ? sum + row.load_au : sum, 0);
    const weekOnWeekPct = previousLoadAu !== null && previousLoadAu > 0
      ? ((loadAu - previousLoadAu) / previousLoadAu) * 100
      : null;
    out.push({ weekStart: isoOf(weekStart), weekEnd: isoOf(weekEnd), loadAu: Math.round(loadAu), isPartial, weekOnWeekPct });
    previousLoadAu = loadAu;
  }
  return out;
}

// ── Monotony & strain (standalone — not coupled to the ACWR baseline) ──────────
export interface WeeklyMonotonyStrain {
  weekStart: string;
  weekEnd: string;
  loadAu: number;
  meanDailyLoad: number;
  /** Population SD of that week's daily loads — every day in [weekStart, weekEnd], rest days counted as 0 (see denseDailyLoad). */
  sdDailyLoad: number;
  /** meanDailyLoad ÷ sdDailyLoad — an undefined ratio when sdDailyLoad is 0 (every day identical, rest days included), so null rather than Infinity. */
  monotony: number | null;
  /** loadAu × monotony. Null whenever monotony is null — there's nothing to multiply. */
  strain: number | null;
  /** True once monotony exceeds 2.0 — training varied too little for the volume carried that week, a recognized injury-risk signal (Foster, 1998). Never true when monotony is null. */
  highMonotony: boolean;
  /** Same meaning as WeeklyLoad.isPartial — only the final entry can be true. */
  isPartial: boolean;
}

/**
 * Weekly monotony (mean daily load ÷ SD of daily load) and strain (weekly
 * load × monotony), tiled into the same non-overlapping 7-day weeks as
 * `computeWeeklyLoad` — see that function's docs for the tiling rule and the
 * `isPartial` trailing-week behavior.
 *
 * Built on `denseDailyLoad`: monotony's SD needs rest days to actually be
 * zeros, not silently absent — a week with one hard session and six real
 * rest days is very different from one with one hard session and six days
 * with no data, and only the dense, zero-filled series tells them apart.
 * Callers should pass `start`/`end` already clipped to the player's own
 * activity window (see `playerActivityBounds`) so an inactive stretch before
 * a player joined or after they left isn't zeroed into their monotony.
 *
 * Deliberately standalone, like `computeWeeklyLoad`: no ACWR baseline,
 * floor, or team-break logic attached.
 */
export function computeWeeklyMonotonyStrain(rows: LoadRow[], start: Date, end: Date): WeeklyMonotonyStrain[] {
  const out: WeeklyMonotonyStrain[] = [];
  for (
    let weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    weekStart <= end;
    weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
  ) {
    const fullWeekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const isPartial = fullWeekEnd > end;
    const weekEnd = isPartial ? end : fullWeekEnd;

    const dailyLoads = denseDailyLoad(rows, weekStart, weekEnd).map((d) => d.load_au);
    const n = dailyLoads.length;
    const loadAu = dailyLoads.reduce((s, v) => s + v, 0);
    const meanDailyLoad = n > 0 ? loadAu / n : 0;
    const variance = n > 0
      ? dailyLoads.reduce((s, v) => s + (v - meanDailyLoad) ** 2, 0) / n
      : 0;
    const sdDailyLoad = Math.sqrt(variance);
    const monotony = sdDailyLoad > 0 ? meanDailyLoad / sdDailyLoad : null;
    const strain = monotony !== null ? loadAu * monotony : null;

    out.push({
      weekStart: isoOf(weekStart),
      weekEnd: isoOf(weekEnd),
      loadAu: Math.round(loadAu),
      meanDailyLoad,
      sdDailyLoad,
      monotony,
      strain,
      highMonotony: monotony !== null && monotony > 2.0,
      isPartial,
    });
  }
  return out;
}

// ── Workload ratio (uncoupled ACWR) ────────────────────────────────────────────
/**
 * Below this weekly baseline, a ratio is classified "low_base" instead of by
 * its numeric band — a small absolute increase on a near-zero baseline (e.g.
 * a player just back from injury) can otherwise read as a dramatic spike.
 *
 * Fixed rule, not tuned from current data: 300 AU/week is roughly one light
 * session per week. This is meant to hold every season, not be recalibrated
 * off whatever's currently in the database.
 */
export const CHRONIC_LOAD_FLOOR = 300;

/**
 * A team-wide dead period of at least this many consecutive calendar days
 * with no Training or Match session — a real off-season/break, not any one
 * player's own absence — qualifies as a break worth resetting for. How long
 * ratios then stay "building" afterward is not this number: it's however
 * long the full 28-day acute+baseline window takes to move entirely past
 * the break (see `computeAcwr`), which is longer than this by definition.
 */
export const GAP_RESET_DAYS = 21;

/**
 * Every date the *whole squad* has a Training or Match session — the input
 * `computeAcwr`'s `teamSessionDates` param expects. Pass the full `sessions`
 * table (or every session in scope), not one player's rows; team-break
 * detection is squad-wide by design.
 */
export function teamSessionDatesFrom(sessions: Pick<TrainingSession, "date" | "session_type">[]): string[] {
  return sessions
    .filter((s) => s.session_type === "Training" || s.session_type === "Match")
    .map((s) => s.date);
}

/**
 * The date the squad's own session calendar most recently resumed after a
 * gap of at least `gapDays` *empty* days (no Training/Match at all) — null
 * if no such gap exists in `teamSessionDates` up to `anchor`.
 *
 * This is deliberately about the team's calendar, never an individual
 * player's attendance — an injury, illness, or being dropped from the squad
 * must never trigger this; only a genuine team-wide gap does. `low_base`
 * already covers a player whose own baseline is thin for other reasons.
 *
 * "At least `gapDays` empty days between session A and session B" means the
 * two dates are `gapDays + 1` calendar days apart (the days strictly between
 * them are the empty ones) — so with the default 21, a 22-day gap between
 * consecutive sessions triggers a reset and a 20-day gap does not.
 */
function findTeamBreakResumeDate(teamSessionDates: string[], anchor: Date, gapDays: number): Date | null {
  const dates = [...new Set(teamSessionDates)]
    .map(toLocalDate)
    .filter((d) => d <= anchor)
    .sort((a, b) => a.getTime() - b.getTime());

  let resumeDate: Date | null = null;
  for (let i = 1; i < dates.length; i++) {
    const daysApart = Math.round((dates[i].getTime() - dates[i - 1].getTime()) / 86_400_000);
    if (daysApart - 1 >= gapDays) resumeDate = dates[i];
  }
  return resumeDate;
}

// Boundaries are exact and intentionally asymmetric at 1.3 vs 1.5: Typical
// runs [0.8, 1.3), Elevated [1.3, 1.5] — see computeAcwr below.
export const ACWR_CONFIG: Record<AcwrResult["status"], { label: string; color: string; desc: string }> = {
  low:      { label: "Low",            color: "#94a3b8",      desc: "Recent workload is lower than the player's previous three-week average." },
  typical:  { label: "Typical",        color: STATUS.good,    desc: "Recent workload is broadly in line with the player's previous three weeks." },
  elevated: { label: "Elevated",       color: STATUS.warning, desc: "Recent workload is above the player's previous three-week average — worth monitoring alongside recovery and upcoming sessions." },
  spike:    { label: "Spike",          color: STATUS.critical,desc: "Recent workload is well above the player's previous three-week average — worth a closer look at workload, recovery, and upcoming sessions." },
  low_base: { label: "Low Base",       color: "#94a3b8",      desc: "The player's own three-week average is too low for this ratio to be a meaningful signal yet." },
  building: { label: "Building Baseline", color: "#94a3b8",   desc: "A complete 28-day workload history is needed before this ratio is classified." },
};

/**
 * The most recently completed Sunday on or before `referenceDate` — Sunday
 * being the last day of the team's fixed Wed/Fri/Sun training week.
 *
 * Every ACWR anchor in the app should be built from this rather than a raw
 * "now": a plain `new Date()` anchor means a player's status can change
 * purely because a coach opened the page on a different day of the week —
 * a training day silently rolling out of the trailing 7-day window with
 * nothing having actually changed. Pinning to the same Sunday all week means
 * Monday through Saturday all read the identical, just-completed week, and
 * the number only moves once, at the real weekly boundary.
 *
 * `referenceDate` is deliberately not always "today" — see `buildPlayerReport`,
 * which pins relative to a report's own selected range or last session date
 * rather than the literal present, so a report about the past doesn't anchor
 * to an unrelated today.
 *
 * If `referenceDate` itself is a Sunday, it snaps to that same day — a
 * deliberate simplification that treats that day's session as already
 * logged, rather than distinguishing a Sunday-morning check (before that
 * evening's session) from a Sunday-night one.
 */
export function pinnedWeeklyAnchor(referenceDate: Date = new Date()): Date {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function workloadRatioWindows(anchor?: Date): WorkloadRatioWindows {
  const supplied = anchor ?? new Date();
  const end = new Date(supplied.getFullYear(), supplied.getMonth(), supplied.getDate());
  const shift = (days: number) => new Date(end.getFullYear(), end.getMonth(), end.getDate() + days);
  return {
    end,
    acuteStart: shift(-6),
    baselineStart: shift(-27),
    baselineEnd: shift(-7),
  };
}

/**
 * Uncoupled acute:chronic workload ratio, measured back from `anchor`
 * (defaults to today). The acute period is exactly the latest 7 calendar days
 * (anchor − 6 through anchor); the baseline is the preceding 21 calendar days
 * (anchor − 27 through anchor − 7), averaged into a weekly value.
 *
 * Excluding the acute week from its own denominator makes the result easier to
 * read: "this week compared with what the player averaged over the prior three
 * weeks." Reports anchor to the end of the selected range so the number matches
 * the period being printed rather than silently reflecting the present day.
 */
/**
 * `floor` defaults to the real `CHRONIC_LOAD_FLOOR` constant; only tests pass
 * a different value, since the real one is a placeholder (0, inert) until
 * tuned against actual weekly-load percentiles.
 *
 * `teamSessionDates` — every date the whole squad had a Training/Match
 * session (not this one player's rows) — is optional and defaults to `[]`,
 * meaning "no team-break detection." Pass it to have a real team-wide gap
 * (see `GAP_RESET_DAYS`) force `status: "building"` until a fresh baseline
 * has rebuilt since the break ended, regardless of what this player's own
 * ratio would otherwise read.
 */
export function computeAcwr(
  rows: LoadRow[],
  anchor?: Date,
  floor: number = CHRONIC_LOAD_FLOOR,
  teamSessionDates: string[] = [],
): AcwrResult {
  const { end, acuteStart, baselineStart, baselineEnd } = workloadRatioWindows(anchor);
  // The single week right before the acute week — baselineEnd is already
  // exactly one day before acuteStart, so this just extends 7 days further back.
  const previousWeekStart = new Date(baselineEnd.getFullYear(), baselineEnd.getMonth(), baselineEnd.getDate() - 6);
  const at = (r: LoadRow) => (r.date ? new Date(r.date + "T00:00:00") : null);
  const dated = rows.flatMap((r) => {
    const date = at(r);
    return date ? [{ ...r, at: date }] : [];
  });

  const acute = dated.reduce((sum, row) =>
    row.at >= acuteStart && row.at <= end ? sum + row.load_au : sum, 0);
  const previousWeekAu = dated.reduce((sum, row) =>
    row.at >= previousWeekStart && row.at <= baselineEnd ? sum + row.load_au : sum, 0);
  const weekOnWeekPct = previousWeekAu > 0 ? ((acute - previousWeekAu) / previousWeekAu) * 100 : null;
  const baselineTotal = dated.reduce((sum, row) =>
    row.at >= baselineStart && row.at <= baselineEnd ? sum + row.load_au : sum, 0);
  const baselineWeeklyAvg = baselineTotal / 3;
  const firstLogged = dated.reduce<Date | null>(
    (earliest, row) => earliest === null || row.at < earliest ? row.at : earliest,
    null,
  );
  const historyDays = firstLogged
    ? Math.floor((end.getTime() - firstLogged.getTime()) / 86_400_000) + 1
    : 0;
  const hasBaseline = firstLogged !== null && firstLogged <= baselineStart && baselineWeeklyAvg > 0;
  const acwr = hasBaseline ? acute / baselineWeeklyAvg : null;

  // low_base only ever replaces what would otherwise be Spike — a low/typical/
  // elevated reading stays as-is even when the baseline is below the floor.
  // `hasBaseline` already requires baselineWeeklyAvg > 0, so a baseline of
  // exactly 0 routes to "building" above and never reaches this check at all.
  const ratioStatus: AcwrResult["status"] =
    acwr === null ? "building"
    : acwr < 0.8 ? "low"
    : acwr < 1.3 ? "typical"
    : acwr <= 1.5 ? "elevated"
    : "spike";
  const withFloor: AcwrResult["status"] =
    ratioStatus === "spike" && baselineWeeklyAvg < floor ? "low_base" : ratioStatus;

  // Team-wide break: overrides everything above, including a "building" the
  // ratio math alone would already have produced — a fresh team-wide start
  // needs its own rebuilt baseline, not a partial one spanning the break.
  // Stays "building" until the *entire* 28-day window (baselineStart through
  // end) falls on or after the resume date — comparing dates directly rather
  // than counting days avoids re-deriving the same 28-day-window arithmetic
  // as a separate, easy-to-desync magic number.
  const resumeDate = findTeamBreakResumeDate(teamSessionDates, end, GAP_RESET_DAYS);
  const inTeamBreakRebuild = resumeDate !== null && baselineStart < resumeDate;

  // A week with zero team Training/Match sessions in it (mid-break, before
  // any resume date is even detectable) has nothing to measure — reporting
  // "Low (0.00)" would read as a real, calm week rather than as no data.
  // Only applies when team dates were actually supplied (`[]` means "team-
  // break detection is off", not "the team did nothing this week").
  const acuteWeekIsTeamDead = teamSessionDates.length > 0 && !teamSessionDates.some((iso) => {
    const d = toLocalDate(iso);
    return d >= acuteStart && d <= end;
  });

  const forcedBuilding = inTeamBreakRebuild || acuteWeekIsTeamDead;
  const status: AcwrResult["status"] = forcedBuilding ? "building" : withFloor;
  const finalAcwr = forcedBuilding ? null : acwr;
  const finalHasBaseline = forcedBuilding ? false : hasBaseline;

  return {
    acwr: finalAcwr, acute, previousWeekAu, weekOnWeekPct, baselineWeeklyAvg,
    historyDays, hasBaseline: finalHasBaseline, status, asAt: isoOf(end),
  };
}

// ── EWMA ACWR (alongside computeAcwr, not a replacement for it) ────────────────
/**
 * Standard smoothing constants for a 7-day acute / 28-day chronic EWMA
 * (Williams et al., 2016): λ = 2 ÷ (N + 1).
 */
const EWMA_ACUTE_LAMBDA = 2 / (7 + 1);
const EWMA_CHRONIC_LAMBDA = 2 / (28 + 1);
const EWMA_CHRONIC_SEED_DAYS = 28;

export interface EwmaAcwrResult {
  ewmaAcute: number;
  ewmaChronic: number;
  /** ewmaAcute ÷ ewmaChronic. Null until a full 28-day seed window exists — same "not yet meaningful" idea as AcwrResult.hasBaseline, just for this ratio. */
  ewmaAcwr: number | null;
  /** Calendar days from the first logged workload through the anchor date. */
  historyDays: number;
  /** True once `historyDays` reaches the 28-day chronic seed window. */
  hasBaseline: boolean;
  asAt: string;
}

/**
 * Exponentially-weighted acute:chronic workload ratio, measured back from
 * `anchor` (defaults to today) — a second lens on the same load rows
 * `computeAcwr` uses, not a replacement for it. Where `computeAcwr` is a
 * rolling-window ratio (this week's total vs. the flat 3-week average before
 * it), this is a smoothed daily ratio: every day's load nudges both a fast
 * (7-day-equivalent) and slow (28-day-equivalent) exponential average, and
 * their ratio is read at `anchor`. It reacts a little faster to genuine
 * trend changes and doesn't have the rolling-window's hard edge where an old
 * heavy day drops out all at once — worth showing next to the existing
 * status, not swapping in for it.
 *
 * The acute EWMA is seeded naively at the first logged day's own value, then
 * recurses forward one day at a time — standard practice, and acute's fast
 * decay (λ=0.25) washes out that single-day seed within a couple of weeks
 * regardless.
 *
 * The chronic EWMA is seeded differently, on request: instead of the same
 * single-day start (which chronic's slow decay, λ≈0.069, would take many
 * weeks to recover from), it's seeded at the *plain average of the first 28
 * days* of logged load, and only then does the recursive smoothing take
 * over from day 29 onward. `ewmaAcwr` stays null until that seed window is
 * complete — there's no meaningful chronic value before day 28 to divide by.
 *
 * Every calendar day from the first logged workload through `anchor` is
 * walked (via `denseDailyLoad`, so rest days are real zeros, not gaps) —
 * there's no partial/windowed variant of this the way `computeWeeklyLoad`
 * has one, since the whole point of an EWMA is that it already accounts for
 * a player's entire history, weighted toward the recent end.
 */
export function computeEwmaAcwr(rows: LoadRow[], anchor?: Date): EwmaAcwrResult {
  const { end } = workloadRatioWindows(anchor);
  const asAt = isoOf(end);

  const firstLoggedIso = rows.reduce<string | null>((min, r) => {
    if (r.date == null) return min;
    return min === null || r.date < min ? r.date : min;
  }, null);

  if (firstLoggedIso === null || toLocalDate(firstLoggedIso) > end) {
    return { ewmaAcute: 0, ewmaChronic: 0, ewmaAcwr: null, historyDays: 0, hasBaseline: false, asAt };
  }

  const days = denseDailyLoad(rows, toLocalDate(firstLoggedIso), end);
  const historyDays = days.length;
  const hasBaseline = historyDays >= EWMA_CHRONIC_SEED_DAYS;

  let ewmaAcute = days[0].load_au;
  for (let i = 1; i < days.length; i++) {
    ewmaAcute = days[i].load_au * EWMA_ACUTE_LAMBDA + ewmaAcute * (1 - EWMA_ACUTE_LAMBDA);
  }

  let ewmaChronic = 0;
  if (hasBaseline) {
    const seedWindow = days.slice(0, EWMA_CHRONIC_SEED_DAYS);
    ewmaChronic = seedWindow.reduce((s, d) => s + d.load_au, 0) / EWMA_CHRONIC_SEED_DAYS;
    for (let i = EWMA_CHRONIC_SEED_DAYS; i < days.length; i++) {
      ewmaChronic = days[i].load_au * EWMA_CHRONIC_LAMBDA + ewmaChronic * (1 - EWMA_CHRONIC_LAMBDA);
    }
  }

  const ewmaAcwr = hasBaseline && ewmaChronic > 0 ? ewmaAcute / ewmaChronic : null;

  return { ewmaAcute, ewmaChronic, ewmaAcwr, historyDays, hasBaseline, asAt };
}

export interface EwmaAcwrStatusResult extends EwmaAcwrResult {
  status: AcwrResult["status"];
}

/**
 * EWMA ACWR classified with the exact same rules `computeAcwr` uses for the
 * rolling ratio: identical numeric bands (<0.8 low, <1.3 typical, ≤1.5
 * elevated, else spike), the identical `CHRONIC_LOAD_FLOOR` demotion of a
 * Spike to Low Base, and the identical team-break "building" override
 * (`findTeamBreakResumeDate` evaluated over the same acute/baseline windows
 * from `workloadRatioWindows`) — a coach reading "Spike" or "Building" means
 * the same thing regardless of which ratio produced it. This is not a
 * parallel reimplementation of those rules; it applies them to this ratio's
 * own numbers.
 *
 * `acute` (this week's AU) and `weekOnWeekPct` are deliberately not
 * reproduced here — they don't change with this switch, and stay sourced
 * from `computeAcwr`'s own unmodified result, exactly as before.
 *
 * One real unit difference to account for: `ewmaChronic` is a smoothed
 * *daily* load, where `CHRONIC_LOAD_FLOOR` is a *weekly* figure — so the
 * floor check compares against `ewmaChronic * 7` (the implied weekly
 * equivalent), not the raw daily EWMA value directly.
 *
 * A second individual (not team-wide) reset also has to be replicated:
 * `computeAcwr`'s own `hasBaseline` requires real load somewhere in the
 * *trailing 21-day baseline window*, not just 28 days of history existing
 * somewhere in the past — a player who logged nothing for the last several
 * weeks (stopped attending, dropped from the squad, long injury) fails that
 * even with months of older data. EWMA's chronic/acute values don't have an
 * equivalent built in — they just keep decaying toward zero — so left alone
 * they'd keep reporting a real-looking "Low" ratio for a player who has
 * simply gone quiet, long after the rolling ratio has correctly given up
 * and said "Building" (not enough *recent* data). This block detects that
 * same condition (zero load anywhere in the identical baseline window) and
 * folds it into the same forced-building path as the team break.
 */
export function computeEwmaAcwrStatus(
  rows: LoadRow[],
  anchor?: Date,
  floor: number = CHRONIC_LOAD_FLOOR,
  teamSessionDates: string[] = [],
): EwmaAcwrStatusResult {
  const ewma = computeEwmaAcwr(rows, anchor);
  const { end, acuteStart, baselineStart, baselineEnd } = workloadRatioWindows(anchor);

  const ratioStatus: AcwrResult["status"] =
    ewma.ewmaAcwr === null ? "building"
    : ewma.ewmaAcwr < 0.8 ? "low"
    : ewma.ewmaAcwr < 1.3 ? "typical"
    : ewma.ewmaAcwr <= 1.5 ? "elevated"
    : "spike";
  const withFloor: AcwrResult["status"] =
    ratioStatus === "spike" && ewma.ewmaChronic * 7 < floor ? "low_base" : ratioStatus;

  const resumeDate = findTeamBreakResumeDate(teamSessionDates, end, GAP_RESET_DAYS);
  const inTeamBreakRebuild = resumeDate !== null && baselineStart < resumeDate;
  const acuteWeekIsTeamDead = teamSessionDates.length > 0 && !teamSessionDates.some((iso) => {
    const d = toLocalDate(iso);
    return d >= acuteStart && d <= end;
  });
  const baselineWindowHasNoLoad = !rows.some((r) => {
    if (r.date == null || r.load_au <= 0) return false;
    const at = new Date(r.date + "T00:00:00");
    return at >= baselineStart && at <= baselineEnd;
  });
  const forcedBuilding = inTeamBreakRebuild || acuteWeekIsTeamDead || baselineWindowHasNoLoad;

  return {
    ...ewma,
    ewmaAcwr: forcedBuilding ? null : ewma.ewmaAcwr,
    hasBaseline: forcedBuilding ? false : ewma.hasBaseline,
    status: forcedBuilding ? "building" : withFloor,
  };
}

// ── Z-scores against a player's own recent history ──────────────────────────────
/**
 * At least this many prior weeks are required before a z-score is considered
 * meaningful — below it, a "typical" reading could just be a small sample
 * getting lucky.
 */
export const Z_SCORE_MIN_WEEKS = 8;
/** At most this many of the most recent prior weeks are used as the baseline — older weeks don't get to keep influencing "recent". */
export const Z_SCORE_MAX_WEEKS = 12;

export interface ZScoreResult {
  /** (current − mean) ÷ sd of the trailing window. Null below Z_SCORE_MIN_WEEKS of history, or when sd is 0. */
  zScore: number | null;
  mean: number;
  sd: number;
  /** How many prior weeks were actually used (after capping at Z_SCORE_MAX_WEEKS) — reported even when null, so a caller can show e.g. "5/8 weeks of history". */
  weeksUsed: number;
}

/**
 * Z-score of `current` against a player's own recent history — metric-
 * agnostic: the same function scores weekly load, ACWR, or strain, whatever
 * `priorWeeks` (most-recent-last, current week NOT included) happens to
 * hold. Only the most recent `Z_SCORE_MAX_WEEKS` (12) entries are used; at
 * least `Z_SCORE_MIN_WEEKS` (8) are required for `zScore` to be non-null.
 *
 * Population SD, matching `computeWeeklyMonotonyStrain`'s choice, for the
 * same reason: `priorWeeks` is the complete window being described, not a
 * sample standing in for a larger one. `sd === 0` (every prior week
 * identical) returns a null `zScore` — an undefined ratio, not an infinite
 * one — the same rule used for monotony and the EWMA ACWR.
 */
export function computeZScore(current: number, priorWeeks: number[]): ZScoreResult {
  const window = priorWeeks.slice(Math.max(0, priorWeeks.length - Z_SCORE_MAX_WEEKS));
  const n = window.length;
  const mean = n > 0 ? window.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n > 0 ? window.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const sd = Math.sqrt(variance);
  const zScore = n >= Z_SCORE_MIN_WEEKS && sd > 0 ? (current - mean) / sd : null;
  return { zScore, mean, sd, weeksUsed: n };
}

const NO_HISTORY_Z_SCORE: ZScoreResult = { zScore: null, mean: 0, sd: 0, weeksUsed: 0 };

export interface WorkloadZScores {
  weeklyLoad: ZScoreResult;
  acwr: ZScoreResult;
  strain: ZScoreResult;
}

/**
 * The three z-scores named together: weekly load, ACWR, and strain, each
 * against that same metric's own trailing history. A thin bundle over
 * `computeZScore` — it doesn't compute the underlying series itself (that's
 * `computeWeeklyLoad`, `computeAcwr`/`computeEwmaAcwr` run per week, and
 * `computeWeeklyMonotonyStrain`, each with their own history/date-range
 * decisions to make) — only null-safe when the current ACWR or strain value
 * isn't available yet (e.g. still building baseline), in which case that
 * one field comes back as a no-history result rather than throwing.
 */
export function computeWorkloadZScores(
  current: { weeklyLoad: number; acwr: number | null; strain: number | null },
  priorWeeks: { weeklyLoad: number[]; acwr: number[]; strain: number[] },
): WorkloadZScores {
  return {
    weeklyLoad: computeZScore(current.weeklyLoad, priorWeeks.weeklyLoad),
    acwr: current.acwr !== null ? computeZScore(current.acwr, priorWeeks.acwr) : NO_HISTORY_Z_SCORE,
    strain: current.strain !== null ? computeZScore(current.strain, priorWeeks.strain) : NO_HISTORY_Z_SCORE,
  };
}

/** Width of a chart's shaded "usual range" band, in SDs either side of the mean. */
export const USUAL_RANGE_SD = 1.5;

export interface UsualRange {
  low: number;
  high: number;
}

/**
 * The shaded "usual range" band for a weekly-load (or other metric) trend
 * chart, derived from a `ZScoreResult`'s own mean/sd — so a chart's band and
 * its "outside the band" read are always backed by the exact same window,
 * never two slightly different history calculations.
 *
 * Null when `weeksUsed` hasn't reached `Z_SCORE_MIN_WEEKS` — the explicit
 * "not enough history yet" state: a caller should render the bare trend
 * line with no band at all in that case, not a band built from too few
 * points (or, worse, from zero points) to mean anything.
 */
export function usualRangeFor(zScoreResult: ZScoreResult): UsualRange | null {
  if (zScoreResult.weeksUsed < Z_SCORE_MIN_WEEKS) return null;
  return {
    low: zScoreResult.mean - USUAL_RANGE_SD * zScoreResult.sd,
    high: zScoreResult.mean + USUAL_RANGE_SD * zScoreResult.sd,
  };
}

// ── Report builder ────────────────────────────────────────────────────────────
export function buildPlayerReport(
  player: Player,
  data: ReportData,
  range: ReportRange | null,
): PlayerReport {
  // ── Attendance ──────────────────────────────────────────────────────────
  const scopedSessions = data.sessions.filter((s) => inRange(s.date, range));
  const attendedIds = new Set(
    data.attendance
      .filter((a) => a.player_id === player.id && countsAsAttended(a.status))
      .map((a) => a.session_id),
  );
  // Attendance is marked per day, so a tournament day is one unit however many
  // fixtures it held. Counting raw sessions would understate every month that
  // contained a tournament.
  const scopedUnits = collapseMatchDays(scopedSessions, (sid) => attendedIds.has(sid)).sessions;
  const attended = scopedUnits.filter((s) => attendedIds.has(s.id)).length;

  const byMonth: Record<string, string[]> = {};
  for (const s of scopedUnits) (byMonth[s.date.slice(0, 7)] ??= []).push(s.id);
  const monthly: MonthlyAttendance[] = Object.entries(byMonth)
    .map(([month, ids]) => {
      const a = ids.filter((id) => attendedIds.has(id)).length;
      return { month, total: ids.length, attended: a, pct: Math.round((a / ids.length) * 100) };
    })
    .sort((x, y) => x.month.localeCompare(y.month));

  const slice = (ss: TrainingSession[]): AttendanceSlice => {
    const a = ss.filter((s) => attendedIds.has(s.id)).length;
    return { total: ss.length, attended: a, pct: ss.length > 0 ? Math.round((a / ss.length) * 100) : null };
  };

  // Unscoped, for the profile-matching tiles an all-time report leads with —
  // both halves read the current month so they describe the same period.
  const thisMonthKey = isoOf(new Date()).slice(0, 7);
  const monthSessions = data.sessions.filter((s) => s.date.slice(0, 7) === thisMonthKey);
  const currentMonthTraining = {
    month: thisMonthKey,
    ...slice(monthSessions.filter((s) => !isMatchSession(s))),
  };
  const currentMonthMatch = matchDayAttendance(monthSessions, (sid) => attendedIds.has(sid));

  // ── Matches ─────────────────────────────────────────────────────────────
  const playerStats = data.matchStats.filter(
    (m) => m.player_id === player.id && inRange(m.matches?.sessions?.date, range),
  );
  const thisYear = isoOf(new Date()).slice(0, 4);
  const yearStats = data.matchStats.filter(
    (m) => m.player_id === player.id && (m.matches?.sessions?.date ?? "").startsWith(thisYear),
  );
  // Keyed by id rather than name so each group can be matched to its finish;
  // matches belonging to no tournament share the one sentinel key.
  const byTournamentMap = new Map<string, { name: string; rows: PlayerMatchStat[] }>();
  for (const s of playerStats) {
    const t = s.matches?.tournaments;
    const key = t?.id ?? "__none__";
    if (!byTournamentMap.has(key)) {
      byTournamentMap.set(key, { name: t?.name ?? "Friendlies", rows: [] });
    }
    byTournamentMap.get(key)!.rows.push(s);
  }

  // ── Fitness ─────────────────────────────────────────────────────────────
  const playerResults = data.results.filter(
    (r) => r.player_id === player.id && inRange(r.test_sessions?.test_date, range),
  );
  const chronological = [...playerResults].sort((a, b) =>
    (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""),
  );

  /** Best across every named trial — sprints are recorded as two attempts. */
  const best = (fields: (keyof TestResult)[], higherIsBetter = false) =>
    playerResults.reduce<number | null>((acc, r) => {
      for (const f of fields) {
        const v = r[f] as number | null;
        if (v === null || v === undefined) continue;
        acc = acc === null ? v : higherIsBetter ? Math.max(acc, v) : Math.min(acc, v);
      }
      return acc;
    }, null);

  /**
   * Latest *recorded* value, not the value on the latest test. A session that
   * only ran sprints must not blank out a bronco time measured the month before.
   */
  const latestOf = (fields: (keyof TestResult)[], higherIsBetter = false) => {
    for (let i = chronological.length - 1; i >= 0; i--) {
      const r = chronological[i];
      let v: number | null = null;
      for (const f of fields) {
        const x = r[f] as number | null;
        if (x === null || x === undefined) continue;
        v = v === null ? x : higherIsBetter ? Math.max(v, x) : Math.min(v, x);
      }
      if (v !== null) return v;
    }
    return null;
  };

  const bestBronco = best(["bronco_mins"]);
  const latestBroncoRow = [...chronological].reverse().find((r) => r.bronco_mins !== null) ?? null;
  const latestBronco = latestBroncoRow?.bronco_mins ?? null;

  // Squad context for the band: every team-mate's most recent bronco, unscoped
  // by the report range so a short period still ranks against the full squad.
  const squadLatest = new Map<string, { date: string; mins: number }>();
  for (const r of data.results) {
    if (r.bronco_mins === null) continue;
    const date = r.test_sessions?.test_date ?? "";
    const held = squadLatest.get(r.player_id);
    if (!held || date > held.date) squadLatest.set(r.player_id, { date, mins: r.bronco_mins });
  }
  const teamBand = teamBandFor(
    latestBronco,
    Array.from(squadLatest.values(), (v) => v.mins),
    "light",
  );

  // ── Load ────────────────────────────────────────────────────────────────
  // Training and match minutes folded together — see buildLoadRows
  const playerLoad = buildLoadRows(
    data.rpe.filter((r) => r.player_id === player.id),
    data.matchStats.filter((m) => m.player_id === player.id),
    data.attendance.filter((a) => a.player_id === player.id),
    data.sessions,
  );
  const scopedLoad = playerLoad.filter((r) => inRange(r.date, range));
  // ACWR needs the full history (its 28-day window may reach before the range).
  // An all-time report anchors to the last session on record rather than today,
  // so a report printed weeks after the last session doesn't read 0.00 for the
  // whole squad. The printed "as at" date keeps that honest either way.
  //
  // Either reference point is then pinned to its own most-recent-Sunday (see
  // pinnedWeeklyAnchor) rather than used raw — a report for a specific range
  // should read the same regardless of which day inside that range it was
  // generated on, same reasoning as every other ACWR anchor in the app.
  const lastSessionDate = data.sessions.reduce<string | null>(
    (max, s) => (s.date && (max === null || s.date > max) ? s.date : max),
    null,
  );
  const anchor = pinnedWeeklyAnchor(
    range
      ? new Date(range.to + "T00:00:00")
      : lastSessionDate
        ? new Date(lastSessionDate + "T00:00:00")
        : new Date(),
  );
  // Per day, matching the profile. Totals are the same either way; the unit isn't.
  const acwr = computeAcwr(collapseLoadByDay(playerLoad), anchor, CHRONIC_LOAD_FLOOR, teamSessionDatesFrom(data.sessions));
  const ratioWindows = workloadRatioWindows(anchor);
  const estimatedMatchRows = playerLoad.filter((r) => r.source === "match" && r.estimated && r.date !== null);
  const estimatedIn = (from: Date, to: Date) => estimatedMatchRows.reduce((sum, row) => {
    const date = new Date(`${row.date}T00:00:00`);
    return date >= from && date <= to ? sum + row.load_au : sum;
  }, 0);
  const estimatedInScopedRange = scopedLoad.filter((r) => r.source === "match" && r.estimated);

  return {
    player,
    range,
    attendance: {
      total: scopedUnits.length,
      attended,
      pct: scopedUnits.length > 0 ? Math.round((attended / scopedUnits.length) * 100) : null,
      monthly,
      training: slice(scopedSessions.filter((s) => !isMatchSession(s))),
      match: matchDayAttendance(scopedSessions, (sid) => attendedIds.has(sid)),
      currentMonthTraining,
      currentMonthMatch,
    },
    matches: {
      ...sumStats(playerStats),
      callUps: playerStats.length,
      byTournament: Array.from(byTournamentMap.entries()).map(([id, group]) => ({
        name: group.name,
        totals: sumStats(group.rows),
        finish: data.finishes.get(id),
      })),
      thisYear: { ...sumStats(yearStats), callUps: yearStats.length },
    },
    fitness: {
      tested: playerResults.length,
      bestBronco,
      latestBronco,
      latestBroncoDate: latestBroncoRow?.test_sessions?.test_date ?? null,
      teamBand,
      bestMas: best(["mas_ms"], true),
      latestMas: latestOf(["mas_ms"], true),
      bestTen: best(["ten_m_1", "ten_m_2"]),
      latestTen: latestOf(["ten_m_1", "ten_m_2"]),
      bestTwenty: best(["twenty_m_1", "twenty_m_2"]),
      latestTwenty: latestOf(["twenty_m_1", "twenty_m_2"]),
      // Describes the number the report leads with, so it follows the latest test
      tier: latestBronco !== null ? getBroncoTier(latestBronco) : null,
      series: chronological
        .filter((r) => r.bronco_mins !== null)
        .map((r) => ({
          label: r.test_sessions?.test_name ?? r.test_sessions?.test_date ?? "—",
          mins: r.bronco_mins as number,
        })),
    },
    load: {
      totalAu: Math.round(scopedLoad.reduce((s, r) => s + r.load_au, 0)),
      plannedAu: Math.round(scopedLoad.reduce((s, r) => s + (r.planned_load_au ?? 0), 0)),
      sessionCount: scopedLoad.filter((r) => r.source === "session").length,
      matchCount: scopedLoad.filter((r) => r.source === "match").length,
      estimatedMatchAu: Math.round(estimatedInScopedRange.reduce((s, r) => s + r.load_au, 0)),
      estimatedMatchCount: estimatedInScopedRange.length,
      acuteEstimatedMatchAu: Math.round(estimatedIn(ratioWindows.acuteStart, ratioWindows.end)),
      baselineEstimatedMatchAu: Math.round(estimatedIn(ratioWindows.baselineStart, ratioWindows.baselineEnd)),
      ...acwr,
    },
  };
}
