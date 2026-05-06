import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { DayPicker, DayButton } from "react-day-picker";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  Activity,
  ArrowRight,
  CalendarDays,
  Users,
  RefreshCw,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  fetchTrainingSessions,
  fetchPlayers,
  fetchAttendanceBySession,
  upsertAttendance,
  bulkUpsertAttendance,
  deleteAttendance,
} from "@/lib/queries";
import type { TrainingSession, Player, AttendanceStatus, SessionType } from "@/lib/types";

// ── Config ────────────────────────────────────────────────────────────────────
const SESSION_TYPE_CFG: Record<SessionType, { text: string; bg: string; dot: string; border: string }> = {
  Training: { text: "text-indigo-400",  bg: "bg-indigo-500/15",  dot: "bg-indigo-500",  border: "border-indigo-500/30" },
  Match:    { text: "text-amber-400",   bg: "bg-amber-500/15",   dot: "bg-amber-500",   border: "border-amber-500/30"  },
  Gym:      { text: "text-emerald-400", bg: "bg-emerald-500/15", dot: "bg-emerald-500", border: "border-emerald-500/30"},
  Recovery: { text: "text-slate-400",   bg: "bg-slate-500/15",   dot: "bg-slate-400",   border: "border-slate-500/30"  },
};

type AttendanceCfg = {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
  activeBg: string;
};
const ATTENDANCE_CFG: Record<AttendanceStatus, AttendanceCfg> = {
  Present: { label: "Present", icon: CheckCircle2, activeColor: "text-emerald-400", activeBg: "bg-emerald-500/20 border-emerald-500/40" },
  Absent:  { label: "Absent",  icon: XCircle,      activeColor: "text-red-400",     activeBg: "bg-red-500/20 border-red-500/40"         },
  Late:    { label: "Late",    icon: Clock,         activeColor: "text-amber-400",   activeBg: "bg-amber-500/20 border-amber-500/40"     },
  Injured: { label: "Injured", icon: Activity,      activeColor: "text-orange-400",  activeBg: "bg-orange-500/20 border-orange-500/40"   },
};
const ATTENDANCE_STATUSES: AttendanceStatus[] = ["Present", "Absent", "Late", "Injured"];

function formatDateLong(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Calendar Page ─────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  // Active session in the detail panel (when multiple sessions on one day)
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null);

  // Attendance: playerId → status or null (unmarked)
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus | null>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [savingPlayers, setSavingPlayers] = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);

  // ── Load sessions + players ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchTrainingSessions(), fetchPlayers()])
      .then(([sess, plist]) => {
        if (cancelled) return;
        setSessions(sess);
        setPlayers(plist.filter((p) => p.is_active));
      })
      .catch((err) => {
        if (!cancelled)
          toast({ title: "Error loading data", description: String(err), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Index sessions by ISO date ─────────────────────────────────────────────
  const sessionsByDate = useMemo(() => {
    const map: Record<string, TrainingSession[]> = {};
    for (const s of sessions) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }
    return map;
  }, [sessions]);

  // Dates that have at least one session (used as DayPicker modifier)
  const sessionDates = useMemo(
    () => Object.keys(sessionsByDate).map((d) => new Date(d + "T00:00:00")),
    [sessionsByDate],
  );

  // Sessions on the currently selected date
  const selectedDateSessions = useMemo(() => {
    if (!selectedDate) return [];
    const iso = format(selectedDate, "yyyy-MM-dd");
    return sessionsByDate[iso] ?? [];
  }, [selectedDate, sessionsByDate]);

  // ── Handle date click ──────────────────────────────────────────────────────
  const handleDaySelect = useCallback(
    (date: Date | undefined) => {
      setSelectedDate(date);
      setAttendance({});
      if (!date) {
        setActiveSession(null);
        return;
      }
      const iso = format(date, "yyyy-MM-dd");
      const dateSessions = sessionsByDate[iso] ?? [];
      setActiveSession(dateSessions[0] ?? null);
    },
    [sessionsByDate],
  );

  // Keep activeSession valid when sessions reload
  useEffect(() => {
    if (!selectedDate) return;
    const iso = format(selectedDate, "yyyy-MM-dd");
    const dateSessions = sessionsByDate[iso] ?? [];
    setActiveSession((prev) => {
      if (prev && dateSessions.some((s) => s.id === prev.id)) return prev;
      return dateSessions[0] ?? null;
    });
  }, [sessionsByDate, selectedDate]);

  // ── Load attendance when active session changes ────────────────────────────
  useEffect(() => {
    if (!activeSession) {
      setAttendance({});
      return;
    }
    let cancelled = false;
    setAttendanceLoading(true);
    fetchAttendanceBySession(activeSession.id)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, AttendanceStatus | null> = {};
        for (const r of rows) map[r.player_id] = r.status;
        setAttendance(map);
      })
      .catch(() => {/* silent */})
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeSession]);

  // ── Attendance interactions ────────────────────────────────────────────────
  const handleStatusClick = async (playerId: string, status: AttendanceStatus) => {
    if (!activeSession) return;
    const prev = attendance[playerId] ?? null;
    const next = prev === status ? null : status; // toggle off if same

    setAttendance((a) => ({ ...a, [playerId]: next }));
    setSavingPlayers((s) => new Set(s).add(playerId));
    try {
      if (next === null) {
        await deleteAttendance(activeSession.id, playerId);
      } else {
        await upsertAttendance(activeSession.id, playerId, next);
      }
    } catch (err) {
      toast({ title: "Failed to save", description: String(err), variant: "destructive" });
      setAttendance((a) => ({ ...a, [playerId]: prev }));
    } finally {
      setSavingPlayers((s) => { const ns = new Set(s); ns.delete(playerId); return ns; });
    }
  };

  const handleMarkAllPresent = async () => {
    if (!activeSession || players.length === 0) return;
    setMarkingAll(true);
    const newMap: Record<string, AttendanceStatus | null> = {};
    for (const p of players) newMap[p.id] = "Present";
    setAttendance(newMap);
    try {
      await bulkUpsertAttendance(
        activeSession.id,
        players.map((p) => ({ player_id: p.id, status: "Present" as AttendanceStatus })),
      );
      toast({ title: "All players marked Present ✓" });
    } catch (err) {
      toast({ title: "Failed to mark all", description: String(err), variant: "destructive" });
    } finally {
      setMarkingAll(false);
    }
  };

  // ── Attendance summary counts ──────────────────────────────────────────────
  const attendanceCount = useMemo(() => {
    const present  = players.filter((p) => attendance[p.id] === "Present").length;
    const late     = players.filter((p) => attendance[p.id] === "Late").length;
    const absent   = players.filter((p) => attendance[p.id] === "Absent").length;
    const injured  = players.filter((p) => attendance[p.id] === "Injured").length;
    const unmarked = players.filter((p) => !attendance[p.id]).length;
    return { present, late, absent, injured, unmarked, total: players.length };
  }, [attendance, players]);

  // ── Custom DayButton (stable ref pattern so no remounts) ──────────────────
  const sessionsByDateRef = useRef(sessionsByDate);
  sessionsByDateRef.current = sessionsByDate;

  const CustomDayButton = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return function CustomDayBtn({
      day,
      modifiers,
      ...props
    }: React.ComponentProps<typeof DayButton>) {
      const iso = format(day.date, "yyyy-MM-dd");
      const daySessions = sessionsByDateRef.current[iso] ?? [];
      const isSelected = modifiers.selected;
      const isToday    = modifiers.today;
      const isOutside  = modifiers.outside;

      return (
        <button
          {...props}
          className={cn(
            "relative flex flex-col items-center justify-center w-full aspect-square rounded-lg text-sm font-medium transition-all duration-100 select-none focus:outline-none",
            isSelected
              ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-offset-1 ring-offset-background"
              : isToday
                ? "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                : "text-foreground hover:bg-muted/60",
            isOutside && "opacity-30",
          )}
        >
          <span className="leading-none text-[13px]">{day.date.getDate()}</span>
          {daySessions.length > 0 && (
            <div className="flex gap-0.5 mt-0.5">
              {daySessions.slice(0, 3).map((s, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1 h-1 rounded-full",
                    isSelected
                      ? "bg-white/80"
                      : SESSION_TYPE_CFG[s.session_type]?.dot ?? "bg-indigo-500",
                  )}
                />
              ))}
            </div>
          )}
        </button>
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Calendar</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Session schedule & attendance tracker</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── Left: Calendar panel ─────────────────────────────────────────── */}
        <div
          className={cn(
            "w-full lg:w-auto flex-shrink-0 bg-card border border-border rounded-2xl p-4",
          )}
        >
          {/* Session type legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4 px-1">
            {(Object.entries(SESSION_TYPE_CFG) as [SessionType, (typeof SESSION_TYPE_CFG)[SessionType]][]).map(
              ([type, cfg]) => (
                <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                  {type}
                </div>
              ),
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-64 w-72">
              <RefreshCw size={20} className="animate-spin text-muted-foreground/40" />
            </div>
          ) : (
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDaySelect}
              month={month}
              onMonthChange={setMonth}
              showOutsideDays
              className="[--cell-size:2.5rem]"
              classNames={{
                root: "w-full",
                months: "w-full",
                month: "w-full",
                nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between",
                button_previous: cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                  isDark
                    ? "text-slate-400 hover:bg-white/8 hover:text-slate-200"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                ),
                button_next: cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                  isDark
                    ? "text-slate-400 hover:bg-white/8 hover:text-slate-200"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                ),
                month_caption: "relative flex h-10 items-center justify-center mb-1",
                caption_label: "text-sm font-semibold text-foreground",
                weekdays: "flex",
                weekday: "flex-1 text-center text-[11px] font-medium text-muted-foreground py-1",
                weeks: "mt-1",
                week: "flex mt-0.5",
                day: "flex-1 p-0.5",
                today: "",
                selected: "",
                outside: "",
                disabled: "opacity-40 cursor-not-allowed",
                hidden: "invisible",
              }}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === "left" ? (
                    <ChevronLeft size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  ),
                DayButton: CustomDayButton,
              }}
            />
          )}

          {/* Month session count summary */}
          {!loading && sessions.length > 0 && (
            <div
              className={cn(
                "mt-4 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between px-1",
                isDark ? "border-white/[0.06]" : "border-slate-200",
              )}
            >
              <span>{sessions.length} total sessions</span>
              <button
                onClick={() => setLocation("/sessions")}
                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                Manage <ArrowRight size={11} />
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Detail / Attendance panel ─────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!selectedDate ? (
            /* Empty state */
            <div
              className={cn(
                "flex flex-col items-center justify-center bg-card border border-border rounded-2xl p-12 min-h-[320px] text-center",
              )}
            >
              <CalendarDays size={40} className="text-muted-foreground/25 mb-4" />
              <p className="text-foreground text-sm font-medium">Select a date</p>
              <p className="text-muted-foreground/60 text-xs mt-1 max-w-[200px]">
                Click any date on the calendar to view sessions and track attendance
              </p>
            </div>
          ) : selectedDateSessions.length === 0 ? (
            /* No session on this date */
            <div className="flex flex-col items-center justify-center bg-card border border-border rounded-2xl p-12 min-h-[320px] text-center">
              <CalendarDays size={40} className="text-muted-foreground/25 mb-4" />
              <p className="text-foreground text-sm font-semibold">
                {format(selectedDate, "EEEE, d MMMM yyyy")}
              </p>
              <p className="text-muted-foreground/60 text-xs mt-1">No sessions scheduled on this date</p>
              <button
                onClick={() => setLocation("/sessions")}
                className="mt-4 text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 mx-auto transition-colors"
              >
                Create a session <ArrowRight size={13} />
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Date heading */}
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {format(selectedDate, "EEEE, d MMMM yyyy")}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedDateSessions.length} session{selectedDateSessions.length !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Session tabs (when multiple sessions on same day) */}
              {selectedDateSessions.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {selectedDateSessions.map((s) => {
                    const cfg = SESSION_TYPE_CFG[s.session_type];
                    const isActive = activeSession?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setActiveSession(s);
                          setAttendance({});
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                          isActive
                            ? cn(cfg.bg, cfg.text, cfg.border)
                            : isDark
                              ? "border-white/10 text-slate-400 hover:border-white/20"
                              : "border-slate-200 text-slate-500 hover:border-slate-300",
                        )}
                      >
                        {s.session_type} · {s.duration_mins} min
                      </button>
                    );
                  })}
                </div>
              )}

              {activeSession && (
                <>
                  {/* ── Session info card ─────────────────────────────────── */}
                  <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                            SESSION_TYPE_CFG[activeSession.session_type].bg,
                            SESSION_TYPE_CFG[activeSession.session_type].text,
                          )}
                        >
                          {activeSession.session_type}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {formatDateLong(activeSession.date)} · {activeSession.day}
                        </p>
                      </div>
                      <button
                        onClick={() => setLocation(`/sessions/${activeSession.id}`)}
                        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
                      >
                        Full details <ArrowRight size={12} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Duration</p>
                        <p className="text-base font-bold font-time text-foreground flex items-baseline gap-1">
                          {activeSession.duration_mins}
                          <span className="text-xs font-normal text-muted-foreground">min</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Planned RPE</p>
                        <p className="text-base font-bold font-time text-foreground">
                          {activeSession.planned_rpe.toFixed(1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">Planned Load</p>
                        <p className="text-base font-bold font-time text-amber-400 flex items-baseline gap-1">
                          <Zap size={11} className="shrink-0 self-center" />
                          {Math.round(activeSession.planned_load_au)}
                          <span className="text-xs font-normal text-amber-400/60">AU</span>
                        </p>
                      </div>
                    </div>

                    {activeSession.notes && (
                      <p className="text-xs text-muted-foreground border-t border-border pt-2">
                        {activeSession.notes}
                      </p>
                    )}
                  </div>

                  {/* ── Attendance card ───────────────────────────────────── */}
                  <div className="bg-card border border-border rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Users size={14} className="text-muted-foreground shrink-0" />
                        <h3 className="text-sm font-semibold text-foreground">Attendance</h3>
                        {!attendanceLoading && players.length > 0 && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {attendanceCount.present + attendanceCount.late}/{attendanceCount.total} attended
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleMarkAllPresent}
                        disabled={markingAll || players.length === 0 || attendanceLoading}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0",
                          "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        {markingAll ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : (
                          <CheckCheck size={12} />
                        )}
                        {markingAll ? "Saving…" : "All Present"}
                      </button>
                    </div>

                    {/* Summary chips */}
                    {!attendanceLoading && players.length > 0 && (
                      <div
                        className={cn(
                          "px-4 py-2 flex flex-wrap gap-1.5 border-b",
                          isDark ? "border-white/[0.06]" : "border-slate-100",
                        )}
                      >
                        {ATTENDANCE_STATUSES.map((status) => {
                          const count =
                            status === "Present"
                              ? attendanceCount.present
                              : status === "Late"
                                ? attendanceCount.late
                                : status === "Absent"
                                  ? attendanceCount.absent
                                  : attendanceCount.injured;
                          const cfg = ATTENDANCE_CFG[status];
                          const Icon = cfg.icon;
                          return (
                            <div
                              key={status}
                              className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                                count > 0 ? cn(cfg.activeBg, cfg.activeColor) : isDark ? "border-white/10 text-muted-foreground" : "border-slate-200 text-muted-foreground",
                              )}
                            >
                              <Icon size={10} />
                              {count} {cfg.label}
                            </div>
                          );
                        })}
                        {attendanceCount.unmarked > 0 && (
                          <div
                            className={cn(
                              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                              isDark ? "border-white/10 text-muted-foreground" : "border-slate-200 text-muted-foreground",
                            )}
                          >
                            {attendanceCount.unmarked} Unmarked
                          </div>
                        )}
                      </div>
                    )}

                    {/* Legend row */}
                    <div
                      className={cn(
                        "px-4 py-2 flex gap-3 flex-wrap border-b text-[10px] text-muted-foreground",
                        isDark ? "border-white/[0.06]" : "border-slate-100",
                      )}
                    >
                      {ATTENDANCE_STATUSES.map((status) => {
                        const cfg = ATTENDANCE_CFG[status];
                        const Icon = cfg.icon;
                        return (
                          <span key={status} className={cn("flex items-center gap-1", cfg.activeColor)}>
                            <Icon size={10} /> {cfg.label}
                          </span>
                        );
                      })}
                    </div>

                    {/* Player rows */}
                    {attendanceLoading ? (
                      <div className="p-4 space-y-2">
                        {[...Array(6)].map((_, i) => (
                          <div key={i} className="h-11 bg-muted/30 rounded-lg animate-pulse" />
                        ))}
                      </div>
                    ) : players.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No active players found
                      </div>
                    ) : (
                      <div className="divide-y divide-border/40">
                        {players.map((player) => {
                          const currentStatus = attendance[player.id] ?? null;
                          const isSaving = savingPlayers.has(player.id);

                          return (
                            <div
                              key={player.id}
                              className={cn(
                                "px-4 py-2.5 flex items-center gap-3 transition-colors",
                                isDark ? "hover:bg-white/[0.02]" : "hover:bg-slate-50/50",
                              )}
                            >
                              {/* Player info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {player.name}
                                  </span>
                                  <span
                                    className={cn(
                                      "shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                                      player.team === "Sharks"
                                        ? "bg-blue-500/15 text-blue-400"
                                        : "bg-violet-500/15 text-violet-400",
                                    )}
                                  >
                                    {player.team === "Sharks" ? "Sharks" : "Wildcats"}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground">{player.primary_position}</p>
                              </div>

                              {/* Status buttons */}
                              <div className="flex gap-1 shrink-0">
                                {isSaving ? (
                                  <div className="w-[120px] flex items-center justify-center">
                                    <RefreshCw size={13} className="animate-spin text-muted-foreground" />
                                  </div>
                                ) : (
                                  ATTENDANCE_STATUSES.map((status) => {
                                    const cfg = ATTENDANCE_CFG[status];
                                    const Icon = cfg.icon;
                                    const isActive = currentStatus === status;
                                    return (
                                      <button
                                        key={status}
                                        onClick={() => handleStatusClick(player.id, status)}
                                        title={cfg.label}
                                        className={cn(
                                          "w-7 h-7 flex items-center justify-center rounded-lg border transition-all duration-100",
                                          isActive
                                            ? cn(cfg.activeBg, cfg.activeColor)
                                            : isDark
                                              ? "border-white/10 text-slate-600 hover:border-white/20 hover:text-slate-400"
                                              : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600",
                                        )}
                                      >
                                        <Icon size={12} />
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
