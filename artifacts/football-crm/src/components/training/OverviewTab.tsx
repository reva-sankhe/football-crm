import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { MiniTable, OverviewCard, tooltipStyle } from "@/components/OverviewCard";
import { HIGHLIGHT, ink, posColor, type Mode } from "@/lib/viz";
import {
  fetchAdoptableSessions, fetchAllAttendanceStats, fetchAllMatchStats, fetchAllRPEWithSessions,
  fetchPlayers,
} from "@/lib/queries";
import { ACWR_CONFIG, MATCH_RPE, buildLoadRows, type LoadRow } from "@/lib/report";
import {
  buildPlayerLoadDistribution, buildWeeklyTeamLoad, interpretLoadDistribution,
  interpretWeeklyLoad, withinWeeks, type PlayerLoadLine,
} from "@/lib/trainingAnalytics";
import type { Player, TrainingSession } from "@/lib/types";

/**
 * Training → Overview: what the load actually says.
 *
 * The same object as the other Overview tabs — a chart, and underneath it the
 * reading of what it shows. Load comes from `buildLoadRows`, the pipeline the
 * player profile, the printed report and the Dashboard alerts already use, so
 * the team view here cannot disagree with any of them. That means matches are
 * scored at MATCH_RPE × minutes rather than at whatever the player rated them,
 * which is why these figures differ from the old Analytics page.
 */

const WINDOWS: { label: string; weeks: number | null }[] = [
  { label: "4 weeks", weeks: 4 },
  { label: "8 weeks", weeks: 8 },
  { label: "12 weeks", weeks: 12 },
  { label: "16 weeks", weeks: 16 },
  { label: "All time", weeks: null },
];

export function OverviewTab() {
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);
  const tip = tooltipStyle(INK);
  const { toast } = useToast();

  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState<number | null>(16);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The same five reads the Dashboard makes, for the same reason: load is
      // rated sessions plus match minutes plus the match days nobody rated
      const [ps, rpe, matchStats, attendance, orphans] = await Promise.all([
        fetchPlayers(),
        fetchAllRPEWithSessions(),
        fetchAllMatchStats(),
        fetchAllAttendanceStats(),
        fetchAdoptableSessions(),
      ]);
      const squad = new Set(ps.map((p) => p.id));
      setPlayers(ps);
      setRows(
        buildLoadRows(
          rpe.filter((r) => squad.has(r.player_id)),
          matchStats.filter((s) => squad.has(s.player_id)),
          attendance.filter((a) => squad.has(a.player_id)),
          orphans as TrainingSession[],
        ),
      );
    } catch (err) {
      toast({ title: "Failed to load training analytics", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const windowed = useMemo(() => withinWeeks(rows, weeks), [rows, weeks]);
  const weekly = useMemo(() => buildWeeklyTeamLoad(windowed), [windowed]);
  const distribution = useMemo(
    // ACWR reads the full history: a 4-week window can't hold a 4-week baseline
    () => buildPlayerLoadDistribution(windowed, rows, players),
    [windowed, rows, players],
  );

  const totalAu = weekly.reduce((s, w) => s + w.totalAu, 0);
  const avgPerWeek = weekly.length > 0 ? Math.round(totalAu / weekly.length) : 0;
  const flagged = distribution.filter((l) => l.acwr.status === "danger" || l.acwr.status === "caution");

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl h-20 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-80 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-80 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Window and team ────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Reporting on
          </div>
          <div className="text-base font-semibold text-foreground mt-1">
            {weeks ? `Last ${weeks} weeks` : "All time"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {totalAu.toLocaleString()} AU across {weekly.length} {weekly.length === 1 ? "week" : "weeks"}
            {distribution.length > 0 && ` · ${distribution.length} players`}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {WINDOWS.map(({ label, weeks: w }) => (
              <button
                key={label}
                onClick={() => setWeeks(w)}
                className={cn(
                  "px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
                  weeks === w
                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                data-testid={`button-load-window-${w ?? "all"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Snapshot ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-px bg-border border border-border rounded-2xl overflow-hidden">
        <Stat label="Total load" value={`${totalAu.toLocaleString()} AU`} sub={`${weekly.length} weeks`} />
        <Stat label="Avg per week" value={`${avgPerWeek.toLocaleString()} AU`} sub="whole squad" />
        <Stat
          label="Heaviest player"
          value={distribution[0] ? `${distribution[0].totalAu.toLocaleString()} AU` : "—"}
          sub={distribution[0]?.player.name}
        />
        <Stat
          label="Above 1.3 ACWR"
          value={flagged.length}
          tone={flagged.length > 0 ? "text-status-warn" : undefined}
          sub="acute vs 4-week base"
        />
      </div>

      {/* ── Weekly team load ───────────────────────────────────────────────── */}
      <OverviewCard
        title="Weekly team load"
        subtitle="Total AU per week, oldest first · weeks start Monday"
        interpretation={interpretWeeklyLoad(weekly)}
        table={
          <MiniTable
            head={["Week of", "Total", "Per player", "Players", "Days"]}
            rows={weekly.map((w) => [
              w.label,
              `${w.totalAu.toLocaleString()} AU`,
              `${w.perPlayerAu.toLocaleString()} AU`,
              String(w.players),
              String(w.days),
            ])}
          />
        }
      >
        <div className="h-64">
          {weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground py-20 text-center">No load logged in this window</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="team-load" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={HIGHLIGHT} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={HIGHLIGHT} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: INK.secondary, fontSize: 10 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                <YAxis tick={{ fill: INK.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  {...tip}
                  labelFormatter={(label) => `Week of ${label}`}
                  formatter={(v: number, _n, item) => {
                    const w = item?.payload as { players: number; perPlayerAu: number };
                    return [`${v.toLocaleString()} AU · ${w?.perPlayerAu.toLocaleString()} each (${w?.players} players)`, "Total load"];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="totalAu"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  fill="url(#team-load)"
                  dot={{ r: 3, fill: HIGHLIGHT, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: HIGHLIGHT, stroke: INK.surface, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>

      {/* ── Player load distribution ───────────────────────────────────────── */}
      <OverviewCard
        title="Player load distribution"
        subtitle="Days worked against load per day · circle colour is position"
        interpretation={interpretLoadDistribution(distribution)}
        table={
          <MiniTable
            head={["Player", "Total", "Days", "Per day", "ACWR"]}
            rows={distribution.map((l) => [
              l.player.name,
              `${l.totalAu.toLocaleString()} AU`,
              String(l.days),
              `${l.perDayAu.toLocaleString()} AU`,
              l.acwr.acwr === null ? "—" : l.acwr.acwr.toFixed(2),
            ])}
          />
        }
      >
        <div className="h-72">
          {distribution.length === 0 ? (
            <p className="text-sm text-muted-foreground py-24 text-center">No load logged in this window</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={INK.grid} />
                <XAxis
                  type="number"
                  dataKey="days"
                  name="Days"
                  allowDecimals={false}
                  tick={{ fill: INK.muted, fontSize: 10 }}
                  axisLine={{ stroke: INK.axis }}
                  tickLine={false}
                  label={{ value: "Days worked", position: "insideBottom", offset: -4, fill: INK.muted, fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="perDayAu"
                  name="Load per day"
                  tick={{ fill: INK.muted, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <ZAxis range={[70, 70]} />
                <Tooltip cursor={{ strokeDasharray: "3 3", stroke: INK.axis }} content={<LoadTooltip INK={INK} />} />
                <Scatter
                  data={distribution.map((l) => ({
                    days: l.days,
                    perDayAu: l.perDayAu,
                    name: l.player.name,
                    position: l.player.primary_position,
                    totalAu: l.totalAu,
                    acwr: l.acwr.acwr,
                    status: l.acwr.status,
                    matchShare: l.matchShare,
                    fill: posColor(mode, l.player.primary_position),
                  }))}
                  isAnimationActive={false}
                />
                {/* Squad average load per day — the line a dot sits above or below */}
                {distribution.length > 1 && (
                  <ReferenceLine
                    y={Math.round(distribution.reduce((s, l) => s + l.perDayAu, 0) / distribution.length)}
                    stroke={HIGHLIGHT}
                    strokeDasharray="5 3"
                    label={{ value: "Squad avg", position: "insideTopRight", fill: HIGHLIGHT, fontSize: 9, fontWeight: 600 }}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {["Forward", "Midfielder", "Defender", "Goalkeeper"]
            .filter((pos) => distribution.some((l) => l.player.primary_position === pos))
            .map((pos) => (
              <span key={pos} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: posColor(mode, pos) }} />
                {pos}
              </span>
            ))}
        </div>
      </OverviewCard>

      {/* ── Who to watch ───────────────────────────────────────────────────── */}
      {flagged.length > 0 && (
        <div className="bg-card border border-border rounded-2xl px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Load to watch</h2>
          <div className="flex flex-wrap gap-2">
            {flagged.map((l) => (
              <Link
                key={l.player.id}
                href={`/players/${l.player.id}`}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-[11px] hover:border-indigo-500/40 transition-colors"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: ACWR_CONFIG[l.acwr.status].color }} />
                <span className="text-foreground font-medium">{l.player.name}</span>
                <span className="font-time text-muted-foreground">
                  ACWR {l.acwr.acwr?.toFixed(2) ?? "—"} · {ACWR_CONFIG[l.acwr.status].label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Load is rated sessions plus match minutes, with every match scored at RPE {MATCH_RPE} however
        hard it felt — the same rows the player profile and the printed report read, so no two screens
        can disagree. ACWR always reads the full history rather than the window above: the ratio needs
        four weeks of baseline behind it.
      </p>
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, tone }: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="bg-card px-4 py-3 flex-1 min-w-[7.5rem]">
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={cn("text-xl font-bold font-time", tone ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

interface LoadPoint {
  name: string;
  position: string | null;
  days: number;
  perDayAu: number;
  totalAu: number;
  acwr: number | null;
  status: PlayerLoadLine["acwr"]["status"];
  matchShare: number;
}

function LoadTooltip({ active, payload, INK }: {
  active?: boolean;
  payload?: { payload: LoadPoint }[];
  INK: ReturnType<typeof ink>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded-lg px-2.5 py-2 text-xs"
      style={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}` }}
    >
      <div className="font-semibold" style={{ color: INK.primary }}>{d.name}</div>
      <div style={{ color: INK.secondary }}>{d.position ?? "No position"}</div>
      <div className="font-time" style={{ color: INK.secondary }}>
        {d.totalAu.toLocaleString()} AU over {d.days} {d.days === 1 ? "day" : "days"} · {d.perDayAu.toLocaleString()} a day
      </div>
      <div className="font-time" style={{ color: ACWR_CONFIG[d.status].color }}>
        ACWR {d.acwr?.toFixed(2) ?? "—"} · {ACWR_CONFIG[d.status].label}
      </div>
      {d.matchShare > 0 && (
        <div className="font-time" style={{ color: INK.muted }}>
          {Math.round(d.matchShare * 100)}% from matches
        </div>
      )}
    </div>
  );
}
