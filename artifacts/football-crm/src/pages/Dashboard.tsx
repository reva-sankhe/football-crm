import { useEffect, useState, useCallback, useMemo } from "react";
import { useTeam } from "@/context/TeamContext";
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { MetricCardSkeleton } from "@/components/Skeleton";
import {
  fetchLatestSessionResults, fetchPlayers, fetchAllRPEWithSessions,
  fetchAllAttendanceStats, fetchAllResults, fetchTrainingSessions,
} from "@/lib/queries";
import { cn, formatBronco } from "@/lib/utils";
import { STATUS } from "@/lib/viz";
import { PosBadge } from "@/components/PosBadge";
import { SessionTypeBadge } from "@/components/Badges";
import {
  type Player, type TestResult, type TestSession,
  type TrainingSession, type SessionRPE, type SessionAttendance,
} from "@/lib/types";
import { AlertTriangle, CheckCircle2, Activity, Calendar, Dumbbell, ChevronDown, ChevronRight } from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────
const BENCHMARK_MINS = 5 + 6 / 60;

// ── Alert types ──────────────────────────────────────────────────────────────
type AlertSeverity = "danger" | "warning" | "info";
type AlertCategory = "injury_risk" | "recovery" | "attendance" | "fitness";

interface AlertItem {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  player: Player;
  headline: string;
  detail: string;
  action: string;
}

// Severity used only for per-alert colour coding within sections
const SEV_COLOR: Record<AlertSeverity, string> = {
  danger:  STATUS.critical,
  warning: STATUS.warning,
  info:    STATUS.serious,
};

// The 4 functional sections — each maps to one area a coach can act on
const CAT_CFG: Record<AlertCategory, { label: string; description: string; color: string; dimBg: string; metricNote: string }> = {
  injury_risk: {
    label: "Injury Risk",
    description: "Players whose recent training load has spiked beyond what their body is adapted to. The acute:chronic workload ratio (ACWR) compares this week's load against a 4-week rolling average — above 1.3 is the recognised caution zone, above 1.5 is high risk.",
    metricNote: "ACWR = this week's load ÷ average weekly load over 28 days",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  recovery: {
    label: "Recovery Concern",
    description: "Players who are consistently reporting sessions as harder than planned. When a player's actual RPE is regularly above the session's planned RPE, it signals they may not be recovering adequately between sessions — or that planned intensity is beyond their current capacity.",
    metricNote: "RPE gap = player's actual rating minus the session's planned RPE",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  attendance: {
    label: "Attendance",
    description: "Players below the 75% monthly attendance threshold. Consistent absence disrupts fitness development, reduces cohesion in set-piece and tactical work, and makes it harder to fairly assess match readiness.",
    metricNote: "Minimum required: 75% of logged sessions per month",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  fitness: {
    label: "Fitness & Testing",
    description: "Players with a notable bronco time decline since their last test, or who haven't been tested in 60+ days. Without regular testing you can't track fitness trends, spot fatigue-related decline early, or make informed decisions about match minutes.",
    metricNote: "Bronco test recommended every 4–8 weeks",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
};

type RPERow = SessionRPE & { sessions: TrainingSession; players: Pick<Player, "id" | "name" | "team" | "primary_position" | "age_range"> };
type AttRow = SessionAttendance & { players: Pick<Player, "id" | "name" | "primary_position" | "team"> };
type ResultRow = TestResult & { players?: Pick<Player, "name" | "code" | "team" | "primary_position" | "age_range">; test_sessions?: { test_date: string; test_name: string; type: string | null } };

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { team } = useTeam();

  const [players,          setPlayers]          = useState<Player[]>([]);
  const [latestData,       setLatestData]        = useState<{ session: TestSession | null; results: (TestResult & { players: Pick<Player, "name" | "code" | "team"> })[] } | null>(null);
  const [rpeData,          setRpeData]           = useState<RPERow[]>([]);
  const [attendanceData,   setAttendanceData]    = useState<AttRow[]>([]);
  const [allResults,       setAllResults]        = useState<ResultRow[]>([]);
  const [trainingSessions, setTrainingSessions]  = useState<TrainingSession[]>([]);
  const [loading,          setLoading]           = useState(true);
  const [expanded,         setExpanded]          = useState<Set<AlertCategory>>(new Set(["injury_risk", "recovery", "attendance", "fitness"]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, latest, rpe, att, results, sessions] = await Promise.all([
        fetchPlayers(team), fetchLatestSessionResults(team),
        fetchAllRPEWithSessions(), fetchAllAttendanceStats(),
        fetchAllResults(), fetchTrainingSessions(),
      ]);
      setPlayers(ps);
      setLatestData(latest);
      setRpeData(rpe as RPERow[]);
      setAttendanceData(att as AttRow[]);
      setAllResults(results as ResultRow[]);
      setTrainingSessions(sessions);
    } finally { setLoading(false); }
  }, [team]);

  useEffect(() => { load(); }, [load]);

  const active   = players.filter((p) => p.is_active);
  const inactive = players.filter((p) => !p.is_active);

  const latestResults = latestData?.results ?? [];
  const testedCount   = latestResults.filter((r) => r.bronco_mins !== null).length;
  const atBenchmark   = latestResults.filter((r) => r.bronco_mins !== null && r.bronco_mins < BENCHMARK_MINS).length;

  // ── Alert engine ──────────────────────────────────────────────────────────
  const alerts = useMemo((): AlertItem[] => {
    const items: AlertItem[] = [];
    const activePlayers = players.filter((p) => p.is_active);
    const teamRpe       = rpeData.filter((r) => r.players?.team === team);
    const teamResults   = allResults.filter((r) => r.players?.team === team);
    const teamAtt       = attendanceData.filter((a) => a.players?.team === team);

    const now     = new Date();
    const days7   = new Date(now.getTime() - 7  * 86_400_000);
    const days28  = new Date(now.getTime() - 28 * 86_400_000);

    // 1. ACWR + RPE vs planned gap
    const rpeByPlayer = new Map<string, RPERow[]>();
    for (const r of teamRpe) {
      if (!r.players?.id) continue;
      if (!rpeByPlayer.has(r.players.id)) rpeByPlayer.set(r.players.id, []);
      rpeByPlayer.get(r.players.id)!.push(r);
    }
    for (const [pid, rows] of rpeByPlayer) {
      const player = activePlayers.find((p) => p.id === pid);
      if (!player) continue;

      // ── ACWR ────────────────────────────────────────────────────────────
      const acuteSessions = rows.filter((r) => r.sessions?.date && new Date(r.sessions.date + "T00:00:00") >= days7);
      const acute      = acuteSessions.reduce((s, r) => s + r.load_au, 0);
      const chronic28  = rows.filter((r) => r.sessions?.date && new Date(r.sessions.date + "T00:00:00") >= days28).reduce((s, r) => s + r.load_au, 0);
      const chronicAvg = chronic28 / 4;
      const acwr       = chronicAvg > 0 ? acute / chronicAvg : null;

      if (acwr !== null && acwr > 1.5) {
        // Downgrade severity if the spike was driven by planned high-intensity sessions
        const acutePlannedRpes = acuteSessions.map((r) => r.sessions?.planned_rpe ?? 0).filter((v) => v > 0);
        const acuteAvgPlannedRpe = acutePlannedRpes.length > 0
          ? acutePlannedRpes.reduce((a, b) => a + b, 0) / acutePlannedRpes.length
          : 0;
        const isPlannedHighBlock = acuteAvgPlannedRpe >= 7;
        items.push({
          id: `acwr-${pid}`,
          severity: isPlannedHighBlock ? "warning" : "danger",
          category: "injury_risk",
          player,
          headline: isPlannedHighBlock
            ? `ACWR ${acwr.toFixed(2)} — Elevated during planned high-intensity block`
            : `ACWR ${acwr.toFixed(2)} — Load spike not explained by session plan`,
          detail: isPlannedHighBlock
            ? `This week's load is ${Math.round(acwr * 100)}% of their 4-week average. The spike is driven by planned hard sessions (avg planned RPE ${acuteAvgPlannedRpe.toFixed(1)}), so it's expected — but still worth watching.`
            : `This week's load is ${Math.round(acwr * 100)}% of their 4-week average (${Math.round(acute)} AU this week vs ${Math.round(chronicAvg)} AU/wk norm). The spike isn't explained by planned session intensity, which makes it more concerning.`,
          action: isPlannedHighBlock
            ? "Check in with players after the next session. If multiple players report heavy legs or excessive soreness, consider scaling back the following session's intensity."
            : "Reduce session volume or intensity immediately. Schedule a recovery or low-intensity day before the next hard session. Reassess after 7 days.",
        });
      } else if (acwr !== null && acwr > 1.3) {
        items.push({ id: `acwr-${pid}`, severity: "warning", category: "injury_risk", player,
          headline: `ACWR ${acwr.toFixed(2)} — Approaching the caution threshold`,
          detail: `This week's load is ${Math.round(acwr * 100)}% of their 4-week average (${Math.round(acute)} AU this week vs ${Math.round(chronicAvg)} AU/wk norm). Above 130% is the recognised caution zone.`,
          action: "Stick to the current plan — don't add extra sessions or unplanned intensity this week. If the player looks flat, pull back before it becomes a bigger issue." });
      }

      // ── RPE vs planned gap ───────────────────────────────────────────────
      // Only alert when a player is consistently working harder than the session plan intended.
      const sortedByDate = [...rows].sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""));
      const withPlan = sortedByDate.filter((r) => (r.sessions?.planned_rpe ?? 0) > 0);
      const recentWithPlan = withPlan.slice(-5);
      if (recentWithPlan.length >= 3) {
        const gaps = recentWithPlan.map((r) => r.rpe - (r.sessions?.planned_rpe ?? r.rpe));
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        if (avgGap >= 3.0) {
          items.push({ id: `rpe-${pid}`, severity: "danger", category: "recovery", player,
            headline: `Effort ${avgGap.toFixed(1)} points above plan on average`,
            detail: `Across the last ${recentWithPlan.length} sessions with a set plan, this player has rated their effort ${avgGap.toFixed(1)} RPE points above what was planned on average. A gap this large usually means the training stimulus is beyond what they can currently absorb.`,
            action: "Lower planned RPE or reduce session duration for this player. Either the plan needs adjusting, or they need extra recovery time between sessions — don't wait for an injury to prompt this." });
        } else if (avgGap >= 1.5) {
          items.push({ id: `rpe-${pid}`, severity: "warning", category: "recovery", player,
            headline: `Effort ${avgGap.toFixed(1)} points above plan on average`,
            detail: `Across the last ${recentWithPlan.length} sessions with a set plan, this player has rated sessions ${avgGap.toFixed(1)} RPE points harder than planned on average — a consistent gap, not a one-off hard day.`,
            action: "Before the next session, ask the player how they're feeling. If they report heaviness or fatigue, reduce their involvement in high-intensity drills for that session." });
        }
      }
    }

    // 2. Monthly attendance
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const monthSessions = trainingSessions.filter((s) => (s.date ?? "") >= monthStart && (s.date ?? "") <= monthEnd);
    const sessionIdsWithAtt = new Set(teamAtt.map((a) => a.session_id));
    const loggedMonthSessions = monthSessions.filter((s) => sessionIdsWithAtt.has(s.id));
    if (loggedMonthSessions.length > 0) {
      for (const player of activePlayers) {
        const playerAtt = teamAtt.filter((a) => a.player_id === player.id && loggedMonthSessions.some((s) => s.id === a.session_id));
        if (!playerAtt.length) continue;
        const attended = playerAtt.filter((a) => a.status === "Present" || a.status === "Late").length;
        const pct = attended / loggedMonthSessions.length;
        if (pct < 0.75) {
          const isDanger = pct < 0.5;
          items.push({ id: `att-${player.id}`, severity: isDanger ? "danger" : "warning", category: "attendance", player,
            headline: `${Math.round(pct * 100)}% attendance this month (${attended} of ${loggedMonthSessions.length} sessions)`,
            detail: isDanger
              ? `This player has missed more than half of this month's logged sessions. At this level of absence they're falling behind on fitness, missing tactical and set-piece work, and it becomes difficult to justify match selection.`
              : `Below the 75% minimum. Missed sessions add up quickly — one or two more absences this month will make it very difficult to meet the threshold.`,
            action: isDanger
              ? "Reach out to the player directly and have an honest conversation. Continued absence at this level needs to factor into squad selection decisions."
              : "Have a conversation with the player before the next session. Identify whether it's injury, scheduling, or something else — and agree on what's needed to get back on track." });
        }
      }
    }

    // 3. Fitness decline
    const resultsByPlayer = new Map<string, ResultRow[]>();
    for (const r of teamResults) {
      if (!r.player_id || r.bronco_mins === null) continue;
      if (!resultsByPlayer.has(r.player_id)) resultsByPlayer.set(r.player_id, []);
      resultsByPlayer.get(r.player_id)!.push(r);
    }
    for (const [pid, res] of resultsByPlayer) {
      const player = activePlayers.find((p) => p.id === pid);
      if (!player) continue;
      const sorted = [...res].sort((a, b) => (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""));
      if (sorted.length < 2) continue;
      const prev = sorted[sorted.length - 2], latest = sorted[sorted.length - 1];
      if (prev.bronco_mins !== null && latest.bronco_mins !== null) {
        const dec = Math.round((latest.bronco_mins - prev.bronco_mins) * 60);
        if (dec >= 15) {
          items.push({ id: `fitdec-${pid}`, severity: "warning", category: "fitness", player,
            headline: `Bronco time declined by ${dec}s since last test`,
            detail: `Previous: ${formatBronco(prev.bronco_mins)} → Latest: ${formatBronco(latest.bronco_mins)} at ${latest.test_sessions?.test_name ?? "latest test"}. A drop of ${dec}s+ is a meaningful decline — it can indicate accumulated fatigue, illness during the testing period, or a genuine fitness regression.`,
            action: "Don't act on one result in isolation — schedule a retest to confirm. If the decline holds, review this player's training load and recovery from the past 4 weeks before making changes." });
        }
      }
    }

    // 4. Test overdue (>60 days)
    const latestTestDate = new Map<string, string>();
    for (const r of teamResults) {
      if (!r.player_id || !r.test_sessions?.test_date) continue;
      const ex = latestTestDate.get(r.player_id);
      if (!ex || r.test_sessions.test_date > ex) latestTestDate.set(r.player_id, r.test_sessions.test_date);
    }
    const days60 = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    for (const player of activePlayers) {
      const last = latestTestDate.get(player.id);
      if (last && last < days60) {
        items.push({ id: `overdue-${player.id}`, severity: "info", category: "fitness", player,
          headline: `No fitness test recorded since ${last}`,
          detail: `That's 60+ days without a bronco result. Without recent data you're making squad and load decisions without knowing where this player's fitness actually sits — trends can shift significantly in 8 weeks.`,
          action: "Get this player into the next testing session. If a full bronco isn't possible soon, a shorter time-trial can give a useful reference point." });
      }
    }

    const order: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 };
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [players, rpeData, attendanceData, allResults, trainingSessions, team]);

  // ── Monthly attendance % ──────────────────────────────────────────────────
  const monthlyAttPct = useMemo(() => {
    const now = new Date();
    const ms  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const me  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const teamAtt = attendanceData.filter((a) => a.players?.team === team);
    const logged  = trainingSessions.filter((s) => (s.date ?? "") >= ms && (s.date ?? "") <= me && teamAtt.some((a) => a.session_id === s.id));
    if (!logged.length) return null;
    const relevant = teamAtt.filter((a) => logged.some((s) => s.id === a.session_id));
    const present  = relevant.filter((a) => a.status === "Present" || a.status === "Late").length;
    return relevant.length > 0 ? Math.round((present / relevant.length) * 100) : null;
  }, [attendanceData, trainingSessions, team]);

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
        <TeamSwitcher />
      </div>

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
                    {[dangerCount > 0 && `${dangerCount} danger`, warningCount > 0 && `${warningCount} caution`, infoCount > 0 && `${infoCount} info`].filter(Boolean).join(" · ")}
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
                {dangerCount  > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-bad   text-status-bad">{dangerCount} urgent</span>}
                {warningCount > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{warningCount} monitor</span>}
                {infoCount    > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted  text-foreground">{infoCount} info</span>}
              </div>
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="px-5 py-5 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-status-good flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-foreground">All clear</div>
                <div className="text-xs text-muted-foreground mt-0.5">No concerns flagged for {team} right now</div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(["injury_risk", "recovery", "attendance", "fitness"] as AlertCategory[]).map((cat) => {
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
                        {urgentCount  > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-status-bad   text-status-bad">{urgentCount} urgent</span>}
                        {monitorCount > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{monitorCount} monitor</span>}
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
