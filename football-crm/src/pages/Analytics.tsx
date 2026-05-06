import { useEffect, useState, useCallback, useMemo } from "react";
import { useTeam } from "@/context/TeamContext";
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { ChartSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { formatBroncho } from "@/lib/utils";
import { getBronchoTier, BRONCHO_TIERS, type Player, type TestResult, type TestSession } from "@/lib/types";
import { fetchAllResults, fetchSessions, fetchPlayers } from "@/lib/queries";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
  AreaChart, Area,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";

// ── Position helpers ───────────────────────────────────────────────────────
const POS_CFG: Record<string, { label: string; color: string; tailwindText: string; tailwindBg: string }> = {
  Forward:    { label: "FW", color: "#f87171", tailwindText: "text-red-400",    tailwindBg: "bg-red-400/15"    },
  Midfielder: { label: "MF", color: "#60a5fa", tailwindText: "text-blue-400",   tailwindBg: "bg-blue-400/15"   },
  Defender:   { label: "DF", color: "#818cf8", tailwindText: "text-indigo-400", tailwindBg: "bg-indigo-400/15" },
  Goalkeeper: { label: "GK", color: "#fbbf24", tailwindText: "text-amber-400",  tailwindBg: "bg-amber-400/15"  },
};
function getPos(pos: string | null) { return POS_CFG[pos ?? ""] ?? { label: pos ?? "?", color: "#9ca3af", tailwindText: "text-slate-400", tailwindBg: "bg-slate-400/15" }; }

function PosBadge({ pos }: { pos: string | null }) {
  const cfg = getPos(pos);
  return (
    <span className={cn("inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold font-time", cfg.tailwindText, cfg.tailwindBg)}>
      {cfg.label}
    </span>
  );
}

// ── Change badge ───────────────────────────────────────────────────────────
function ChangeBadge({ diffSecs }: { diffSecs: number | null }) {
  if (diffSecs === null) return <span className="text-xs text-muted-foreground font-time">—</span>;
  if (Math.abs(diffSecs) <= 3) return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-time bg-amber-400/15 text-amber-400">—</span>;
  if (diffSecs > 0) return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-time bg-emerald-400/15 text-emerald-400">− {diffSecs}s</span>;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-time bg-red-400/15 text-red-400">+ {Math.abs(diffSecs)}s</span>;
}

// ── Tier badge (broncho-based) ─────────────────────────────────────────────
function TierBadge({ bronco }: { bronco: number | null }) {
  if (bronco === null) return <span className="text-xs text-muted-foreground">—</span>;
  const t = getBronchoTier(bronco);
  return <span className="text-xs font-medium" style={{ color: t.color }}>{t.label}</span>;
}

// ── Bar row (CSS-based, no Recharts) ──────────────────────────────────────
function BarRow({ name, bronco, maxBronco, color, prefix }: { name: string; bronco: number; maxBronco: number; color: string; prefix?: React.ReactNode }) {
  const pct = Math.min(100, (bronco / maxBronco) * 100);
  return (
    <div className="flex items-center gap-2.5 py-1">
      <div className="min-w-[120px] text-xs text-foreground flex items-center gap-1.5">{prefix}{name}</div>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="min-w-[38px] text-right text-[11px] font-time text-muted-foreground">{formatBroncho(bronco)}</div>
    </div>
  );
}

// ── Metric strip ──────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, valueColor }: { label: string; value: string | number; sub?: string; valueColor?: string }) {
  return (
    <div className="py-4 px-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</div>
      <div className={cn("text-2xl font-bold font-time leading-none", valueColor ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

// ── Benchmark tier strip (broncho-based) ──────────────────────────────────
function TierStrip({ players: ps }: { players: { player: Player; bronco: number | null }[] }) {
  return (
    <div className="space-y-1">
      {BRONCHO_TIERS.map((t) => {
        const inTier = ps.filter((x) => x.bronco !== null && x.bronco >= t.minMins && x.bronco < t.maxMins);
        return (
          <div key={t.label}>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border" style={{ backgroundColor: t.color + "12", borderColor: t.color + "30" }}>
              <span className="text-xs font-semibold min-w-[130px]" style={{ color: t.color }}>{t.label}</span>
              <span className="text-[11px] font-time text-muted-foreground min-w-[80px]">{t.displayRange}</span>
              <span className="text-[11px] text-muted-foreground flex-1 hidden sm:block">{t.description}</span>
              <span className="ml-auto text-sm font-bold font-time" style={{ color: t.color }}>{inTier.length}</span>
            </div>
            {inTier.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {inTier.map(({ player, bronco }) => (
                  <div key={player.id} title={`${player.name} · ${formatBroncho(bronco)}`}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold font-time cursor-default"
                    style={{ backgroundColor: t.color + "22", color: t.color, border: `1px solid ${t.color}44` }}>
                    {player.name.slice(0, 2).toUpperCase()}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────
interface EnrichedResult extends TestResult {
  players?: Pick<Player, "name" | "code" | "team" | "primary_position" | "age_range">;
  test_sessions?: Pick<TestSession, "test_date" | "test_name" | "type">;
}

const TABS = ["overview", "compare", "bands", "benchmarks", "position", "age"] as const;
type TabId = typeof TABS[number];
const TAB_LABELS: Record<TabId, string> = {
  overview:   "Overview",
  compare:    "Compare",
  bands:      "Team Bands",
  benchmarks: "Global Benchmarks",
  position:   "By Position",
  age:        "By Age Group",
};

// ── Main component ────────────────────────────────────────────────────────
export default function Analytics() {
  const { team } = useTeam();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [tab, setTab] = useState<TabId>("overview");
  const [results, setResults] = useState<EnrichedResult[]>([]);
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [rankGroup, setRankGroup] = useState<"all" | "position" | "age">("all");
  const [ovSessionIds, setOvSessionIds] = useState<string[] | null>(null); // null = all
  const [ovDropdownOpen, setOvDropdownOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, ss, ps] = await Promise.all([fetchAllResults(), fetchSessions(), fetchPlayers(team)]);
      setResults(rs as EnrichedResult[]);
      setSessions(ss);
      setPlayers(ps);
    } finally { setLoading(false); }
  }, [team]);

  useEffect(() => { load(); }, [load]);

  const teamResults = useMemo(() => results.filter((r) => r.players?.team === team), [results, team]);

  // Distinct non-null session types, sorted
  const availableTypes = useMemo(() => {
    const types = Array.from(new Set(sessions.map((s) => s.type).filter(Boolean) as string[])).sort();
    return types;
  }, [sessions]);

  // Reset typeFilter if it no longer exists in current sessions
  const validTypeFilter = availableTypes.includes(typeFilter) ? typeFilter : "all";

  // All sessions chronologically, filtered by type when one is selected
  const chronoSessions = useMemo(() => {
    const sorted = [...sessions].reverse();
    return validTypeFilter === "all" ? sorted : sorted.filter((s) => s.type === validTypeFilter);
  }, [sessions, validTypeFilter]);

  // Further filtered by the user's session selection (null = all)
  const effectiveSessions = useMemo(() => {
    if (!ovSessionIds) return chronoSessions;
    return chronoSessions.filter((s) => ovSessionIds.includes(s.id));
  }, [chronoSessions, ovSessionIds]);

  // Per-player: first & latest bronco
  const playerComparisons = useMemo(() => {
    return players.map((p) => {
      const pResults = effectiveSessions
        .map((s) => {
          const r = teamResults.find((r) => r.player_id === p.id && r.session_id === s.id && r.bronco_mins !== null);
          return r ? { date: s.test_date, sessionName: s.test_name, bronco_mins: r.bronco_mins!, mas_ms: r.mas_ms } : null;
        })
        .filter(Boolean) as { date: string; sessionName: string; bronco_mins: number; mas_ms: number | null }[];

      const first = pResults[0] ?? null;
      const latest = pResults[pResults.length - 1] ?? null;
      const diffSecs = first && latest && first !== latest
        ? Math.round((first.bronco_mins - latest.bronco_mins) * 60)
        : null;
      return { player: p, first, latest, diffSecs, pResults };
    });
  }, [players, teamResults, effectiveSessions]);

  // Benchmark data — broncho-based (lower = better/faster)
  const benchmarkData = useMemo(() => {
    return playerComparisons
      .map(({ player, latest }) => ({ player, bronco: latest?.bronco_mins ?? null }))
      .filter((x) => x.bronco !== null)
      .sort((a, b) => a.bronco! - b.bronco!); // ascending: best (fastest) first
  }, [playerComparisons]);

  // Team band lookup from quartiles
  const getTeamBand = useMemo(() => {
    const vals = benchmarkData.map((d) => d.bronco!);
    const calcQ = (arr: number[], p: number) => {
      if (arr.length === 0) return null;
      const idx = (p / 100) * (arr.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return arr[lo] + (idx - lo) * ((arr[hi] ?? arr[lo]) - arr[lo]);
    };
    const q1 = calcQ(vals, 25), q2 = calcQ(vals, 50), q3 = calcQ(vals, 75);
    return (bronco: number | null): { label: string; color: string } | null => {
      if (bronco === null || q1 === null || q2 === null || q3 === null) return null;
      if (bronco <= q1) return { label: "Top 25%",    color: "#34d399" };
      if (bronco <= q2) return { label: "Upper Mid",  color: "#60a5fa" };
      if (bronco <= q3) return { label: "Lower Mid",  color: "#fbbf24" };
      return                    { label: "Bottom 25%", color: "#f87171" };
    };
  }, [benchmarkData]);

  // Overview: per-player change sorted best → worst
  const changeData = useMemo(() => {
    return playerComparisons
      .filter((x) => x.diffSecs !== null)
      .sort((a, b) => b.diffSecs! - a.diffSecs!)
      .map(({ player, diffSecs, first, latest }) => ({
        name: player.name,
        diff: parseFloat(((first!.bronco_mins - latest!.bronco_mins)).toFixed(3)),
        diffSecs: diffSecs!,
        firstBronco: first!.bronco_mins,
        latestBronco: latest!.bronco_mins,
      }));
  }, [playerComparisons]);

  // Session avg over time
  const avgOverTime = useMemo(() => {
    return effectiveSessions.map((s) => {
      const srs = teamResults.filter((r) => r.session_id === s.id && r.bronco_mins !== null);
      const avg = srs.length ? srs.reduce((a, r) => a + r.bronco_mins!, 0) / srs.length : null;
      return { name: s.test_name, avg };
    }).filter((x) => x.avg !== null);
  }, [effectiveSessions, teamResults]);

  // Metric strip values — based on effective sessions
  const latestSession = effectiveSessions.length > 0 ? effectiveSessions[effectiveSessions.length - 1] : null;
  const latestResults = teamResults.filter((r) => r.session_id === latestSession?.id && r.bronco_mins !== null);
  const latestAvg = latestResults.length ? latestResults.reduce((a, r) => a + r.bronco_mins!, 0) / latestResults.length : null;
  const comparable = playerComparisons.filter((x) => x.diffSecs !== null);
  const improved = comparable.filter((x) => x.diffSecs! > 3).length;
  const declined = comparable.filter((x) => x.diffSecs! < -3).length;

  // Position data
  const positions = useMemo(() => ["Forward", "Midfielder", "Defender", "Goalkeeper"], []);
  const ageRanges = useMemo(() => ["U18", "18-24", "25+"], []);

  const chartGrid = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
  const chartAxis = isDark ? "#6b7280" : "#9ca3af";
  const chartTooltipBg = isDark ? "#0f172a" : "#ffffff";
  const chartTooltipBorder = isDark ? "#1e293b" : "#e2e8f0";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Analytics <span className="text-indigo-500 dark:text-indigo-400">— {team}</span>
          </h1>
          {latestSession && (
            <p className="text-sm text-muted-foreground mt-0.5">Latest: {latestSession.test_name} · {latestSession.test_date}</p>
          )}
        </div>
        <TeamSwitcher />
      </div>

      {/* Filters row */}
      {chronoSessions.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5">
          {/* Session multi-select dropdown */}
          {chronoSessions.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setOvDropdownOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-colors border",
                  ovSessionIds
                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                    : "text-muted-foreground border-border hover:text-foreground"
                )}
              >
                <span>
                  {!ovSessionIds
                    ? "All sessions"
                    : ovSessionIds.length === 1
                    ? chronoSessions.find((s) => s.id === ovSessionIds[0])?.test_name ?? "1 session"
                    : `${ovSessionIds.length} sessions`}
                </span>
                <span className="opacity-50">▾</span>
              </button>

              {ovDropdownOpen && (
                <>
                  {/* backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setOvDropdownOpen(false)} />
                  <div className="absolute left-0 top-full mt-1.5 z-20 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[220px]">
                    {/* All option */}
                    <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!ovSessionIds}
                        onChange={() => setOvSessionIds(null)}
                        className="accent-indigo-500"
                      />
                      <span className="text-xs font-medium text-foreground">All sessions</span>
                    </label>
                    <div className="border-t border-border my-1" />
                    {chronoSessions.map((s) => {
                      const checked = !ovSessionIds || ovSessionIds.includes(s.id);
                      return (
                        <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const current = ovSessionIds ?? chronoSessions.map((x) => x.id);
                              const next = current.includes(s.id)
                                ? current.filter((id) => id !== s.id)
                                : [...current, s.id];
                              setOvSessionIds(next.length === chronoSessions.length ? null : next.length === 0 ? [s.id] : next);
                            }}
                            className="accent-indigo-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-foreground truncate">{s.test_name}</div>
                            <div className="text-[10px] text-muted-foreground">{s.test_date}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metric strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 border border-border rounded-2xl overflow-hidden divide-x divide-border mb-5 bg-card">
        <MetricCard label="Squad" value={players.length} sub="registered" />
        <MetricCard label="Latest test" value={latestResults.length} sub={latestSession?.test_name ?? "—"} />
        <MetricCard label="Avg broncho" value={formatBroncho(latestAvg)} sub="latest session" />
        <MetricCard label="Comparable" value={comparable.length} sub="2+ sessions" />
        <MetricCard label="Improved" value={improved} sub={`of ${comparable.length}`} valueColor="text-emerald-400" />
        <MetricCard label="Declined" value={declined} sub={`of ${comparable.length}`} valueColor="text-red-400" />
      </div>

      {/* Underline tabs */}
      <div className="border-b border-border mb-5">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              data-testid={`tab-${id}`}
              className={cn(
                "px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                tab === id
                  ? "border-indigo-500 text-indigo-500 dark:border-indigo-400 dark:text-indigo-400 font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {TAB_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────── */}
      {tab === "overview" && (() => {
        const TARGET_MINS = 5 + 6 / 60;
        const tested = benchmarkData;
        const aboveTarget = tested.filter((d) => d.bronco! < TARGET_MINS).length;
        const notTested = players.length - tested.length;

        const trendDelta = avgOverTime.length >= 2
          ? Math.round((avgOverTime[0].avg! - avgOverTime[avgOverTime.length - 1].avg!) * 60)
          : null;

        const withChange = playerComparisons.filter((x) => x.diffSecs !== null && x.first !== null && x.latest !== null);
        const mostImproved = [...withChange].sort((a, b) => b.diffSecs! - a.diffSecs!).slice(0, 5);
        const watchList = [...withChange].sort((a, b) => a.diffSecs! - b.diffSecs!).slice(0, 5);

        return (
          <div className="space-y-4">

            {/* ── Squad health ── */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Squad health</div>
                  {loading ? (
                    <div className="h-8 w-48 bg-muted rounded animate-pulse" />
                  ) : (
                    <div className="text-2xl font-bold text-foreground">
                      <span className="text-emerald-400">{aboveTarget}</span>
                      <span className="text-muted-foreground font-normal text-lg"> of {players.length} at target</span>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-0.5">Target: Good tier or better (under 5:06)</p>
                </div>
                {!loading && trendDelta !== null && (
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold font-time",
                    trendDelta > 3 ? "bg-emerald-400/10 text-emerald-400" :
                    trendDelta < -3 ? "bg-red-400/10 text-red-400" :
                    "bg-amber-400/10 text-amber-400"
                  )}>
                    {trendDelta > 3 ? "−" : trendDelta < -3 ? "+" : "—"}
                    {" "}{Math.abs(trendDelta)}s avg since first session
                  </div>
                )}
              </div>

              {/* Stacked tier bar */}
              {!loading && players.length > 0 && (
                <>
                  <div className="flex h-3 rounded-full overflow-hidden mb-3">
                    {BRONCHO_TIERS.map((t) => {
                      const count = tested.filter((d) => d.bronco! >= t.minMins && d.bronco! < t.maxMins).length;
                      const pct = (count / players.length) * 100;
                      return pct > 0 ? (
                        <div key={t.label} title={`${t.label}: ${count}`} style={{ width: `${pct}%`, background: t.color }} />
                      ) : null;
                    })}
                    {notTested > 0 && (
                      <div style={{ width: `${(notTested / players.length) * 100}%` }}
                        className="bg-muted-foreground/20" title={`Not tested: ${notTested}`} />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {BRONCHO_TIERS.map((t) => {
                      const count = tested.filter((d) => d.bronco! >= t.minMins && d.bronco! < t.maxMins).length;
                      if (!count) return null;
                      return (
                        <div key={t.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
                          <span style={{ color: t.color }} className="font-medium">{count}</span>
                          <span>{t.label}</span>
                        </div>
                      );
                    })}
                    {notTested > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground/30 flex-shrink-0" />
                        <span className="font-medium">{notTested}</span>
                        <span>Not tested</span>
                      </div>
                    )}
                  </div>
                </>
              )}
              {loading && <ChartSkeleton height={48} />}
            </div>

            {/* ── Fitness trend + Movers ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Fitness trend */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Team fitness trend</div>
                <p className="text-[11px] text-muted-foreground mb-4">Avg broncho across sessions · lower = faster</p>
                {loading ? <ChartSkeleton height={200} /> : avgOverTime.length < 2 ? (
                  <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">Need 2+ sessions to show trend</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={avgOverTime} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                      <XAxis dataKey="name" tick={{ fill: chartAxis, fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => formatBroncho(v)} domain={["auto", "auto"]} tick={{ fill: chartAxis, fontSize: 10 }} width={46} />
                      <Tooltip
                        contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                        formatter={(v: number) => [formatBroncho(v), "Team avg"]}
                      />
                      <Area type="monotone" dataKey="avg" stroke="#6366f1" strokeWidth={2} fill="url(#trendGrad)" dot={{ fill: "#6366f1", r: 3 }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Most improved + Watch list */}
              <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-5">
                {/* Most improved */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Most improved</div>
                  {loading ? <ChartSkeleton height={100} /> : mostImproved.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No comparable data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {mostImproved.map(({ player, diffSecs, first, latest }) => (
                        <div key={player.id} className="flex items-center gap-2.5">
                          <PosBadge pos={player.primary_position} />
                          <span className="text-sm text-foreground flex-1 truncate">{player.name}</span>
                          <span className="text-[11px] font-time text-muted-foreground">{formatBroncho(first!.bronco_mins)} → {formatBroncho(latest!.bronco_mins)}</span>
                          <ChangeBadge diffSecs={diffSecs} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-border" />

                {/* Watch list */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Watch list</div>
                  {loading ? <ChartSkeleton height={100} /> : watchList.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No comparable data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {watchList.map(({ player, diffSecs, first, latest }) => (
                        <div key={player.id} className="flex items-center gap-2.5">
                          <PosBadge pos={player.primary_position} />
                          <span className="text-sm text-foreground flex-1 truncate">{player.name}</span>
                          <span className="text-[11px] font-time text-muted-foreground">{formatBroncho(first!.bronco_mins)} → {formatBroncho(latest!.bronco_mins)}</span>
                          <ChangeBadge diffSecs={diffSecs} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Players table ── */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 flex-wrap px-5 pt-5 pb-4 border-b border-border">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">All players</div>
                <div className="flex items-center gap-3 flex-wrap">
                  <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}
                    className="bg-transparent border border-border rounded-lg text-xs px-2.5 py-1.5 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500/50">
                    <option value="all">All positions</option>
                    {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}
                    className="bg-transparent border border-border rounded-lg text-xs px-2.5 py-1.5 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500/50">
                    <option value="all">All ages</option>
                    {ageRanges.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="players-analytics-table">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-8"></th>
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Player</th>
                      <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Group</th>
                      <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">First</th>
                      <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Latest</th>
                      <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Band</th>
                      <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
                    ) : playerComparisons
                      .filter((x) => (posFilter === "all" || x.player.primary_position === posFilter) && (ageFilter === "all" || x.player.age_range === ageFilter))
                      .map(({ player, first, latest, diffSecs }) => (
                        <tr key={player.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5"><PosBadge pos={player.primary_position} /></td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{player.name}</td>
                          <td className="px-4 py-2.5">
                            {player.age_range
                              ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-time">{player.age_range}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-time text-muted-foreground">{first ? formatBroncho(first.bronco_mins) : <span className="text-muted-foreground/50">—</span>}</td>
                          <td className="px-4 py-2.5 text-right font-time text-foreground">{latest ? formatBroncho(latest.bronco_mins) : <span className="text-muted-foreground/50">—</span>}</td>
                          <td className="px-4 py-2.5 text-right">{(() => { const b = getTeamBand(latest?.bronco_mins ?? null); return b ? <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: b.color + "20", color: b.color }}>{b.label}</span> : <span className="text-muted-foreground/50">—</span>; })()}</td>
                          <td className="px-4 py-2.5 text-right"><ChangeBadge diffSecs={diffSecs} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        );
      })()}

      {/* ── BENCHMARKS ───────────────────────────────────────────── */}
      {tab === "benchmarks" && (
        <div className="space-y-4">
          {/* Tier distribution FIRST */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Tier distribution — {team} squad</div>
            <p className="text-[11px] text-muted-foreground mb-4">Female athlete benchmarks · lower time = better</p>
            {loading ? <ChartSkeleton /> : benchmarkData.length === 0 ? (
              <EmptyState title="No broncho data yet" description="Record fitness test sessions to see tier distribution" />
            ) : (
              <TierStrip players={benchmarkData} />
            )}
          </div>

          {/* Player vs benchmark bar chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Player broncho time vs benchmarks</div>
            <p className="text-[11px] text-muted-foreground mb-4">Latest session · reference lines mark tier boundaries · lower = faster</p>
            {loading ? <ChartSkeleton height={320} /> : benchmarkData.length === 0 ? (
              <EmptyState title="No broncho data" description="Broncho times will appear after fitness tests are recorded" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, benchmarkData.length * 26 + 80)}>
                <BarChart
                  data={benchmarkData.map((d) => ({ name: d.player.name, bronco: d.bronco, tier: getBronchoTier(d.bronco!).label }))}
                  layout="vertical"
                  margin={{ top: 4, right: 60, bottom: 4, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[4.0, 6.0]}
                    tick={{ fill: chartAxis, fontSize: 10 }}
                    tickCount={9}
                    tickFormatter={(v: number) => {
                      const m = Math.floor(v);
                      const s = Math.round((v - m) * 60);
                      return `${m}:${s.toString().padStart(2, "0")}`;
                    }}
                  />
                  <YAxis type="category" dataKey="name" tick={{ fill: chartAxis, fontSize: 11 }} width={95} />
                  {BRONCHO_TIERS.filter((t) => t.minMins > 4.0 && t.minMins < 6.0).map((t) => (
                    <ReferenceLine key={t.minMins} x={t.minMins} stroke={t.color + "66"} strokeDasharray="4 3" label={{ value: t.label, position: "insideTopRight", fill: t.color, fontSize: 9 }} />
                  ))}
                  <Tooltip
                    contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                    labelStyle={{ color: isDark ? "#f1f5f9" : "#0f172a", fontSize: 12, fontWeight: 600 }}
                    formatter={(v: number, _: string, props) => [`${formatBroncho(v)} — ${props.payload.tier}`, ""]}
                  />
                  <Bar dataKey="bronco" radius={[0, 3, 3, 0]} minPointSize={2}>
                    {benchmarkData.map((entry, i) => (
                      <Cell key={i} fill={getBronchoTier(entry.bronco!).color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── BY POSITION ──────────────────────────────────────────── */}
      {tab === "position" && (
        <div className="space-y-4">
          {/* Position avg chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Avg broncho by position (latest session)</div>
            {loading ? <ChartSkeleton height={200} /> : (() => {
              const data = positions.map((pos) => {
                const prs = latestResults.filter((r) => r.players?.primary_position === pos && r.bronco_mins !== null);
                const avg = prs.length ? prs.reduce((a, r) => a + r.bronco_mins!, 0) / prs.length : null;
                return { pos, avg, color: getPos(pos).color };
              }).filter((x) => x.avg !== null);
              if (!data.length) return <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No data for latest session</div>;
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="pos" tick={{ fill: chartAxis, fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatBroncho(v)} domain={["auto", "auto"]} tick={{ fill: chartAxis, fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }} formatter={(v: number) => [formatBroncho(v), "Avg Broncho"]} />
                    <Bar dataKey="avg" radius={[3, 3, 0, 0]} minPointSize={2}>
                      {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Per-position cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {positions.map((pos) => {
              const cfg = getPos(pos);
              const inPos = playerComparisons.filter((x) => x.player.primary_position === pos);
              const withLatest = inPos.filter((x) => x.latest !== null);
              const avgLatest = withLatest.length ? withLatest.reduce((a, x) => a + x.latest!.bronco_mins, 0) / withLatest.length : null;
              const maxBronco = Math.max(...withLatest.map((x) => x.latest!.bronco_mins), 8);
              if (!inPos.length) return null;
              return (
                <div key={pos} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <PosBadge pos={pos} />
                    <span className="font-semibold text-foreground">{pos}s</span>
                    <span className="ml-auto text-xs text-muted-foreground">{inPos.length} players</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Avg Latest</div>
                      <div className="text-xl font-bold font-time" style={{ color: cfg.color }}>{avgLatest ? formatBroncho(avgLatest) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Tested</div>
                      <div className="text-xl font-bold font-time text-foreground">{withLatest.length}</div>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {withLatest
                      .sort((a, b) => a.latest!.bronco_mins - b.latest!.bronco_mins)
                      .map(({ player, latest, diffSecs }) => (
                        <BarRow
                          key={player.id}
                          name={player.name}
                          bronco={latest!.bronco_mins}
                          maxBronco={maxBronco}
                          color={cfg.color}
                          prefix={diffSecs !== null && diffSecs > 3 ? <span className="text-emerald-400 text-[10px]">−</span> : diffSecs !== null && diffSecs < -3 ? <span className="text-red-400 text-[10px]">+</span> : undefined}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BY AGE ────────────────────────────────────────────────── */}
      {tab === "age" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Avg broncho by age group (latest session)</div>
            {loading ? <ChartSkeleton height={200} /> : (() => {
              const AGE_COLORS: Record<string, string> = { "U18": "#f87171", "18-24": "#60a5fa", "25+": "#34d399" };
              const data = ageRanges.map((r) => {
                const prs = latestResults.filter((x) => x.players?.age_range === r && x.bronco_mins !== null);
                const avg = prs.length ? prs.reduce((a, x) => a + x.bronco_mins!, 0) / prs.length : null;
                return { range: r, avg, color: AGE_COLORS[r] };
              }).filter((x) => x.avg !== null);
              if (!data.length) return <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No data for latest session</div>;
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                    <XAxis dataKey="range" tick={{ fill: chartAxis, fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatBroncho(v)} domain={["auto", "auto"]} tick={{ fill: chartAxis, fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }} formatter={(v: number) => [formatBroncho(v), "Avg Broncho"]} />
                    <Bar dataKey="avg" radius={[3, 3, 0, 0]} minPointSize={2}>
                      {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Per-age-group cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {ageRanges.map((range) => {
              const AGE_COLORS: Record<string, string> = { "U18": "#f87171", "18-24": "#60a5fa", "25+": "#34d399" };
              const color = AGE_COLORS[range] ?? "#818cf8";
              const inRange = playerComparisons.filter((x) => x.player.age_range === range);
              const withLatest = inRange.filter((x) => x.latest !== null);
              const comparable2 = inRange.filter((x) => x.diffSecs !== null);
              const improvedInRange = comparable2.filter((x) => x.diffSecs! > 3).length;
              const avgLatest = withLatest.length ? withLatest.reduce((a, x) => a + x.latest!.bronco_mins, 0) / withLatest.length : null;
              const maxBronco = Math.max(...withLatest.map((x) => x.latest!.bronco_mins), 8);
              if (!inRange.length) return null;
              return (
                <div key={range} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg font-bold" style={{ color }}>{range}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{inRange.length} players</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Avg</div>
                      <div className="text-lg font-bold font-time" style={{ color }}>{avgLatest ? formatBroncho(avgLatest) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Tested</div>
                      <div className="text-lg font-bold font-time text-foreground">{withLatest.length}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Improved</div>
                      <div className="text-lg font-bold font-time text-emerald-400">{improvedInRange}</div>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {withLatest
                      .sort((a, b) => a.latest!.bronco_mins - b.latest!.bronco_mins)
                      .map(({ player, latest, diffSecs }) => (
                        <BarRow
                          key={player.id}
                          name={player.name}
                          bronco={latest!.bronco_mins}
                          maxBronco={maxBronco}
                          color={color}
                          prefix={diffSecs !== null && diffSecs > 3 ? <span className="text-emerald-400 text-[10px]">−</span> : diffSecs !== null && diffSecs < -3 ? <span className="text-red-400 text-[10px]">+</span> : undefined}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── COMPARE ──────────────────────────────────────────────── */}
      {tab === "compare" && (() => {
        // Build percentile data: rank by latest bronco_mins ascending (lower = better)
        const ranked = benchmarkData
          .map((d, i, arr) => ({
            ...d,
            rank: i + 1,
            percentile: Math.round((1 - i / Math.max(arr.length - 1, 1)) * 100),
          }));

        // Players with any bronco result (for picker)
        const pickable = playerComparisons.filter((x) => x.latest !== null);

        const togglePlayer = (id: string) => {
          setCompareIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev
          );
        };

        const selected = compareIds
          .map((id) => playerComparisons.find((x) => x.player.id === id))
          .filter(Boolean) as typeof playerComparisons;

        // Palette for selected players
        const COMPARE_COLORS = ["#818cf8", "#34d399", "#f87171", "#fbbf24", "#60a5fa"];

        // For chart: all sessions chronologically, with bronco per selected player
        const sessionLabels = chronoSessions.map((s) => s.test_name);
        const compareChartData = [...chronoSessions].reverse().map((s) => {
          const row: Record<string, string | number | null> = { session: s.test_name };
          selected.forEach((pc) => {
            const r = teamResults.find((x) => x.session_id === s.id && x.player_id === pc.player.id && x.bronco_mins !== null);
            row[pc.player.id] = r?.bronco_mins ?? null;
          });
          return row;
        }).filter((row) => selected.some((pc) => row[pc.player.id] != null));

        return (
          <div className="space-y-4">
            {/* ── Scatter plot ── */}
            {(() => {
              const POS_ORDER = ["Forward", "Midfielder", "Defender", "Goalkeeper"];
              const AGE_ORDER = ["U18", "18-24", "25+"];
              const POS_COLORS: Record<string, string> = { Forward: "#f87171", Midfielder: "#60a5fa", Defender: "#818cf8", Goalkeeper: "#fbbf24" };
              const AGE_COLORS: Record<string, string> = { "U18": "#f87171", "18-24": "#60a5fa", "25+": "#34d399" };
              const groups = rankGroup === "position" ? POS_ORDER : rankGroup === "age" ? AGE_ORDER : ["All"];

              // Build scatter data — for "all", everyone sits in one column with jitter
              const scatterData = rankGroup === "all"
                ? ranked.map((d, idx, arr) => {
                    const spread = 0.45;
                    const jitter = arr.length > 1 ? (idx / (arr.length - 1) - 0.5) * spread : 0;
                    return {
                      x: jitter,
                      y: d.bronco!,
                      name: d.player.name,
                      initials: d.player.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
                      tier: getBronchoTier(d.bronco!),
                      color: getBronchoTier(d.bronco!).color,
                      diffSecs: playerComparisons.find((x) => x.player.id === d.player.id)?.diffSecs ?? null,
                      percentile: d.percentile,
                    };
                  })
                : groups.flatMap((g) => {
                    const GROUP_COLORS = rankGroup === "position" ? POS_COLORS : AGE_COLORS;
                    const inGroup = ranked.filter((d) =>
                      (rankGroup === "position" ? d.player.primary_position : d.player.age_range) === g
                    );
                    return inGroup.map((d, idx) => {
                      const spread = 0.32;
                      const jitter = inGroup.length > 1 ? (idx / (inGroup.length - 1) - 0.5) * spread : 0;
                      return {
                        x: groups.indexOf(g) + jitter,
                        y: d.bronco!,
                        name: d.player.name,
                        initials: d.player.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
                        tier: getBronchoTier(d.bronco!),
                        color: GROUP_COLORS[g] ?? "#818cf8",
                        diffSecs: playerComparisons.find((x) => x.player.id === d.player.id)?.diffSecs ?? null,
                        percentile: d.percentile,
                      };
                    });
                  });

              const yMin = Math.min(...scatterData.map((d) => d.y));
              const yMax = Math.max(...scatterData.map((d) => d.y));
              const yPad = 0.08;
              const yAvg = scatterData.length > 0 ? scatterData.reduce((a, b) => a + b.y, 0) / scatterData.length : null;
              const sortedY = [...scatterData.map((d) => d.y)].sort((a, b) => a - b);
              const calcPercentile = (arr: number[], p: number) => {
                if (arr.length === 0) return null;
                const idx = (p / 100) * (arr.length - 1);
                const lo = Math.floor(idx), hi = Math.ceil(idx);
                return arr[lo] + (idx - lo) * (arr[hi] - arr[lo]);
              };
              const yQ1 = calcPercentile(sortedY, 25);
              const yQ3 = calcPercentile(sortedY, 75);

              // Custom dot: circle + initials
              const CustomDot = (props: any) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null) return null;
                const r = 14;
                return (
                  <g style={{ cursor: "default" }}>
                    <circle cx={cx} cy={cy} r={r} fill={payload.tier.color + "28"} stroke={payload.tier.color} strokeWidth={1.5} />
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                      fontSize={8} fontWeight="700" fill={payload.tier.color} letterSpacing={0}>
                      {payload.initials}
                    </text>
                  </g>
                );
              };

              const CustomTooltip = ({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="rounded-xl border px-3 py-2.5 text-xs shadow-lg"
                    style={{ background: chartTooltipBg, borderColor: chartTooltipBorder }}>
                    <div className="font-semibold text-foreground mb-1">{d.name}</div>
                    <div style={{ color: d.tier.color }} className="font-medium">{d.tier.label}</div>
                    <div className="text-muted-foreground mt-1 font-time">{formatBroncho(d.y)} · {d.percentile}th pct</div>
                    {d.diffSecs !== null && (
                      <div className={cn("mt-0.5 font-time", d.diffSecs > 3 ? "text-emerald-400" : d.diffSecs < -3 ? "text-red-400" : "text-amber-400")}>
                        {d.diffSecs > 3 ? `− ${d.diffSecs}s` : d.diffSecs < -3 ? `+ ${Math.abs(d.diffSecs)}s` : "— unchanged"}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <div className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Player broncho distribution</div>
                    <div className="flex gap-1">
                      {(["all", "position", "age"] as const).map((g) => (
                        <button key={g} onClick={() => setRankGroup(g)}
                          className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                            rankGroup === g
                              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                              : "text-muted-foreground border-transparent hover:border-border hover:text-foreground"
                          )}>
                          {g === "all" ? "All" : g === "position" ? "By Position" : "By Age"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-4">Each circle is a player · lower = faster · hover for details</p>
                  {loading ? <ChartSkeleton height={320} /> : scatterData.length === 0 ? (
                    <EmptyState title="No broncho data yet" description="Record fitness test sessions first" />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={320}>
                        <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                          <XAxis
                            type="number"
                            dataKey="x"
                            domain={rankGroup === "all" ? [-0.6, 0.6] : [-0.5, groups.length - 0.5]}
                            ticks={rankGroup === "all" ? [] : groups.map((_, i) => i)}
                            tickFormatter={(v) => groups[Math.round(v)] ?? ""}
                            tick={{ fill: chartAxis, fontSize: 12, fontWeight: 600 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            type="number"
                            dataKey="y"
                            domain={[yMin - yPad, yMax + yPad]}
                            tickFormatter={(v) => formatBroncho(v)}
                            tick={{ fill: chartAxis, fontSize: 10 }}
                            width={46}
                            tickCount={10}
                          />
                          <ZAxis range={[1, 1]} />
                          <Tooltip content={<CustomTooltip />} cursor={false} />
                          {yQ1 !== null && (
                            <ReferenceLine
                              y={yQ1}
                              stroke="#a78bfa"
                              strokeDasharray="4 3"
                              strokeWidth={1.5}
                              label={{ value: `Q1 ${formatBroncho(yQ1)}`, position: "insideTopRight", fill: "#a78bfa", fontSize: 9, fontWeight: 600 }}
                            />
                          )}
                          {yQ3 !== null && (
                            <ReferenceLine
                              y={yQ3}
                              stroke="#a78bfa"
                              strokeDasharray="4 3"
                              strokeWidth={1.5}
                              label={{ value: `Q3 ${formatBroncho(yQ3)}`, position: "insideTopRight", fill: "#a78bfa", fontSize: 9, fontWeight: 600 }}
                            />
                          )}
                          {yAvg !== null && (
                            <ReferenceLine
                              y={yAvg}
                              stroke="#fbbf24"
                              strokeDasharray="5 3"
                              strokeWidth={1.5}
                              label={{ value: `Avg ${formatBroncho(yAvg)}`, position: "insideTopRight", fill: "#fbbf24", fontSize: 9, fontWeight: 600 }}
                            />
                          )}
                          <Scatter data={scatterData} shape={<CustomDot />} isAnimationActive={false} />
                        </ScatterChart>
                      </ResponsiveContainer>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-3 mt-3 px-1">
                        {rankGroup === "all"
                          ? BRONCHO_TIERS.map((t) => (
                              <div key={t.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                                {t.label}
                              </div>
                            ))
                          : groups.map((g) => {
                              const GROUP_COLORS = rankGroup === "position" ? POS_COLORS : AGE_COLORS;
                              return (
                                <div key={g} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: GROUP_COLORS[g] }} />
                                  {g}
                                </div>
                              );
                            })
                        }
                        {yQ1 !== null && yQ3 !== null && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <div className="w-4 h-[2px] rounded-full bg-violet-400" />
                            Q1 {formatBroncho(yQ1)} · Q3 {formatBroncho(yQ3)}
                          </div>
                        )}
                        {yAvg !== null && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <div className="w-4 h-[2px] rounded-full bg-amber-400" />
                            Avg {formatBroncho(yAvg)}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Player picker ── */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Select players to compare</div>
              <p className="text-[11px] text-muted-foreground mb-4">Pick up to 5 players · click to toggle</p>
              {loading ? <ChartSkeleton height={80} /> : pickable.length === 0 ? (
                <EmptyState title="No data" description="Record fitness test sessions first" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pickable
                    .sort((a, b) => a.player.name.localeCompare(b.player.name))
                    .map(({ player, latest }) => {
                      const isSelected = compareIds.includes(player.id);
                      const colorIdx = compareIds.indexOf(player.id);
                      const color = isSelected ? COMPARE_COLORS[colorIdx] : undefined;
                      return (
                        <button
                          key={player.id}
                          onClick={() => togglePlayer(player.id)}
                          disabled={!isSelected && compareIds.length >= 5}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                            isSelected
                              ? "text-white border-transparent"
                              : compareIds.length >= 5
                              ? "text-muted-foreground border-border opacity-40 cursor-not-allowed"
                              : "text-foreground border-border hover:border-indigo-400/50 hover:text-indigo-400"
                          )}
                          style={isSelected ? { backgroundColor: color, borderColor: color } : undefined}
                        >
                          <PosBadge pos={player.primary_position} />
                          <span>{player.name}</span>
                          <span className="font-time opacity-75">{formatBroncho(latest!.bronco_mins)}</span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* ── Comparison panel ── */}
            {selected.length > 0 && (
              <div className="space-y-4">
                {/* Side-by-side stat cards */}
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(0, 1fr))` }}>
                  {selected.map((pc, i) => {
                    const color = COMPARE_COLORS[i];
                    const tier = pc.latest ? getBronchoTier(pc.latest.bronco_mins) : null;
                    const rankedEntry = ranked.find((r) => r.player.id === pc.player.id);
                    return (
                      <div key={pc.player.id} className="bg-card border border-border rounded-2xl p-5" style={{ borderTopColor: color, borderTopWidth: 3 }}>
                        <div className="flex items-center gap-2 mb-3">
                          <PosBadge pos={pc.player.primary_position} />
                          <span className="font-semibold text-foreground text-sm">{pc.player.name}</span>
                          <button
                            onClick={() => togglePlayer(pc.player.id)}
                            className="ml-auto text-muted-foreground hover:text-red-400 text-xs leading-none"
                          >✕</button>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Latest</div>
                            <div className="text-xl font-bold font-time" style={{ color }}>{pc.latest ? formatBroncho(pc.latest.bronco_mins) : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Tier</div>
                            <div className="text-xs font-medium" style={{ color: tier?.color }}>{tier?.label ?? "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Percentile</div>
                            <div className="text-sm font-bold font-time" style={{ color }}>{rankedEntry ? `${rankedEntry.percentile}th` : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">First</div>
                            <div className="text-sm font-time text-muted-foreground">{pc.first ? formatBroncho(pc.first.bronco_mins) : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Change</div>
                            <ChangeBadge diffSecs={pc.diffSecs} />
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Sessions</div>
                            <div className="text-sm font-time text-foreground">{pc.pResults.length}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Progress over sessions chart */}
                {compareChartData.length >= 1 && (
                  <div className="bg-card border border-border rounded-2xl p-5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Broncho over time</div>
                    <div className="flex flex-wrap gap-4 mb-4 mt-2">
                      {selected.map((pc, i) => (
                        <div key={pc.player.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COMPARE_COLORS[i] }} />
                          {pc.player.name}
                        </div>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={compareChartData} margin={{ top: 4, right: 16, bottom: 40, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                        <XAxis dataKey="session" tick={{ fill: chartAxis, fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tickFormatter={(v) => formatBroncho(v)} domain={["auto", "auto"]} tick={{ fill: chartAxis, fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8 }}
                          formatter={(v: number, key: string) => {
                            const pc = selected.find((x) => x.player.id === key);
                            return [formatBroncho(v), pc?.player.name ?? key];
                          }}
                        />
                        {selected.map((pc, i) => (
                          <Bar key={pc.player.id} dataKey={pc.player.id} fill={COMPARE_COLORS[i]} radius={[3, 3, 0, 0]} maxBarSize={40} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Session-by-session breakdown table */}
                <div className="bg-card border border-border rounded-2xl p-5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Session breakdown</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Session</th>
                          {selected.map((pc, i) => (
                            <th key={pc.player.id} className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: COMPARE_COLORS[i] }}>
                              {pc.player.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {chronoSessions.map((s) => {
                          const cells = selected.map((pc) => {
                            const r = teamResults.find((x) => x.session_id === s.id && x.player_id === pc.player.id && x.bronco_mins !== null);
                            return r?.bronco_mins ?? null;
                          });
                          if (cells.every((c) => c === null)) return null;
                          return (
                            <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-2.5 text-xs text-muted-foreground">{s.test_name}<span className="ml-1.5 text-[10px] opacity-60">{s.test_date}</span></td>
                              {cells.map((bronco, i) => (
                                <td key={i} className="py-2.5 font-time text-xs" style={{ color: bronco !== null ? COMPARE_COLORS[i] : undefined }}>
                                  {bronco !== null ? formatBroncho(bronco) : <span className="text-muted-foreground/40">—</span>}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {selected.length === 0 && !loading && pickable.length > 0 && (
              <div className="bg-card border border-dashed border-border rounded-2xl p-10 text-center">
                <div className="text-sm text-muted-foreground">Select players above to compare their performance</div>
              </div>
            )}
          </div>
        );
      })()}

      {tab === "bands" && (() => {
        const vals = benchmarkData.map((d) => d.bronco!);
        const calcQ = (arr: number[], p: number) => {
          if (arr.length === 0) return null;
          const idx = (p / 100) * (arr.length - 1);
          const lo = Math.floor(idx), hi = Math.ceil(idx);
          return arr[lo] + (idx - lo) * ((arr[hi] ?? arr[lo]) - arr[lo]);
        };
        const q1 = calcQ(vals, 25);
        const q2 = calcQ(vals, 50);
        const q3 = calcQ(vals, 75);

        const BANDS = [
          { key: "top",    label: "Top 25%",    description: "Fastest quartile",       color: "#34d399", targetLabel: null },
          { key: "upper",  label: "Upper Mid",  description: "50–75th percentile",     color: "#60a5fa", targetLabel: "Top 25%" },
          { key: "lower",  label: "Lower Mid",  description: "25–50th percentile",     color: "#fbbf24", targetLabel: "Upper Mid" },
          { key: "bottom", label: "Bottom 25%", description: "Slowest quartile",       color: "#f87171", targetLabel: "Lower Mid" },
        ] as const;

        const getPlayerBand = (bronco: number) => {
          if (q1 !== null && bronco <= q1) return BANDS[0];
          if (q2 !== null && bronco <= q2) return BANDS[1];
          if (q3 !== null && bronco <= q3) return BANDS[2];
          return BANDS[3];
        };

        const getTarget = (bronco: number): { boundary: number; gapSecs: number; nextBand: string; isGlobal?: boolean } | null => {
          if (q1 === null || q2 === null || q3 === null) return null;
          if (bronco <= q1) {
            // Top of squad — aim for next global tier
            const tierIdx = BRONCHO_TIERS.findIndex((t) => bronco >= t.minMins && bronco < t.maxMins);
            if (tierIdx <= 0) return null; // already World Record
            const nextTier = BRONCHO_TIERS[tierIdx - 1];
            return { boundary: nextTier.maxMins, gapSecs: Math.round((bronco - nextTier.maxMins) * 60), nextBand: nextTier.label, isGlobal: true };
          }
          if (bronco <= q2) return { boundary: q1, gapSecs: Math.round((bronco - q1) * 60), nextBand: "Top 25%" };
          if (bronco <= q3) return { boundary: q2, gapSecs: Math.round((bronco - q2) * 60), nextBand: "Upper Mid" };
          return { boundary: q3, gapSecs: Math.round((bronco - q3) * 60), nextBand: "Lower Mid" };
        };

        return (
          <div className="space-y-4">
            {/* Quartile boundary strip */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Team quartile boundaries</div>
                <p className="text-[11px] text-muted-foreground">Latest result per player · {benchmarkData.length} players · lower = faster · updates each test</p>
              </div>
              {loading ? <ChartSkeleton height={80} /> : q1 === null ? (
                <div className="px-5 pb-5"><EmptyState title="No data yet" description="Record fitness test sessions first" /></div>
              ) : (
                <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                  <div className="px-5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#34d399" }}>Q1 · Top boundary</div>
                    <div className="text-2xl font-bold font-time text-foreground">{formatBroncho(q1)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Beat this → Top 25%</div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#60a5fa" }}>Median · Mid boundary</div>
                    <div className="text-2xl font-bold font-time text-foreground">{formatBroncho(q2!)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Beat this → Upper Mid</div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "#fbbf24" }}>Q3 · Lower boundary</div>
                    <div className="text-2xl font-bold font-time text-foreground">{formatBroncho(q3!)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Beat this → Lower Mid</div>
                  </div>
                </div>
              )}
            </div>

            {/* Band swimlanes */}
            {!loading && q1 !== null && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Players by band</div>
                <div className="space-y-3">
                  {BANDS.map((band) => {
                    const inBand = benchmarkData.filter(({ bronco }) => {
                      if (band.key === "top")    return bronco! <= q1!;
                      if (band.key === "upper")  return bronco! > q1! && bronco! <= q2!;
                      if (band.key === "lower")  return bronco! > q2! && bronco! <= q3!;
                      return bronco! > q3!;
                    });
                    return (
                      <div key={band.key} className="rounded-xl border p-3" style={{ backgroundColor: band.color + "10", borderColor: band.color + "30" }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold" style={{ color: band.color }}>{band.label}</span>
                            <span className="text-[11px] text-muted-foreground">{band.description}</span>
                          </div>
                          <span className="text-xs font-bold font-time" style={{ color: band.color }}>{inBand.length} player{inBand.length !== 1 ? "s" : ""}</span>
                        </div>
                        {inBand.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {inBand.map(({ player, bronco }) => (
                              <div key={player.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                                style={{ backgroundColor: band.color + "18", border: `1px solid ${band.color}30` }}>
                                <PosBadge pos={player.primary_position} />
                                <span className="text-xs text-foreground font-medium">{player.name}</span>
                                <span className="text-[11px] font-time text-muted-foreground">{formatBroncho(bronco)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground/50 italic">No players in this band</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next test targets table */}
            {!loading && q1 !== null && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Next test targets</div>
                <p className="text-[11px] text-muted-foreground mb-4">How many seconds each player needs to improve to reach the next band</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Player</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Latest</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Avg / round</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Current band</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Target</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Goal avg / round</th>
                        <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkData.map(({ player, bronco }) => {
                        const band = getPlayerBand(bronco!);
                        const target = getTarget(bronco!);
                        return (
                          <tr key={player.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <PosBadge pos={player.primary_position} />
                                <span className="text-xs font-medium text-foreground">{player.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 font-time text-xs text-foreground">{formatBroncho(bronco)}</td>
                            <td className="py-2.5 font-time text-xs text-muted-foreground">{formatBroncho(bronco! / 5)}</td>
                            <td className="py-2.5">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                style={{ backgroundColor: band.color + "20", color: band.color }}>
                                {band.label}
                              </span>
                            </td>
                            <td className="py-2.5 font-time text-xs">
                              {target
                                ? <span style={{ color: target.isGlobal ? "#a78bfa" : "#60a5fa" }}>{formatBroncho(target.boundary)}</span>
                                : <span className="text-amber-400 font-semibold">World Record ✓</span>
                              }
                            </td>
                            <td className="py-2.5 font-time text-xs text-muted-foreground">
                              {target ? formatBroncho(target.boundary / 5) : "—"}
                            </td>
                            <td className="py-2.5">
                              {target
                                ? <span className={cn("inline-block px-2 py-0.5 rounded-full text-[11px] font-time", target.isGlobal ? "bg-violet-400/10 text-violet-400" : "bg-blue-400/10 text-blue-400")}>
                                    −{target.gapSecs}s → {target.isGlobal ? `Global ${target.nextBand}` : target.nextBand}
                                  </span>
                                : <span className="text-[11px] text-muted-foreground">—</span>
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
