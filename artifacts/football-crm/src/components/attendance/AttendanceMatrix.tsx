import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowUpDown, CalendarRange, ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { fetchAttendanceForSessions, upsertAttendance } from "@/lib/queries";
import {
  ATTENDANCE_CFG,
  ATTENDANCE_STATUSES,
  SESSION_TYPE_CFG,
  attendancePctColor,
  countsAsAttended,
  currentMonthKey,
  formatDateLong,
  formatMonthLabel,
} from "@/lib/attendance";
import type { AttendanceStatus, Player, TrainingSession } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortMode = "name" | "pct";
/** playerId → sessionId → status */
type Grid = Record<string, Record<string, AttendanceStatus>>;

interface PlayerStats {
  player: Player;
  counts: Record<AttendanceStatus, number>;
  attended: number;
  pct: number;
}

interface AttendanceMatrixProps {
  sessions: TrainingSession[];   // newest first
  players: Player[];
  /** Bumped by the parent after a save/import to force a refetch. */
  refreshKey: number;
  onJumpToSession: (sessionId: string) => void;
}

export function AttendanceMatrix({ sessions, players, refreshKey, onJumpToSession }: AttendanceMatrixProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [month, setMonth] = useState<string>(currentMonthKey());
  const [allTime, setAllTime] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [grid, setGrid] = useState<Grid>({});
  const [loading, setLoading] = useState(true);

  // Months that actually have sessions, oldest → newest
  const availableMonths = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.date.slice(0, 7)))).sort(),
    [sessions],
  );

  // If the current month has no sessions, land on the most recent one that does
  useEffect(() => {
    if (allTime || availableMonths.length === 0) return;
    if (!availableMonths.includes(month)) {
      setMonth(availableMonths[availableMonths.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths]);

  // Sessions in scope, oldest → newest so columns read left-to-right in time
  const scopedSessions = useMemo(() => {
    const inScope = allTime ? sessions : sessions.filter((s) => s.date.startsWith(month));
    return [...inScope].sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions, month, allTime]);

  const scopedIds = useMemo(() => scopedSessions.map((s) => s.id), [scopedSessions]);

  // ── Load attendance for the scoped sessions ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAttendanceForSessions(scopedIds)
      .then((rows) => {
        if (cancelled) return;
        const next: Grid = {};
        for (const r of rows) {
          (next[r.player_id] ??= {})[r.session_id] = r.status;
        }
        setGrid(next);
      })
      .catch((err) => {
        if (!cancelled) toast({ title: "Failed to load attendance", description: String(err), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIds.join(","), refreshKey]);

  // ── Per-player stats ───────────────────────────────────────────────────────
  const stats: PlayerStats[] = useMemo(() => {
    const rows = players.map((player) => {
      const counts: Record<AttendanceStatus, number> = { Present: 0, Absent: 0, Late: 0, Injured: 0 };
      let attended = 0;
      for (const s of scopedSessions) {
        const status = grid[player.id]?.[s.id];
        if (status) counts[status]++;
        if (countsAsAttended(status)) attended++;
      }
      const pct = scopedSessions.length > 0 ? Math.round((attended / scopedSessions.length) * 100) : 0;
      return { player, counts, attended, pct };
    });

    return sortMode === "pct"
      ? rows.sort((a, b) => a.pct - b.pct || a.player.name.localeCompare(b.player.name))
      : rows.sort((a, b) => a.player.name.localeCompare(b.player.name));
  }, [players, scopedSessions, grid, sortMode]);

  const teamPct = useMemo(() => {
    if (stats.length === 0 || scopedSessions.length === 0) return null;
    return Math.round(stats.reduce((sum, r) => sum + r.pct, 0) / stats.length);
  }, [stats, scopedSessions]);

  // ── Inline cell edit ───────────────────────────────────────────────────────
  const handleCellChange = async (playerId: string, sessionId: string, status: AttendanceStatus) => {
    const prev = grid[playerId]?.[sessionId];
    setGrid((g) => ({ ...g, [playerId]: { ...g[playerId], [sessionId]: status } }));
    try {
      await upsertAttendance(sessionId, playerId, status);
    } catch (err) {
      setGrid((g) => {
        const next = { ...g, [playerId]: { ...g[playerId] } };
        if (prev) next[playerId][sessionId] = prev;
        else delete next[playerId][sessionId];
        return next;
      });
      toast({ title: "Failed to update", description: String(err), variant: "destructive" });
    }
  };

  // ── CSV export ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const header = ["Name", "Code", "Attendance %", ...ATTENDANCE_STATUSES, ...scopedSessions.map((s) => s.date)];
    const lines = stats.map(({ player, counts, pct }) => [
      player.name,
      player.code ?? "",
      String(pct),
      ...ATTENDANCE_STATUSES.map((s) => String(counts[s])),
      ...scopedSessions.map((s) => ATTENDANCE_CFG[grid[player.id]?.[s.id] ?? "Absent"].short),
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${allTime ? "all-time" : month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Step through months that actually have sessions — plain month arithmetic
  // would strand the user on a gap month with both arrows disabled.
  const monthIdx = availableMonths.indexOf(month);
  const canPrev = !allTime && monthIdx > 0;
  const canNext = !allTime && monthIdx >= 0 && monthIdx < availableMonths.length - 1;
  const stepMonth = (delta: number) => {
    const next = availableMonths[monthIdx + delta];
    if (next) setMonth(next);
  };

  return (
    <div className="space-y-3">
      {/* ── Scope controls ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("flex items-center rounded-lg border", isDark ? "border-white/10" : "border-slate-200")}>
          <button
            onClick={() => stepMonth(-1)}
            disabled={!canPrev}
            aria-label="Previous month"
            className="w-8 h-8 flex items-center justify-center rounded-l-lg text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <span className={cn("px-3 text-sm font-medium min-w-[120px] text-center", allTime ? "text-muted-foreground/50" : "text-foreground")}>
            {allTime ? "All time" : formatMonthLabel(month)}
          </span>
          <button
            onClick={() => stepMonth(1)}
            disabled={!canNext}
            aria-label="Next month"
            className="w-8 h-8 flex items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <button
          onClick={() => setAllTime((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
            allTime
              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
              : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
          )}
        >
          <CalendarRange size={12} /> All time
        </button>

        <button
          onClick={() => setSortMode((m) => (m === "name" ? "pct" : "name"))}
          className={cn(
            "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
            isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
          )}
        >
          <ArrowUpDown size={12} /> {sortMode === "name" ? "Sort by name" : "Lowest % first"}
        </button>

        <div className="flex-1" />

        {teamPct != null && (
          <span className="text-xs text-muted-foreground">
            {scopedSessions.length} session{scopedSessions.length !== 1 ? "s" : ""} · squad avg{" "}
            <span className={cn("font-bold font-time", attendancePctColor(teamPct))}>{teamPct}%</span>
          </span>
        )}

        <button
          onClick={handleExport}
          disabled={scopedSessions.length === 0}
          className={cn(
            "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40",
            isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
          )}
        >
          <Download size={12} /> Export
        </button>
      </div>

      {/* ── Empty / loading ─────────────────────────────────────────────────── */}
      {scopedSessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <CalendarRange size={36} className="mx-auto text-muted-foreground/25 mb-3" />
          <p className="text-foreground text-sm font-medium">No sessions in this period</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Use the arrows to browse other months.</p>
        </div>
      ) : loading ? (
        <div className="bg-card border border-border rounded-2xl p-12 flex items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-muted-foreground/40" />
        </div>
      ) : (
        <>
          {/* ── Desktop: matrix ─────────────────────────────────────────────── */}
          <div className="hidden lg:block bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-auto max-h-[calc(100vh-16rem)]">
              <table className="text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 bg-card border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground w-[180px] min-w-[180px]">
                      Player
                    </th>
                    <th className="sticky left-[180px] top-0 z-30 bg-card border-b border-r border-border px-2 py-2 text-right text-xs font-medium text-muted-foreground w-[52px] min-w-[52px]">
                      %
                    </th>
                    {scopedSessions.map((s) => {
                      const cfg = SESSION_TYPE_CFG[s.session_type] ?? SESSION_TYPE_CFG.Training;
                      return (
                        <th
                          key={s.id}
                          title={`${formatDateLong(s.date)} · ${s.session_type}`}
                          className="sticky top-0 z-20 bg-card border-b border-border px-1 py-2 w-9 min-w-[36px]"
                        >
                          <button
                            onClick={() => onJumpToSession(s.id)}
                            className="flex flex-col items-center gap-1 w-full group"
                          >
                            <span className="text-[10px] font-medium text-muted-foreground group-hover:text-indigo-400 transition-colors font-time whitespace-nowrap">
                              {Number(s.date.slice(5, 7))}/{Number(s.date.slice(8, 10))}
                            </span>
                            <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                          </button>
                        </th>
                      );
                    })}
                    {ATTENDANCE_STATUSES.map((s, i) => (
                      <th
                        key={s}
                        title={ATTENDANCE_CFG[s].label}
                        className={cn(
                          "sticky top-0 z-20 bg-card border-b border-border px-1 py-2 text-xs font-medium w-8 min-w-[32px]",
                          ATTENDANCE_CFG[s].activeColor,
                          i === 0 && "border-l pl-2",
                        )}
                      >
                        {ATTENDANCE_CFG[s].short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map(({ player, counts, pct }) => (
                    <tr key={player.id} className="group">
                      <td className="sticky left-0 z-10 bg-card group-hover:bg-muted/40 border-b border-border/60 px-3 py-1.5 transition-colors">
                        <Link
                          href={`/players/${player.id}`}
                          className="text-sm text-foreground hover:text-indigo-400 transition-colors truncate block max-w-[160px]"
                        >
                          {player.name}
                        </Link>
                      </td>
                      <td className="sticky left-[180px] z-10 bg-card group-hover:bg-muted/40 border-b border-r border-border/60 px-2 py-1.5 text-right transition-colors">
                        <span className={cn("text-sm font-bold font-time", attendancePctColor(pct))}>{pct}</span>
                      </td>

                      {scopedSessions.map((s) => {
                        const status = grid[player.id]?.[s.id];
                        const cfg = status ? ATTENDANCE_CFG[status] : null;
                        return (
                          <td key={s.id} className="border-b border-border/60 p-0.5 text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  title={`${player.name} · ${s.date} · ${status ?? "not recorded"}`}
                                  className={cn(
                                    "w-7 h-7 rounded-md text-[11px] font-bold border transition-all hover:scale-110",
                                    cfg
                                      ? cn(cfg.activeBg, cfg.activeColor)
                                      : "border-transparent text-muted-foreground/30 hover:border-border",
                                  )}
                                >
                                  {cfg ? cfg.short : "–"}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="w-36">
                                {ATTENDANCE_STATUSES.map((opt) => {
                                  const c = ATTENDANCE_CFG[opt];
                                  const Icon = c.icon;
                                  return (
                                    <DropdownMenuItem
                                      key={opt}
                                      onSelect={() => handleCellChange(player.id, s.id, opt)}
                                      className={cn("gap-2 text-xs", status === opt && "font-semibold")}
                                    >
                                      <Icon size={12} className={c.activeColor} />
                                      {c.label}
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        );
                      })}

                      {ATTENDANCE_STATUSES.map((s, i) => (
                        <td
                          key={s}
                          className={cn(
                            "group-hover:bg-muted/40 border-b border-border/60 px-1 py-1.5 text-center text-xs font-time transition-colors",
                            counts[s] > 0 ? ATTENDANCE_CFG[s].activeColor : "text-muted-foreground/30",
                            i === 0 && "border-l border-l-border pl-2",
                          )}
                        >
                          {counts[s]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Mobile: card list ───────────────────────────────────────────── */}
          <div className="lg:hidden space-y-2">
            {stats.map(({ player, counts, attended, pct }) => (
              <Link
                key={player.id}
                href={`/players/${player.id}`}
                className="block bg-card border border-border rounded-xl px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{player.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {attended} of {scopedSessions.length} sessions
                    </div>
                  </div>
                  <span className={cn("text-xl font-bold font-time shrink-0", attendancePctColor(pct))}>{pct}%</span>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {ATTENDANCE_STATUSES.map((s) => {
                    const cfg = ATTENDANCE_CFG[s];
                    const Icon = cfg.icon;
                    return (
                      <span
                        key={s}
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border",
                          counts[s] > 0
                            ? cn(cfg.activeBg, cfg.activeColor)
                            : isDark ? "border-white/10 text-muted-foreground/50" : "border-slate-200 text-muted-foreground/50",
                        )}
                      >
                        <Icon size={9} />{counts[s]}
                      </span>
                    );
                  })}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
