import { useEffect, useState, useCallback, useMemo } from "react";
import { MetricCardSkeleton } from "@/components/Skeleton";
import {
  fetchLatestSessionResults, fetchPlayers, fetchAllRPEWithSessions,
  fetchAllAttendanceStats, fetchAllResults, fetchTrainingSessions, fetchAllMatchStats,
  fetchInjuryHistory, type PlayerMatchStat,
} from "@/lib/queries";
import { NO_INJURIES, buildAvailability, buildEvidence, closingPrompts, type Availability } from "@/lib/injuries";
import { todayISO } from "@/lib/attendance";
import { ClosingPrompts } from "@/components/injuries/ClosingPrompts";
import { AvailabilityBadge } from "@/components/injuries/AvailabilityBadge";
import type { InjuryStage, InjuryWithStatus } from "@/lib/types";
import { Link } from "wouter";
import {
  computeAlerts, CAT_CFG, SEV_COLOR,
  type AlertItem, type AlertSeverity, type AlertCategory,
  type AlertRPERow as RPERow, type AlertAttRow as AttRow, type AlertResultRow as ResultRow,
} from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { PosBadge } from "@/components/PosBadge";
import { SessionTypeBadge } from "@/components/Badges";
import { type Player, type TestResult, type TestSession, type TrainingSession } from "@/lib/types";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ReportInjuryDialog } from "@/components/injuries/ReportInjuryDialog";

// ── Constants ────────────────────────────────────────────────────────────────
const BENCHMARK_MINS = 5 + 6 / 60;

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [reportingInjury, setReportingInjury] = useState(false);

  const [players,          setPlayers]          = useState<Player[]>([]);
  const [latestData,       setLatestData]        = useState<{ session: TestSession | null; results: (TestResult & { players: Pick<Player, "name" | "code" | "team"> })[] } | null>(null);
  const [rpeData,          setRpeData]           = useState<RPERow[]>([]);
  const [attendanceData,   setAttendanceData]    = useState<AttRow[]>([]);
  const [allResults,       setAllResults]        = useState<ResultRow[]>([]);
  const [trainingSessions, setTrainingSessions]  = useState<TrainingSession[]>([]);
  const [matchStats,       setMatchStats]        = useState<PlayerMatchStat[]>([]);
  const [availability,     setAvailability]      = useState<Availability>(NO_INJURIES);
  const [injuryHistory,    setInjuryHistory]     = useState<{ injuries: InjuryWithStatus[]; stages: InjuryStage[] }>({ injuries: [], stages: [] });
  const [loading,          setLoading]           = useState(true);
  const [expanded,         setExpanded]          = useState<Set<AlertCategory>>(new Set(["workload", "recovery", "attendance", "fitness"]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, latest, rpe, att, results, sessions, mStats, injuryHistory] = await Promise.all([
        fetchPlayers(), fetchLatestSessionResults(),
        fetchAllRPEWithSessions(), fetchAllAttendanceStats(),
        fetchAllResults(), fetchTrainingSessions(), fetchAllMatchStats(),
        fetchInjuryHistory(),
      ]);
      setAvailability(buildAvailability(injuryHistory.injuries, injuryHistory.stages));
      setInjuryHistory(injuryHistory);
      setPlayers(ps);
      setLatestData(latest);
      setRpeData(rpe as RPERow[]);
      setAttendanceData(att as AttRow[]);
      setAllResults(results as ResultRow[]);
      setTrainingSessions(sessions);
      setMatchStats(mStats);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active   = players.filter((p) => p.is_active);
  const inactive = players.filter((p) => !p.is_active);

  const latestResults = latestData?.results ?? [];
  const testedCount   = latestResults.filter((r) => r.bronco_mins !== null).length;
  const atBenchmark   = latestResults.filter((r) => r.bronco_mins !== null && r.bronco_mins < BENCHMARK_MINS).length;

  // ── Alert engine ── extracted to lib/alerts.ts, shared with the dashboard
  // rebuild and any other page that needs the same squad-wide flags.
  const alerts = useMemo(
    () => computeAlerts({ players, rpeData, attendanceData, allResults, trainingSessions, matchStats, availability }),
    [players, rpeData, attendanceData, allResults, trainingSessions, matchStats, availability],
  );

  // ── Availability ──────────────────────────────────────────────────────────
  const today = todayISO();
  const unavailable = useMemo(() => {
    const m = availability.unavailableOn(today);
    return players.filter((p) => p.is_active && m.has(p.id)).map((p) => ({ player: p, a: m.get(p.id)! }));
  }, [availability, players, today]);
  const prompts = useMemo(() => {
    const evidence = buildEvidence(
      rpeData.map((r) => ({ player_id: r.player_id, date: r.sessions?.date, estimated: r.estimated })),
      matchStats.map((m) => ({ player_id: m.player_id, date: m.matches?.sessions?.date, minutes: m.minutes_played })),
    );
    return closingPrompts(injuryHistory.injuries, injuryHistory.stages, evidence, today);
  }, [injuryHistory, rpeData, matchStats, today]);

  // ── Monthly attendance % ──────────────────────────────────────────────────
  const monthlyAttPct = useMemo(() => {
    const now = new Date();
    const ms  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const me  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const logged  = trainingSessions.filter((s) => (s.date ?? "") >= ms && (s.date ?? "") <= me && attendanceData.some((a) => a.session_id === s.id));
    if (!logged.length) return null;
    const relevant = attendanceData.filter((a) => logged.some((s) => s.id === a.session_id));
    const present  = relevant.filter((a) => a.status === "Present" || a.status === "Late").length;
    return relevant.length > 0 ? Math.round((present / relevant.length) * 100) : null;
  }, [attendanceData, trainingSessions]);

  // ── Upcoming sessions ─────────────────────────────────────────────────────
  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...trainingSessions]
      .filter((s) => (s.date ?? "") >= today)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      .slice(0, 6);
  }, [trainingSessions]);

  // ── Alert grouping helpers ────────────────────────────────────────────────
  const alertsByCat = (cat: AlertCategory) => alerts.filter((a) => a.category === cat);
  const groupByPlayer = (items: AlertItem[]) => {
    const map = new Map<string, { player: Player; items: AlertItem[] }>();
    for (const a of items) {
      if (!map.has(a.player.id)) map.set(a.player.id, { player: a.player, items: [] });
      map.get(a.player.id)!.items.push(a);
    }
    // Sort players within group: most severe first
    const sevOrder: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 };
    return Array.from(map.values()).sort((a, b) => {
      const aMin = Math.min(...a.items.map((i) => sevOrder[i.severity]));
      const bMin = Math.min(...b.items.map((i) => sevOrder[i.severity]));
      return aMin - bMin;
    });
  };

  const toggle = (cat: AlertCategory) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const dangerCount  = alerts.filter((a) => a.severity === "danger").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount    = alerts.filter((a) => a.severity === "info").length;

  const monthName = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{active.length} active · {inactive.length} inactive · {monthName}</p>
        {/* For injuries that don't come up while taking attendance or filling in a match */}
        {isAdmin && !loading && (
          <button
            onClick={() => setReportingInjury(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-report-injury"
          >
            <Activity size={13} /> Report injury
          </button>
        )}
      </div>

      {reportingInjury && (
        <ReportInjuryDialog
          players={active}
          sessions={trainingSessions}
          onClose={() => setReportingInjury(false)}
          onRecorded={() => setReportingInjury(false)}
        />
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-border rounded-2xl overflow-hidden divide-x divide-y sm:divide-y-0 divide-border bg-card">
        {loading ? Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />) : (
          <>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Squad</div>
              <div className="text-2xl font-bold text-foreground">{active.length}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{players.length} registered</div>
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Alerts</div>
              {alerts.length === 0 ? (
                <><div className="text-xl font-bold text-status-good">All clear</div><div className="text-[11px] text-muted-foreground mt-1">No issues flagged</div></>
              ) : (
                <>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    {dangerCount  > 0 && <span className="text-2xl font-bold text-status-bad">{dangerCount}</span>}
                    {warningCount > 0 && <span className={cn("font-bold text-status-warn", dangerCount > 0 ? "text-lg" : "text-2xl")}>{warningCount}</span>}
                    {infoCount    > 0 && <span className={cn("font-bold text-foreground",  dangerCount + warningCount > 0 ? "text-base" : "text-2xl")}>{infoCount}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {[dangerCount > 0 && `${dangerCount} Priority`, warningCount > 0 && `${warningCount} Review`, infoCount > 0 && `${infoCount} info`].filter(Boolean).join(" · ")}
                  </div>
                </>
              )}
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Attendance this month</div>
              {monthlyAttPct !== null ? (
                <><div className={cn("text-2xl font-bold font-time", monthlyAttPct >= 75 ? "text-status-good" : "text-status-warn")}>{monthlyAttPct}%</div><div className="text-[11px] text-muted-foreground mt-1">Team avg · target ≥75%</div></>
              ) : (
                <><div className="text-2xl font-bold text-muted-foreground">—</div><div className="text-[11px] text-muted-foreground mt-1">No attendance logged yet</div></>
              )}
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">At benchmark</div>
              {testedCount > 0 ? (
                <><div className="text-2xl font-bold text-foreground"><span className="text-status-good">{atBenchmark}</span><span className="text-muted-foreground font-normal text-lg"> / {testedCount}</span></div><div className="text-[11px] text-muted-foreground mt-1">Good tier · latest session</div></>
              ) : (
                <><div className="text-2xl font-bold text-muted-foreground">—</div><div className="text-[11px] text-muted-foreground mt-1">No bronco data yet</div></>
              )}
            </div>
          </>
        )}
      </div>

      {/* Availability — who is injured, and which injuries need an answer */}
      {!loading && (unavailable.length > 0 || prompts.length > 0) && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden" data-testid="panel-availability">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Availability</span>
            <span className="text-[11px] text-muted-foreground">
              {unavailable.length} not match fit{prompts.length > 0 && ` · ${prompts.length} to update`}
            </span>
          </div>
          <ClosingPrompts prompts={prompts} players={players} onChanged={load} />
          {unavailable.length > 0 && (
            <div className={cn("px-5 py-3 flex flex-wrap gap-2", prompts.length > 0 && "border-t border-border")}>
              {unavailable.map(({ player, a }) => (
                <Link key={player.id} href={`/players/${player.id}`} className="flex items-center gap-1.5 text-sm text-foreground hover:text-indigo-400 transition-colors">
                  {player.name} <AvailabilityBadge availability={a} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alert accordion */}
      {!loading && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {/* Panel header */}
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              {alerts.length > 0
                ? <AlertTriangle size={14} className={dangerCount > 0 ? "text-status-bad" : "text-status-warn"} />
                : <CheckCircle2 size={14} className="text-status-good" />}
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {alerts.length > 0 ? "Player alerts" : "Squad status"}
              </span>
            </div>
            {alerts.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {dangerCount  > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-bad   text-status-bad">{dangerCount} Priority</span>}
                {warningCount > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{warningCount} Review</span>}
                {infoCount    > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted  text-foreground">{infoCount} info</span>}
              </div>
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="px-5 py-5 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-status-good flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-foreground">All clear</div>
                <div className="text-xs text-muted-foreground mt-0.5">No concerns flagged right now</div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(["workload", "recovery", "attendance", "fitness"] as AlertCategory[]).map((cat) => {
                const catItems = alertsByCat(cat);
                if (!catItems.length) return null;
                const cfg    = CAT_CFG[cat];
                const groups = groupByPlayer(catItems);
                const isOpen = expanded.has(cat);
                const urgentCount  = catItems.filter((a) => a.severity === "danger").length;
                const monitorCount = catItems.filter((a) => a.severity === "warning").length;
                return (
                  <div key={cat}>
                    {/* Section header */}
                    <button
                      onClick={() => toggle(cat)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                    >
                      {isOpen
                        ? <ChevronDown size={13} className="text-muted-foreground flex-shrink-0" />
                        : <ChevronRight size={13} className="text-muted-foreground flex-shrink-0" />}
                      <span className="text-sm font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                      <div className="flex gap-1.5">
                        {urgentCount  > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-status-bad   text-status-bad">{urgentCount} Priority</span>}
                        {monitorCount > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{monitorCount} Review</span>}
                      </div>
                      <span className="ml-auto text-[11px] text-muted-foreground">{groups.length} player{groups.length !== 1 ? "s" : ""}</span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border/50" style={{ background: cfg.color + "07" }}>
                        {/* Section description + metric note */}
                        <div className="px-5 py-3 border-b border-border/30 space-y-1">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{cfg.description}</p>
                          <p className="text-[10px] font-medium" style={{ color: cfg.color + "cc" }}>{cfg.metricNote}</p>
                        </div>
                        {/* Player cards */}
                        <div className="divide-y divide-border/40">
                          {groups.map(({ player, items }) => {
                            return (
                              <div key={player.id} className="px-5 py-3.5">
                                <div className="flex items-center gap-2 mb-3">
                                  <PosBadge pos={player.primary_position} className="h-5 px-1" />
                                  <span className="text-sm font-semibold text-foreground">{player.name}</span>
                                </div>
                                <div className="space-y-3.5">
                                  {items.map((a) => {
                                    const sevColor = SEV_COLOR[a.severity];
                                    return (
                                      <div key={a.id} className="pl-1">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sevColor }} />
                                          <span className="text-xs font-semibold text-foreground">{a.headline}</span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed pl-3">{a.detail}</p>
                                        <div className="mt-1.5 flex items-start gap-1 pl-3">
                                          <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: sevColor }}>→</span>
                                          <span className="text-[11px] font-medium leading-relaxed" style={{ color: sevColor }}>{a.action}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Upcoming sessions */}
      {!loading && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Upcoming sessions</span>
            {upcoming.length > 0 && <span className="text-xs text-muted-foreground">{upcoming.length} scheduled</span>}
          </div>
          {upcoming.length === 0 ? (
            <div className="px-5 py-5 text-sm text-muted-foreground">No upcoming sessions scheduled</div>
          ) : (
            <div className="divide-y divide-border/50">
              {upcoming.map((s) => {
                const dateObj  = new Date(s.date + "T00:00:00");
                const dayLabel = dateObj.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                return (
                  <div key={s.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-[96px] text-xs font-medium text-foreground font-time">{dayLabel}</div>
                    <SessionTypeBadge type={s.session_type} />
                    <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground">
                      <span className="font-time">{s.duration_mins} min</span>
                      {s.planned_rpe > 0 && <span>RPE {s.planned_rpe}</span>}
                      {s.notes && <span className="truncate max-w-[160px] hidden sm:block">{s.notes}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
