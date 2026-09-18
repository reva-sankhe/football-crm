import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { OverviewCard, tooltipStyle } from "@/components/OverviewCard";
import { HIGHLIGHT, ink, type Mode } from "@/lib/viz";
import {
  fetchAllAttendanceStats, fetchAllMatchStats, fetchAllRPEWithSessions, fetchPlayers, fetchTrainingSessions,
} from "@/lib/queries";
import { ACWR_CONFIG, buildLoadRows, pinnedWeeklyAnchor, teamSessionDatesFrom, type LoadRow } from "@/lib/report";
import {
  buildLoadToWatch, buildSquadWeeklyLoad, computeSquadUsualLoadRange,
  interpretLoadToWatch, interpretSquadWeeklyLoad, weeksAgo, withinWeeks,
  type LoadToWatchRow, type SquadWeekLoad,
} from "@/lib/trainingAnalytics";
import type { Player, TrainingSession } from "@/lib/types";

/**
 * Training → Overview: what the load actually says.
 *
 * Load comes from `buildLoadRows`, the pipeline the player profile, the
 * printed report and the Dashboard alerts already use, so this page cannot
 * disagree with any of them. Flagged-player and ratio figures anchor to
 * `pinnedWeeklyAnchor()` (the most recently completed Sunday) rather than
 * today, so a player's status doesn't shift just because a coach opened the
 * page on a different day of the week — see report.ts for why. The weekly
 * load *chart* is the one exception: it tiles through the literal present so
 * a partial, still-building current week shows real progress, clearly
 * marked, rather than jumping straight to Sunday.
 *
 * Deliberately simple by design: this page is only Flagged players, four
 * stat cards, and the weekly load trend. No squad-wide table, no gone-quiet
 * signal, no data-quality panel — cut in favor of a page that answers "who
 * needs a look, and is the squad's load doing anything unusual" without
 * asking a coach to parse a big table.
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
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState<number | null>(16);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, rpe, matchStats, attendance, sessionsData] = await Promise.all([
        fetchPlayers(),
        fetchAllRPEWithSessions(),
        fetchAllMatchStats(),
        fetchAllAttendanceStats(),
        fetchTrainingSessions(),
      ]);
      // Squad-wide totals and the per-player list are active-roster only — a
      // player marked inactive drops out of team load figures entirely, not
      // just the alert engine.
      const activePs = ps.filter((p) => p.is_active);
      const squad = new Set(activePs.map((p) => p.id));
      setPlayers(activePs);
      setSessions(sessionsData);
      setRows(
        buildLoadRows(
          rpe.filter((r) => squad.has(r.player_id)),
          matchStats.filter((s) => squad.has(s.player_id)),
          attendance.filter((a) => squad.has(a.player_id)),
          sessionsData,
        ),
      );
    } catch (err) {
      toast({ title: "Failed to load training analytics", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // ── Two different anchors, deliberately ────────────────────────────────────
  // Flagged-player status uses the pinned Sunday anchor, so it reads the same
  // all week. The weekly load *chart* tiles through the literal present
  // instead, so a partial current week shows real in-progress data (see
  // buildSquadWeeklyLoad's isPartial).
  const statusAnchor = useMemo(() => pinnedWeeklyAnchor(), []);
  const chartEnd = useMemo(() => new Date(), []);
  const teamSessionDates = useMemo(() => teamSessionDatesFrom(sessions), [sessions]);

  const earliestRowDate = useMemo(() => {
    const dated = rows.filter((r) => r.date != null).map((r) => r.date as string).sort();
    return dated.length > 0 ? new Date(dated[0] + "T00:00:00") : chartEnd;
  }, [rows, chartEnd]);
  const chartStart = useMemo(
    () => weeksAgo(weeks, chartEnd) ?? earliestRowDate,
    [weeks, chartEnd, earliestRowDate],
  );

  const weeklySquad = useMemo(
    () => buildSquadWeeklyLoad(rows, chartStart, chartEnd),
    [rows, chartStart, chartEnd],
  );
  const usualRange = useMemo(() => computeSquadUsualLoadRange(weeklySquad), [weeklySquad]);

  const loadToWatch = useMemo(
    () => buildLoadToWatch(rows, players, statusAnchor, teamSessionDates),
    [rows, players, statusAnchor, teamSessionDates],
  );

  // ── Stat cards ───────────────────────────────────────────────────────────
  const latestWeek: SquadWeekLoad | undefined = weeklySquad[weeklySquad.length - 1];
  const previousCompleteWeek: SquadWeekLoad | undefined = latestWeek?.isPartial
    ? weeklySquad[weeklySquad.length - 2]
    : undefined;
  // A partial current week has no week-on-week of its own (see buildSquadWeeklyLoad) —
  // "change vs last week" instead reads the most recent pair of complete weeks.
  const changeVsLastWeek = latestWeek?.isPartial
    ? previousCompleteWeek?.weekOnWeekPerPlayerPct ?? null
    : latestWeek?.weekOnWeekPerPlayerPct ?? null;

  const weeksWithData = weeklySquad.filter((w) => w.totalAu > 0).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl h-20 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-16 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-80 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Window ─────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Reporting on
          </div>
          <div className="text-base font-semibold text-foreground mt-1">
            {weeks ? `Last ${weeks} weeks` : "All time"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {weeks
              ? `Last ${weeks} weeks selected · ${weeksWithData} of ${weeklySquad.length} have data logged`
              : `${weeksWithData} of ${weeklySquad.length} weeks on record have data logged`}
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

      {/* ── Flagged players ────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground mb-1">Flagged players</h2>
        <p className="text-xs text-muted-foreground mb-3">{interpretLoadToWatch(loadToWatch)}</p>
        {loadToWatch.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">Nobody is above their usual load range right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {loadToWatch.map((w) => (
              <FlaggedPlayerChip key={w.player.id} row={w} />
            ))}
          </div>
        )}
      </div>

      {/* ── Four stat cards ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-px bg-border border border-border rounded-2xl overflow-hidden">
        <Stat
          label="Avg load per player"
          value={latestWeek ? `${latestWeek.perPlayerAu.toLocaleString()} AU` : "—"}
          sub={latestWeek?.isPartial ? "this week so far" : "this week"}
        />
        <Stat
          label="Change vs last week"
          value={changeVsLastWeek === null ? "—" : `${changeVsLastWeek >= 0 ? "+" : ""}${Math.round(changeVsLastWeek)}%`}
          sub="per player"
        />
        <Stat
          label="Players trained"
          value={latestWeek ? `${latestWeek.players} of ${players.length}` : "—"}
          sub={latestWeek?.isPartial ? "this week so far" : "this week"}
        />
        <Stat
          label="Load estimated"
          value={latestWeek ? `${Math.round(latestWeek.estimatedShare * 100)}%` : "—"}
          sub="this week"
        />
      </div>

      {/* ── Weekly load chart ──────────────────────────────────────────────── */}
      <OverviewCard
        title="Weekly team load"
        subtitle="Average AU per player who trained, oldest first · weeks start Monday"
        interpretation={interpretSquadWeeklyLoad(weeklySquad)}
      >
        <div className="h-64">
          {weeklySquad.length === 0 ? (
            <p className="text-sm text-muted-foreground py-20 text-center">No load logged in this window</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={weeklySquad.map((w) => ({
                  ...w,
                  label: w.isPartial ? `${w.label} (so far)` : w.label,
                }))}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="squad-load" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={HIGHLIGHT} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={HIGHLIGHT} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: INK.secondary, fontSize: 10 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                <YAxis tick={{ fill: INK.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                {usualRange && (
                  <ReferenceArea
                    y1={Math.max(0, usualRange.low)}
                    y2={usualRange.high}
                    fill={HIGHLIGHT}
                    fillOpacity={0.08}
                    stroke="none"
                    label={{ value: "Usual range", position: "insideTopLeft", fill: HIGHLIGHT, fontSize: 9, fontWeight: 600 }}
                  />
                )}
                <Tooltip
                  {...tip}
                  labelFormatter={(label) => `Week of ${label}`}
                  formatter={(v: number, _n, item) => {
                    const w = item?.payload as SquadWeekLoad;
                    return [
                      `${v.toLocaleString()} AU avg · ${w?.players ?? 0} trained · ${w?.totalAu.toLocaleString() ?? 0} total`,
                      "Load per player",
                    ];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="perPlayerAu"
                  stroke={HIGHLIGHT}
                  strokeWidth={2}
                  fill="url(#squad-load)"
                  dot={(props: { cx?: number; cy?: number; payload?: SquadWeekLoad; index?: number }) => {
                    const { cx, cy, payload, index } = props;
                    if (cx == null || cy == null) return <g key={index} />;
                    return (
                      <circle
                        key={index}
                        cx={cx}
                        cy={cy}
                        r={3}
                        fill={HIGHLIGHT}
                        strokeWidth={payload?.isPartial ? 2 : 0}
                        stroke={INK.surface}
                        strokeDasharray={payload?.isPartial ? "2 2" : undefined}
                      />
                    );
                  }}
                  activeDot={{ r: 5, fill: HIGHLIGHT, stroke: INK.surface, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>

      <p className="text-[11px] text-muted-foreground">
        Load is rated sessions plus match minutes. Match minutes use the player's RPE when logged, or a
        clearly marked RPE 7 estimate when it is missing. The workload ratio compares the latest 7 days
        with the prior 3-week average and needs 28 calendar days of history; it is a monitoring signal,
        not an injury prediction.
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

function FlaggedPlayerChip({ row }: { row: LoadToWatchRow }) {
  const cfg = ACWR_CONFIG[row.status];
  return (
    <Link
      href={`/players/${row.player.id}`}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-[11px] hover:border-indigo-500/40 transition-colors"
      title={`Ratio ${row.acwr?.toFixed(2) ?? "—"}`}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
      <span className="text-foreground font-medium">{row.player.name}</span>
      <span className="font-time" style={{ color: cfg.color }}>
        {cfg.label}
        {row.pctVsUsual != null && (
          <>, {Math.abs(Math.round(row.pctVsUsual))}% {row.pctVsUsual >= 0 ? "above" : "below"} usual</>
        )}
      </span>
    </Link>
  );
}
