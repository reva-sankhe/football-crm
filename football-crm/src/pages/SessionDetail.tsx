import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Zap, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTrainingSession, fetchSessionRPEWithPlayers } from "@/lib/queries";
import type { TrainingSession, SessionRPE, Player, SessionType } from "@/lib/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

// ── Position config ────────────────────────────────────────────────────────────
const POS_CFG: Record<string, { label: string; tailwindText: string; tailwindBg: string }> = {
  Forward:    { label: "FW", tailwindText: "text-red-400",    tailwindBg: "bg-red-400/15"    },
  Midfielder: { label: "MF", tailwindText: "text-blue-400",   tailwindBg: "bg-blue-400/15"   },
  Defender:   { label: "DF", tailwindText: "text-indigo-400", tailwindBg: "bg-indigo-400/15" },
  Goalkeeper: { label: "GK", tailwindText: "text-amber-400",  tailwindBg: "bg-amber-400/15"  },
};
function PosBadge({ pos }: { pos: string | null }) {
  const cfg = POS_CFG[pos ?? ""] ?? { label: pos ?? "?", tailwindText: "text-slate-400", tailwindBg: "bg-slate-400/15" };
  return (
    <span className={cn("inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold", cfg.tailwindText, cfg.tailwindBg)}>
      {cfg.label}
    </span>
  );
}

// ── Session type config ────────────────────────────────────────────────────────
const SESSION_TYPE_CFG: Record<SessionType, { text: string; bg: string }> = {
  Training: { text: "text-indigo-400", bg: "bg-indigo-500/15" },
  Match:    { text: "text-amber-400",  bg: "bg-amber-500/15"  },
  Gym:      { text: "text-emerald-400",bg: "bg-emerald-500/15"},
  Recovery: { text: "text-slate-400",  bg: "bg-slate-500/15"  },
};
function SessionTypeBadge({ type }: { type: SessionType }) {
  const cfg = SESSION_TYPE_CFG[type] ?? SESSION_TYPE_CFG.Training;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.bg, cfg.text)}>
      {type}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type RpeRow = SessionRPE & { players: Player };

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

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

  // Chart data — sorted ascending by load
  const chartData = [...rpeRows]
    .sort((a, b) => a.load_au - b.load_au)
    .map((r) => ({
      name: r.players?.name?.split(" ")[0] ?? "—",
      load: Math.round(r.load_au),
      rpe: r.rpe,
    }));

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
            <div className="text-lg font-bold font-time text-amber-400">{Math.round(session.planned_load_au)} <span className="text-xs font-normal text-amber-400/60">AU</span></div>
          </div>
        </div>
        {/* Prominent planned load banner */}
        <div className="flex items-center justify-between bg-amber-400/10 border border-amber-400/20 rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <span className="text-xs text-amber-400/80 font-medium">Planned Load (AU)</span>
          </div>
          <span className="text-2xl font-bold text-amber-400 font-time">{Math.round(session.planned_load_au)}</span>
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
            <div className="text-xl font-bold font-time text-emerald-400">{avgLoad ?? "—"}</div>
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
                  const variance = Math.round(r.load_au) - Math.round(session.planned_load_au);
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
                            ? "bg-red-400/15 text-red-400"
                            : variance < 0
                              ? "bg-emerald-400/15 text-emerald-400"
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

      {/* Planned vs Actual chart */}
      {count > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Planned vs Actual Load (AU)</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Each bar is a player's actual load. Dashed line = planned load ({Math.round(session.planned_load_au)} AU).
          </p>
          <ResponsiveContainer width="100%" height={Math.max(220, count * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, "dataMax + 50"]}
                tick={{ fill: "#9CA3AF", fontSize: 10 }}
                tickFormatter={(v) => String(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                width={56}
              />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 6 }}
                labelStyle={{ color: "#fff", fontSize: 12 }}
                formatter={(v: number, _: string, entry: { payload?: { rpe?: number } }) => [
                  `${v} AU (RPE ${entry.payload?.rpe?.toFixed(1) ?? "?"})`,
                  "Load"
                ]}
              />
              <ReferenceLine
                x={Math.round(session.planned_load_au)}
                stroke="#fbbf24"
                strokeDasharray="5 3"
                label={{ value: "Planned", position: "right", fill: "#fbbf24", fontSize: 10 }}
              />
              <Bar dataKey="load" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.load > Math.round(session.planned_load_au) ? "#f87171" : "#818cf8"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-indigo-400 inline-block" /> At or below planned</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Above planned</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 inline-block border-dashed border-t border-amber-400" /> Planned ({Math.round(session.planned_load_au)} AU)</span>
          </div>
        </div>
      )}
    </div>
  );
}
