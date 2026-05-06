import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { fetchPlayer, fetchResultsByPlayer, updatePlayer, fetchAllResults, fetchPlayerRecentSessions } from "@/lib/queries";
import { formatBroncho, positionColor, ageRangeColor, cn } from "@/lib/utils";
import { MasBadge } from "@/components/MasBadge";
import { ChartSkeleton, TableSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import type { Player, TestResult, SessionRPE, TrainingSession, SessionType } from "@/lib/types";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowLeft, Edit, Save, X, Timer, Dumbbell, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PRIMARY_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SECONDARY_POSITIONS: Record<string, string[]> = {
  Goalkeeper: [],
  Defender:   ["Wing Back", "Center Back"],
  Midfielder: ["Right Wing", "Left Wing", "CDM", "CM"],
  Forward:    ["Striker", "CAM"],
};

export default function PlayerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [player, setPlayer] = useState<Player | null>(null);
  const [results, setResults] = useState<(TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]>([]);
  const [recentLoad, setRecentLoad] = useState<(SessionRPE & { sessions: TrainingSession })[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Player>>({});
  const [saving, setSaving] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [teamBand, setTeamBand] = useState<{ label: string; color: string } | null>(null);
  const HISTORY_PAGE_SIZE = 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, rs, allRs, loadHistory] = await Promise.all([fetchPlayer(id!), fetchResultsByPlayer(id!), fetchAllResults(), fetchPlayerRecentSessions(id!, 5)]);
      setPlayer(p);
      setResults(rs as (TestResult & { test_sessions?: { test_date: string; test_name: string; type: string | null } })[]);
      setRecentLoad(loadHistory as (SessionRPE & { sessions: TrainingSession })[]);

      // Calculate team percentile
      const teamLatest = new Map<string, number>();
      for (const r of (allRs as (TestResult & { players?: { team: string } })[]).filter(r => r.players?.team === p?.team && r.bronco_mins !== null)) {
        if (!teamLatest.has(r.player_id)) teamLatest.set(r.player_id, r.bronco_mins!);
      }
      const sorted = Array.from(teamLatest.values()).sort((a, b) => a - b);
      const playerBronco = (rs as TestResult[])[0]?.bronco_mins;
      if (playerBronco != null && sorted.length > 0) {
        const calcQ = (arr: number[], p: number) => {
          const idx = (p / 100) * (arr.length - 1);
          const lo = Math.floor(idx), hi = Math.ceil(idx);
          return arr[lo] + (idx - lo) * ((arr[hi] ?? arr[lo]) - arr[lo]);
        };
        const q1 = calcQ(sorted, 25), q2 = calcQ(sorted, 50), q3 = calcQ(sorted, 75);
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

  const startEdit = () => {
    if (!player) return;
    setEditForm({ ...player });
    setEditing(true);
  };

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

  const chartData = [...results]
    .sort((a, b) => (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""))
    .map((r) => ({
      date: r.test_sessions?.test_date ?? "",
      session: r.test_sessions?.test_name ?? "",
      mins: r.bronco_mins,
      display: formatBroncho(r.bronco_mins),
    }));

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-40" />
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="bg-card border border-border rounded-2xl p-5"><ChartSkeleton /></div>
        <div className="bg-card border border-border rounded-2xl p-5"><TableSkeleton /></div>
      </div>
    );
  }

  if (!player) {
    return <EmptyState icon={Dumbbell} title="Player not found" action={<button onClick={() => setLocation("/players")} className="text-primary text-sm">Back to Players</button>} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => setLocation("/players")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back">
          <ArrowLeft size={14} />
          Players
        </button>
      </div>

      {/* Player info card */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
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
            <div className="flex items-center gap-3 mt-1">
              <span className="font-time text-xs text-muted-foreground">{player.code}</span>
              <span className={cn("text-xs font-semibold", positionColor(player.primary_position))}>{player.primary_position}</span>
              {player.secondary_position && <span className="text-xs text-muted-foreground">/ {player.secondary_position}</span>}
              <span className={cn("text-xs font-medium", ageRangeColor(player.age_range))}>{player.age_range ?? "—"}</span>
              <span className={cn("inline-flex px-2 py-0.5 rounded text-xs", player.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground")}>
                {player.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <div className="hidden sm:flex gap-2">
                <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground" data-testid="button-cancel-edit"><X size={13} />Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60" data-testid="button-save-edit"><Save size={13} />{saving ? "Saving…" : "Save"}</button>
              </div>
            ) : (
              <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors" data-testid="button-edit-player"><Edit size={13} />Edit</button>
            )}
          </div>
        </div>

        {editing && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Primary Position</label>
              <select value={editForm.primary_position ?? ""} onChange={(e) => setEditForm({ ...editForm, primary_position: e.target.value, secondary_position: null })} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground">
                {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Secondary Position</label>
              <select value={editForm.secondary_position ?? ""} onChange={(e) => setEditForm({ ...editForm, secondary_position: e.target.value || null })} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground">
                <option value="">— None —</option>
                {(SECONDARY_POSITIONS[editForm.primary_position ?? ""] ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Year of Birth</label>
              <input type="number" value={editForm.year_of_birth ?? ""} onChange={(e) => setEditForm({ ...editForm, year_of_birth: parseInt(e.target.value) || null })} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Team</label>
              <select value={editForm.team ?? "Sharks"} onChange={(e) => setEditForm({ ...editForm, team: e.target.value as "Sharks" | "Wildcats" })} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground">
                <option value="Sharks">Sharks</option>
                <option value="Wildcats">Wildcats</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" id="edit_active" checked={editForm.is_active ?? true} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded border-border" />
              <label htmlFor="edit_active" className="text-sm text-muted-foreground">Active</label>
            </div>
            <div className="sm:hidden flex gap-2 pt-2 col-span-2">
              <button onClick={cancelEdit} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground"><X size={13} />Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60"><Save size={13} />{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        )}

        {/* Best + latest stats */}
        {results.length > 0 && (() => {
          const bestBronco = results.reduce<number | null>((best, r) => r.bronco_mins !== null && (best === null || r.bronco_mins < best) ? r.bronco_mins : best, null);
          const bestMas    = results.reduce<number | null>((best, r) => r.mas_ms !== null    && (best === null || r.mas_ms > best)    ? r.mas_ms    : best, null);
          const bestTen    = results.reduce<number | null>((best, r) => r.ten_m_1 !== null   && (best === null || r.ten_m_1 < best)   ? r.ten_m_1   : best, null);
          const bestTwenty = results.reduce<number | null>((best, r) => r.twenty_m_1 !== null && (best === null || r.twenty_m_1 < best) ? r.twenty_m_1 : best, null);
          const stats = [
            { label: "Broncho",     best: formatBroncho(bestBronco),                                       latest: formatBroncho(latestResult?.bronco_mins) },
            { label: "MAS (m/s)",   best: bestMas    !== null ? bestMas.toFixed(2)    : "—",               latest: latestResult?.mas_ms    !== null ? latestResult!.mas_ms!.toFixed(2)    + "" : "—" },
            { label: "10m Sprint",  best: bestTen    !== null ? bestTen.toFixed(2)    + "s" : "—",         latest: latestResult?.ten_m_1   !== null ? latestResult!.ten_m_1!.toFixed(2)   + "s" : "—" },
            { label: "20m Sprint",  best: bestTwenty !== null ? bestTwenty.toFixed(2) + "s" : "—",         latest: latestResult?.twenty_m_1 !== null ? latestResult!.twenty_m_1!.toFixed(2) + "s" : "—" },
          ];
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-border mt-4">
              {stats.map(({ label, best, latest }) => (
                <div key={label}>
                  <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                  <div className="text-lg font-bold font-time text-foreground">{best}</div>
                  {best !== latest && <div className="text-[11px] font-time text-muted-foreground/60 mt-0.5">Latest: {latest}</div>}
                </div>
              ))}
              <div className="sm:col-span-4 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Team band:</span>
                {teamBand
                  ? <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: teamBand.color + "20", color: teamBand.color }}>{teamBand.label}</span>
                  : <span className="text-xs text-muted-foreground">—</span>
                }
              </div>
            </div>
          );
        })()}
      </div>

      {/* Broncho over time chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Broncho Over Time</h2>
        {chartData.length === 0 ? (
          <EmptyState icon={Timer} title="No test history" description="This player hasn't been tested yet" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 40, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" />
              <XAxis dataKey="session" tick={{ fill: "#9CA3AF", fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tickFormatter={(v) => formatBroncho(v)} domain={["auto", "auto"]} tick={{ fill: "#9CA3AF", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 6 }}
                labelStyle={{ color: "#fff", fontSize: 12 }}
                formatter={(v: number) => [formatBroncho(v), "Broncho"]}
              />
              <Line type="monotone" dataKey="mins" stroke="#4F46E5" strokeWidth={2} dot={{ fill: "#4F46E5", r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent training load */}
      {(() => {
        const SESSION_TYPE_CFG: Record<SessionType, { text: string; bg: string }> = {
          Training: { text: "text-indigo-400", bg: "bg-indigo-500/15" },
          Match:    { text: "text-amber-400",  bg: "bg-amber-500/15"  },
          Gym:      { text: "text-emerald-400",bg: "bg-emerald-500/15"},
          Recovery: { text: "text-slate-400",  bg: "bg-slate-500/15"  },
        };
        return (
          <div className="bg-card border border-border rounded-lg">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Recent Load</h2>
              <span className="text-xs text-muted-foreground">Last 5 sessions</span>
            </div>
            {recentLoad.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No sessions logged yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium">Date</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-right font-medium">RPE</th>
                      <th className="px-4 py-2.5 text-right font-medium">Load (AU)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLoad.map((r) => {
                      const st = r.sessions?.session_type as SessionType;
                      const cfg = SESSION_TYPE_CFG[st] ?? SESSION_TYPE_CFG.Training;
                      const dateStr = r.sessions?.date
                        ? new Date(r.sessions.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "—";
                      return (
                        <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-4 py-2.5 text-muted-foreground font-time text-xs">{dateStr}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.bg, cfg.text)}>{st}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-time text-foreground">{r.rpe.toFixed(1)}</td>
                          <td className="px-4 py-2.5 text-right font-bold font-time text-amber-400">{Math.round(r.load_au)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Full test history with pagination */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Test History</h2>
          <span className="text-xs text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""}</span>
        </div>
        {results.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No test results" description="No fitness tests recorded for this player" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="test-history-table">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Session</th>
                    <th className="px-4 py-2.5 text-right font-medium">Broncho</th>
                    <th className="px-4 py-2.5 text-right font-medium">MAS</th>
                    <th className="px-4 py-2.5 text-right font-medium">10m</th>
                    <th className="px-4 py-2.5 text-right font-medium">20m</th>
                    <th className="px-4 py-2.5 text-right font-medium">40m</th>
                    <th className="px-4 py-2.5 text-right font-medium">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE).map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`row-result-${r.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground font-time text-xs">{r.test_sessions?.test_date ?? "—"}</td>
                      <td className="px-4 py-2.5 text-foreground">
                        <div className="flex items-center gap-1.5">
                          {r.test_sessions?.test_name ?? "—"}
                          {r.test_sessions?.type && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              {r.test_sessions.type}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-time text-foreground">{formatBroncho(r.bronco_mins)}</td>
                      <td className="px-4 py-2.5 text-right font-time text-foreground">{r.mas_ms !== null ? r.mas_ms.toFixed(2) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-time text-muted-foreground">{r.ten_m_1 !== null ? r.ten_m_1.toFixed(2) + "s" : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-time text-muted-foreground">{r.twenty_m_1 !== null ? r.twenty_m_1.toFixed(2) + "s" : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-time text-muted-foreground">{r.forty_m_1 !== null ? r.forty_m_1.toFixed(2) + "s" : "—"}</td>
                      <td className="px-4 py-2.5 text-right"><MasBadge mas={r.mas_ms} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > HISTORY_PAGE_SIZE && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Page {historyPage + 1} of {Math.ceil(results.length / HISTORY_PAGE_SIZE)}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                    disabled={historyPage === 0}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    data-testid="history-prev"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => Math.min(Math.ceil(results.length / HISTORY_PAGE_SIZE) - 1, p + 1))}
                    disabled={historyPage >= Math.ceil(results.length / HISTORY_PAGE_SIZE) - 1}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    data-testid="history-next"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
