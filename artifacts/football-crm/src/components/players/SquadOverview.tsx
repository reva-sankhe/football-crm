import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { HIGHLIGHT, ink, posColor, type Mode } from "@/lib/viz";
import {
  buildSquadOverview, interpretAge, interpretPositions, interpretSize,
} from "@/lib/squad";
import type { Player } from "@/lib/types";

/**
 * A block on the Overview tab: a figure or chart, and underneath it the reading
 * of what that figure shows.
 *
 * `table` is not optional decoration — a chart whose values are only reachable
 * by hovering fails accessibility, so every plot here ships its numbers as a
 * table too.
 */
function OverviewCard({
  title, subtitle, interpretation, table, className, children,
}: {
  title: string;
  subtitle?: string;
  interpretation: string;
  table?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={cn("bg-card border border-border rounded-2xl p-5 flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {table && (
          <button
            onClick={() => setShowTable((v) => !v)}
            className="shrink-0 text-[11px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-pressed={showTable}
            data-testid={`toggle-table-${title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </div>

      <div className="flex-1">{showTable && table ? table : children}</div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
          Interpretation
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{interpretation}</p>
      </div>
    </div>
  );
}

/** Shared tooltip chrome, matching the charts on Analytics and the player profile. */
function tooltipStyle(INK: ReturnType<typeof ink>) {
  return {
    contentStyle: {
      background: INK.tooltipBg,
      border: `1px solid ${INK.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
    },
    labelStyle: { color: INK.secondary },
  };
}

function MiniTable({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="text-left font-semibold pb-2">{head[0]}</th>
            <th className="text-right font-semibold pb-2">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-border/50">
              <td className="py-1.5 text-foreground">{k}</td>
              <td className="py-1.5 text-right font-time text-muted-foreground">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SquadOverview({ players, loading }: { players: Player[]; loading: boolean }) {
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);
  const tip = tooltipStyle(INK);

  const o = useMemo(() => buildSquadOverview(players), [players]);

  // A numeric axis picks its own ticks and drops most of the ages, so step them
  // by hand — roughly eight, always including both ends of the range.
  const ageTicks = useMemo(() => {
    if (o.minAge == null || o.maxAge == null) return [];
    const step = Math.max(1, Math.ceil((o.maxAge - o.minAge) / 7));
    const ticks: number[] = [];
    for (let age = o.minAge; age <= o.maxAge; age += step) ticks.push(age);
    if (ticks[ticks.length - 1] !== o.maxAge) ticks.push(o.maxAge);
    return ticks;
  }, [o.minAge, o.maxAge]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-card border border-border rounded-2xl h-56 animate-pulse" />
          <div className="bg-card border border-border rounded-2xl h-56 animate-pulse lg:col-span-2" />
        </div>
        <div className="bg-card border border-border rounded-2xl h-72 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1 ── Total players. One number is the whole story, so it stays a
                number rather than becoming a one-bar chart. */}
        <OverviewCard
          title="Total players"
          subtitle="Active roster"
          interpretation={interpretSize(o)}
        >
          <div className="flex flex-col justify-center h-full py-2">
            <div className="text-6xl font-bold text-foreground leading-none" data-testid="stat-total-players">
              {o.total}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between gap-3">
                <span>Inactive on file</span>
                <span className="font-time">{o.inactive}</span>
              </div>
            </div>
          </div>
        </OverviewCard>

        {/* 3 ── Players per position. Bars carry the app's fixed position hues,
                the same ones PosBadge uses, plus a direct value label — which is
                also what satisfies the light-mode contrast relief. */}
        <OverviewCard
          title="Players per position"
          subtitle="By primary position"
          className="lg:col-span-2"
          interpretation={interpretPositions(o)}
          table={
            <MiniTable
              head={["Position", "Players"]}
              rows={o.byPosition.map((p) => [
                p.position,
                p.avgAge != null ? `${p.players}  ·  avg ${p.avgAge}` : String(p.players),
              ])}
            />
          }
        >
          <div className="h-56">
            {o.byPosition.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No positions recorded</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={o.byPosition} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis
                    dataKey="position"
                    tick={{ fill: INK.secondary, fontSize: 11 }}
                    axisLine={{ stroke: INK.axis }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: INK.muted, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tip}
                    cursor={{ fill: INK.grid }}
                    formatter={(v: number, _n, item) => {
                      const avg = (item?.payload as { avgAge: number | null })?.avgAge;
                      return [avg != null ? `${v} · avg age ${avg}` : `${v}`, "Players"];
                    }}
                  />
                  <Bar dataKey="players" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {o.byPosition.map((p) => (
                      <Cell key={p.position} fill={posColor(mode, p.position)} />
                    ))}
                    <LabelList
                      dataKey="players"
                      position="top"
                      offset={6}
                      style={{ fill: INK.secondary, fontSize: 11, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>
      </div>

      {/* 2 ── Age distribution. Every year between youngest and oldest is on the
              axis, empty ones included — dropping them would close the gaps and
              flatter the shape. */}
      <OverviewCard
        title="Age distribution"
        subtitle={o.avgAge != null ? `${o.withAge} players with a birth year · average ${o.avgAge}` : undefined}
        interpretation={interpretAge(o)}
        table={
          <MiniTable
            head={["Age", "Players"]}
            rows={o.ageCurve.filter((b) => b.players > 0).map((b) => [String(b.age), String(b.players)])}
          />
        }
      >
        <div className="h-64">
          {o.ageCurve.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No birth years recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={o.ageCurve} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ageCurveFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={HIGHLIGHT} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={HIGHLIGHT} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                {/* A numeric axis, not the default categorical one, so the
                    average line can sit at 23.5 rather than snapping to 24. */}
                <XAxis
                  dataKey="age"
                  type="number"
                  domain={[o.minAge ?? 0, o.maxAge ?? 0]}
                  tick={{ fill: INK.secondary, fontSize: 11 }}
                  axisLine={{ stroke: INK.axis }}
                  tickLine={false}
                  ticks={ageTicks}
                  allowDecimals={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: INK.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  {...tip}
                  formatter={(v: number) => [`${v}`, "Players"]}
                  labelFormatter={(age) => `Age ${age}`}
                />
                {o.avgAge != null && (
                  <ReferenceLine
                    x={o.avgAge}
                    stroke={INK.axis}
                    strokeWidth={1}
                    label={{
                      value: `avg ${o.avgAge}`,
                      position: "insideTopRight",
                      fill: INK.secondary,
                      fontSize: 10,
                    }}
                  />
                )}
                {/* Monotone rather than a spline: it can't overshoot below zero
                    through the empty years. */}
                <Area
                  type="monotone"
                  dataKey="players"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  fill="url(#ageCurveFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: INK.surface }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>
    </div>
  );
}
