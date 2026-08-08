import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  fetchPlayer, fetchResultsByPlayer, updatePlayer, fetchAllResults, fetchPlayerRecentSessions,
  fetchAttendanceByPlayer, fetchTrainingSessions, fetchMatchStatsByPlayer, type PlayerMatchStat,
} from "@/lib/queries";
import { formatBronco, cn } from "@/lib/utils";
import { attendancePctColor, countsAsAttended } from "@/lib/attendance";
import { ACWR_CONFIG, computeAcwr } from "@/lib/report";
import { ChartSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { PlayerTournamentStats } from "@/components/tournaments/PlayerTournamentStats";
import { sumStats } from "@/lib/tournaments";
import { AttendanceCard } from "@/components/player/AttendanceCard";
import { LastSessionsCard } from "@/components/player/LastSessionsCard";
import type { Player, TestResult, SessionRPE, TrainingSession, SessionAttendance } from "@/lib/types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ArrowLeft, Edit, Save, X, Timer, Dumbbell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/context/ThemeContext";

const PRIMARY_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SECONDARY_POSITIONS: Record<string, string[]> = {
  Goalkeeper: [],
  Defender:   ["Wing Back", "Center Back"],
  Midfielder: ["Right Wing", "Left Wing", "CDM", "CM"],
  Forward:    ["Striker", "CAM"],
};

/** Small uppercase anchor above each section. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

function SnapshotTile({ label, value, sub, valueColor }: { label: string; value: string | number; sub?: string; valueColor?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-2xl font-bold font-time leading-none", valueColor ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [player, setPlayer] = useState<Player | null>(null);
  const [results, setResults] = useState<(TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]>([]);
  const [recentLoad, setRecentLoad] = useState<(SessionRPE & { sessions: TrainingSession })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Player>>({});
  const [saving, setSaving] = useState(false);
  const [teamBand, setTeamBand] = useState<{ label: string; color: string } | null>(null);
  const [allSessions, setAllSessions] = useState<TrainingSession[]>([]);
  const [playerAttendance, setPlayerAttendance] = useState<(SessionAttendance & { sessions: { id: string; date: string; session_type: string } })[]>([]);
  const [matchStats, setMatchStats] = useState<PlayerMatchStat[]>([]);

  // Theme-aware chart colours, matching the pattern in Analytics.tsx
  const chartGrid = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
  const chartAxis = isDark ? "#6b7280" : "#9ca3af";
  const chartTooltipBg = isDark ? "#0f172a" : "#ffffff";
  const chartTooltipBorder = isDark ? "#1e293b" : "#e2e8f0";
  const chartLabel = isDark ? "#f1f5f9" : "#0f172a";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, rs, allRs, loadHistory, attendance, sessions, mStats] = await Promise.all([
        fetchPlayer(id!),
        fetchResultsByPlayer(id!),
        fetchAllResults(),
        fetchPlayerRecentSessions(id!, 28),
        fetchAttendanceByPlayer(id!),
        fetchTrainingSessions(),
        fetchMatchStatsByPlayer(id!),
      ]);
      setPlayer(p);
      setResults(rs as (TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]);
      setRecentLoad(loadHistory as (SessionRPE & { sessions: TrainingSession })[]);
      setPlayerAttendance(attendance);
      setAllSessions(sessions);
      setMatchStats(mStats);

      const teamLatest = new Map<string, number>();
      for (const r of (allRs as (TestResult & { players?: { team: string } })[]).filter(r => r.players?.team === p?.team && r.bronco_mins !== null)) {
        if (!teamLatest.has(r.player_id)) teamLatest.set(r.player_id, r.bronco_mins!);
      }
      const sortedBronco = Array.from(teamLatest.values()).sort((a, b) => a - b);
      const playerBronco = (rs as TestResult[])[0]?.bronco_mins;
      if (playerBronco != null && sortedBronco.length > 0) {
        const calcQ = (arr: number[], p: number) => {
          const idx = (p / 100) * (arr.length - 1);
          const lo = Math.floor(idx), hi = Math.ceil(idx);
          return arr[lo] + (idx - lo) * ((arr[hi] ?? arr[lo]) - arr[lo]);
        };
        const q1 = calcQ(sortedBronco, 25), q2 = calcQ(sortedBronco, 50), q3 = calcQ(sortedBronco, 75);
        if (playerBronco <= q1)      setTeamBand({ label: "Top 25%",    color: "#34d399" });
        else if (playerBronco <= q2) setTeamBand({ label: "Upper Mid",  color: "#60a5fa" });
        else if (playerBronco <= q3) setTeamBand({ label: "Lower Mid",  color: "#fbbf24" });
        else                         setTeamBand({ label: "Bottom 25%", color: "#f87171" });
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => { if (!player) return; setEditForm({ ...player }); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = async () => {
    if (!player) return;
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

  const latestResult = results[0];

  const broncoChartData = [...results]
    .sort((a, b) => (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""))
    .map((r) => ({
      date: r.test_sessions?.test_date ?? "",
      session: r.test_sessions?.test_name ?? "",
      mins: r.bronco_mins,
      display: formatBronco(r.bronco_mins),
    }));

  // ── Training load ─────────────────────────────────────────────────────────
  const loadChartData = [...recentLoad]
    .sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""))
    .map((r) => ({
      date: r.sessions?.date
        ? new Date(r.sessions.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "—",
      load: Math.round(r.load_au),
      rpe: r.rpe,
    }));

  const loadWithAvg = loadChartData.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 3), i + 1);
    return { ...d, rollingAvg: Math.round(window.reduce((s, x) => s + x.load, 0) / window.length) };
  });

  // ACWR — shared with the printable report so the two can't disagree
  const { acwr, acute: acuteLoad, chronicWeeklyAvg, status: acwrStatus } = computeAcwr(recentLoad);
  const acwrCfg = ACWR_CONFIG[acwrStatus];

  // ── Attendance ────────────────────────────────────────────────────────────
  const attendedIds = useMemo(
    () => new Set(playerAttendance.filter((a) => countsAsAttended(a.status)).map((a) => a.session_id)),
    [playerAttendance],
  );

  const monthlyAttendance = useMemo(() => {
    if (!allSessions.length) return [];
    const byMonth: Record<string, string[]> = {};
    for (const s of allSessions) {
      (byMonth[s.date.slice(0, 7)] ??= []).push(s.id);
    }
    return Object.entries(byMonth)
      .map(([month, ids]) => {
        const attended = ids.filter((sid) => attendedIds.has(sid)).length;
        return { month, total: ids.length, attended, pct: Math.round((attended / ids.length) * 100) };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [allSessions, attendedIds]);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const overallAttendancePct = allSessions.length > 0
    ? Math.round((allSessions.filter((s) => attendedIds.has(s.id)).length / allSessions.length) * 100)
    : null;

  const matchTotals = useMemo(() => sumStats(matchStats), [matchStats]);

  const bestBronco = results.reduce<number | null>(
    (best, r) => (r.bronco_mins !== null && (best === null || r.bronco_mins < best) ? r.bronco_mins : best),
    null,
  );

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
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{player.name}</h1>
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
          ) : (
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="button-edit-player"><Edit size={13} />Edit</button>
          )}
        </div>

        {editing && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 mt-4 border-t border-border">
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
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Team</label>
              <select value={editForm.team ?? "Sharks"} onChange={(e) => setEditForm({ ...editForm, team: e.target.value as "Sharks" | "Wildcats" })} className="w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-foreground">
                <option value="Sharks">Sharks</option>
                <option value="Wildcats">Wildcats</option>
              </select>
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
            label="Attendance"
            value={overallAttendancePct !== null ? `${overallAttendancePct}%` : "—"}
            sub={allSessions.length > 0 ? `${allSessions.filter((s) => attendedIds.has(s.id)).length}/${allSessions.length} sessions` : undefined}
            valueColor={overallAttendancePct !== null ? attendancePctColor(overallAttendancePct) : undefined}
          />
          <SnapshotTile label="Goals" value={matchTotals.goals} sub={matchTotals.assists > 0 ? `${matchTotals.assists} assists` : undefined} />
          <SnapshotTile label="Appearances" value={matchTotals.appearances} sub={matchStats.length > 0 ? `${matchStats.length} call-ups` : undefined} />
          <SnapshotTile label="Best Bronco" value={formatBronco(bestBronco)} sub={latestResult?.bronco_mins != null ? `Latest ${formatBronco(latestResult.bronco_mins)}` : undefined} />
        </div>
      </div>

      {/* ── Availability ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Availability</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <AttendanceCard monthly={monthlyAttendance} />
          <LastSessionsCard sessions={allSessions} attendance={playerAttendance} />
        </div>
      </section>

      {/* ── Match record ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Match Record</SectionLabel>
        <PlayerTournamentStats stats={matchStats} />
      </section>

      {/* ── Fitness ────────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <SectionLabel>Fitness</SectionLabel>
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Bronco Over Time</h3>
          {broncoChartData.length === 0 ? (
            <EmptyState icon={Timer} title="No test history" description="This player hasn't been tested yet" />
          ) : (
            <>
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
                  <Line type="monotone" dataKey="mins" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1", r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>

              {/* Best / latest test numbers live with the chart they describe */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 mt-2 border-t border-border">
                {[
                  { label: "Bronco",    best: formatBronco(bestBronco), latest: formatBronco(latestResult?.bronco_mins) },
                  { label: "MAS (m/s)",  best: fmtBest(results, "mas_ms", true),     latest: fmtVal(latestResult?.mas_ms) },
                  { label: "10m Sprint", best: fmtBest(results, "ten_m_1", false, "s"),    latest: fmtVal(latestResult?.ten_m_1, "s") },
                  { label: "20m Sprint", best: fmtBest(results, "twenty_m_1", false, "s"), latest: fmtVal(latestResult?.twenty_m_1, "s") },
                ].map(({ label, best, latest }) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
                    <div className="text-lg font-bold font-time text-foreground">{best}</div>
                    {best !== latest && <div className="text-[11px] font-time text-muted-foreground mt-0.5">Latest: {latest}</div>}
                  </div>
                ))}
              </div>

              {teamBand && (
                <div className="flex items-center gap-2 mt-4">
                  <span className="text-xs text-muted-foreground">Team band:</span>
                  <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: teamBand.color + "20", color: teamBand.color }}>
                    {teamBand.label}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Training load ──────────────────────────────────────────────────── */}
      {recentLoad.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Training Load</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* ACWR */}
            <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">ACWR</div>
                  <div className="text-3xl font-bold font-time leading-none" style={{ color: acwrCfg.color }}>
                    {acwr !== null ? acwr.toFixed(2) : "—"}
                  </div>
                  <div className="text-xs font-medium mt-1" style={{ color: acwrCfg.color }}>{acwrCfg.label}</div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground space-y-1">
                  <div>Acute (7d) <span className="text-foreground font-time font-bold">{Math.round(acuteLoad)}</span></div>
                  <div>Chronic /wk <span className="text-foreground font-time font-bold">{Math.round(chronicWeeklyAvg)}</span></div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{acwrCfg.desc}</p>
              <div className="flex h-1.5 rounded-full overflow-hidden gap-px mt-auto">
                <div className="w-[10%] bg-slate-400/40" title="< 0.5 Underloaded" />
                <div className="w-[60%] bg-emerald-400/50" title="0.5–1.3 Safe" />
                <div className="w-[15%] bg-amber-400/50" title="1.3–1.5 Caution" />
                <div className="w-[15%] bg-red-400/50" title="> 1.5 High risk" />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0.5</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0+</span>
              </div>
            </div>

            {/* Load trend */}
            {loadChartData.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">Load Trend</h3>
                  <span className="text-[11px] text-muted-foreground">{recentLoad.length} sessions</span>
                </div>
                <div className="flex-1 min-h-0" style={{ minHeight: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={loadWithAvg} margin={{ top: 4, right: 8, bottom: 30, left: -8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: chartAxis, fontSize: 9 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
                      <YAxis tick={{ fill: chartAxis, fontSize: 9 }} width={32} />
                      <Tooltip
                        contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: chartLabel, fontSize: 12 }}
                        formatter={(v: number, key: string) => [`${v} AU`, key === "rollingAvg" ? "Rolling avg (4)" : "Load"]}
                      />
                      <Line type="monotone" dataKey="load" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1", r: 2.5 }} />
                      <Line type="monotone" dataKey="rollingAvg" stroke={chartAxis} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Test-value formatting helpers ─────────────────────────────────────────────
type ResultRow = TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } };

function fmtVal(v: number | null | undefined, suffix = ""): string {
  return v != null ? v.toFixed(2) + suffix : "—";
}

/** Best value for a numeric test field — higher is better only for MAS. */
function fmtBest(rows: ResultRow[], field: keyof TestResult, higherIsBetter: boolean, suffix = ""): string {
  const best = rows.reduce<number | null>((acc, r) => {
    const v = r[field] as number | null;
    if (v === null || v === undefined) return acc;
    if (acc === null) return v;
    return higherIsBetter ? Math.max(acc, v) : Math.min(acc, v);
  }, null);
  return best !== null ? best.toFixed(2) + suffix : "—";
}
