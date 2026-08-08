import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Activity, ChevronDown, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { STAGE_CFG } from "@/lib/tournaments";
import { formatDateShort } from "@/lib/attendance";
import type { PlayerMatchStat } from "@/lib/queries";

interface Totals {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  injuries: number;
}

/**
 * Minutes are often left at 0 when only goals get logged, so a contribution
 * counts as evidence of playing — otherwise a two-goal game reads as
 * "0 appearances".
 */
function didPlay(r: PlayerMatchStat): boolean {
  return r.minutes_played > 0 || r.goals > 0 || r.assists > 0 || r.yellow_cards > 0 || r.red_cards > 0;
}

function sumStats(rows: PlayerMatchStat[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      appearances: acc.appearances + (didPlay(r) ? 1 : 0),
      minutes: acc.minutes + r.minutes_played,
      goals: acc.goals + r.goals,
      assists: acc.assists + r.assists,
      yellow: acc.yellow + r.yellow_cards,
      red: acc.red + r.red_cards,
      injuries: acc.injuries + (r.injured ? 1 : 0),
    }),
    { appearances: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, injuries: 0 },
  );
}

export function PlayerTournamentStats({ stats }: { stats: PlayerMatchStat[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => sumStats(stats), [stats]);

  // Grouped by tournament, most recent match first
  const byTournament = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; rows: PlayerMatchStat[] }>();
    for (const r of stats) {
      const t = r.matches?.tournaments;
      const key = t?.id ?? "__none__";
      if (!groups.has(key)) {
        groups.set(key, { id: t?.id ?? "", name: t?.name ?? "Unassigned matches", rows: [] });
      }
      groups.get(key)!.rows.push(r);
    }
    return Array.from(groups.values());
  }, [stats]);

  if (stats.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={15} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground">Tournament History</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          No match stats logged yet. They appear here once this player features in a tournament match.
        </p>
      </div>
    );
  }

  const minsPerApp = totals.appearances > 0 ? Math.round(totals.minutes / totals.appearances) : 0;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={15} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground">Tournament History</h2>
          <span className="text-xs text-muted-foreground">
            {byTournament.length} competition{byTournament.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Headline totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Goals"       value={totals.goals}       color="text-emerald-400" />
          <Tile label="Assists"     value={totals.assists}     color="text-blue-400" />
          <Tile label="Minutes"     value={totals.minutes}     sub={totals.appearances > 0 ? `${minsPerApp} per app` : undefined} />
          <Tile label="Appearances" value={totals.appearances} sub={`${stats.length} squad call-up${stats.length !== 1 ? "s" : ""}`} />
        </div>

        {/* Discipline / availability */}
        {(totals.yellow > 0 || totals.red > 0 || totals.injuries > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {totals.yellow > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400">
                <span className="w-2 h-2.5 rounded-[2px] bg-amber-400" />
                {totals.yellow} yellow
              </span>
            )}
            {totals.red > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-400">
                <span className="w-2 h-2.5 rounded-[2px] bg-red-400" />
                {totals.red} red
              </span>
            )}
            {totals.injuries > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-400">
                <Activity size={10} />
                {totals.injuries} injury{totals.injuries !== 1 ? " incidents" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Per-tournament breakdown */}
      <div className={cn("border-t", isDark ? "border-white/[0.06]" : "border-slate-100")}>
        {byTournament.map((group) => {
          const gt = sumStats(group.rows);
          return (
            <div key={group.id || group.name} className="px-5 py-3 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-3 flex-wrap">
                {group.id ? (
                  <Link href={`/tournaments/${group.id}`} className="text-sm font-medium text-foreground hover:text-indigo-400 transition-colors">
                    {group.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">{group.name}</span>
                )}
                <div className="ml-auto flex items-center gap-3 text-[11px] font-time">
                  <span className="text-emerald-400">{gt.goals} G</span>
                  <span className="text-blue-400">{gt.assists} A</span>
                  <span className="text-muted-foreground">{gt.minutes} min</span>
                  <span className="text-muted-foreground">{gt.appearances} app</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Match-by-match */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full px-5 py-2.5 flex items-center justify-between text-xs transition-colors border-t",
          isDark ? "border-white/[0.06] text-muted-foreground hover:bg-white/[0.02]" : "border-slate-100 text-slate-500 hover:bg-slate-50",
        )}
      >
        <span>Match by match ({stats.length})</span>
        <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="divide-y divide-border/40">
          {stats.map((r) => {
            const m = r.matches;
            const cfg = m ? STAGE_CFG[m.stage] ?? STAGE_CFG["Group Stage"] : null;
            return (
              <div key={r.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                {cfg && (
                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0", cfg.bg, cfg.text)}>
                    {cfg.short}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {m ? (
                    <Link href={`/matches/${m.id}`} className="text-xs text-foreground hover:text-indigo-400 transition-colors">
                      {m.opponent ? `vs ${m.opponent}` : "Opponent TBD"}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">Match removed</span>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {m?.sessions ? formatDateShort(m.sessions.date) : "—"}
                    {m?.goals_for != null && m?.goals_against != null && ` · ${m.goals_for}–${m.goals_against}`}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 text-[11px] font-time shrink-0">
                  <span className="text-muted-foreground">{r.minutes_played}'</span>
                  {r.goals > 0 && <span className="text-emerald-400">{r.goals} G</span>}
                  {r.assists > 0 && <span className="text-blue-400">{r.assists} A</span>}
                  {r.yellow_cards > 0 && <span className="w-2 h-2.5 rounded-[2px] bg-amber-400" title={`${r.yellow_cards} yellow`} />}
                  {r.red_cards > 0 && <span className="w-2 h-2.5 rounded-[2px] bg-red-400" title="Red card" />}
                  {r.injured && (
                    <span className="text-orange-400 flex items-center gap-1" title={r.injury_note ?? "Injured"}>
                      <Activity size={10} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-2xl font-bold font-time leading-none", color ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
