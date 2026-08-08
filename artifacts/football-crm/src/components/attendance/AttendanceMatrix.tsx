import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import type { DateRange } from "react-day-picker";
import { ArrowUpDown, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Download, RefreshCw, X } from "lucide-react";
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
import { formatDateRange } from "@/lib/tournaments";
import type { AttendanceStatus, Player, TrainingSession } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type SortMode = "name" | "pct";

/**
 * What the matrix currently covers. A discriminated union rather than a pile of
 * booleans, so "month" / "all time" / "custom range" can't contradict each other.
 */
type Scope =
  | { kind: "month"; month: string }          // "2026-07"
  | { kind: "all" }
  | { kind: "range"; from: string; to: string }; // ISO dates, inclusive

/** Local-time YYYY-MM-DD — toISOString() would shift across the date line. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];
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

  const [scope, setScope] = useState<Scope>({ kind: "month", month: currentMonthKey() });
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [grid, setGrid] = useState<Grid>({});
  const [loading, setLoading] = useState(true);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();

  // Months that actually have sessions, oldest → newest
  const availableMonths = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.date.slice(0, 7)))).sort(),
    [sessions],
  );

  // If the current month has no sessions, land on the most recent one that does
  useEffect(() => {
    if (availableMonths.length === 0) return;
    setScope((s) =>
      s.kind === "month" && !availableMonths.includes(s.month)
        ? { kind: "month", month: availableMonths[availableMonths.length - 1] }
        : s,
    );
  }, [availableMonths]);

  // Sessions in scope, oldest → newest so columns read left-to-right in time
  const scopedSessions = useMemo(() => {
    const inScope =
      scope.kind === "all"
        ? sessions
        : scope.kind === "month"
          ? sessions.filter((s) => s.date.startsWith(scope.month))
          : sessions.filter((s) => s.date >= scope.from && s.date <= scope.to);
    return [...inScope].sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions, scope]);

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
    a.download = `attendance-${scopeSlug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Step through months that actually have sessions — plain month arithmetic
  // would strand the user on a gap month with both arrows disabled.
  const monthIdx = scope.kind === "month" ? availableMonths.indexOf(scope.month) : -1;
  const canPrev = scope.kind === "month" && monthIdx > 0;
  const canNext = scope.kind === "month" && monthIdx >= 0 && monthIdx < availableMonths.length - 1;
  const stepMonth = (delta: number) => {
    const next = availableMonths[monthIdx + delta];
    if (next) setScope({ kind: "month", month: next });
  };

  const scopeLabel =
    scope.kind === "all"
      ? "All time"
      : scope.kind === "month"
        ? formatMonthLabel(scope.month)
        : formatDateRange(scope.from, scope.to) ?? "Custom range";

  const scopeSlug =
    scope.kind === "all" ? "all-time" : scope.kind === "month" ? scope.month : `${scope.from}_to_${scope.to}`;

  // Highlight days that actually have a session, so the picker shows where data is
  const sessionDays = useMemo(
    () => sessions.map((s) => new Date(s.date + "T00:00:00")),
    [sessions],
  );

  const applyRange = (from: Date, to: Date) => {
    setScope({ kind: "range", from: isoOf(from), to: isoOf(to) });
    setRangeOpen(false);
  };

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    setDraftRange({ from, to });
    applyRange(from, to);
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
          <span className="px-3 text-sm font-medium min-w-[150px] text-center text-foreground whitespace-nowrap">
            {scopeLabel}
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
          onClick={() =>
            setScope((s) =>
              s.kind === "all"
                ? { kind: "month", month: availableMonths[availableMonths.length - 1] ?? currentMonthKey() }
                : { kind: "all" },
            )
          }
          className={cn(
            "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
            scope.kind === "all"
              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
              : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
          )}
        >
          <CalendarRange size={12} /> All time
        </button>

        {/* Custom date range */}
        <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
                scope.kind === "range"
                  ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                  : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              )}
              data-testid="button-date-range"
            >
              <CalendarDays size={12} /> Date range
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <div className="flex flex-wrap gap-1.5 p-3 border-b border-border">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => applyPreset(p.days)}
                  className={cn(
                    "px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                    isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Selection only drafts — DayPicker fills both ends on the first
                click, so auto-applying would make multi-day ranges unpickable. */}
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={draftRange}
              onSelect={setDraftRange}
              defaultMonth={
                scope.kind === "range"
                  ? new Date(scope.from + "T00:00:00")
                  : sessionDays[0] ?? new Date()
              }
              modifiers={{ hasSession: sessionDays }}
              modifiersClassNames={{ hasSession: "font-bold underline decoration-indigo-500 decoration-2 underline-offset-4" }}
            />

            <div className="flex items-center justify-between gap-2 p-3 border-t border-border">
              <span className="text-[11px] text-muted-foreground">
                {draftRange?.from
                  ? formatDateRange(isoOf(draftRange.from), isoOf(draftRange.to ?? draftRange.from))
                  : "Underlined days have sessions"}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {scope.kind === "range" && (
                  <button
                    onClick={() => {
                      setDraftRange(undefined);
                      setScope({ kind: "month", month: availableMonths[availableMonths.length - 1] ?? currentMonthKey() });
                      setRangeOpen(false);
                    }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X size={11} /> Clear
                  </button>
                )}
                <button
                  onClick={() => {
                    if (draftRange?.from) applyRange(draftRange.from, draftRange.to ?? draftRange.from);
                  }}
                  disabled={!draftRange?.from}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-apply-range"
                >
                  Apply
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

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
          <p className="text-muted-foreground/60 text-xs mt-1">
            {scope.kind === "range"
              ? "Try a wider date range, or switch to All time."
              : "Use the arrows to browse other months."}
          </p>
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
