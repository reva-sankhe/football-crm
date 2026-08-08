import { countsAsAttended } from "./attendance";
import { sumStats, type Totals } from "./tournaments";
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
}

export interface MonthlyAttendance {
  month: string;
  total: number;
  attended: number;
  pct: number;
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
    total: number;
    attended: number;
    pct: number | null;
    monthly: MonthlyAttendance[];
  };
  matches: Totals & {
    callUps: number;
    byTournament: { name: string; totals: Totals }[];
  };
  fitness: {
    tested: number;
    bestBronco: number | null;
    latestBronco: number | null;
    bestMas: number | null;
    latestMas: number | null;
    bestTen: number | null;
    bestTwenty: number | null;
    tier: BroncoTier | null;
    series: { label: string; mins: number }[];
  };
  load: {
    totalAu: number;
    sessionCount: number;
  } & AcwrResult;
}

// ── Range helpers ─────────────────────────────────────────────────────────────
function inRange(date: string | null | undefined, range: ReportRange | null): boolean {
  if (!date) return false;
  if (!range) return true;
  return date >= range.from && date <= range.to;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── ACWR ──────────────────────────────────────────────────────────────────────
export const ACWR_CONFIG: Record<AcwrResult["status"], { label: string; color: string; desc: string }> = {
  safe:    { label: "Safe Zone",       color: "#34d399", desc: "Optimal training load balance." },
  caution: { label: "Caution",         color: "#fbbf24", desc: "High load — monitor recovery closely." },
  danger:  { label: "High Risk",       color: "#f87171", desc: "Injury risk elevated. Consider reducing load." },
  low:     { label: "Underloaded",     color: "#94a3b8", desc: "Below baseline — may indicate detraining." },
  unknown: { label: "Not enough data", color: "#94a3b8", desc: "Need 28 days of session data to calculate." },
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
  const attended = scopedSessions.filter((s) => attendedIds.has(s.id)).length;

  const byMonth: Record<string, string[]> = {};
  for (const s of scopedSessions) (byMonth[s.date.slice(0, 7)] ??= []).push(s.id);
  const monthly: MonthlyAttendance[] = Object.entries(byMonth)
    .map(([month, ids]) => {
      const a = ids.filter((id) => attendedIds.has(id)).length;
      return { month, total: ids.length, attended: a, pct: Math.round((a / ids.length) * 100) };
    })
    .sort((x, y) => x.month.localeCompare(y.month));

  // ── Matches ─────────────────────────────────────────────────────────────
  const playerStats = data.matchStats.filter(
    (m) => m.player_id === player.id && inRange(m.matches?.sessions?.date, range),
  );
  const byTournamentMap = new Map<string, PlayerMatchStat[]>();
  for (const s of playerStats) {
    const name = s.matches?.tournaments?.name ?? "Unassigned matches";
    if (!byTournamentMap.has(name)) byTournamentMap.set(name, []);
    byTournamentMap.get(name)!.push(s);
  }

  // ── Fitness ─────────────────────────────────────────────────────────────
  const playerResults = data.results.filter(
    (r) => r.player_id === player.id && inRange(r.test_sessions?.test_date, range),
  );
  const chronological = [...playerResults].sort((a, b) =>
    (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""),
  );
  const latest = chronological[chronological.length - 1];

  const best = (field: keyof TestResult, higherIsBetter = false) =>
    playerResults.reduce<number | null>((acc, r) => {
      const v = r[field] as number | null;
      if (v === null || v === undefined) return acc;
      if (acc === null) return v;
      return higherIsBetter ? Math.max(acc, v) : Math.min(acc, v);
    }, null);

  const bestBronco = best("bronco_mins");

  // ── Load ────────────────────────────────────────────────────────────────
  const playerRpe = data.rpe.filter((r) => r.player_id === player.id);
  const scopedRpe = playerRpe.filter((r) => inRange(r.sessions?.date, range));
  // ACWR needs the full history (its 28-day window may reach before the range)
  const acwr = computeAcwr(playerRpe, range ? new Date(range.to + "T00:00:00") : undefined);

  return {
    player,
    range,
    attendance: {
      total: scopedSessions.length,
      attended,
      pct: scopedSessions.length > 0 ? Math.round((attended / scopedSessions.length) * 100) : null,
      monthly,
    },
    matches: {
      ...sumStats(playerStats),
      callUps: playerStats.length,
      byTournament: Array.from(byTournamentMap.entries()).map(([name, rows]) => ({
        name,
        totals: sumStats(rows),
      })),
    },
    fitness: {
      tested: playerResults.length,
      bestBronco,
      latestBronco: latest?.bronco_mins ?? null,
      bestMas: best("mas_ms", true),
      latestMas: latest?.mas_ms ?? null,
      bestTen: best("ten_m_1"),
      bestTwenty: best("twenty_m_1"),
      tier: bestBronco !== null ? getBroncoTier(bestBronco) : null,
      series: chronological
        .filter((r) => r.bronco_mins !== null)
        .map((r) => ({
          label: r.test_sessions?.test_name ?? r.test_sessions?.test_date ?? "—",
          mins: r.bronco_mins as number,
        })),
    },
    load: {
      totalAu: Math.round(scopedRpe.reduce((s, r) => s + r.load_au, 0)),
      sessionCount: scopedRpe.length,
      ...acwr,
    },
  };
}
