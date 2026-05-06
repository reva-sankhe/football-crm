import { useEffect, useState, useCallback } from "react";
import { useTeam } from "@/context/TeamContext";
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { MetricCardSkeleton, ChartSkeleton } from "@/components/Skeleton";
import { fetchLatestSessionResults, fetchPlayers } from "@/lib/queries";
import { positionColor, cn } from "@/lib/utils";
import { BRONCHO_TIERS, type Player, type TestResult, type TestSession } from "@/lib/types";

interface LatestData {
  session: TestSession | null;
  results: (TestResult & { players: Pick<Player, "name" | "code" | "team"> })[];
}

const POS_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;
const AGE_ORDER = ["U18", "18-24", "25+"] as const;

const POS_COLORS: Record<string, { color: string; bg: string }> = {
  Goalkeeper: { color: "#fbbf24", bg: "bg-amber-400/10" },
  Defender:   { color: "#818cf8", bg: "bg-indigo-400/10" },
  Midfielder: { color: "#60a5fa", bg: "bg-blue-400/10" },
  Forward:    { color: "#f87171", bg: "bg-red-400/10" },
};

const AGE_COLORS: Record<string, { color: string; bg: string }> = {
  "U18":   { color: "#f87171", bg: "bg-red-400/10" },
  "18-24": { color: "#60a5fa", bg: "bg-blue-400/10" },
  "25+":   { color: "#34d399", bg: "bg-emerald-400/10" },
};

// Target = Good tier or better (bronco < 5:06)
const BENCHMARK_MINS = 5 + 6 / 60;

export default function Dashboard() {
  const { team } = useTeam();
  const [players, setPlayers] = useState<Player[]>([]);
  const [latestData, setLatestData] = useState<LatestData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, latest] = await Promise.all([fetchPlayers(team), fetchLatestSessionResults(team)]);
      setPlayers(ps);
      setLatestData(latest);
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => { load(); }, [load]);

  const active = players.filter((p) => p.is_active);
  const inactive = players.filter((p) => !p.is_active);

  // Broncho benchmark: players with a result at Good tier or better in latest session
  const latestResults = latestData?.results ?? [];
  const atBenchmark = latestResults.filter((r) => r.bronco_mins !== null && r.bronco_mins < BENCHMARK_MINS).length;
  const testedCount = latestResults.filter((r) => r.bronco_mins !== null).length;

  // Position breakdown (active players only)
  const byPosition = POS_ORDER.map((pos) => ({
    pos,
    players: active.filter((p) => p.primary_position === pos),
  }));

  // Age breakdown (active players only)
  const byAge = AGE_ORDER.map((range) => ({
    range,
    players: active.filter((p) => p.age_range === range),
  }));
  const noAge = active.filter((p) => !p.age_range);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {team} <span className="text-indigo-500 dark:text-indigo-400">— Squad</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{active.length} active · {inactive.length} inactive</p>
        </div>
        <TeamSwitcher />
      </div>

      {/* Top stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-border rounded-2xl overflow-hidden divide-x divide-y sm:divide-y-0 divide-border bg-card">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Squad size</div>
              <div className="text-2xl font-bold text-foreground">{active.length}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{players.length} registered</div>
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">By position</div>
              <div className="flex items-end gap-2 flex-wrap">
                {POS_ORDER.map((pos) => {
                  const count = active.filter((p) => p.primary_position === pos).length;
                  if (!count) return null;
                  return (
                    <div key={pos} className="text-center">
                      <div className="text-lg font-bold font-time" style={{ color: POS_COLORS[pos].color }}>{count}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-widest">{pos.slice(0, 2)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">By age group</div>
              <div className="flex items-end gap-2 flex-wrap">
                {AGE_ORDER.map((range) => {
                  const count = active.filter((p) => p.age_range === range).length;
                  if (!count) return null;
                  return (
                    <div key={range} className="text-center">
                      <div className="text-lg font-bold font-time" style={{ color: AGE_COLORS[range].color }}>{count}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-widest">{range}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">At benchmark</div>
              {testedCount > 0 ? (
                <>
                  <div className="text-2xl font-bold text-foreground">
                    <span className="text-emerald-400">{atBenchmark}</span>
                    <span className="text-muted-foreground font-normal text-lg"> / {testedCount}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Good tier or better · latest session</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
                  <div className="text-[11px] text-muted-foreground mt-1">No broncho data yet</div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Position breakdown + Age breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

        {/* By position */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Squad by position</div>
          {loading ? <ChartSkeleton height={200} /> : (
            <div className="space-y-4">
              {/* Stacked bar */}
              <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                {POS_ORDER.map((pos) => {
                  const count = active.filter((p) => p.primary_position === pos).length;
                  const pct = active.length ? (count / active.length) * 100 : 0;
                  return pct > 0 ? (
                    <div key={pos} style={{ width: `${pct}%`, background: POS_COLORS[pos].color }}
                      title={`${pos}: ${count}`} />
                  ) : null;
                })}
              </div>
              {/* Position rows */}
              {byPosition.map(({ pos, players: ps }) => {
                if (!ps.length) return null;
                const cfg = POS_COLORS[pos];
                return (
                  <div key={pos}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
                        <span className="text-sm font-medium text-foreground">{pos}</span>
                      </div>
                      <span className="text-xs font-bold font-time" style={{ color: cfg.color }}>{ps.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-4">
                      {ps.map((p) => (
                        <span key={p.id} className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", cfg.bg)}
                          style={{ color: cfg.color }}>
                          {p.name.split(" ")[0]}
                          {p.secondary_position && <span className="opacity-60 ml-1 text-[10px]">· {p.secondary_position}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By age */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Squad by age group</div>
          {loading ? <ChartSkeleton height={200} /> : (
            <div className="space-y-4">
              {/* Stacked bar */}
              <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                {AGE_ORDER.map((range) => {
                  const count = active.filter((p) => p.age_range === range).length;
                  const pct = active.length ? (count / active.length) * 100 : 0;
                  return pct > 0 ? (
                    <div key={range} style={{ width: `${pct}%`, background: AGE_COLORS[range].color }}
                      title={`${range}: ${count}`} />
                  ) : null;
                })}
              </div>
              {/* Age rows */}
              {byAge.map(({ range, players: ps }) => {
                if (!ps.length) return null;
                const cfg = AGE_COLORS[range];
                return (
                  <div key={range}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
                        <span className="text-sm font-medium text-foreground">{range}</span>
                      </div>
                      <span className="text-xs font-bold font-time" style={{ color: cfg.color }}>{ps.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-4">
                      {ps.map((p) => (
                        <span key={p.id} className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", cfg.bg)}
                          style={{ color: cfg.color }}>
                          {p.name.split(" ")[0]}
                          {p.primary_position && (
                            <span className="opacity-60 ml-1 text-[10px]">· {p.primary_position.slice(0, 3)}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {noAge.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                      <span className="text-sm font-medium text-muted-foreground">Unknown</span>
                    </div>
                    <span className="text-xs font-bold font-time text-muted-foreground">{noAge.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-4">
                    {noAge.map((p) => (
                      <span key={p.id} className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                        {p.name.split(" ")[0]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full roster */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Full roster</div>
          <span className="text-xs text-muted-foreground">{players.length} players</span>
        </div>
        {loading ? (
          <div className="p-5"><ChartSkeleton height={100} /></div>
        ) : players.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No players registered yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Player</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Position</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Age</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {players
                  .sort((a, b) => {
                    const posA = POS_ORDER.indexOf(a.primary_position as typeof POS_ORDER[number]);
                    const posB = POS_ORDER.indexOf(b.primary_position as typeof POS_ORDER[number]);
                    return (posA === -1 ? 99 : posA) - (posB === -1 ? 99 : posB) || a.name.localeCompare(b.name);
                  })
                  .map((p) => {
                    const pc = POS_COLORS[p.primary_position];
                    return (
                      <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                        <td className="px-4 py-2.5">
                          {pc ? (
                            <span className={cn("text-xs font-semibold", positionColor(p.primary_position))}>{p.primary_position}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.secondary_position ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          {p.age_range ? (
                            <span className="text-xs font-medium" style={{ color: AGE_COLORS[p.age_range]?.color }}>
                              {p.age_range}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium",
                            p.is_active ? "bg-emerald-400/10 text-emerald-400" : "bg-muted text-muted-foreground")}>
                            {p.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
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
