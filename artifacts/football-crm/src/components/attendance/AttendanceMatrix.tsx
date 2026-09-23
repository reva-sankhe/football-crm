import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CalendarRange, Check, RefreshCw, SlidersHorizontal } from "lucide-react";
import { cn, getErrorMessage } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { fetchAttendanceForSessions, upsertAttendance } from "@/lib/queries";
import {
  ATTENDANCE_CFG,
  ATTENDANCE_STATUSES,
  SESSION_TYPE_CFG,
  attendancePctColor,
  countsAsAttended,
  formatDateLong,
  isExcusedAbsence,
  tallyAttendance,
} from "@/lib/attendance";
import { availabilityLabel, type Availability } from "@/lib/injuries";
import { ReportInjuryDialog } from "@/components/injuries/ReportInjuryDialog";
import { DateRangePicker, isoOf, type IsoRange } from "@/components/DateRangePicker";
import { CountPill, IconButton, SearchInput, TOOLBAR_MENU, TOOLBAR_SELECT } from "@/components/Toolbar";
import type { AttendanceStatus, Player, TrainingSession } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortMode = "name" | "lowest" | "highest";

const SORT_LABELS: Record<SortMode, string> = {
  name: "Name",
  lowest: "Lowest %",
  highest: "Highest %",
};

/** Bands match `attendancePctColor` — the 75% minimum is the one that matters. */
type PctBand = "" | "below75" | "75to84" | "85plus";

const PCT_BANDS: { value: PctBand; label: string }[] = [
  { value: "",        label: "All attendance" },
  { value: "below75", label: "Not meeting 75%" },
  { value: "75to84",  label: "75–84%" },
  { value: "85plus",  label: "85% and above" },
];

function inBand(pct: number, band: PctBand): boolean {
  if (band === "below75") return pct < 75;
  if (band === "75to84") return pct >= 75 && pct < 85;
  if (band === "85plus") return pct >= 85;
  return true;
}

/** The month we're in, as an inclusive ISO range — the default scope. */
function currentMonthRange(): IsoRange {
  const now = new Date();
  return {
    from: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/** playerId → sessionId → status */
type Grid = Record<string, Record<string, AttendanceStatus>>;

interface PlayerStats {
  player: Player;
  /** By the status shown — an absence while injured counts under Injured. */
  counts: Record<AttendanceStatus, number>;
  attended: number;
  /** Sessions missed while injured, left out of `pct`. */
  excused: number;
  /** null when every session in range was excused. */
  pct: number | null;
}

interface AttendanceMatrixProps {
  sessions: TrainingSession[];   // newest first
  /** Canonical session id → matches that day. Only set when a day had several. */
  matchesOnDay?: Record<string, number>;
  players: Player[];
  /** Who was injured when: an absence inside an injury shows as Injured and is excused. */
  availability: Availability;
  /** After the report form records an injury, so `availability` can refetch. */
  onInjuryRecorded: () => void;
  /** Bumped by the parent after a save/import to force a refetch. */
  refreshKey: number;
  onJumpToSession: (sessionId: string) => void;
}

export function AttendanceMatrix({
  sessions, matchesOnDay, players, availability, onInjuryRecorded, refreshKey, onJumpToSession,
}: AttendanceMatrixProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  /** One scope control: a date range, defaulting to this month. null = all time. */
  const [range, setRange] = useState<IsoRange | null>(currentMonthRange);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [search, setSearch] = useState("");
  const [pctBand, setPctBand] = useState<PctBand>("");
  const [grid, setGrid] = useState<Grid>({});
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<"sort" | "filters" | null>(null);
  /** The cell whose "Injured…" pick is being reported. */
  const [reporting, setReporting] = useState<{ player: Player; session: TrainingSession } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const inRange = (date: string, r: IsoRange | null) => !r || (date >= r.from && date <= r.to);

  // Newest → oldest, so the most recent session is the first column you read
  const scopedSessions = useMemo(
    () => sessions.filter((s) => inRange(s.date, range)).sort((a, b) => b.date.localeCompare(a.date)),
    [sessions, range],
  );

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
        if (!cancelled) toast({ title: "Failed to load attendance", description: getErrorMessage(err), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIds.join(","), refreshKey]);

  // ── Per-player stats ───────────────────────────────────────────────────────
  const shownStatus = (playerId: string, s: TrainingSession): AttendanceStatus | undefined => {
    const status = grid[playerId]?.[s.id];
    return isExcusedAbsence(status, availability, playerId, s.date) ? "Injured" : status;
  };

  const tallyFor = (playerId: string) => tallyAttendance(
    scopedSessions,
    (s) => countsAsAttended(grid[playerId]?.[s.id]),
    (s) => isExcusedAbsence(grid[playerId]?.[s.id], availability, playerId, s.date),
  );

  const stats: PlayerStats[] = useMemo(() => {
    const rows = players.map((player) => {
      const counts: Record<AttendanceStatus, number> = { Present: 0, Absent: 0, Late: 0, Injured: 0 };
      for (const s of scopedSessions) {
        const status = shownStatus(player.id, s);
        if (status) counts[status]++;
      }
      const t = tallyFor(player.id);
      return { player, counts, attended: t.attended, excused: t.excused, pct: t.pct };
    });

    const q = search.trim().toLowerCase();
    const filtered = rows.filter(
      (r) => (!q || r.player.name.toLowerCase().includes(q))
        && (pctBand === "" || (r.pct !== null && inBand(r.pct, pctBand))),
    );

    // A player with nothing to score (injured throughout) sorts after everyone
    const byPct = (dir: 1 | -1) => (a: PlayerStats, b: PlayerStats) =>
      (a.pct === null ? 1 : 0) - (b.pct === null ? 1 : 0)
      || dir * ((a.pct ?? 0) - (b.pct ?? 0))
      || a.player.name.localeCompare(b.player.name);
    if (sortMode === "lowest") return filtered.sort(byPct(1));
    if (sortMode === "highest") return filtered.sort(byPct(-1));
    return filtered.sort((a, b) => a.player.name.localeCompare(b.player.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, scopedSessions, grid, sortMode, search, pctBand, availability]);

  // Dismiss whichever popover is open on an outside click or Escape
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // The export menu holds a date picker that portals out of this subtree,
      // so clicks inside a Radix popper must not read as "outside".
      if (target?.closest?.("[data-radix-popper-content-wrapper]")) return;
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // One height and one shape for every control on the bar — as on Players
  /** The whole squad's average, not the filtered subset's — filtering the list
      shouldn't move the headline number. */
  const teamPct = useMemo(() => {
    if (players.length === 0 || scopedSessions.length === 0) return null;
    // Averaged over players who have a percentage — injured throughout, none
    const pcts = players.map((p) => tallyFor(p.id).pct).filter((x): x is number => x !== null);
    if (pcts.length === 0) return null;
    return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, scopedSessions, grid, availability]);

  // ── Inline cell edit ───────────────────────────────────────────────────────
  const handleCellChange = async (playerId: string, sessionId: string, status: AttendanceStatus) => {
    if (!isAdmin) return;
    // As on the Mark tab: an injury is reported, and the row saved as Absent
    if (status === "Injured") {
      const player = players.find((p) => p.id === playerId);
      const session = scopedSessions.find((s) => s.id === sessionId);
      if (player && session) setReporting({ player, session });
      return;
    }
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
      toast({ title: "Failed to update", description: getErrorMessage(err), variant: "destructive" });
    }
  };


  // Highlight days that actually have a session, so the picker shows where data is
  const sessionDays = useMemo(
    () => sessions.map((s) => new Date(s.date + "T00:00:00")),
    [sessions],
  );

  return (
    <div className="space-y-3">
      {/* ── Toolbar — search · date · filters · export · average ─────────────── */}
      <div className="flex items-center gap-2 flex-wrap" ref={barRef}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search players…"
          className="flex-1 max-w-xs"
          data-testid="input-search-attendance-overview"
        />

        {/* Scope for everything below, defaulting to this month */}
        <DateRangePicker
          value={range}
          onChange={setRange}
          highlightDates={sessionDays}
          label="All time"
          iconOnly
        />

        <div className="relative">
          <IconButton
            label="Sort and filter"
            onClick={() => setOpenMenu((m) => (m === "filters" ? null : "filters"))}
            active={openMenu === "filters" || pctBand !== "" || sortMode !== "name"}
            badge={pctBand !== "" ? 1 : 0}
            aria-expanded={openMenu === "filters"}
            data-testid="button-attendance-filters"
          >
            <SlidersHorizontal size={15} />
          </IconButton>

          {openMenu === "filters" && (
            <div className={cn(TOOLBAR_MENU, "space-y-3")} data-testid="attendance-filter-panel">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Sort by</div>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setSortMode(key)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                      sortMode === key ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                    data-testid={`button-sort-${key}`}
                  >
                    <Check size={13} className={cn(sortMode === key ? "text-indigo-400" : "opacity-0")} />
                    {SORT_LABELS[key]}
                  </button>
                ))}
              </div>

              <div className="pt-1 border-t border-border">
                <label className="block text-xs text-muted-foreground mb-1 mt-2">Attendance</label>
                <select
                  value={pctBand}
                  onChange={(e) => setPctBand(e.target.value as PctBand)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-attendance"
                >
                  {PCT_BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>

              {(pctBand !== "" || sortMode !== "name") && (
                <button
                  onClick={() => { setPctBand(""); setSortMode("name"); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>


        {teamPct != null && (
          <CountPill
            title={`Squad average across ${scopedSessions.length} session${scopedSessions.length !== 1 ? "s" : ""}`}
            className={attendancePctColor(teamPct)}
            data-testid="text-squad-average"
          >
            {teamPct}%
          </CountPill>
        )}
      </div>

      {/* ── Empty / loading ─────────────────────────────────────────────────── */}
      {scopedSessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <CalendarRange size={36} className="mx-auto text-muted-foreground/25 mb-3" />
          <p className="text-foreground text-sm font-medium">No sessions in this period</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            Widen the date range, or clear it to see all time.
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
            {/* Full height — the page scrolls, not a window onto the table.
                Horizontal overflow stays for wide ranges, where the name and %
                columns pin to the left. */}
            <div className="overflow-x-auto">
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
                          title={
                            (matchesOnDay?.[s.id] ?? 0) > 1
                              ? `${formatDateLong(s.date)} · ${matchesOnDay![s.id]} matches`
                              : `${formatDateLong(s.date)} · ${s.session_type}`
                          }
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
                  {stats.map(({ player, counts, pct, excused }) => (
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
                        {pct === null ? (
                          <span className="text-sm text-muted-foreground" title="Every session in range was missed while injured">—</span>
                        ) : (
                          <span
                            className={cn("text-sm font-bold font-time", attendancePctColor(pct))}
                            title={excused > 0 ? `${excused} session${excused !== 1 ? "s" : ""} missed while injured left out` : undefined}
                          >
                            {pct}
                          </span>
                        )}
                      </td>

                      {scopedSessions.map((s) => {
                        const status = shownStatus(player.id, s);
                        const cfg = status ? ATTENDANCE_CFG[status] : null;
                        const injured = status === "Injured" ? availability.on(player.id, s.date) : null;
                        const cellTitle = `${player.name} · ${s.date} · ${
                          injured ? `Injured — ${availabilityLabel(injured)}` : status ?? "not recorded"}`;
                        return (
                          <td key={s.id} className="border-b border-border/60 p-0.5 text-center">
                            {isAdmin ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    title={cellTitle}
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
                                        {opt === "Injured" ? "Injured…" : c.label}
                                      </DropdownMenuItem>
                                    );
                                  })}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <span
                                title={cellTitle}
                                className={cn(
                                  "inline-flex w-7 h-7 rounded-md text-[11px] font-bold border items-center justify-center",
                                  cfg
                                    ? cn(cfg.activeBg, cfg.activeColor)
                                    : "border-transparent text-muted-foreground/30",
                                )}
                              >
                                {cfg ? cfg.short : "–"}
                              </span>
                            )}
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
            {stats.map(({ player, counts, attended, excused, pct }) => (
              <Link
                key={player.id}
                href={`/players/${player.id}`}
                className="block bg-card border border-border rounded-xl px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{player.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {attended} of {scopedSessions.length - excused} sessions
                      {excused > 0 && ` · ${excused} excused (injury)`}
                    </div>
                  </div>
                  {pct === null
                    ? <span className="text-xl text-muted-foreground shrink-0">—</span>
                    : <span className={cn("text-xl font-bold font-time shrink-0", attendancePctColor(pct))}>{pct}%</span>}
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

      {reporting && (
        <ReportInjuryDialog
          player={reporting.player}
          session={reporting.session}
          matchesOnDay={matchesOnDay?.[reporting.session.id]}
          offerStillOut
          onClose={() => setReporting(null)}
          onRecorded={async (result) => {
            const { player, session } = reporting;
            setReporting(null);
            // Saved as Absent; the injury is what makes it read as Injured
            const prev = grid[player.id]?.[session.id];
            if (prev !== "Absent") {
              setGrid((g) => ({ ...g, [player.id]: { ...g[player.id], [session.id]: "Absent" } }));
              try {
                await upsertAttendance(session.id, player.id, "Absent");
              } catch (err) {
                toast({ title: "Failed to update", description: getErrorMessage(err), variant: "destructive" });
              }
            }
            if (result.kind === "created") onInjuryRecorded();
            else toast({ title: `${player.name}: still out`, description: "Recorded as an excused absence" });
          }}
        />
      )}
    </div>
  );
}
