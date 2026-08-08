import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  CheckCheck,
  MoreHorizontal,
  RefreshCw,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { bulkUpsertAttendance, fetchAttendanceBySession } from "@/lib/queries";
import {
  ATTENDANCE_CFG,
  ATTENDANCE_STATUSES,
  SESSION_TYPE_CFG,
  formatDateLong,
} from "@/lib/attendance";
import type { AttendanceStatus, Player, TrainingSession } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AttendanceDraft = Record<string, AttendanceStatus>;

/** Everyone starts Absent; existing rows override. */
function buildDraft(players: Player[], rows: { player_id: string; status: AttendanceStatus }[]): AttendanceDraft {
  const draft: AttendanceDraft = {};
  for (const p of players) draft[p.id] = "Absent";
  for (const r of rows) {
    if (r.player_id in draft) draft[r.player_id] = r.status;
  }
  return draft;
}

function sameDraft(a: AttendanceDraft, b: AttendanceDraft): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

interface MarkAttendanceProps {
  session: TrainingSession | null;
  players: Player[];
  /** Reports draft-vs-saved state up so the page can guard navigation. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called after a successful save so the strip counts refresh. */
  onSaved: (sessionId: string) => void;
}

export function MarkAttendance({
  session,
  players,
  onDirtyChange,
  onSaved,
}: MarkAttendanceProps) {
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [saved, setSaved] = useState<AttendanceDraft>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // ── Load attendance for the selected session ───────────────────────────────
  useEffect(() => {
    if (!session) {
      setDraft({});
      setSaved({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSearch("");
    fetchAttendanceBySession(session.id)
      .then((rows) => {
        if (cancelled) return;
        const next = buildDraft(players, rows);
        setDraft(next);
        setSaved(next);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({ title: "Failed to load attendance", description: String(err), variant: "destructive" });
        const fallback = buildDraft(players, []);
        setDraft(fallback);
        setSaved(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, players]);

  const dirty = useMemo(() => !loading && !sameDraft(draft, saved), [draft, saved, loading]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Guard a browser refresh/close mid-marking
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { Present: 0, Absent: 0, Late: 0, Injured: 0 };
    for (const p of players) c[draft[p.id] ?? "Absent"]++;
    return c;
  }, [draft, players]);

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q),
    );
  }, [players, search]);

  // ── Interactions ───────────────────────────────────────────────────────────
  const setStatus = (playerId: string, status: AttendanceStatus) =>
    setDraft((d) => ({ ...d, [playerId]: status }));

  const toggleRow = (playerId: string) =>
    setDraft((d) => ({
      ...d,
      // Late/Injured are deliberate exceptions — tapping the row clears them
      // back to Absent rather than flipping to Present.
      [playerId]: d[playerId] === "Present" ? "Absent" : "Present",
    }));

  const setAll = (status: AttendanceStatus) => {
    const next: AttendanceDraft = {};
    for (const p of players) next[p.id] = status;
    setDraft(next);
  };

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    const snapshot = draft;
    try {
      // One request writing a row for every active player, Absents included.
      await bulkUpsertAttendance(
        session.id,
        players.map((p) => ({ player_id: p.id, status: snapshot[p.id] ?? "Absent" })),
      );
      setSaved(snapshot);
      onSaved(session.id);
      toast({ title: "Attendance saved", description: `${counts.Present + counts.Late} of ${players.length} attended` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to save attendance", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Empty states ───────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center bg-card border border-border rounded-2xl p-12 min-h-[280px] text-center">
        <Users size={36} className="text-muted-foreground/25 mb-3" />
        <p className="text-foreground text-sm font-medium">No session selected</p>
        <p className="text-muted-foreground/60 text-xs mt-1 max-w-[240px]">
          Pick a date above, or create a new session to start taking attendance.
        </p>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center bg-card border border-border rounded-2xl p-12 min-h-[280px] text-center">
        <Users size={36} className="text-muted-foreground/25 mb-3" />
        <p className="text-foreground text-sm font-medium">No active players</p>
        <button
          onClick={() => setLocation("/players")}
          className="mt-3 text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors"
        >
          Manage roster <ArrowRight size={13} />
        </button>
      </div>
    );
  }

  const typeCfg = SESSION_TYPE_CFG[session.session_type] ?? SESSION_TYPE_CFG.Training;

  return (
    <div className="space-y-3">
      {/* ── Session summary ─────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", typeCfg.bg, typeCfg.text)}>
          {session.session_type}
        </span>
        <span className="text-sm font-medium text-foreground">
          {formatDateLong(session.date)}
        </span>
        <span className="text-xs text-muted-foreground">{session.day}</span>
        <span className="text-xs text-muted-foreground font-time">{session.duration_mins} min</span>
        <span className="text-xs text-amber-400 font-time flex items-center gap-1">
          <Zap size={10} />{Math.round(session.planned_load_au)} AU
        </span>
        <button
          onClick={() => setLocation(`/sessions/${session.id}`)}
          className="ml-auto flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Full details <ArrowRight size={12} />
        </button>
      </div>

      {/* ── Roster ──────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="px-3 py-2.5 border-b border-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${players.length} players…`}
              className={cn(
                "w-full pl-8 pr-7 py-1.5 rounded-lg text-sm bg-muted border border-border text-foreground",
                "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary",
              )}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            onClick={() => setAll("Present")}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
          >
            <CheckCheck size={12} /> All present
          </button>
          <button
            onClick={() => setAll("Absent")}
            disabled={loading}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50",
              isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
            )}
          >
            Clear all
          </button>
        </div>

        {/* Count chips */}
        <div className={cn("px-3 py-2 flex flex-wrap gap-1.5 border-b", isDark ? "border-white/[0.06]" : "border-slate-100")}>
          {ATTENDANCE_STATUSES.map((status) => {
            const cfg = ATTENDANCE_CFG[status];
            const Icon = cfg.icon;
            const count = counts[status];
            return (
              <div
                key={status}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                  count > 0
                    ? cn(cfg.activeBg, cfg.activeColor)
                    : isDark ? "border-white/10 text-muted-foreground" : "border-slate-200 text-muted-foreground",
                )}
              >
                <Icon size={10} />
                {count} {cfg.label}
              </div>
            );
          })}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : visiblePlayers.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No players match “{search}”
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {visiblePlayers.map((player) => {
              const status = draft[player.id] ?? "Absent";
              const cfg = ATTENDANCE_CFG[status];
              const StatusIcon = cfg.icon;
              const isException = status === "Late" || status === "Injured";
              const isPresent = status === "Present";

              return (
                <div
                  key={player.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleRow(player.id)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggleRow(player.id);
                    }
                  }}
                  className={cn(
                    "px-3 py-2.5 min-h-[52px] flex items-center gap-3 cursor-pointer select-none transition-colors",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
                    isPresent
                      ? "bg-emerald-500/[0.07]"
                      : isDark ? "hover:bg-white/[0.03]" : "hover:bg-slate-50",
                  )}
                  data-testid={`attendance-row-${player.id}`}
                >
                  {/* Checkbox */}
                  <div
                    className={cn(
                      "w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-all",
                      isPresent
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : isException
                          ? cn("border-transparent", cfg.activeBg, cfg.activeColor)
                          : isDark ? "border-white/20" : "border-slate-300",
                    )}
                  >
                    {isPresent && <CheckCheck size={12} />}
                    {isException && <StatusIcon size={11} />}
                  </div>

                  {/* Player */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{player.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {player.primary_position || "—"}
                    </div>
                  </div>

                  {/* Status / exception menu */}
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Set status for ${player.name}`}
                          className={cn(
                            "flex items-center gap-1 h-7 rounded-lg border text-[11px] font-medium transition-colors",
                            isException
                              ? cn("px-2", cfg.activeBg, cfg.activeColor)
                              : cn(
                                  "w-7 justify-center",
                                  isDark
                                    ? "border-white/10 text-slate-500 hover:border-white/25 hover:text-slate-300"
                                    : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600",
                                ),
                          )}
                        >
                          {isException ? (
                            <>
                              <StatusIcon size={11} />
                              {cfg.label}
                            </>
                          ) : (
                            <MoreHorizontal size={13} />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        {ATTENDANCE_STATUSES.map((s) => {
                          const c = ATTENDANCE_CFG[s];
                          const Icon = c.icon;
                          return (
                            <DropdownMenuItem
                              key={s}
                              onSelect={() => setStatus(player.id, s)}
                              className={cn("gap-2 text-xs", status === s && "font-semibold")}
                            >
                              <Icon size={12} className={c.activeColor} />
                              {c.label}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Sticky save bar ─────────────────────────────────────────────────── */}
      {/* sticky (not fixed) so it tracks the content column whatever width the
          sidebar currently is */}
      <div className="sticky bottom-4 z-30">
        <div>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur",
              isDark ? "bg-slate-900/90 border-white/10" : "bg-white/95 border-slate-200",
            )}
          >
            <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
              <span className="text-emerald-400 font-medium font-time">{counts.Present} present</span>
              <span className="text-red-400 font-time">{counts.Absent} absent</span>
              {counts.Late > 0 && <span className="text-amber-400 font-time">{counts.Late} late</span>}
              {counts.Injured > 0 && <span className="text-orange-400 font-time">{counts.Injured} injured</span>}
              <span className="text-muted-foreground/70">
                {dirty ? "Unsaved changes" : loading ? "Loading…" : "All changes saved"}
              </span>
            </div>
            <button
              onClick={handleSave}
              disabled={!dirty || saving || loading}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-save-attendance"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              {saving ? "Saving…" : "Save attendance"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
