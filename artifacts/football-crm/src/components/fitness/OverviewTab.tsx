import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatBronco } from "@/lib/utils";
import { useTeam } from "@/context/TeamContext";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { MiniTable, OverviewCard, tooltipStyle } from "@/components/OverviewCard";
import { PosBadge } from "@/components/PosBadge";
import { AGE_ORDER, HIGHLIGHT, POSITION_ORDER, ageColor, ink, posColor, series, type Mode } from "@/lib/viz";
import { fetchAllResults, fetchPlayers, fetchSessions } from "@/lib/queries";
import { BRONCO_TIERS, type Player, type TestResult, type TestSession } from "@/lib/types";
import {
  buildBands, buildFitnessLines, buildGroupBreakdown, buildTeamTrend, buildTierDistribution,
  comparable, interpretBands, interpretCompare, interpretGroups, interpretMovers,
  interpretSquadFitness, interpretTiers, interpretTrend, movers, ranked,
  type FitnessLine,
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

export function OverviewTab() {
  const { team } = useTeam();
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
  const [slots, setSlots] = useState<(string | null)[]>(Array(COMPARE_SLOTS).fill(null));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, ss, ps] = await Promise.all([fetchAllResults(), fetchSessions(), fetchPlayers(team)]);
      setResults(rs as ResultRow[]);
      setSessions(ss);
      setPlayers(ps);
    } catch (err) {
      toast({ title: "Failed to load fitness analytics", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [team, toast]);

  useEffect(() => { load(); }, [load]);

  // Results arrive for every team; the squad in view is what scopes them
  const teamResults = useMemo(() => results.filter((r) => r.players?.team === team), [results, team]);

  const scopedSessions = useMemo(
    () => (pickedSession ? sessions.filter((s) => s.id === pickedSession) : sessions),
    [sessions, pickedSession],
  );

  const lines = useMemo(
    () => buildFitnessLines(players, teamResults, scopedSessions),
    [players, teamResults, scopedSessions],
  );
  const trend = useMemo(
    () => buildTeamTrend(teamResults, scopedSessions),
    [teamResults, scopedSessions],
  );

  const withTime = useMemo(() => ranked(lines), [lines]);
  const moved = useMemo(() => movers(lines), [lines]);
  const latestPoint = trend[trend.length - 1] ?? null;

  /** Group averages sit on one common session, so they compare like with like. */
  const groups = useMemo(
    () => buildGroupBreakdown(
      lines,
      grouping === "age" ? AGE_ORDER : POSITION_ORDER,
      (l) => (grouping === "age" ? l.player.age_range : l.player.primary_position),
      latestPoint?.sessionId ?? null,
    ),
    [lines, grouping, latestPoint],
  );

  const bands = useMemo(() => buildBands(lines, mode), [lines, mode]);
  const tiers = useMemo(() => buildTierDistribution(lines), [lines]);

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
        y: l.latest!.bronco,
        name: l.player.name,
        initials: l.player.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
        color: grouping === "position" ? posColor(mode, column)
          : grouping === "age" ? ageColor(mode, column)
          : l.tier!.color,
        tier: l.tier!.label,
        deltaSecs: l.deltaSecs,
      }));
    });
  }, [withTime, grouping, mode]);

  const scatterColumns = grouping === "position" ? [...POSITION_ORDER]
    : grouping === "age" ? [...AGE_ORDER]
    : ["All"];

  const squadAvg = withTime.length > 0
    ? withTime.reduce((s, l) => s + l.latest!.bronco, 0) / withTime.length
    : null;

  /** Bronco per picked player across the sessions in scope. */
  const compareSeries = useMemo(() => {
    const chronological = [...scopedSessions].sort((a, b) => a.test_date.localeCompare(b.test_date));
    return chronological
      .map((s) => {
        const row: Record<string, string | number | null> = { session: s.test_name };
        for (const line of pickedLines) {
          row[line.player.id] = line.results.find((r) => r.sessionId === s.id)?.bronco ?? null;
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
            {interpretSquadFitness(lines, trend)}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
          <TeamSwitcher />
        </div>
      </div>

      {/* ── Snapshot ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-px bg-border border border-border rounded-2xl overflow-hidden">
        <Stat label="Squad" value={players.length} sub="registered" />
        <Stat label="With a time" value={withTime.length} sub={`of ${players.length}`} />
        <Stat
          label="Avg bronco"
          value={squadAvg ? formatBronco(squadAvg) : "—"}
          sub="latest per player"
        />
        <Stat label="Comparable" value={comparable(lines).length} sub="2+ tests" />
        <Stat label="Improved" value={moved.improved.length} tone="text-status-good" sub={`of ${comparable(lines).length}`} />
        <Stat label="Declined" value={moved.declined.length} tone="text-status-bad" sub={`of ${comparable(lines).length}`} />
      </div>

      {/* ── Trend and movers ───────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <OverviewCard
          title="Team fitness trend"
          subtitle="Squad average bronco per session, oldest first"
          className="lg:col-span-2"
          interpretation={interpretTrend(trend)}
          table={
            <MiniTable
              head={["Session", "Tested", "Avg bronco"]}
              rows={trend.map((p) => [p.name, String(p.tested), formatBronco(p.avgBronco)])}
            />
          }
        >
          <div className="h-56">
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No bronco times recorded</p>
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
                    tickFormatter={(v: number) => formatBronco(v)}
                    tick={{ fill: INK.muted, fontSize: 10 }}
                    width={46}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tip}
                    formatter={(v: number, _n, item) =>
                      [`${formatBronco(v)} · ${(item?.payload as { tested: number })?.tested} tested`, "Squad average"]}
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
          interpretation={interpretMovers(lines)}
          table={
            <MiniTable
              head={["Player", "First", "Latest", "Change"]}
              rows={[...moved.improved, ...moved.declined].map((l) => [
                l.player.name,
                formatBronco(l.first!.bronco),
                formatBronco(l.latest!.bronco),
                `${l.deltaSecs! > 0 ? "−" : "+"}${Math.abs(l.deltaSecs!)}s`,
              ])}
            />
          }
        >
          <div className="h-56 overflow-y-auto space-y-3">
            {comparable(lines).length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">Nobody has two tests yet</p>
            ) : (
              <>
                <MoverList title="Faster" lines={moved.improved} tone="text-status-good" sign="−" />
                <MoverList title="Slower" lines={moved.declined} tone="text-status-bad" sign="+" />
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
            ? "Every player with a time · lower is faster · coloured by benchmark tier"
            : `Grouped by ${grouping}${groups.sessionName ? ` · measured on ${groups.sessionName}` : ""}`
        }
        interpretation={grouping === "all" ? interpretBands(bands, lines) : interpretGroups(groups, grouping)}
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
                head={["Player", "Bronco", "Tier"]}
                rows={withTime.map((l) => [l.player.name, formatBronco(l.latest!.bronco), l.tier!.label])}
              />
            ) : (
              <MiniTable
                head={["Group", "Tested", "Avg bronco", "Faster", "Slower"]}
                rows={groups.groups.map((g) => [
                  g.group, String(g.tested), formatBronco(g.avgBronco), String(g.improved), String(g.declined),
                ])}
              />
            )
        }
      >
        <div className={grouping === "all" ? "h-72" : "h-80"}>
          {scatter.length === 0 ? (
            <p className="text-sm text-muted-foreground py-24 text-center">No bronco times recorded</p>
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
                  tickFormatter={(v: number) => formatBronco(v)}
                  tick={{ fill: INK.muted, fontSize: 10 }}
                  width={46}
                  axisLine={false}
                  tickLine={false}
                />
                <ZAxis range={[1, 1]} />
                <Tooltip cursor={false} content={<PlayerDot.Tooltip INK={INK} />} />
                {squadAvg !== null && (
                  <ReferenceLine
                    y={squadAvg}
                    stroke={HIGHLIGHT}
                    strokeDasharray="5 3"
                    label={{ value: `Avg ${formatBronco(squadAvg)}`, position: "insideTopRight", fill: HIGHLIGHT, fontSize: 9, fontWeight: 600 }}
                  />
                )}
                <Scatter data={scatter} shape={<PlayerDot />} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Colour carries the tier when ungrouped, so it needs naming. Grouped,
            the x-axis already names each column and the legend would repeat it. */}
        {grouping === "all" && scatter.length > 0 && (
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
          placing === "bands"
            ? "Quartiles of this squad — relative, and it moves as the squad moves"
            : "Against the published bronco benchmarks — absolute"
        }
        interpretation={placing === "bands" ? interpretBands(bands, lines) : interpretTiers(tiers, lines)}
        action={
          <Toggle
            options={[["bands", "Team quartiles"], ["tiers", "Global tiers"]]}
            value={placing}
            onChange={(v) => setPlacing(v as Placing)}
          />
        }
        table={
          <MiniTable
            head={[placing === "bands" ? "Band" : "Tier", "Players", "Names"]}
            rows={(placing === "bands"
              ? bands.map((b) => [b.band.label, b.players] as const)
              : tiers.map((t) => [`${t.tier.label} (${t.tier.displayRange})`, t.players] as const)
            ).map(([label, ls]) => [label, String(ls.length), ls.map((l) => l.player.name).join(", ")])}
          />
        }
      >
        <div className="h-56">
          {withTime.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No bronco times recorded</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={placing === "bands"
                  ? bands.map((b) => ({ name: b.band.label, players: b.players.length, color: b.band.color }))
                  : tiers.map((t) => ({ name: t.tier.label, players: t.players.length, color: t.tier.color }))}
                margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 10 }} axisLine={{ stroke: INK.axis }} tickLine={false} interval={0} />
                <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} cursor={{ fill: INK.grid }} formatter={(v: number) => [`${v}`, "Players"]} />
                <Bar dataKey="players" radius={[4, 4, 0, 0]} maxBarSize={54}>
                  {(placing === "bands" ? bands : tiers).map((row, i) => (
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
        interpretation={interpretCompare(pickedLines)}
        table={
          <MiniTable
            head={["Player", "First", "Latest", "Change", "Tier"]}
            rows={pickedLines.map((l) => [
              l.player.name,
              l.first ? formatBronco(l.first.bronco) : "—",
              l.latest ? formatBronco(l.latest.bronco) : "—",
              l.deltaSecs === null ? "—" : `${l.deltaSecs > 0 ? "−" : "+"}${Math.abs(l.deltaSecs)}s`,
              l.tier?.label ?? "—",
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
                    tickFormatter={(v: number) => formatBronco(v)}
                    tick={{ fill: INK.muted, fontSize: 10 }}
                    width={46}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip {...tip} formatter={(v: number, name) => [formatBronco(v), String(name)]} />
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
                    {line.latest ? formatBronco(line.latest.bronco) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </OverviewCard>

      <p className="text-[11px] text-muted-foreground">
        Bronco is a time, so lower is faster and every chart here plots it that way — the vertical
        axes are reversed, and up always means fitter. A change under 3 seconds counts as unchanged;
        across a five-minute effort that is timing noise rather than fitness.
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

function MoverList({ title, lines, tone, sign }: {
  title: string;
  lines: FitnessLine[];
  tone: string;
  sign: string;
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
              {formatBronco(l.first!.bronco)} → {formatBronco(l.latest!.bronco)}
            </span>
            <span className={cn("font-time font-semibold w-10 text-right", tone)}>
              {sign}{Math.abs(l.deltaSecs!)}s
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
  tier: string;
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

PlayerDot.Tooltip = function DotTooltip({ active, payload, INK }: {
  active?: boolean;
  payload?: { payload: DotPayload }[];
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
      <div style={{ color: d.color }}>{d.tier}</div>
      <div className="font-time" style={{ color: INK.secondary }}>{formatBronco(d.y)}</div>
      {d.deltaSecs !== null && (
        <div className="font-time" style={{ color: INK.muted }}>
          {d.deltaSecs > 0 ? `${d.deltaSecs}s faster` : d.deltaSecs < 0 ? `${Math.abs(d.deltaSecs)}s slower` : "unchanged"} than first test
        </div>
      )}
    </div>
  );
};
