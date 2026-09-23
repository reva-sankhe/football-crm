import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  fetchPlayer, fetchPlayers, fetchResultsByPlayer, updatePlayer, fetchAllResults,
  fetchPlayerRecentSessions,
  fetchAttendanceByPlayer, fetchTrainingSessions, fetchMatchStatsByPlayer,
  fetchTournamentFinishes, fetchInjuryHistory, type PlayerMatchStat,
} from "@/lib/queries";
import {
  JERSEY_MAX, JERSEY_MIN, formatBronco, cn, isValidJersey, jerseyClash, playerLabel,
} from "@/lib/utils";
import {
  attendancePctColor, collapseMatchDays, countsAsAttended, formatDateShort, isoDaysAgo, matchDayAttendance,
} from "@/lib/attendance";
import { buildAvailability } from "@/lib/injuries";
import { InjuriesCard } from "@/components/player/InjuriesCard";
import {
  Tooltip as InfoTooltip, TooltipContent as InfoTooltipContent, TooltipTrigger as InfoTooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The span the Load Trend chart actually plots. The workload ratio needs 28
 * days; the extra week gives the player profile a small visual run-up.
 */
const LOAD_WINDOW_DAYS = 35;

/**
 * How much of the player's own history sits *behind* the plotted window, to
 * say what "usual" means for them. Eight weeks is `Z_SCORE_MIN_WEEKS` — the
 * fewest prior weeks the shared z-score helpers will score against — so this
 * is the smallest baseline that produces a usual-session range at all.
 *
 * Deliberately preceding the plotted window rather than overlapping it (the
 * squad chart's band, `computeSquadUsualLoadRange`, overlaps by design): on a
 * daily chart the band is the yardstick the plotted days are being measured
 * against, so the days being judged should not also be setting the mark.
 */
const USUAL_RANGE_BASELINE_DAYS = 56;

/**
 * Everything the page fetches: the plotted window plus its baseline. 91 days
 * is also exactly 13 weeks, which is what the week-to-week variation card
 * needs — twelve complete prior weeks (`Z_SCORE_MAX_WEEKS`) plus the current
 * one — so one fetch serves both.
 */
const LOAD_HISTORY_DAYS = LOAD_WINDOW_DAYS + USUAL_RANGE_BASELINE_DAYS;

/**
 * The turnout window on the status card: how far back "sessions logged" counts.
 * Three weeks is the shortest span that still holds several of a Wed/Fri/Sun
 * schedule's sessions, so one missed week moves the number visibly.
 */
const RECENT_SESSION_DAYS = 21;

/**
 * The fewest training-session days required before a usual-session range is
 * drawn at all. `usualRangeFor` enforces `Z_SCORE_MIN_WEEKS` (8) on whatever
 * series it is handed, but here the series is *days*, not weeks, and eight
 * days is far too thin a base to call anything usual. On a Wed/Fri/Sun week
 * the 56-day baseline holds roughly 24 session days, so a player who has been
 * training normally clears this comfortably; one who has not gets no band,
 * which is the honest answer.
 */
const USUAL_SESSION_MIN_DAYS = 10;
import {
  ACWR_CONFIG, MATCH_RPE, buildLoadRows, collapseLoadByDay, computeAcwr, isMatchSession,
  pinnedWeeklyAnchor, teamSessionDatesFrom, teamBandFor, workloadRatioWindows,
} from "@/lib/report";
import { computeUsualSessionRange } from "@/lib/playerLoad";
import { ChartSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { PlayerTournamentStats } from "@/components/tournaments/PlayerTournamentStats";
import { sumStats, type TournamentFinish } from "@/lib/tournaments";
import { SectionLabel, StatTile as SnapshotTile } from "@/components/StatTile";
import { AttendanceCard } from "@/components/player/AttendanceCard";
import { LastSessionsCard } from "@/components/player/LastSessionsCard";
import type {
  Player, TestResult, SessionRPE, TrainingSession, SessionAttendance, InjuryStage, InjuryWithStatus,
} from "@/lib/types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, ResponsiveContainer,
} from "recharts";
import { ArrowLeft, ChevronDown, Edit, Save, X, Timer, Dumbbell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { HIGHLIGHT, WORKLOAD_ACCENT, WORKLOAD_NEUTRAL, ink, series, type Mode } from "@/lib/viz";

const PRIMARY_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SECONDARY_POSITIONS: Record<string, string[]> = {
  Goalkeeper: [],
  Defender:   ["Wing Back", "Center Back"],
  Midfielder: ["Right Wing", "Left Wing", "CDM", "CM"],
  Forward:    ["Striker", "CAM"],
};

/**
 * " (12 days ago)" beside a date, or "" when it was today or yesterday — the
 * date alone already reads clearly for those. This is the half of the
 * last-session line a coach actually scans: "14 Aug" needs mental arithmetic
 * before it means "he has not trained in three weeks".
 */
function daysSinceLabel(iso: string): string {
  const then = new Date(iso + "T00:00:00");
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - then.getTime()) / 86_400_000,
  );
  if (days <= 0) return " (today)";
  if (days === 1) return " (yesterday)";
  return ` (${days} days ago)`;
}

/** A 0–1 share as a whole percent, or an em dash when there was no load to measure. */
function pctOrDash(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** "Mar 26" — the month a test was taken, for the snapshot sub-line. */
function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export default function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { isAdmin } = useAuth();

  const [player, setPlayer] = useState<Player | null>(null);
  const [results, setResults] = useState<(TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]>([]);
  const [recentLoad, setRecentLoad] = useState<(SessionRPE & { sessions: TrainingSession })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Player>>({});
  const [saving, setSaving] = useState(false);
  const [fitnessHistoryOpen, setFitnessHistoryOpen] = useState(false);
  const [teamBand, setTeamBand] = useState<{ label: string; color: string } | null>(null);
  const [allSessions, setAllSessions] = useState<TrainingSession[]>([]);
  const [playerAttendance, setPlayerAttendance] = useState<(SessionAttendance & { sessions: { id: string; date: string; session_type: string } })[]>([]);
  const [matchStats, setMatchStats] = useState<PlayerMatchStat[]>([]);
  const [finishes, setFinishes] = useState<Map<string, TournamentFinish>>(new Map());
  /** The rest of the squad, so the jersey field can flag a clash. */
  const [roster, setRoster] = useState<Player[]>([]);

  const mode: Mode = isDark ? "dark" : "light";
  const INK = ink(mode);
  const chartGrid = INK.grid;
  const chartAxis = INK.axis;
  const chartTooltipBg = INK.tooltipBg;
  const chartTooltipBorder = INK.tooltipBorder;
  const chartLabel = INK.primary;
  // Planned load is a reference line, not a peer of actual load — it wears a
  // stronger step of the same grey as the rolling average, and is told apart
  // from it by weight and the dash pattern rather than by hue.
  const PLANNED_INK = INK.secondary;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, rs, allRs, loadHistory, attendance, sessions, mStats, placings, allPlayers] =
        await Promise.all([
          fetchPlayer(id!),
          fetchResultsByPlayer(id!),
          fetchAllResults(),
          fetchPlayerRecentSessions(id!, LOAD_HISTORY_DAYS),
          fetchAttendanceByPlayer(id!),
          fetchTrainingSessions(),
          fetchMatchStatsByPlayer(id!),
          fetchTournamentFinishes(),
          fetchPlayers(), // only to tell you a jersey number is taken
        ]);
      setFinishes(placings);
      setRoster(allPlayers);
      setPlayer(p);
      setResults(rs as (TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]);
      setRecentLoad(loadHistory as (SessionRPE & { sessions: TrainingSession })[]);
      setPlayerAttendance(attendance);
      setAllSessions(sessions);
      setMatchStats(mStats);

      // "Latest" means the most recent *test date*. Rows imported in one batch
      // share a created_at, so insertion order can't be trusted to rank them.
      const byTestDateDesc = <T extends { test_sessions?: { test_date: string } | null }>(rows: T[]) =>
        [...rows].sort((a, b) => (b.test_sessions?.test_date ?? "").localeCompare(a.test_sessions?.test_date ?? ""));

      const teamLatest = new Map<string, number>();
      const teamRows = (allRs as (TestResult & { test_sessions?: { test_date: string } | null })[])
        .filter(r => r.bronco_mins !== null);
      for (const r of byTestDateDesc(teamRows)) {
        if (!teamLatest.has(r.player_id)) teamLatest.set(r.player_id, r.bronco_mins!);
      }
      const playerBronco = byTestDateDesc(
        (rs as (TestResult & { test_sessions?: { test_date: string } | null })[]).filter(r => r.bronco_mins !== null),
      )[0]?.bronco_mins;
      setTeamBand(teamBandFor(playerBronco, Array.from(teamLatest.values()), mode));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Injuries ──────────────────────────────────────────────────────────────
  // Squad-wide history (it's small): the card shows this player's, and the
  // closing prompts and badges need the stages.
  const [injuryHistory, setInjuryHistory] = useState<{ injuries: InjuryWithStatus[]; stages: InjuryStage[] }>({ injuries: [], stages: [] });
  const loadInjuries = useCallback(async () => {
    try {
      setInjuryHistory(await fetchInjuryHistory());
    } catch (err) {
      toast({ title: "Couldn't load injuries", description: String(err), variant: "destructive" });
    }
  }, [toast]);
  useEffect(() => { loadInjuries(); }, [loadInjuries]);
  const availability = useMemo(
    () => buildAvailability(injuryHistory.injuries, injuryHistory.stages),
    [injuryHistory],
  );
  const playerInjuries = useMemo(
    () => injuryHistory.injuries.filter((i) => i.player_id === id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
    [injuryHistory, id],
  );

  const startEdit = () => { if (!player) return; setEditForm({ ...player }); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = async () => {
    if (!player) return;
    if (!isValidJersey(editForm.jersey_number ?? null)) {
      toast({ title: `Jersey number must be between ${JERSEY_MIN} and ${JERSEY_MAX}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlayer(player.id, editForm);
      setPlayer(updated);
      setEditing(false);
      toast({ title: "Player updated" });
    } catch (err: unknown) {
      toast({ title: "Failed to update", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Ordered oldest → newest by test date; the query orders by created_at, which
  // ties across a bulk import and so can't rank tests on its own.
  const chronoResults = [...results].sort((a, b) =>
    (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""),
  );

  const broncoChartData = chronoResults
    .map((r) => ({
      date: r.test_sessions?.test_date ?? "",
      session: r.test_sessions?.test_name ?? "",
      mins: r.bronco_mins,
      display: formatBronco(r.bronco_mins),
    }));

  // ── Training load ─────────────────────────────────────────────────────────
  // Rated sessions and match minutes in one list. Matches use a player RPE when
  // available, otherwise the row is explicitly marked as an RPE 7 estimate.
  // Windowed here as well as in the query: match stats are fetched in full for
  // the tournament history above, and without this the baseline would stretch
  // back to the player's first ever fixture.
  //
  // Two spans, deliberately. `historyRows` is everything fetched — what
  // "usual for this player" is measured against. `loadRows` is only the slice
  // the Load Trend chart draws.
  const historyRows = useMemo(() => {
    const since = isoDaysAgo(LOAD_HISTORY_DAYS);
    return buildLoadRows(recentLoad, matchStats, playerAttendance, allSessions)
      .filter((r) => r.date != null && r.date >= since);
  }, [recentLoad, matchStats, playerAttendance, allSessions]);

  const loadRows = useMemo(() => {
    const since = isoDaysAgo(LOAD_WINDOW_DAYS);
    return historyRows.filter((r) => (r.date as string) >= since);
  }, [historyRows]);

  /**
   * What the chart plots: one entry per day, so a tournament day is a single
   * hard day rather than five points stacked on one date. `loadRows` stays per
   * fixture — the counts below still say how many matches there were.
   */
  const dailyLoad = useMemo(() => collapseLoadByDay(loadRows), [loadRows]);

  /** The same collapse over the full history — what the workload ratio reads. */
  const dailyHistory = useMemo(() => collapseLoadByDay(historyRows), [historyRows]);

  const loadChartData = [...dailyLoad]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .map((r) => ({
      date: r.date
        ? new Date(r.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "—",
      load: Math.round(r.load_au),
      // What the session was planned for, so over/under-shooting is visible.
      // Matches carry no plan — null skips them rather than drawing a
      // floor-scraping zero on the Set line.
      planned: r.planned_load_au ? Math.round(r.planned_load_au) : null,
      source: r.source,
      estimated: r.estimated,
    }));

  const loadWithAvg = loadChartData.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 3), i + 1);
    return { ...d, rollingAvg: Math.round(window.reduce((s, x) => s + x.load, 0) / window.length) };
  });

  const sessionLoadCount = loadRows.filter((r) => r.source === "session").length;
  const matchLoadCount = loadRows.filter((r) => r.source === "match").length;
  const estimatedMatchLoadCount = loadRows.filter((r) => r.source === "match" && r.estimated).length;
  /** Match points wear the second categorical slot; rated sessions keep the highlight. */
  const MATCH_INK = series(mode, 1);

  // Shared with the printable report so workload figures cannot disagree.
  const {
    acwr, acute: acuteLoad, weekOnWeekPct, baselineWeeklyAvg, historyDays, status: acwrStatus,
  } = computeAcwr(dailyHistory, pinnedWeeklyAnchor(), undefined, teamSessionDatesFrom(allSessions));
  const acwrCfg = ACWR_CONFIG[acwrStatus];
  const isSpike = acwrStatus === "spike";

  /**
   * The headline's plain-language half: how far above or below this player's
   * own usual load the last seven days ran. `(ratio − 1) × 100` — the same
   * `pctVsUsual` the squad page's flagged chips already show, so the two
   * surfaces phrase the identical number the identical way.
   */
  const pctVsUsual = acwr !== null ? (acwr - 1) * 100 : null;

  /**
   * Estimated share split across the two halves of the ratio, because "20%
   * estimated" overall hides which side of the comparison is soft. A spike
   * driven by a well-rated week against a mostly-filled-in baseline is a
   * different claim from one where this week is the guesswork — and the
   * single blended figure reads the same either way.
   *
   * The windows are `workloadRatioWindows`' own, off the same pinned anchor
   * the ratio uses, so these two numbers describe exactly the periods the
   * ratio divides rather than approximations of them.
   */
  const estimatedSplit = useMemo(() => {
    const { acuteStart, baselineStart, baselineEnd, end } = workloadRatioWindows(pinnedWeeklyAnchor());
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const shareBetween = (fromIso: string, toIso: string) => {
      const inWindow = historyRows.filter((r) => r.date != null && r.date >= fromIso && r.date <= toIso);
      const total = inWindow.reduce((sum, r) => sum + r.load_au, 0);
      if (total <= 0) return null;
      return inWindow.reduce((sum, r) => (r.estimated ? sum + r.load_au : sum), 0) / total;
    };
    return {
      acute: shareBetween(iso(acuteStart), iso(end)),
      baseline: shareBetween(iso(baselineStart), iso(baselineEnd)),
    };
  }, [historyRows]);

  /** The Load Trend band — usual session day, from the history behind the plotted window. */
  const usualSessionRange = useMemo(
    () => computeUsualSessionRange(historyRows, isoDaysAgo(LOAD_WINDOW_DAYS), USUAL_SESSION_MIN_DAYS),
    [historyRows],
  );

  /**
   * Turnout alongside the load figures, so a light week can be told from an
   * absent player. Without these, "18% below usual" reads the same whether he
   * trained three times and went easy or did not turn up at all — and those
   * call for opposite responses from a coach.
   *
   * Three weeks rather than the ratio's four: it is the shortest window that
   * still contains several of a Wed/Fri/Sun schedule's sessions, so a single
   * missed week moves it visibly.
   */
  /**
   * Hoisted above the training-load figures because they read it too — the
   * turnout line on the status card needs to know who actually turned up,
   * not just who submitted an RPE.
   */
  const attendedIds = useMemo(
    () => new Set(playerAttendance.filter((a) => countsAsAttended(a.status)).map((a) => a.session_id)),
    [playerAttendance],
  );

  const recentSessionActivity = useMemo(() => {
    const since = isoDaysAgo(RECENT_SESSION_DAYS);
    const sessionDays = collapseLoadByDay(historyRows.filter((r) => r.source === "session"))
      .filter((r) => r.date != null)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    // Any load row at all — session or match — is evidence of the last time
    // this player actually did something, which is the question being asked.
    const lastAnyDay = [...dailyHistory]
      .filter((r) => r.date != null)
      .sort((a, b) => (a.date as string).localeCompare(b.date as string))
      .pop();

    // Attended and logged are different failures. A player who turned up to
    // six sessions and rated two has an RPE-submission problem; one who
    // attended two of six has an availability problem. Held apart because
    // the load figures above are built only from the rated ones.
    const trainingInWindow = allSessions.filter((s) => !isMatchSession(s) && s.date >= since);
    const attendedInWindow = trainingInWindow.filter((s) => attendedIds.has(s.id)).length;

    // Match minutes, not match count: 90 minutes across three appearances is
    // a different three weeks from 15.
    const matchMinutes = matchStats.reduce((sum, m) => {
      const date = m.matches?.sessions?.date;
      return date && date >= since ? sum + (m.minutes_played ?? 0) : sum;
    }, 0);

    return {
      sessionsInWindow: sessionDays.filter((r) => (r.date as string) >= since).length,
      attendedInWindow,
      trainingHeldInWindow: trainingInWindow.length,
      matchMinutes,
      lastSessionDate: sessionDays.length > 0 ? (sessionDays[sessionDays.length - 1].date as string) : null,
      lastAnyDate: lastAnyDay?.date ?? null,
    };
  }, [historyRows, dailyHistory, allSessions, attendedIds, matchStats]);

  // ── Attendance ────────────────────────────────────────────────────────────
  // One entry per training session, but only one per match day — the same units
  // the Attendance page marks in. Picking the session this player was marked on
  // keeps their own record intact when a day has several fixtures.
  const attendanceUnits = useMemo(
    () => collapseMatchDays(allSessions, (sid) => attendedIds.has(sid)),
    [allSessions, attendedIds],
  );

  const monthlyAttendance = useMemo(() => {
    if (!attendanceUnits.sessions.length) return [];
    const byMonth: Record<string, string[]> = {};
    for (const s of attendanceUnits.sessions) {
      (byMonth[s.date.slice(0, 7)] ??= []).push(s.id);
    }
    return Object.entries(byMonth)
      .map(([month, ids]) => {
        const attended = ids.filter((sid) => attendedIds.has(sid)).length;
        return { month, total: ids.length, attended, pct: Math.round((attended / ids.length) * 100) };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [attendanceUnits, attendedIds]);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  // The headline is this month's training turnout; match-day availability is a
  // separate question, so matches are excluded above and reported underneath.
  const attendanceSlice = (ss: TrainingSession[]) => {
    const a = ss.filter((s) => attendedIds.has(s.id)).length;
    return { total: ss.length, attended: a, pct: ss.length > 0 ? Math.round((a / ss.length) * 100) : null };
  };

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date(thisMonth + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short" });
  const monthSessions = allSessions.filter((s) => s.date.slice(0, 7) === thisMonth);
  const currentMonth = attendanceSlice(monthSessions.filter((s) => !isMatchSession(s)));
  // Matches are counted per day rather than per fixture — see matchDayAttendance
  const matchAttendance = matchDayAttendance(monthSessions, (sid) => attendedIds.has(sid));

  // Goals and appearances are labelled "this year", so they are scoped to it
  const thisYear = String(new Date().getFullYear());
  const yearMatchStats = useMemo(
    () => matchStats.filter((m) => (m.matches?.sessions?.date ?? "").startsWith(thisYear)),
    [matchStats, thisYear],
  );
  const matchTotals = useMemo(() => sumStats(yearMatchStats), [yearMatchStats]);

  const bestBronco = results.reduce<number | null>(
    (best, r) => (r.bronco_mins !== null && (best === null || r.bronco_mins < best) ? r.bronco_mins : best),
    null,
  );

  // Latest recorded bronco — not necessarily the latest test, which may have
  // measured only sprints.
  const latestBroncoRow = [...chronoResults].reverse().find((r) => r.bronco_mins !== null) ?? null;
  const latestMetricRow = (fields: (keyof TestResult)[]) =>
    [...chronoResults].reverse().find((r) => fields.some((field) => r[field] != null));
  const latestMasRow = latestMetricRow(["mas_ms"]);
  const latest10mRow = latestMetricRow(["ten_m_1", "ten_m_2"]);
  const latest20mRow = latestMetricRow(["twenty_m_1", "twenty_m_2"]);
  const latest40mRow = latestMetricRow(["forty_m_1", "forty_m_2"]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-40" />
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="bg-card border border-border rounded-2xl p-5"><ChartSkeleton /></div>
      </div>
    );
  }

  if (!player) {
    return <EmptyState icon={Dumbbell} title="Player not found" action={<button onClick={() => setLocation("/players")} className="text-primary text-sm">Back to Players</button>} />;
  }

  const hasOpenInjury = playerInjuries.some((i) => i.status === "open");
  const injuriesCard = (
    <InjuriesCard
      player={player}
      injuries={playerInjuries}
      stages={injuryHistory.stages}
      availability={availability}
      sessions={allSessions}
      onChanged={loadInjuries}
    />
  );

  return (
    <div className="space-y-6">
      <button onClick={() => setLocation("/players")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back">
        <ArrowLeft size={14} />
        Players
      </button>

      {/* ── Identity + snapshot ────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {editing ? (
              <input
                value={editForm.name ?? ""}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="text-xl font-bold bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="input-edit-name"
              />
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{playerLabel(player)}</h1>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm text-muted-foreground">
              <span className="text-foreground font-medium">{player.primary_position}</span>
              {player.secondary_position && <span>/ {player.secondary_position}</span>}
              <span aria-hidden>·</span>
              <span>{player.age_range ?? "—"}</span>
              <span aria-hidden>·</span>
              <span className={cn(!player.is_active && "text-muted-foreground/60")}>
                {player.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          {editing ? (
            <div className="hidden sm:flex gap-2 shrink-0">
              <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground" data-testid="button-cancel-edit"><X size={13} />Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60" data-testid="button-save-edit"><Save size={13} />{saving ? "Saving…" : "Save"}</button>
            </div>
          ) : isAdmin ? (
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="button-edit-player"><Edit size={13} />Edit</button>
          ) : null}
        </div>

        {editing && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 mt-4 border-t border-border">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Jersey #</label>
              <input
                type="number"
                min={JERSEY_MIN}
                max={JERSEY_MAX}
                value={editForm.jersey_number ?? ""}
                onChange={(e) => setEditForm({ ...editForm, jersey_number: e.target.value === "" ? null : parseInt(e.target.value) })}
                placeholder="—"
                className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                data-testid="input-edit-jersey"
              />
              {(() => {
                const clash = jerseyClash(roster, editForm.jersey_number ?? null, player.id);
                return clash ? (
                  <p className="text-[11px] text-status-warn mt-1" data-testid="hint-jersey-clash">
                    #{editForm.jersey_number} is already {clash.name}'s number
                  </p>
                ) : null;
              })()}
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Primary Position</label>
              <select value={editForm.primary_position ?? ""} onChange={(e) => setEditForm({ ...editForm, primary_position: e.target.value, secondary_position: null })} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-foreground">
                {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Secondary Position</label>
              <select value={editForm.secondary_position ?? ""} onChange={(e) => setEditForm({ ...editForm, secondary_position: e.target.value || null })} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-foreground">
                <option value="">— None —</option>
                {(SECONDARY_POSITIONS[editForm.primary_position ?? ""] ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Year of Birth</label>
              <input type="number" value={editForm.year_of_birth ?? ""} onChange={(e) => setEditForm({ ...editForm, year_of_birth: parseInt(e.target.value) || null })} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-foreground" />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" id="edit_active" checked={editForm.is_active ?? true} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded border-border" />
              <label htmlFor="edit_active" className="text-sm text-muted-foreground">Active</label>
            </div>
            <div className="sm:hidden flex gap-2 pt-2 col-span-2">
              <button onClick={cancelEdit} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground"><X size={13} />Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60"><Save size={13} />{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}

        {/* Snapshot — attendance is the only value carrying colour */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 mt-4 border-t border-border">
          <SnapshotTile
            label={`${monthLabel} Attendance`}
            value={currentMonth.pct !== null ? `${currentMonth.pct}%` : "—"}
            sub={
              matchAttendance.pct !== null
                ? `${matchAttendance.pct}% matches (${matchAttendance.attended}/${matchAttendance.total})`
                : "No matches"
            }
            valueColor={currentMonth.pct !== null ? attendancePctColor(currentMonth.pct) : undefined}
          />
          <SnapshotTile label="Goals" value={matchTotals.goals} sub="This year" />
          <SnapshotTile label="Appearances" value={matchTotals.appearances} sub="This year" />
          <SnapshotTile
            label="Latest Bronco"
            value={formatBronco(latestBroncoRow?.bronco_mins ?? null)}
            valueNote={monthYear(latestBroncoRow?.test_sessions?.test_date) ?? undefined}
            sub={teamBand?.label}
          />
        </div>
      </div>

      {/* ── Availability ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Availability</SectionLabel>
        {/* An open injury leads the page; otherwise the history sits at the end */}
        {hasOpenInjury && injuriesCard}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <AttendanceCard monthly={monthlyAttendance} />
          <LastSessionsCard
            sessions={attendanceUnits.sessions}
            matchesOnDay={attendanceUnits.matchesOnDay}
            attendance={playerAttendance}
          />
        </div>
      </section>

      {/* ── Match record ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Match Record</SectionLabel>
        <PlayerTournamentStats stats={matchStats} finishes={finishes} />
      </section>

      {/* ── Fitness ────────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Fitness</SectionLabel>
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Fitness Snapshot</h3>
          {broncoChartData.length === 0 ? (
            <EmptyState icon={Timer} title="No test history" description="This player hasn't been tested yet" />
          ) : (
            <>
              {broncoChartData.some((row) => row.mins !== null) && (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={broncoChartData} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="session" tick={{ fill: chartAxis, fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={(v) => formatBronco(v)} domain={["auto", "auto"]} tick={{ fill: chartAxis, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                      labelStyle={{ color: chartLabel, fontSize: 12 }}
                      formatter={(v: number) => [formatBronco(v), "Bronco"]}
                    />
                    <Line type="monotone" dataKey="mins" stroke={HIGHLIGHT} strokeWidth={2} dot={{ fill: HIGHLIGHT, r: 4 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: "Bronco",     latest: formatBronco(latestBroncoRow?.bronco_mins), best: formatBronco(bestBronco) },
                  { label: "MAS (m/s)",  latest: fmtVal(latestMasRow?.mas_ms),              best: fmtBest(results, ["mas_ms"], true) },
                  { label: "10m Sprint", latest: fmtTrials(latest10mRow, ["ten_m_1", "ten_m_2"], "s"), best: fmtBest(results, ["ten_m_1", "ten_m_2"], false, "s") },
                  { label: "20m Sprint", latest: fmtTrials(latest20mRow, ["twenty_m_1", "twenty_m_2"], "s"), best: fmtBest(results, ["twenty_m_1", "twenty_m_2"], false, "s") },
                  { label: "40m Sprint", latest: fmtTrials(latest40mRow, ["forty_m_1", "forty_m_2"], "s"), best: fmtBest(results, ["forty_m_1", "forty_m_2"], false, "s") },
                ].map(({ label, latest, best }) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
                    <div className="text-2xl font-bold font-time text-foreground">{latest}</div>
                    <div className="text-[11px] font-time text-muted-foreground mt-1">Best: {best}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setFitnessHistoryOpen((value) => !value)}
                className={cn(
                  "w-full px-0 pt-4 mt-4 flex items-center justify-between text-xs transition-colors border-t",
                  isDark ? "border-white/[0.06] text-muted-foreground hover:text-foreground" : "border-slate-100 text-slate-500 hover:text-foreground",
                )}
                aria-expanded={fitnessHistoryOpen}
                data-testid="button-toggle-fitness-history"
              >
                <span>Test history ({chronoResults.length})</span>
                <ChevronDown size={13} className={cn("transition-transform", fitnessHistoryOpen && "rotate-180")} />
              </button>

              {fitnessHistoryOpen && (
                <div className="pt-4">
                  <div className="border-t border-border/60 divide-y divide-border/40">
                    {[...chronoResults].reverse().map((r) => (
                      <div key={r.id} className="py-3 flex items-center gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-foreground">{r.test_sessions?.test_name ?? "Fitness test"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {r.test_sessions?.test_date ? formatDateShort(r.test_sessions.test_date) : "—"}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-right text-[11px] font-time shrink-0">
                          <HistoryValue label="Bronco" value={formatBronco(r.bronco_mins)} />
                          <HistoryValue label="10m" value={fmtTrials(r, ["ten_m_1", "ten_m_2"], "s")} />
                          <HistoryValue label="20m" value={fmtTrials(r, ["twenty_m_1", "twenty_m_2"], "s")} />
                          <HistoryValue label="40m" value={fmtTrials(r, ["forty_m_1", "forty_m_2"], "s")} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Training load ──────────────────────────────────────────────────── */}
      {/* Not gated on rated sessions alone: a player whose only load is match
          minutes still has a load to show. */}
      {loadRows.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Training Load</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* Workload status — the status word leads, the ratio lives in the tooltip */}
            <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Workload Status</div>
                  <InfoTooltip>
                    <InfoTooltipTrigger asChild>
                      {/* Text wears foreground ink; the mark beside it carries the
                          status colour, and only Spike is ever anything but neutral. */}
                      <div className="flex items-center gap-2 cursor-help w-fit">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: acwrCfg.color }}
                          aria-hidden="true"
                        />
                        <span className="text-3xl font-bold leading-none text-foreground" data-testid="text-workload-status">
                          {acwrCfg.label}
                        </span>
                      </div>
                    </InfoTooltipTrigger>
                    <InfoTooltipContent>
                      Ratio {acwr !== null ? acwr.toFixed(2) : "—"} = last 7 days
                      ({Math.round(acuteLoad)} AU) ÷ prior 3-week average
                      ({Math.round(baselineWeeklyAvg)} AU)
                    </InfoTooltipContent>
                  </InfoTooltip>
                  <div className="text-sm text-muted-foreground mt-1.5" data-testid="text-load-vs-usual">
                    {pctVsUsual === null
                      ? acwrStatus === "building"
                        ? `${historyDays} of 28 days of history so far`
                        : "Not enough history to compare"
                      : Math.abs(Math.round(pctVsUsual)) === 0
                        ? "Level with usual"
                        : `${Math.abs(Math.round(pctVsUsual))}% ${pctVsUsual > 0 ? "above" : "below"} usual`}
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground space-y-1 shrink-0">
                  <div>
                    Last 7 days <span className="text-foreground font-time font-bold">{Math.round(acuteLoad)}</span> AU
                  </div>
                  {weekOnWeekPct != null && (
                    <div>
                      vs prev week{" "}
                      <span className="text-foreground font-time font-bold">
                        {weekOnWeekPct >= 0 ? "+" : ""}{Math.round(weekOnWeekPct)}%
                      </span>
                    </div>
                  )}
                  {(estimatedSplit.acute !== null || estimatedSplit.baseline !== null) && (
                    <div data-testid="text-load-estimated">
                      Estimated{" "}
                      <span className="text-foreground font-time font-bold">{pctOrDash(estimatedSplit.acute)}</span>
                      {" / "}
                      <span className="text-foreground font-time font-bold">{pctOrDash(estimatedSplit.baseline)}</span>
                      <span className="block text-[10px]">7d / baseline</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Turnout, so a light week can be told from an absent player. */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground mb-3">
                <span data-testid="text-sessions-recent">
                  Last 3 weeks:{" "}
                  <span className="text-foreground font-time font-bold">{recentSessionActivity.attendedInWindow}</span>
                  {" of "}
                  <span className="font-time">{recentSessionActivity.trainingHeldInWindow}</span>
                  {" attended · "}
                  <span className="text-foreground font-time font-bold">{recentSessionActivity.sessionsInWindow}</span>
                  {" rated"}
                </span>
                {recentSessionActivity.matchMinutes > 0 && (
                  <span data-testid="text-match-minutes">
                    <span className="text-foreground font-time font-bold">{recentSessionActivity.matchMinutes}</span>
                    {" match min"}
                  </span>
                )}
                <span data-testid="text-last-session">
                  {recentSessionActivity.lastSessionDate
                    ? <>Last session <span className="text-foreground font-medium">{formatDateShort(recentSessionActivity.lastSessionDate)}</span>{daysSinceLabel(recentSessionActivity.lastSessionDate)}</>
                    : recentSessionActivity.lastAnyDate
                      ? <>No rated session in {LOAD_HISTORY_DAYS} days · last played <span className="text-foreground font-medium">{formatDateShort(recentSessionActivity.lastAnyDate)}</span></>
                      : "No sessions logged"}
                </span>
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                {acwrStatus === "building"
                  ? `${acwrCfg.desc} ${historyDays} of 28 calendar days of workload history are currently available.`
                  : acwrCfg.desc}
              </p>

              {/* Neutral scale with one accent segment for Spike, plus a marker
                  for where this player sits. The strip no longer implies that
                  the left-hand bands are "good" and the right-hand ones "bad". */}
              <div className="mt-auto">
                <div className="relative h-1.5">
                  <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
                    <div className="w-[25%]" style={{ background: `${WORKLOAD_NEUTRAL}40` }} title="< 0.8 Low" />
                    <div className="w-[25%]" style={{ background: `${WORKLOAD_NEUTRAL}66` }} title="0.8–1.3 Typical" />
                    <div className="w-[20%]" style={{ background: `${WORKLOAD_NEUTRAL}99` }} title="1.3–1.5 Elevated" />
                    <div className="w-[30%]" style={{ background: `${WORKLOAD_ACCENT}59` }} title="> 1.5 Spike" />
                  </div>
                  {acwr !== null && (
                    <div
                      className="absolute -top-1 w-0.5 h-3.5 rounded-full text-foreground"
                      style={{
                        // The strip spans ratio 0–2.0, which is what puts the
                        // 0.8 / 1.3 / 1.5 stops at the segment widths above.
                        left: `${Math.min(Math.max(acwr / 2, 0), 1) * 100}%`,
                        background: isSpike ? WORKLOAD_ACCENT : "currentColor",
                      }}
                      title={`Ratio ${acwr.toFixed(2)}`}
                      data-testid="marker-workload-ratio"
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0.8</span><span>1.3</span><span>1.5+</span>
                </div>
              </div>
            </div>

            {/* Load trend */}
            {loadChartData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
                <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">Load Trend</h3>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-0.5 rounded-full" style={{ background: HIGHLIGHT }} /> Actual
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-0.5 rounded-full" style={{ background: PLANNED_INK }} /> Set
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 border-t border-dashed" style={{ borderColor: chartAxis }} /> Avg
                    </span>
                    {usualSessionRange && (
                      <span
                        className="flex items-center gap-1"
                        title={`Middle half of this player's session days before the window: ${Math.round(usualSessionRange.low)}–${Math.round(usualSessionRange.high)} AU`}
                      >
                        <span className="w-3 border-t" style={{ borderColor: chartAxis, opacity: 0.45, borderStyle: "dashed" }} />
                        Usual session {Math.round(usualSessionRange.low)}–{Math.round(usualSessionRange.high)}
                      </span>
                    )}
                    {matchLoadCount > 0 && (
                      <span className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rotate-45 border-[1.5px]"
                          style={{ borderColor: MATCH_INK, background: INK.surface }}
                        />
                        Match{estimatedMatchLoadCount > 0
                          ? ` (${estimatedMatchLoadCount} est. RPE ${MATCH_RPE})`
                          : " (player RPE)"}
                      </span>
                    )}
                    <span>
                      {sessionLoadCount} session{sessionLoadCount !== 1 ? "s" : ""}
                      {matchLoadCount > 0 && ` · ${matchLoadCount} match${matchLoadCount !== 1 ? "es" : ""}`}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-h-0" style={{ minHeight: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {/* Level date labels need no angled gutter, so the plot keeps
                        the ~26px the rotated ticks used to reserve. */}
                    {/* left:0 with a wider Y band — match load pushes the axis
                        into 3 digits, which the old -12 gutter clipped. */}
                    <LineChart data={loadWithAvg} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: chartAxis, fontSize: 9 }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tick={{ fill: chartAxis, fontSize: 9 }} width={34} tickLine={false} axisLine={false} />
                      {/* Two light dashed edges rather than a filled block: a
                          shaded region reads as a band of the chart itself,
                          competing with the plotted series instead of
                          annotating it. Unlabelled in the plot — the legend
                          names it, so nothing sits on top of the lines. */}
                      {usualSessionRange && [usualSessionRange.low, usualSessionRange.high].map((y, i) => (
                        <ReferenceLine
                          key={i}
                          y={Math.max(0, y)}
                          stroke={chartAxis}
                          strokeOpacity={0.45}
                          strokeWidth={1}
                          strokeDasharray="5 4"
                          ifOverflow="hidden"
                        />
                      ))}
                      <Tooltip
                        contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: chartLabel, fontSize: 12 }}
                        formatter={(v: number, key: string, item) => [
                          `${v} AU`,
                          key === "rollingAvg" ? "Rolling avg (4)"
                            : key === "planned" ? "Set load"
                            : (item?.payload as { source?: string; estimated?: boolean })?.source === "match"
                              ? (item?.payload as { estimated?: boolean })?.estimated
                                ? `Match load (RPE ${MATCH_RPE} estimate)`
                                : "Match load (player RPE)"
                              : "Actual load",
                        ]}
                      />
                      <Line type="monotone" dataKey="planned" stroke={PLANNED_INK} strokeWidth={1.5} dot={false} connectNulls />
                      {/* Match points distinguish days that include match minutes. */}
                      <Line
                        type="monotone"
                        dataKey="load"
                        stroke={HIGHLIGHT}
                        strokeWidth={2}
                        dot={(props) => {
                          const { cx, cy, payload, index } = props as {
                            cx: number; cy: number; payload: { source?: string }; index: number;
                          };
                          // A match is a different kind of day, not a heavier
                          // session, and the usual-session band does not apply
                          // to it — so it gets a different shape, not just a
                          // different colour. A hollow diamond survives a
                          // greyscale print and colour-blind vision, where two
                          // circles differing only in hue do not.
                          if (payload?.source === "match") {
                            const r = 4;
                            return (
                              <path
                                key={index}
                                d={`M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`}
                                fill={INK.surface}
                                stroke={MATCH_INK}
                                strokeWidth={1.75}
                              />
                            );
                          }
                          return <circle key={index} cx={cx} cy={cy} r={2.5} fill={HIGHLIGHT} />;
                        }}
                      />
                      <Line type="monotone" dataKey="rollingAvg" stroke={chartAxis} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* The caveats, once, under the section — not inside the status card,
              where a sentence about what the number is not was competing with
              the number itself. Mirrors the squad Overview's footnote. */}
          <p className="text-[11px] text-muted-foreground pt-1">
            Load is rated sessions plus match minutes. Match minutes use the player's RPE when logged, or a
            clearly marked RPE {MATCH_RPE} estimate when it is missing. The workload ratio compares the latest
            7 days with the prior 3-week average and needs 28 calendar days of history; it is a monitoring
            signal, not an injury prediction.
            {usualSessionRange && " The usual session range is this player's own training-session days over the weeks before the chart's window — matches are excluded from it."}
          </p>
        </section>
      )}

      {/* ── Injuries, when none is open ────────────────────────────────────── */}
      {!hasOpenInjury && (isAdmin || playerInjuries.length > 0) && (
        <section className="space-y-2">
          <SectionLabel>Injuries</SectionLabel>
          {injuriesCard}
        </section>
      )}
    </div>
  );
}

// ── Test-value formatting helpers ─────────────────────────────────────────────
type ResultRow = TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } };

function HistoryValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

function fmtVal(v: number | null | undefined, suffix = ""): string {
  return v != null ? v.toFixed(2) + suffix : "—";
}

/**
 * Best value across the named test fields — higher is better only for MAS.
 * Sprints pass both trials, since either attempt can be the quicker one.
 */
function fmtBest(rows: ResultRow[], fields: (keyof TestResult)[], higherIsBetter: boolean, suffix = ""): string {
  const best = rows.reduce<number | null>((acc, r) => {
    for (const f of fields) {
      const v = r[f] as number | null;
      if (v === null || v === undefined) continue;
      acc = acc === null ? v : higherIsBetter ? Math.max(acc, v) : Math.min(acc, v);
    }
    return acc;
  }, null);
  return best !== null ? best.toFixed(2) + suffix : "—";
}

/** Best of the trials recorded on one test — mirrors fmtBest for a single row. */
function fmtTrials(row: ResultRow | undefined, fields: (keyof TestResult)[], suffix = ""): string {
  if (!row) return "—";
  let v: number | null = null;
  for (const f of fields) {
    const x = row[f] as number | null;
    if (x === null || x === undefined) continue;
    v = v === null ? x : Math.min(v, x);
  }
  return v !== null ? v.toFixed(2) + suffix : "—";
}
