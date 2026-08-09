import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Zap, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PosBadge } from "@/components/PosBadge";
import { SessionTypeBadge } from "@/components/Badges";
import { useTheme } from "@/context/ThemeContext";
import { HIGHLIGHT, ink, ordinal, posColor, type Mode } from "@/lib/viz";
import { fetchTrainingSession, fetchSessionRPEWithPlayers } from "@/lib/queries";
import type { TrainingSession, SessionRPE, Player, SessionType } from "@/lib/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
} from "recharts";

// RPE 1→10 is an ordinal intensity scale — one hue, light to dark.
function rpeColor(mode: Mode, rpe: number): string {
  return ordinal(mode, 10, Math.max(1, Math.min(10, Math.floor(rpe))) - 1);
}


function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type RpeRow = SessionRPE & { players: Player };

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [rpeRows, setRpeRows] = useState<RpeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sess, rows] = await Promise.all([
        fetchTrainingSession(id!),
        fetchSessionRPEWithPlayers(id!),
      ]);
      setSession(sess);
      setRpeRows(rows as RpeRow[]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-32 animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-20 animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-64 animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Session not found</p>
        <button onClick={() => setLocation("/sessions")} className="mt-2 text-sm text-indigo-400">Back to Sessions</button>
      </div>
    );
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const count = rpeRows.length;
  const avgRpe = count > 0 ? rpeRows.reduce((s, r) => s + r.rpe, 0) / count : null;
  const avgLoad = count > 0 ? Math.round(rpeRows.reduce((s, r) => s + r.load_au, 0) / count) : null;
  const sorted = [...rpeRows].sort((a, b) => b.load_au - a.load_au);
  const highest = sorted[0] ?? null;
  const lowest = sorted[sorted.length - 1] ?? null;

  const planLoad = Math.round(session.planned_load_au);

  // Chart B data — sorted ascending by load, RPE-colored
  const chartData = [...rpeRows]
    .sort((a, b) => a.load_au - b.load_au)
    .map((r) => ({
      name: r.players?.name?.split(" ")[0] ?? "—",
      load: Math.round(r.load_au),
      rpe: r.rpe,
      color: rpeColor(mode, r.rpe),
    }));

  // Chart A — RPE distribution histogram
  const histogramData = Array.from({ length: 10 }, (_, i) => {
    const rpeVal = i + 1;
    return {
      rpe: rpeVal,
      count: rpeRows.filter((r) => Math.round(r.rpe) === rpeVal).length,
      color: ordinal(mode, 10, rpeVal - 1),
    };
  });

  // Chart C — avg load by position
  const positionLoadData = ["Forward", "Midfielder", "Defender", "Goalkeeper"]
    .map((pos) => {
      const inPos = rpeRows.filter((r) => r.players?.primary_position === pos);
      if (inPos.length === 0) return null;
      const avgL = Math.round(inPos.reduce((s, r) => s + r.load_au, 0) / inPos.length);
      const avgR = inPos.reduce((s, r) => s + r.rpe, 0) / inPos.length;
      return { pos, avgLoad: avgL, avgRpe: parseFloat(avgR.toFixed(1)), color: posColor(mode, pos), count: inPos.length };
    })
    .filter(Boolean) as { pos: string; avgLoad: number; avgRpe: number; color: string; count: number }[];

  // Effort vs plan insight blurb
  const teamAvgLoad = avgLoad ?? 0;
  const pctVsPlan = planLoad > 0 ? Math.round(((teamAvgLoad - planLoad) / planLoad) * 100) : 0;
  const highestPosGroup = positionLoadData.length > 0
    ? positionLoadData.reduce((a, b) => (b.avgLoad > a.avgLoad ? b : a))
    : null;
  const effortBlurb = count > 0 && planLoad > 0
    ? `Team averaged ${Math.abs(pctVsPlan)}% ${pctVsPlan >= 0 ? "above" : "below"} plan` +
      (highestPosGroup ? `, with ${highestPosGroup.pos}s carrying the highest load (avg ${highestPosGroup.avgLoad} AU).` : ".")
    : null;

  return (
    <div className="space-y-5">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setLocation("/sessions")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Sessions
        </button>
        <button
          onClick={() => setLocation(`/sessions/${id}/rpe`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm btn-primary text-white rounded-xl font-semibold"
        >
          <Zap size={13} />
          Log RPE
        </button>
      </div>

      {/* Session info card */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{session.day}</h1>
            <div className="text-sm text-muted-foreground">{formatDate(session.date)}</div>
          </div>
          <SessionTypeBadge type={session.session_type} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Duration</div>
            <div className="text-lg font-bold font-time text-foreground">{session.duration_mins}<span className="text-xs font-normal text-muted-foreground ml-1">min</span></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Planned RPE</div>
            <div className="text-lg font-bold font-time text-foreground">{session.planned_rpe.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Planned Load</div>
            <div className="text-lg font-bold font-time text-status-warn">{planLoad} <span className="text-xs font-normal text-muted-foreground">AU</span></div>
          </div>
        </div>
        <div className="flex items-center justify-between bg-status-warn border border-status-warn rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-status-warn" />
            <span className="text-xs text-muted-foreground font-medium">Planned Load (AU)</span>
          </div>
          <span className="text-2xl font-bold text-status-warn font-time">{planLoad}</span>
        </div>
        {session.notes && (
          <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">{session.notes}</p>
        )}
      </div>

      {/* Summary stats row */}
      {count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 border border-border rounded-2xl overflow-hidden divide-x divide-y sm:divide-y-0 divide-border bg-card">
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground mb-0.5">Avg RPE</div>
            <div className="text-xl font-bold font-time text-foreground">{avgRpe?.toFixed(1) ?? "—"}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground mb-0.5">Avg Load (AU)</div>
            <div className="text-xl font-bold font-time text-status-good">{avgLoad ?? "—"}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground mb-0.5">Highest Load</div>
            <div className="text-base font-bold font-time text-foreground">{highest ? Math.round(highest.load_au) : "—"}</div>
            {highest && <div className="text-[11px] text-muted-foreground truncate">{highest.players?.name}</div>}
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground mb-0.5">Lowest Load</div>
            <div className="text-base font-bold font-time text-foreground">{lowest ? Math.round(lowest.load_au) : "—"}</div>
            {lowest && <div className="text-[11px] text-muted-foreground truncate">{lowest.players?.name}</div>}
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground mb-0.5">Logged</div>
            <div className="text-xl font-bold font-time text-foreground">{count}</div>
          </div>
        </div>
      )}

      {/* Chart A — RPE Distribution */}
      {count > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">RPE Distribution</h2>
          <p className="text-xs text-muted-foreground mb-4">
            How many players reported each RPE score this session.
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={histogramData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
              <XAxis dataKey="rpe" tick={{ fill: INK.axis, fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: INK.axis, fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: INK.primary, fontSize: 12 }}
                formatter={(v: number, _: string, entry: { payload?: { rpe?: number } }) => [
                  `${v} player${v !== 1 ? "s" : ""}`,
                  `RPE ${entry.payload?.rpe}`,
                ]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {histogramData.map((entry, i) => (
                  <Cell key={`hist-${i}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-between mt-2 text-[11px]">
            <span style={{ color: ordinal(mode, 10, 0) }}>1 — Easy</span>
            <span style={{ color: ordinal(mode, 10, 4) }}>5 — Moderate</span>
            <span style={{ color: ordinal(mode, 10, 9) }}>10 — Max</span>
          </div>
        </div>
      )}

      {/* Effort vs plan blurb */}
      {effortBlurb && (
        <div className="flex items-start gap-2 px-4 py-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-300">
          <Zap size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
          <span>{effortBlurb}</span>
        </div>
      )}

      {/* Chart C — Load by Position */}
      {positionLoadData.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Avg Load by Position</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Average load (AU) per position group. Dashed line = planned ({planLoad} AU).
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={positionLoadData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
              <XAxis dataKey="pos" tick={{ fill: INK.axis, fontSize: 11 }} />
              <YAxis tick={{ fill: INK.axis, fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: INK.primary, fontSize: 12 }}
                formatter={(v: number, _: string, entry: { payload?: { avgRpe?: number; count?: number } }) => [
                  `${v} AU · avg RPE ${entry.payload?.avgRpe?.toFixed(1) ?? "?"} · ${entry.payload?.count} player${entry.payload?.count !== 1 ? "s" : ""}`,
                  "Avg Load",
                ]}
              />
              <ReferenceLine
                y={planLoad}
                stroke={HIGHLIGHT}
                strokeDasharray="5 3"
                label={{ value: "Plan", position: "insideTopRight", fill: HIGHLIGHT, fontSize: 10 }}
              />
              <Bar dataKey="avgLoad" radius={[4, 4, 0, 0]} maxBarSize={52}>
                <LabelList
                  dataKey="avgLoad"
                  position="top"
                  style={{ fill: INK.axis, fontSize: 10 }}
                />
                {positionLoadData.map((entry, i) => (
                  <Cell key={`pos-${i}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Player RPE table */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Player RPE</h2>
          <span className="text-xs text-muted-foreground">{count} player{count !== 1 ? "s" : ""}</span>
        </div>
        {count === 0 ? (
          <div className="py-12 text-center">
            <ClipboardList size={28} className="mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No RPE entries yet</p>
            <button
              onClick={() => setLocation(`/sessions/${id}/rpe`)}
              className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
            >
              Start logging RPE →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Player</th>
                  <th className="px-4 py-2.5 text-left font-medium">Pos</th>
                  <th className="px-4 py-2.5 text-right font-medium">RPE</th>
                  <th className="px-4 py-2.5 text-right font-medium">Load (AU)</th>
                  <th className="px-4 py-2.5 text-right font-medium">vs Planned</th>
                  <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...rpeRows].sort((a, b) => b.load_au - a.load_au).map((r) => {
                  const variance = Math.round(r.load_au) - planLoad;
                  return (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium text-foreground">{r.players?.name ?? "—"}</td>
                      <td className="px-4 py-2.5"><PosBadge pos={r.players?.primary_position ?? null} /></td>
                      <td className="px-4 py-2.5 text-right font-time text-foreground">{r.rpe.toFixed(1)}</td>
                      <td className="px-4 py-2.5 text-right font-bold font-time text-foreground">{Math.round(r.load_au)}</td>
                      <td className="px-4 py-2.5 text-right font-time">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-[11px] font-medium",
                          variance > 0
                            ? "bg-status-bad text-status-bad"
                            : variance < 0
                              ? "bg-status-good text-status-good"
                              : "bg-muted text-muted-foreground"
                        )}>
                          {variance > 0 ? `+${variance}` : variance === 0 ? "—" : variance}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[140px] truncate">{r.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Chart B — Planned vs Actual Load, RPE-colored */}
      {count > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Planned vs Actual Load (AU)</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Each bar colored by player RPE. Dashed line = planned ({planLoad} AU).
          </p>
          <ResponsiveContainer width="100%" height={Math.max(220, count * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, "dataMax + 50"]}
                tick={{ fill: INK.axis, fontSize: 10 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: INK.axis, fontSize: 11 }}
                width={56}
              />
              <Tooltip
                contentStyle={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: INK.primary, fontSize: 12 }}
                formatter={(v: number, _: string, entry: { payload?: { rpe?: number } }) => [
                  `${v} AU — RPE ${entry.payload?.rpe?.toFixed(1) ?? "?"}`,
                  "Load",
                ]}
              />
              <ReferenceLine
                x={planLoad}
                stroke={HIGHLIGHT}
                strokeDasharray="5 3"
                label={{ value: "Plan", position: "right", fill: HIGHLIGHT, fontSize: 10 }}
              />
              <Bar dataKey="load" radius={[0, 4, 4, 0]} maxBarSize={20}>
                <LabelList
                  dataKey="rpe"
                  position="insideRight"
                  style={{ fill: "#fff", fontSize: 9, fontWeight: 700 }}
                  formatter={(v: number) => (v >= 1 ? v.toFixed(1) : "")}
                />
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* RPE gradient legend */}
          <div className="flex h-2 rounded-full overflow-hidden mt-3 gap-px">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <div key={n} className="flex-1 h-full" style={{ background: ordinal(mode, 10, n - 1) }} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>RPE 1 (Easy)</span>
            <span>RPE 10 (Max)</span>
          </div>
        </div>
      )}
    </div>
  );
}
