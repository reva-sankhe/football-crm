import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  fetchPlayer, fetchResultsByPlayer, updatePlayer, fetchAllResults, fetchPlayerRecentSessions,
  fetchAttendanceByPlayer, fetchTrainingSessions, fetchMatchStatsByPlayer, type PlayerMatchStat,
} from "@/lib/queries";
import { JERSEY_MAX, JERSEY_MIN, formatBronco, cn, isValidJersey, playerLabel } from "@/lib/utils";
import { attendancePctColor, collapseMatchDays, countsAsAttended, matchDayAttendance } from "@/lib/attendance";
import { ACWR_CONFIG, computeAcwr, isMatchSession, teamBandFor } from "@/lib/report";
import { ChartSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { PlayerTournamentStats } from "@/components/tournaments/PlayerTournamentStats";
import { sumStats } from "@/lib/tournaments";
import { SectionLabel, StatTile as SnapshotTile } from "@/components/StatTile";
import { AttendanceCard } from "@/components/player/AttendanceCard";
import { LastSessionsCard } from "@/components/player/LastSessionsCard";
import type { Player, TestResult, SessionRPE, TrainingSession, SessionAttendance } from "@/lib/types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ArrowLeft, Edit, Save, X, Timer, Dumbbell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/context/ThemeContext";
import { HIGHLIGHT, ink, type Mode } from "@/lib/viz";

const PRIMARY_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SECONDARY_POSITIONS: Record<string, string[]> = {
  Goalkeeper: [],
  Defender:   ["Wing Back", "Center Back"],
  Midfielder: ["Right Wing", "Left Wing", "CDM", "CM"],
  Forward:    ["Striker", "CAM"],
};

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

      // "Latest" means the most recent *test date*. Rows imported in one batch
      // share a created_at, so insertion order can't be trusted to rank them.
      const byTestDateDesc = <T extends { test_sessions?: { test_date: string } | null }>(rows: T[]) =>
        [...rows].sort((a, b) => (b.test_sessions?.test_date ?? "").localeCompare(a.test_sessions?.test_date ?? ""));

      const teamLatest = new Map<string, number>();
      const teamRows = (allRs as (TestResult & { players?: { team: string }; test_sessions?: { test_date: string } | null })[])
        .filter(r => r.players?.team === p?.team && r.bronco_mins !== null);
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
  const latestResult = chronoResults[chronoResults.length - 1];

  const broncoChartData = chronoResults
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
      // What the session was planned for, so over/under-shooting is visible.
      // Matches carry no plan (load 0) — null skips them rather than drawing a
      // floor-scraping zero on the Set line.
      planned: r.sessions?.planned_load_au ? Math.round(r.sessions.planned_load_au) : null,
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
          ) : (
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0" data-testid="button-edit-player"><Edit size={13} />Edit</button>
          )}
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
                  <Line type="monotone" dataKey="mins" stroke={HIGHLIGHT} strokeWidth={2} dot={{ fill: HIGHLIGHT, r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>

              {/* Best / latest test numbers live with the chart they describe */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 mt-2 border-t border-border">
                {[
                  { label: "Bronco",    best: formatBronco(bestBronco), latest: formatBronco(latestResult?.bronco_mins) },
                  { label: "MAS (m/s)",  best: fmtBest(results, ["mas_ms"], true),     latest: fmtVal(latestResult?.mas_ms) },
                  { label: "10m Sprint", best: fmtBest(results, ["ten_m_1", "ten_m_2"], false, "s"),       latest: fmtTrials(latestResult, ["ten_m_1", "ten_m_2"], "s") },
                  { label: "20m Sprint", best: fmtBest(results, ["twenty_m_1", "twenty_m_2"], false, "s"), latest: fmtTrials(latestResult, ["twenty_m_1", "twenty_m_2"], "s") },
                ].map(({ label, best, latest }) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
                    <div className="text-lg font-bold font-time text-foreground">{best}</div>
                    {best !== latest && <div className="text-[11px] font-time text-muted-foreground mt-0.5">Latest: {latest}</div>}
                  </div>
                ))}
              </div>

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
                <div className="w-[60%] bg-status-good" title="0.5–1.3 Safe" />
                <div className="w-[15%] bg-status-warn" title="1.3–1.5 Caution" />
                <div className="w-[15%] bg-status-bad" title="> 1.5 High risk" />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0.5</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0+</span>
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
                    <span>{recentLoad.length} sessions</span>
                  </div>
                </div>
                <div className="flex-1 min-h-0" style={{ minHeight: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {/* Level date labels need no angled gutter, so the plot keeps
                        the ~26px the rotated ticks used to reserve. */}
                    <LineChart data={loadWithAvg} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: chartAxis, fontSize: 9 }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tick={{ fill: chartAxis, fontSize: 9 }} width={32} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                        labelStyle={{ color: chartLabel, fontSize: 12 }}
                        formatter={(v: number, key: string) => [
                          `${v} AU`,
                          key === "rollingAvg" ? "Rolling avg (4)" : key === "planned" ? "Set load" : "Actual load",
                        ]}
                      />
                      <Line type="monotone" dataKey="planned" stroke={PLANNED_INK} strokeWidth={1.5} dot={false} connectNulls />
                      <Line type="monotone" dataKey="load" stroke={HIGHLIGHT} strokeWidth={2} dot={{ fill: HIGHLIGHT, r: 2.5 }} />
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
