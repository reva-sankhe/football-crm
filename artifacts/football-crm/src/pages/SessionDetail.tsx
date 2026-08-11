import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Zap, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PosBadge } from "@/components/PosBadge";
import { SessionTypeBadge } from "@/components/Badges";
import { useTheme } from "@/context/ThemeContext";
import { AGE_ORDER, HIGHLIGHT, POSITION_ORDER, ageColor, ink, posColor, type Mode } from "@/lib/viz";
import { fetchTrainingSession, fetchSessionRPEWithPlayers } from "@/lib/queries";
import type { TrainingSession, SessionRPE, Player } from "@/lib/types";
import {
  Area, AreaChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
} from "recharts";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type RpeRow = SessionRPE & { players: Player };

/** One figure in the strip under the session header. */
function Stat({ label, value, sub, tone }: {
  label: string;
  value: string | number;
  sub?: string | null;
  tone?: string;
}) {
  return (
    // Flex rather than a grid cell: the strip carries anywhere from one tile to
    // six, and an empty grid cell would show as a block of bare divider colour
    <div className="bg-card px-4 py-3 flex-1 min-w-[7.5rem]">
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={cn("text-xl font-bold font-time", tone ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

/**
 * Average load for one grouping of the session's RPE rows — position or age.
 * Groups nobody was in are dropped rather than plotted at zero, which would
 * read as a group that turned up and did nothing.
 */
function groupLoad<T extends string>(
  rows: RpeRow[],
  order: readonly T[],
  groupOf: (r: RpeRow) => string | null | undefined,
  colorOf: (g: T) => string,
) {
  return order
    .map((group) => {
      const inGroup = rows.filter((r) => groupOf(r) === group);
      if (inGroup.length === 0) return null;
      return {
        group,
        avgLoad: Math.round(inGroup.reduce((s, r) => s + r.load_au, 0) / inGroup.length),
        avgRpe: parseFloat((inGroup.reduce((s, r) => s + r.rpe, 0) / inGroup.length).toFixed(1)),
        color: colorOf(group),
        count: inGroup.length,
      };
    })
    .filter(Boolean) as { group: string; avgLoad: number; avgRpe: number; color: string; count: number }[];
}

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
  // Lectures are attendance only; matches record minutes, not a planned RPE
  const carriesLoad = session.session_type !== "Lecture" && session.planned_rpe > 0;

  // The RPE curve — how many reported each score, over the whole 1–10 scale so
  // the shape is comparable between sessions rather than fitted to the data
  const curveData = Array.from({ length: 10 }, (_, i) => ({
    rpe: i + 1,
    count: rpeRows.filter((r) => Math.round(r.rpe) === i + 1).length,
  }));

  const positionLoadData = groupLoad(rpeRows, POSITION_ORDER, (r) => r.players?.primary_position, (g) => posColor(mode, g));
  const ageLoadData = groupLoad(rpeRows, AGE_ORDER, (r) => r.players?.age_range, (g) => ageColor(mode, g));

  // Effort vs plan insight blurb
  const teamAvgLoad = avgLoad ?? 0;
  const pctVsPlan = planLoad > 0 ? Math.round(((teamAvgLoad - planLoad) / planLoad) * 100) : 0;
  const highestPosGroup = positionLoadData.length > 0
    ? positionLoadData.reduce((a, b) => (b.avgLoad > a.avgLoad ? b : a))
    : null;
  const effortBlurb = count > 0 && planLoad > 0
    ? `Team averaged ${Math.abs(pctVsPlan)}% ${pctVsPlan >= 0 ? "above" : "below"} plan` +
      (highestPosGroup ? `, with ${highestPosGroup.group}s carrying the highest load (avg ${highestPosGroup.avgLoad} AU).` : ".")
    : null;

  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={() => setLocation("/sessions")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Sessions
      </button>

      {/* Session header */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{session.day}</h1>
            <div className="text-sm text-muted-foreground">{formatDate(session.date)}</div>
          </div>
          <SessionTypeBadge type={session.session_type} />
        </div>
        {session.notes && (
          <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">{session.notes}</p>
        )}
      </div>

      {/* Plan and outcome in one strip. `gap-px` over a border-coloured ground
          gives clean dividers however many tiles there are and however they wrap —
          a lecture has no plan, and an unlogged session has no outcome. */}
      <div className="flex flex-wrap gap-px bg-border border border-border rounded-2xl overflow-hidden">
        <Stat label="Duration" value={session.duration_mins} sub="minutes" />
        {carriesLoad && (
          <Stat
            label="Planned load"
            value={`${planLoad} AU`}
            sub={`RPE ${session.planned_rpe.toFixed(1)} × ${session.duration_mins} min`}
          />
        )}
        {count > 0 && (
          <>
            <Stat
              label="Avg RPE"
              value={avgRpe?.toFixed(1) ?? "—"}
              sub={carriesLoad ? `planned ${session.planned_rpe.toFixed(1)}` : null}
            />
            <Stat
              label="Avg load"
              value={`${avgLoad ?? "—"} AU`}
              tone="text-status-good"
              sub={carriesLoad && planLoad > 0 ? `${pctVsPlan >= 0 ? "+" : ""}${pctVsPlan}% vs plan` : null}
            />
            <Stat
              label="Highest load"
              value={highest ? Math.round(highest.load_au) : "—"}
              sub={highest?.players?.name}
            />
            <Stat
              label="Lowest load"
              value={lowest ? Math.round(lowest.load_au) : "—"}
              sub={lowest?.players?.name}
            />
          </>
        )}
      </div>

      {/* RPE distribution */}
      {count > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">RPE distribution</h2>
          <p className="text-xs text-muted-foreground mb-4">
            How many players reported each RPE score. 1 is easy, 10 is maximal.
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={curveData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <defs>
                <linearGradient id="rpe-curve" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={HIGHLIGHT} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={HIGHLIGHT} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
              {/* Numeric rather than category, so the average can sit at 7.4 */}
              <XAxis
                dataKey="rpe"
                type="number"
                domain={[1, 10]}
                ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                tick={{ fill: INK.axis, fontSize: 11 }}
              />
              <YAxis allowDecimals={false} tick={{ fill: INK.axis, fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}`, borderRadius: 8 }}
                labelStyle={{ color: INK.primary, fontSize: 12 }}
                labelFormatter={(rpe) => `RPE ${rpe}`}
                formatter={(v: number) => [`${v} player${v !== 1 ? "s" : ""}`, "Reported"]}
              />
              {avgRpe != null && (
                <ReferenceLine
                  x={avgRpe}
                  stroke={INK.axis}
                  strokeDasharray="4 4"
                  label={{ value: `avg ${avgRpe.toFixed(1)}`, position: "top", fill: INK.secondary, fontSize: 10 }}
                />
              )}
              {/* One series, so one hue and no legend — the title names it */}
              <Area
                type="monotone"
                dataKey="count"
                stroke={HIGHLIGHT}
                strokeWidth={2}
                fill="url(#rpe-curve)"
                dot={{ r: 3, fill: HIGHLIGHT, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: HIGHLIGHT, stroke: INK.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Effort vs plan blurb */}
      {effortBlurb && (
        <div className="flex items-start gap-2 px-4 py-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-300">
          <Zap size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
          <span>{effortBlurb}</span>
        </div>
      )}

      {/* Who carried the load — the same measure cut two ways, side by side */}
      {(positionLoadData.length > 0 || ageLoadData.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { title: "Avg load by position", data: positionLoadData },
            { title: "Avg load by age group", data: ageLoadData },
          ].map(({ title, data }) => data.length === 0 ? null : (
            <div key={title} className="bg-card border border-border rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Average load (AU) per group.
                {carriesLoad && ` Dashed line = planned (${planLoad} AU).`}
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="group" tick={{ fill: INK.axis, fontSize: 11 }} />
                  <YAxis tick={{ fill: INK.axis, fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}`, borderRadius: 8 }}
                    labelStyle={{ color: INK.primary, fontSize: 12 }}
                    formatter={(v: number, _: string, entry: { payload?: { avgRpe?: number; count?: number } }) => [
                      `${v} AU · avg RPE ${entry.payload?.avgRpe?.toFixed(1) ?? "?"} · ${entry.payload?.count} player${entry.payload?.count !== 1 ? "s" : ""}`,
                      "Avg load",
                    ]}
                  />
                  {carriesLoad && (
                    <ReferenceLine
                      y={planLoad}
                      stroke={HIGHLIGHT}
                      strokeDasharray="5 3"
                      label={{ value: "Plan", position: "insideTopRight", fill: HIGHLIGHT, fontSize: 10 }}
                    />
                  )}
                  {/* Colour follows the group, never its rank — see lib/viz.ts */}
                  <Bar dataKey="avgLoad" radius={[4, 4, 0, 0]} maxBarSize={52}>
                    <LabelList dataKey="avgLoad" position="top" style={{ fill: INK.axis, fontSize: 10 }} />
                    {data.map((entry) => <Cell key={entry.group} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}

      {/* Player RPE table */}
      <div className="bg-card border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Player RPE</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{count} player{count !== 1 ? "s" : ""}</span>
            {/* The way to the RPE screen once entries exist — the empty state
                below covers the other case. A quiet link, not a primary button. */}
            {count > 0 && session.session_type !== "Lecture" && (
              <button
                onClick={() => setLocation(`/sessions/${id}/rpe`)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-log-rpe"
              >
                Log RPE
              </button>
            )}
          </div>
        </div>
        {count === 0 ? (
          <div className="py-12 text-center">
            <ClipboardList size={28} className="mx-auto text-muted-foreground/30 mb-2" />
            {session.session_type === "Lecture" ? (
              <p className="text-sm text-muted-foreground">
                A lecture is an attendance record — there's no RPE to log.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No RPE entries yet</p>
                <button
                  onClick={() => setLocation(`/sessions/${id}/rpe`)}
                  className="mt-2 text-sm text-indigo-400 hover:text-indigo-300"
                >
                  Start logging RPE
                </button>
              </>
            )}
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

    </div>
  );
}
