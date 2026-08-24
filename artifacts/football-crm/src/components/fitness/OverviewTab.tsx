import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { MiniTable, OverviewCard, tooltipStyle } from "@/components/OverviewCard";
import { PosBadge } from "@/components/PosBadge";
import { AGE_ORDER, HIGHLIGHT, POSITION_ORDER, ageColor, ink, posColor, series, type Mode } from "@/lib/viz";
import { fetchAllResults, fetchPlayers, fetchSessions } from "@/lib/queries";
import { BRONCO_TIERS, type Player, type TestResult, type TestSession } from "@/lib/types";
import {
  buildBands, buildFitnessLines, buildGroupBreakdown, buildTeamTrend, buildTierDistribution,
  comparable, interpretBands, interpretCompare, interpretGroups, interpretMovers,
  interpretSquadFitness, interpretTiers, interpretTrend, formatMetric, formatMetricDelta,
  formatMetricChangeMagnitude, improvementThreshold,
  metricLabel, movers, ranked, type FitnessLine, type FitnessMetric,
} from "@/lib/fitnessAnalytics";

/**
 * Fitness → Overview: what the test results actually say.
 *
 * The same object as Players → Overview and Tournaments → Overview — a chart,
 * and underneath it the reading of what that chart shows, from the deterministic
 * `interpret*` functions in `lib/fitnessAnalytics.ts`. One parent fetch feeds
 * every card, so no two blocks can describe different data.
 *
 * Replaces six tabs of the old Analytics page. Two of its charts disagreed with
 * the cards beneath them — the chart averaged the latest *session* while the
 * cards averaged each player's own latest *time* — so every group average here
 * states which basis it uses. See `buildGroupBreakdown`.
 */

type ResultRow = TestResult & {
  players?: Pick<Player, "name" | "code" | "team" | "primary_position" | "age_range">;
  test_sessions?: Pick<TestSession, "test_date" | "test_name" | "type">;
};

/** Compare holds fixed slots, so deselecting one player never repaints the rest. */
const COMPARE_SLOTS = 5;

type Grouping = "all" | "position" | "age";
type Placing = "bands" | "tiers";
type OverviewMode = "bronco" | "sprints";

export function OverviewTab() {
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);
  const tip = tooltipStyle(INK);
  const { toast } = useToast();

  const [results, setResults] = useState<ResultRow[]>([]);
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  /** "" means every session. */
  const [pickedSession, setPickedSession] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("all");
  const [placing, setPlacing] = useState<Placing>("bands");
  const [overviewMode, setOverviewMode] = useState<OverviewMode>("bronco");
  const [sprintMetric, setSprintMetric] = useState<Exclude<FitnessMetric, "bronco">>("10m");
  const [slots, setSlots] = useState<(string | null)[]>(Array(COMPARE_SLOTS).fill(null));

  const metric: FitnessMetric = overviewMode === "bronco" ? "bronco" : sprintMetric;
  const isBronco = metric === "bronco";
  const metricName = metricLabel(metric);
  const formatValue = (value: number | null | undefined) => formatMetric(value, metric);
  const noiseThreshold = improvementThreshold(metric);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, ss, ps] = await Promise.all([fetchAllResults(), fetchSessions(), fetchPlayers()]);
      // Only the current squad: inactive players are excluded here — and their
      // results with them, so the team trend can't average in departed players.
      const active = ps.filter((p) => p.is_active);
      const activeIds = new Set(active.map((p) => p.id));
      setResults((rs as ResultRow[]).filter((r) => activeIds.has(r.player_id)));
      setSessions(ss);
      setPlayers(active);
    } catch (err) {
      toast({ title: "Failed to load fitness analytics", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const scopedSessions = useMemo(
    () => (pickedSession ? sessions.filter((s) => s.id === pickedSession) : sessions),
    [sessions, pickedSession],
  );

  const lines = useMemo(
    () => buildFitnessLines(players, results, scopedSessions, metric),
    [players, results, scopedSessions, metric],
  );
  const trend = useMemo(
    () => buildTeamTrend(results, scopedSessions, metric),
    [results, scopedSessions, metric],
  );

  const withTime = useMemo(() => ranked(lines), [lines]);
  const moved = useMemo(() => movers(lines), [lines]);
  const latestPoint = trend[trend.length - 1] ?? null;

  /** Group averages use each player's personal-best time (sessionId = null),
   *  consistent with the scatter below. Filtering to a single session would
   *  exclude anyone who missed that day and make "tested" misleadingly small. */
  const groups = useMemo(
    () => buildGroupBreakdown(
      lines,
      grouping === "age" ? AGE_ORDER : POSITION_ORDER,
      (l) => (grouping === "age" ? l.player.age_range : l.player.primary_position),
      null,
    ),
    [lines, grouping],
  );

  const bands = useMemo(() => buildBands(lines, mode), [lines, mode]);
  const tiers = useMemo(() => (isBronco ? buildTierDistribution(lines) : []), [lines, isBronco]);

  const picked = useMemo(
    () => slots.map((id) => (id ? lines.find((l) => l.player.id === id) ?? null : null)),
    [slots, lines],
  );
  const pickedLines = picked.filter(Boolean) as FitnessLine[];

  const toggleCompare = (id: string) => {
    setSlots((prev) => {
      const at = prev.indexOf(id);
      if (at !== -1) { const next = [...prev]; next[at] = null; return next; }
      const free = prev.indexOf(null);
      if (free === -1) return prev; // all five slots taken
      const next = [...prev]; next[free] = id; return next;
    });
  };
  const slotOf = (id: string) => slots.indexOf(id);

  // The squad as points, coloured by tier when ungrouped and by group otherwise
  const scatter = useMemo(() => {
    const columns = grouping === "position" ? [...POSITION_ORDER]
      : grouping === "age" ? [...AGE_ORDER]
      : ["All"];
    const groupOf = (l: FitnessLine) =>
      grouping === "position" ? l.player.primary_position
      : grouping === "age" ? l.player.age_range
      : "All";

    return columns.flatMap((column) => {
      const inColumn = withTime.filter((l) => (grouping === "all" ? true : groupOf(l) === column));
      const spread = grouping === "all" ? 0.45 : 0.32;
      return inColumn.map((l, i) => ({
        x: columns.indexOf(column) + (inColumn.length > 1 ? (i / (inColumn.length - 1) - 0.5) * spread : 0),
        y: l.latest!.value,
        name: l.player.name,
        initials: l.player.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
        color: grouping === "position" ? posColor(mode, column)
          : grouping === "age" ? ageColor(mode, column)
          : l.tier?.color ?? HIGHLIGHT,
        tier: l.tier?.label,
        deltaSecs: l.deltaSecs,
      }));
    });
  }, [withTime, grouping, mode]);

  const scatterColumns = grouping === "position" ? [...POSITION_ORDER]
    : grouping === "age" ? [...AGE_ORDER]
    : ["All"];

  const squadAvg = withTime.length > 0
    ? withTime.reduce((s, l) => s + l.latest!.value, 0) / withTime.length
    : null;

  /** Selected metric per picked player across the sessions in scope. */
  const compareSeries = useMemo(() => {
    const chronological = [...scopedSessions].sort((a, b) => a.test_date.localeCompare(b.test_date));
    return chronological
      .map((s) => {
        const row: Record<string, string | number | null> = { session: s.test_name };
        for (const line of pickedLines) {
          row[line.player.id] = line.results.find((r) => r.sessionId === s.id)?.value ?? null;
        }
        return row;
      })
      .filter((row) => pickedLines.some((l) => row[l.player.id] != null));
  }, [scopedSessions, pickedLines]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl h-20 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-card border border-border rounded-2xl h-72 animate-pulse lg:col-span-2" />
          <div className="bg-card border border-border rounded-2xl h-72 animate-pulse" />
        </div>
        <div className="bg-card border border-border rounded-2xl h-80 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── What the cards are reporting on ────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Reporting on
          </div>
          <div className="text-base font-semibold text-foreground mt-1">
            {pickedSession ? sessions.find((s) => s.id === pickedSession)?.test_name ?? "Session" : "All test sessions"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {interpretSquadFitness(lines, trend, metric)}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Toggle
            options={[["bronco", "Bronco"], ["sprints", "Sprints"]]}
            value={overviewMode}
            onChange={(value) => {
              const next = value as OverviewMode;
              setOverviewMode(next);
              if (next === "sprints") setPlacing("bands");
            }}
          />
          {!isBronco && (
            <Toggle
              options={[["10m", "10m"], ["20m", "20m"], ["40m", "40m"]]}
              value={sprintMetric}
              onChange={(value) => setSprintMetric(value as Exclude<FitnessMetric, "bronco">)}
            />
          )}
          {sessions.length > 1 && (
            <select
              value={pickedSession}
              onChange={(e) => setPickedSession(e.target.value)}
              className="h-9 bg-muted border border-border rounded-lg px-2.5 text-sm text-foreground max-w-[14rem]"
              aria-label="Test session"
              data-testid="select-fitness-session"
            >
              <option value="">All test sessions</option>
              {[...sessions]
                .sort((a, b) => b.test_date.localeCompare(a.test_date))
                .map((s) => <option key={s.id} value={s.id}>{s.test_name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── Snapshot ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-px bg-border border border-border rounded-2xl overflow-hidden">
        <Stat label="Squad" value={players.length} sub="registered" />
        <Stat label={`With ${metricName}`} value={withTime.length} sub={`of ${players.length}`} />
        <Stat
          label={`Avg ${metricName}`}
          value={squadAvg == null ? "—" : formatValue(squadAvg)}
          sub="latest per player"
        />
        <Stat label="Comparable" value={comparable(lines).length} sub="2+ tests" />
        <Stat label="Improved" value={moved.improved.length} tone="text-status-good" sub={`of ${comparable(lines).length}`} />
        <Stat label="Declined" value={moved.declined.length} tone="text-status-bad" sub={`of ${comparable(lines).length}`} />
      </div>

      {/* ── Trend and movers ───────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <OverviewCard
          title={`Team ${metricName} trend`}
          subtitle={`Squad average ${metricName.toLowerCase()} per session, oldest first`}
          className="lg:col-span-2"
          interpretation={interpretTrend(trend, metric)}
          table={
            <MiniTable
              head={["Session", "Tested", `Avg ${metricName}`]}
              rows={trend.map((p) => [p.name, String(p.tested), formatValue(p.avgBronco)])}
            />
          }
        >
          <div className="h-56">
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No {metricName} times recorded</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fitness-trend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={HIGHLIGHT} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={HIGHLIGHT} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  {/* Lower is faster, so the axis is reversed — up means fitter */}
                  <YAxis
                    reversed
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatValue(v)}
                    tick={{ fill: INK.muted, fontSize: 10 }}
                    width={46}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tip}
                    formatter={(v: number, _n, item) =>
                      [`${formatValue(v)} · ${(item?.payload as { tested: number })?.tested} tested`, "Squad average"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="avgBronco"
                    stroke={HIGHLIGHT}
                    strokeWidth={2}
                    fill="url(#fitness-trend)"
                    dot={{ r: 3, fill: HIGHLIGHT, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: HIGHLIGHT, stroke: INK.surface, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>

        <OverviewCard
          title="Movers"
          subtitle="Change since each player's first test in scope"
          interpretation={interpretMovers(lines, metric)}
          table={
            <MiniTable
              head={["Player", "First", "Latest", "Change"]}
              rows={[...moved.improved, ...moved.declined].map((l) => [
                l.player.name,
                formatValue(l.first!.value),
                formatValue(l.latest!.value),
                formatMetricDelta(l.deltaSecs!, metric),
              ])}
            />
          }
        >
          <div className="h-56 overflow-y-auto space-y-3">
            {comparable(lines).length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">Nobody has two tests yet</p>
            ) : (
              <>
                <MoverList title="Faster" lines={moved.improved} tone="text-status-good" metric={metric} />
                <MoverList title="Slower" lines={moved.declined} tone="text-status-bad" metric={metric} />
              </>
            )}
          </div>
        </OverviewCard>
      </div>

      {/* ── Squad distribution ─────────────────────────────────────────────── */}
      <OverviewCard
        title="Squad distribution"
        subtitle={
          grouping === "all"
            ? isBronco
              ? "Every player with a time · lower is faster · coloured by benchmark tier"
              : `Every player with a ${metricName} time · lower is faster`
            : `Grouped by ${grouping}${groups.sessionName ? ` · measured on ${groups.sessionName}` : ""}`
        }
        interpretation={grouping === "all"
          ? interpretBands(bands, lines, metric)
          : interpretGroups(groups, grouping, metric)}
        action={
          <Toggle
            options={[["all", "All"], ["position", "Position"], ["age", "Age"]]}
            value={grouping}
            onChange={(v) => setGrouping(v as Grouping)}
          />
        }
        table={
          grouping === "all"
            ? (
              <MiniTable
                head={isBronco ? ["Player", "Bronco", "Tier"] : ["Player", metricName, "Rank"]}
                rows={withTime.map((l, index) => [
                  l.player.name,
                  formatValue(l.latest!.value),
                  isBronco ? l.tier?.label ?? "—" : String(index + 1),
                ])}
              />
            ) : (
              <MiniTable
                head={["Group", "Tested", `Avg ${metricName}`, "Faster", "Slower"]}
                rows={groups.groups.map((g) => [
                  g.group, String(g.tested), formatValue(g.avgBronco), String(g.improved), String(g.declined),
                ])}
              />
            )
        }
      >
        <div className={grouping === "all" ? "h-72" : "h-80"}>
          {scatter.length === 0 ? (
            <p className="text-sm text-muted-foreground py-24 text-center">No {metricName} times recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 16, bottom: 8, left: 6 }}>
                <CartesianGrid stroke={INK.grid} />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={grouping === "all" ? [-0.6, 0.6] : [-0.5, scatterColumns.length - 0.5]}
                  ticks={grouping === "all" ? [] : scatterColumns.map((_, i) => i)}
                  tickFormatter={(v: number) => scatterColumns[Math.round(v)] ?? ""}
                  tick={{ fill: INK.secondary, fontSize: 11, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  reversed
                  domain={["dataMin - 0.08", "dataMax + 0.08"]}
                  tickFormatter={(v: number) => formatValue(v)}
                  tick={{ fill: INK.muted, fontSize: 10 }}
                  width={46}
                  axisLine={false}
                  tickLine={false}
                />
                <ZAxis range={[1, 1]} />
                  <Tooltip cursor={false} content={<PlayerDot.Tooltip INK={INK} metric={metric} />} />
                {squadAvg !== null && (
                  <ReferenceLine
                    y={squadAvg}
                    stroke={HIGHLIGHT}
                    strokeDasharray="5 3"
                    label={{ value: `Avg ${formatValue(squadAvg)}`, position: "insideTopRight", fill: HIGHLIGHT, fontSize: 9, fontWeight: 600 }}
                  />
                )}
                <Scatter data={scatter} shape={<PlayerDot />} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Colour carries the tier when ungrouped, so it needs naming. Grouped,
            the x-axis already names each column and the legend would repeat it. */}
        {isBronco && grouping === "all" && scatter.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {BRONCO_TIERS.filter((t) => scatter.some((d) => d.tier === t.label)).map((t) => (
              <span key={t.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
        )}
      </OverviewCard>

      {/* ── Where the squad sits ───────────────────────────────────────────── */}
      <OverviewCard
        title="Where the squad sits"
        subtitle={
          !isBronco || placing === "bands"
            ? "Quartiles of this squad — relative, and it moves as the squad moves"
            : "Against the published bronco benchmarks — absolute"
        }
        interpretation={!isBronco || placing === "bands"
          ? interpretBands(bands, lines, metric)
          : interpretTiers(tiers, lines)}
        action={
          isBronco && <Toggle
            options={[["bands", "Team quartiles"], ["tiers", "Global tiers"]]}
            value={placing}
            onChange={(v) => setPlacing(v as Placing)}
          />
        }
        table={
          <MiniTable
            head={[!isBronco || placing === "bands" ? "Band" : "Tier", "Players", "Names"]}
            rows={(!isBronco || placing === "bands"
              ? bands.map((b) => [b.band.label, b.players] as const)
              : tiers.map((t) => [`${t.tier.label} (${t.tier.displayRange})`, t.players] as const)
            ).map(([label, ls]) => [label, String(ls.length), ls.map((l) => l.player.name).join(", ")])}
          />
        }
      >
        <div className="h-56">
          {withTime.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No {metricName} times recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={!isBronco || placing === "bands"
                  ? bands.map((b) => ({ name: b.band.label, players: b.players.length, color: b.band.color }))
                  : tiers.map((t) => ({ name: t.tier.label, players: t.players.length, color: t.tier.color }))}
                margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 10 }} axisLine={{ stroke: INK.axis }} tickLine={false} interval={0} />
                <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} cursor={{ fill: INK.grid }} formatter={(v: number) => [`${v}`, "Players"]} />
                <Bar dataKey="players" radius={[4, 4, 0, 0]} maxBarSize={54}>
                  {(!isBronco || placing === "bands" ? bands : tiers).map((row, i) => (
                    <Cell key={i} fill={"band" in row ? row.band.color : row.tier.color} />
                  ))}
                  <LabelList dataKey="players" position="top" offset={6} style={{ fill: INK.secondary, fontSize: 11, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>

      {/* ── Compare ────────────────────────────────────────────────────────── */}
      <OverviewCard
        title="Compare players"
        subtitle={`Pick up to ${COMPARE_SLOTS} · every test in scope`}
        interpretation={interpretCompare(pickedLines, metric)}
        table={
          <MiniTable
            head={isBronco ? ["Player", "First", "Latest", "Change", "Tier"] : ["Player", "First", "Latest", "Change"]}
            rows={pickedLines.map((l) => [
              l.player.name,
              l.first ? formatValue(l.first.value) : "—",
              l.latest ? formatValue(l.latest.value) : "—",
              l.deltaSecs === null ? "—" : formatMetricDelta(l.deltaSecs, metric),
              ...(isBronco ? [l.tier?.label ?? "—"] : []),
            ])}
          />
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {withTime.map((l) => {
              const slot = slotOf(l.player.id);
              const isPicked = slot !== -1;
              return (
                <button
                  key={l.player.id}
                  onClick={() => toggleCompare(l.player.id)}
                  className={cn(
                    "px-2.5 h-7 rounded-lg text-xs font-medium border transition-colors",
                    isPicked ? "text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                  style={isPicked ? { borderColor: series(mode, slot), background: `${series(mode, slot)}22` } : undefined}
                  data-testid={`button-compare-${l.player.id}`}
                >
                  {l.player.name}
                </button>
              );
            })}
            {withTime.length === 0 && (
              <p className="text-sm text-muted-foreground">No players with a time to compare</p>
            )}
          </div>

          <div className="h-56">
            {pickedLines.length === 0 || compareSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">
                {pickedLines.length === 0 ? "Pick players above to compare them" : "No shared sessions to plot"}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compareSeries} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="session" tick={{ fill: INK.secondary, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  <YAxis
                    reversed
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatValue(v)}
                    tick={{ fill: INK.muted, fontSize: 10 }}
                    width={46}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip {...tip} formatter={(v: number, name) => [formatValue(v), String(name)]} />
                  {/* Colour follows the slot, not the rank — dropping one player
                      never recolours the others */}
                  {picked.map((line, slot) => line && (
                    <Line
                      key={line.player.id}
                      type="monotone"
                      dataKey={line.player.id}
                      name={line.player.name}
                      stroke={series(mode, slot)}
                      strokeWidth={2}
                      dot={{ r: 3, fill: series(mode, slot), strokeWidth: 0 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {pickedLines.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {picked.map((line, slot) => line && (
                <Link
                  key={line.player.id}
                  href={`/players/${line.player.id}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-[11px] hover:border-indigo-500/40 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: series(mode, slot) }} />
                  <PosBadge pos={line.player.primary_position} />
                  <span className="text-foreground font-medium">{line.player.name}</span>
                  <span className="font-time text-muted-foreground">
                      {line.latest ? formatValue(line.latest.value) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </OverviewCard>

      <p className="text-[11px] text-muted-foreground">
        {metricName} is a time, so lower is faster and every chart here plots it that way — the vertical
        axes are reversed, and up always means faster. A change under {noiseThreshold}s counts as unchanged;
        this prevents small timing differences from being over-read.
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

function Toggle({ options, value, onChange }: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
            value === id
              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
          data-testid={`toggle-${id}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MoverList({ title, lines, tone, metric }: {
  title: string;
  lines: FitnessLine[];
  tone: string;
  metric: FitnessMetric;
}) {
  if (lines.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        {title}
      </div>
      <div className="space-y-0.5">
        {lines.map((l) => (
          <Link
            key={l.player.id}
            href={`/players/${l.player.id}`}
            className="flex items-center gap-2 text-[11px] hover:text-indigo-400 transition-colors"
          >
            <span className="text-foreground truncate flex-1 min-w-0">{l.player.name}</span>
            <span className="font-time text-muted-foreground">
              {formatMetric(l.first!.value, metric)} → {formatMetric(l.latest!.value, metric)}
            </span>
            <span className={cn("font-time font-semibold w-10 text-right", tone)}>
              {formatMetricDelta(l.deltaSecs!, metric)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A player as a circle with their initials — the squad-distribution mark. */
interface DotPayload {
  name: string;
  initials: string;
  color: string;
  tier?: string;
  y: number;
  deltaSecs: number | null;
}

function PlayerDot(props: { cx?: number; cy?: number; payload?: DotPayload }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={14} fill={`${payload.color}28`} stroke={payload.color} strokeWidth={1.5} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={8}
        fontWeight={700}
        fill={payload.color}
      >
        {payload.initials}
      </text>
    </g>
  );
}

PlayerDot.Tooltip = function DotTooltip({ active, payload, INK, metric }: {
  active?: boolean;
  payload?: { payload: DotPayload }[];
  INK: ReturnType<typeof ink>;
  metric: FitnessMetric;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded-lg px-2.5 py-2 text-xs"
      style={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}` }}
    >
      <div className="font-semibold" style={{ color: INK.primary }}>{d.name}</div>
      {d.tier && <div style={{ color: d.color }}>{d.tier}</div>}
      <div className="font-time" style={{ color: INK.secondary }}>{formatMetric(d.y, metric)}</div>
      {d.deltaSecs !== null && (
        <div className="font-time" style={{ color: INK.muted }}>
          {d.deltaSecs > 0
            ? `${formatMetricChangeMagnitude(d.deltaSecs, metric)}s faster`
            : d.deltaSecs < 0
              ? `${formatMetricChangeMagnitude(d.deltaSecs, metric)}s slower`
              : "unchanged"} than first test
        </div>
      )}
    </div>
  );
};
