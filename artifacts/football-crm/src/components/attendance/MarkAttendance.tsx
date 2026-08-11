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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { bulkUpsertAttendance, fetchAttendanceBySession } from "@/lib/queries";
import { ATTENDANCE_CFG, ATTENDANCE_STATUSES } from "@/lib/attendance";
import type { AttendanceStatus, Player, TrainingSession } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AttendanceDraft = Record<string, AttendanceStatus>;

/** Dot colours for the count line — a mark carries identity, the text stays ink. */
const STATUS_DOT: Record<AttendanceStatus, string> = {
  Present: "bg-[#0ca30c]",
  Absent:  "bg-[#d03b3b]",
  Late:    "bg-[#fab219]",
  Injured: "bg-[#ec835a]",
};

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
  /** Matches played on this date, when the day had more than one. */
  matchesOnDay?: number;
  players: Player[];
  /** Reports draft-vs-saved state up so the page can guard navigation. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called after a successful save so the strip counts refresh. */
  onSaved: (sessionId: string) => void;
}

export function MarkAttendance({
  session,
  matchesOnDay,
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

  return (
    <div className="space-y-4">
      {/* ── Toolbar — search and the running counts share one line ──────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-36 shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="w-full h-9 pl-9 pr-8 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-search-attendance"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {(matchesOnDay ?? 0) > 1 && (
          <span className="text-[11px] text-muted-foreground">
            {matchesOnDay} matches this day — attendance is taken once
          </span>
        )}

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {ATTENDANCE_STATUSES.map((status) => {
            const cfg = ATTENDANCE_CFG[status];
            const count = counts[status];
            return (
              <span key={status} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[status])} />
                <span className={cn("font-time font-medium", count > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {count}
                </span>
                {cfg.label}
              </span>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setAll("Present")}
            disabled={loading}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <CheckCheck size={13} /> All present
          </button>
          <button
            onClick={() => setAll("Absent")}
            disabled={loading}
            className="h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* ── Roster — one box per player, tap to toggle ──────────────────────── */}
      {loading ? (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-[68px] bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : visiblePlayers.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl py-12 text-center text-sm text-muted-foreground">
          No players match “{search}”
        </div>
      ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                aria-pressed={isPresent}
                onClick={() => toggleRow(player.id)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggleRow(player.id);
                  }
                }}
                className={cn(
                  // State is carried by the check and the border, never a fill
                  "rounded-xl border bg-card px-3 py-2.5 min-h-[46px] flex items-center",
                  "cursor-pointer select-none transition-colors",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                  isPresent
                    ? "border-status-good"
                    : isException
                      ? cfg.activeBorder
                      : "border-border hover:bg-muted/40",
                )}
                data-testid={`attendance-box-${player.id}`}
              >
                <div className="flex items-center gap-2 w-full">
                  <div
                    className={cn(
                      "w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-all",
                      isPresent
                        ? "bg-[#0ca30c] border-[#0ca30c] text-white"
                        : isException
                          ? cn("border-transparent", cfg.activeBg, cfg.activeColor)
                          : isDark ? "border-white/20" : "border-slate-300",
                    )}
                  >
                    {isPresent && <CheckCheck size={12} />}
                    {isException && <StatusIcon size={11} />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate leading-tight">{player.name}</div>
                    {isException && (
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">{cfg.label}</div>
                    )}
                  </div>

                  {/* Late / injured live behind this, so a tap can stay a toggle */}
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0 -mr-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Set status for ${player.name}`}
                          className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <MoreHorizontal size={13} />
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
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sticky save bar ─────────────────────────────────────────────────── */}
      {/* sticky (not fixed) so it tracks the content column whatever width the
          sidebar currently is */}
      <div className="sticky bottom-4 z-30">
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur",
            isDark ? "bg-slate-900/90 border-white/10" : "bg-white/95 border-slate-200",
          )}
        >
          <span className="flex-1 min-w-0 text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : loading ? "Loading…" : "All changes saved"}
          </span>
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
  );
}
