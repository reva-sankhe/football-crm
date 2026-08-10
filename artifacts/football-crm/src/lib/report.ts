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
  acute: number;
  chronicWeeklyAvg: number;
  status: "safe" | "caution" | "danger" | "low" | "unknown";
  /** The date the rolling windows were measured back from. */
  asAt: string;
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
    totalAu: number;
    /** Sum of the planned ("set") load for those same sessions. */
    plannedAu: number;
    sessionCount: number;
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

// ── ACWR ──────────────────────────────────────────────────────────────────────
export const ACWR_CONFIG: Record<AcwrResult["status"], { label: string; color: string; desc: string }> = {
  safe:    { label: "Safe Zone",       color: STATUS.good,     desc: "Optimal training load balance." },
  caution: { label: "Caution",         color: STATUS.warning,  desc: "High load — monitor recovery closely." },
  danger:  { label: "High Risk",       color: STATUS.critical, desc: "Injury risk elevated. Consider reducing load." },
  low:     { label: "Underloaded",     color: "#94a3b8",       desc: "Below baseline — may indicate detraining." },
  unknown: { label: "Not enough data", color: "#94a3b8",       desc: "Need 28 days of session data to calculate." },
};

/**
 * Acute:chronic workload ratio, measured back from `anchor` (defaults to today).
 * Reports anchor to the end of the selected range so the number matches the
 * period being printed rather than silently reflecting the present day.
 */
export function computeAcwr(rows: RpeRow[], anchor?: Date): AcwrResult {
  const end = anchor ?? new Date();
  const days7 = new Date(end.getTime() - 7 * 86_400_000);
  const days28 = new Date(end.getTime() - 28 * 86_400_000);

  const at = (r: RpeRow) => (r.sessions?.date ? new Date(r.sessions.date + "T00:00:00") : null);

  const acute = rows.reduce((s, r) => {
    const d = at(r);
    return d && d >= days7 && d <= end ? s + r.load_au : s;
  }, 0);
  const chronic28 = rows.reduce((s, r) => {
    const d = at(r);
    return d && d >= days28 && d <= end ? s + r.load_au : s;
  }, 0);

  const chronicWeeklyAvg = chronic28 / 4;
  const acwr = chronicWeeklyAvg > 0 ? acute / chronicWeeklyAvg : null;

  const status: AcwrResult["status"] =
    acwr === null ? "unknown"
    : acwr < 0.5  ? "low"
    : acwr <= 1.3 ? "safe"
    : acwr <= 1.5 ? "caution"
    : "danger";

  return { acwr, acute, chronicWeeklyAvg, status, asAt: isoOf(end) };
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
      byTournamentMap.set(key, { name: t?.name ?? "Unassigned matches", rows: [] });
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
    if (r.bronco_mins === null || r.players?.team !== player.team) continue;
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
  const playerRpe = data.rpe.filter((r) => r.player_id === player.id);
  const scopedRpe = playerRpe.filter((r) => inRange(r.sessions?.date, range));
  // ACWR needs the full history (its 28-day window may reach before the range).
  // An all-time report anchors to the last session on record rather than today,
  // so a report printed weeks after the last session doesn't read 0.00 for the
  // whole squad. The printed "as at" date keeps that honest either way.
  const lastSessionDate = data.sessions.reduce<string | null>(
    (max, s) => (s.date && (max === null || s.date > max) ? s.date : max),
    null,
  );
  const anchor = range
    ? new Date(range.to + "T00:00:00")
    : lastSessionDate
      ? new Date(lastSessionDate + "T00:00:00")
      : undefined;
  const acwr = computeAcwr(playerRpe, anchor);

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
      totalAu: Math.round(scopedRpe.reduce((s, r) => s + r.load_au, 0)),
      plannedAu: Math.round(scopedRpe.reduce((s, r) => s + (r.sessions?.planned_load_au ?? 0), 0)),
      sessionCount: scopedRpe.length,
      ...acwr,
    },
  };
}
