import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { DayPicker, DayButton } from "react-day-picker";
import { format } from "date-fns";
import Papa from "papaparse";
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
  Upload,
  FileSpreadsheet,
  AlertCircle,
  ChevronDown,
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
  createTrainingSession,
  createPlayer,
} from "@/lib/queries";
import type { TrainingSession, Player, AttendanceStatus, SessionType } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

// ── CSV Import helpers ────────────────────────────────────────────────────────
const CSV_STATUS_MAP: Record<string, AttendanceStatus> = { P: "Present", A: "Absent", I: "Injured" };
const SUMMARY_COLS = new Set(["present", "absent", "injured/unavailable", "percentage"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CsvPlayerRow {
  csvId: string;
  csvName: string;
  statuses: string[]; // one entry per date column (P/A/I/blank)
}

interface ParsedCsv {
  dateColumns: string[];   // e.g. ["4/1", "4/3", "4/5"]
  playerRows: CsvPlayerRow[];
}

interface MatchedDate {
  col: string;
  isoDate: string;
  session: TrainingSession | null;
}

interface MatchedPlayer {
  csvId: string;
  csvName: string;
  player: Player | null;
}

interface ImportPreview {
  matchedDates: MatchedDate[];
  matchedPlayers: MatchedPlayer[];
  recordCount: number;
}

function parseCsvText(text: string): ParsedCsv | null {
  const result = Papa.parse<string[]>(text.trim(), { header: false, skipEmptyLines: true });
  const rows = result.data as string[][];
  const headerIdx = rows.findIndex((r) => r[1]?.trim().toLowerCase() === "id");
  if (headerIdx === -1) return null;

  const headerRow = rows[headerIdx];
  const allCols = headerRow.slice(4).map((c) => c.trim());
  const dateColumns = allCols.filter((c) => c && !SUMMARY_COLS.has(c.toLowerCase()));

  const playerRows: CsvPlayerRow[] = [];
  for (let i = headerIdx + 2; i < rows.length; i++) {
    const r = rows[i];
    const csvId = r[1]?.trim() ?? "";
    const csvName = r[3]?.trim() ?? "";
    if (!csvName) continue;
    const statuses = r.slice(4, 4 + dateColumns.length).map((s) => s?.trim() ?? "");
    playerRows.push({ csvId, csvName, statuses });
  }
  return { dateColumns, playerRows };
}

function parseDateCol(col: string, year: number): string | null {
  const parts = col.split("/");
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  if (!m || !d) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function matchPlayer(csvId: string, csvName: string, players: Player[]): Player | null {
  if (UUID_RE.test(csvId)) {
    const byId = players.find((p) => p.id === csvId);
    if (byId) return byId;
  }
  const lower = csvName.toLowerCase();
  return players.find((p) => p.name.trim().toLowerCase() === lower) ?? null;
}

function buildPreview(parsed: ParsedCsv, year: number, sessions: TrainingSession[], players: Player[]): ImportPreview {
  const matchedDates: MatchedDate[] = parsed.dateColumns.map((col) => {
    const isoDate = parseDateCol(col, year) ?? "";
    const session = isoDate ? (sessions.find((s) => s.date === isoDate) ?? null) : null;
    return { col, isoDate, session };
  });

  const matchedPlayers: MatchedPlayer[] = parsed.playerRows.map((r) => ({
    csvId: r.csvId,
    csvName: r.csvName,
    player: matchPlayer(r.csvId, r.csvName, players),
  }));

  let recordCount = 0;
  for (let pi = 0; pi < matchedPlayers.length; pi++) {
    for (let di = 0; di < parsed.dateColumns.length; di++) {
      if (matchedDates[di].isoDate && CSV_STATUS_MAP[parsed.playerRows[pi].statuses[di]]) {
        recordCount++;
      }
    }
  }

  return { matchedDates, matchedPlayers, recordCount };
}

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

  // ── CSV Import state ───────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "done">("upload");
  const [importYear, setImportYear] = useState<number>(new Date().getFullYear());
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ── CSV Import handlers ────────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      handleCsvText(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCsvText = (text: string) => {
    const parsed = parseCsvText(text);
    if (!parsed || parsed.dateColumns.length === 0) {
      toast({ title: "Invalid CSV", description: "Could not find date columns. Check the file format.", variant: "destructive" });
      return;
    }
    const preview = buildPreview(parsed, importYear, sessions, players);
    setParsedCsv(parsed);
    setImportPreview(preview);
    setImportStep("preview");
  };

  const handleYearChange = (year: number) => {
    setImportYear(year);
    if (parsedCsv) {
      setImportPreview(buildPreview(parsedCsv, year, sessions, players));
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedCsv || !importPreview) return;
    setImporting(true);
    let successSessions = 0;
    let totalRecords = 0;
    let newSessionCount = 0;
    let newPlayerCount = 0;
    try {
      // Build mutable copies so we can fill in newly-created records
      const matchedDates = importPreview.matchedDates.map((md) => ({ ...md }));
      const matchedPlayers = importPreview.matchedPlayers.map((mp) => ({ ...mp }));

      // 1. Create any missing sessions
      for (const md of matchedDates) {
        if (!md.session && md.isoDate) {
          const created = await createTrainingSession({
            date: md.isoDate,
            session_type: "Training",
            duration_mins: 90,
            planned_rpe: 5,
            notes: null,
          });
          md.session = created;
          newSessionCount++;
        }
      }
      if (newSessionCount > 0) {
        setSessions((prev) => [...prev, ...matchedDates.filter((md) => md.session).map((md) => md.session!)]);
      }

      // 2. Create any missing players
      const createdPlayers: Player[] = [];
      for (const mp of matchedPlayers) {
        if (!mp.player) {
          const code = mp.csvName.toUpperCase().replace(/\s+/g, "_");
          const created = await createPlayer({
            name: mp.csvName,
            code,
            primary_position: "",
            secondary_position: null,
            age: null,
            year_of_birth: null,
            age_range: null,
            team: "Sharks",
            is_active: true,
          });
          mp.player = created;
          createdPlayers.push(created);
          newPlayerCount++;
        }
      }
      if (createdPlayers.length > 0) {
        setPlayers((prev) => [...prev, ...createdPlayers]);
      }

      // 3. Upsert attendance
      for (let di = 0; di < matchedDates.length; di++) {
        const md = matchedDates[di];
        if (!md.session) continue;

        const records: { player_id: string; status: AttendanceStatus }[] = [];
        for (let pi = 0; pi < parsedCsv.playerRows.length; pi++) {
          const mp = matchedPlayers[pi];
          if (!mp.player) continue;
          const rawStatus = parsedCsv.playerRows[pi].statuses[di];
          const status = CSV_STATUS_MAP[rawStatus];
          if (!status) continue;
          records.push({ player_id: mp.player.id, status });
        }

        if (records.length > 0) {
          await bulkUpsertAttendance(md.session.id, records);
          successSessions++;
          totalRecords += records.length;
        }
      }

      const extras: string[] = [];
      if (newSessionCount > 0) extras.push(`${newSessionCount} session${newSessionCount > 1 ? "s" : ""} created`);
      if (newPlayerCount > 0) extras.push(`${newPlayerCount} player${newPlayerCount > 1 ? "s" : ""} added to roster`);
      const extraNote = extras.length > 0 ? ` · ${extras.join(" · ")}` : "";
      toast({ title: "Import complete", description: `${totalRecords} records across ${successSessions} sessions${extraNote}` });
      setImportStep("done");

      // Refresh attendance for currently-viewed session
      if (activeSession) {
        fetchAttendanceBySession(activeSession.id).then((rows) => {
          const map: Record<string, AttendanceStatus | null> = {};
          for (const r of rows) map[r.player_id] = r.status;
          setAttendance(map);
        });
      }
    } catch (err) {
      toast({ title: "Import failed", description: String(err), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setImportStep("upload");
    setParsedCsv(null);
    setImportPreview(null);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Session schedule & attendance tracker</p>
        </div>
        <button
          onClick={() => { setImportOpen(true); resetImport(); }}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors shrink-0",
            isDark
              ? "border-white/10 text-slate-300 hover:bg-white/5 hover:border-white/20"
              : "border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300",
          )}
        >
          <Upload size={14} />
          Import CSV
        </button>
      </div>

      {/* ── CSV Import Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-indigo-400" />
              <SheetTitle>Import Attendance CSV</SheetTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Upload your Google Sheets attendance export. Dates are matched to existing sessions.
            </p>
          </SheetHeader>

          <div className="py-5 space-y-5">
            {/* Step indicators */}
            <div className="flex items-center gap-2 text-xs">
              {(["upload", "preview", "done"] as const).map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold",
                      importStep === step
                        ? "bg-indigo-500 text-white"
                        : importStep === "preview" && step === "upload"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : importStep === "done"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : isDark ? "bg-white/10 text-slate-500" : "bg-slate-100 text-slate-400",
                    )}
                  >
                    {(importStep === "preview" && step === "upload") || importStep === "done" ? "✓" : i + 1}
                  </span>
                  <span className={cn("capitalize", importStep === step ? "text-foreground font-medium" : "text-muted-foreground")}>
                    {step === "upload" ? "Upload" : step === "preview" ? "Preview" : "Done"}
                  </span>
                  {i < 2 && <span className="text-muted-foreground/40">›</span>}
                </div>
              ))}
            </div>

            {/* ── Step 1: Upload ── */}
            {importStep === "upload" && (
              <div className="space-y-4">
                {/* Year picker */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Year
                  </label>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    CSV dates have no year — select the year these sessions belong to.
                  </p>
                  <div className="relative inline-block">
                    <select
                      value={importYear}
                      onChange={(e) => handleYearChange(Number(e.target.value))}
                      className={cn(
                        "appearance-none pl-3 pr-8 py-2 rounded-lg text-sm border transition-colors",
                        isDark
                          ? "bg-card border-white/10 text-foreground"
                          : "bg-white border-slate-200 text-slate-800",
                      )}
                    >
                      {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Upload area */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    CSV File
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "mt-2 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors",
                      isDark
                        ? "border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5"
                        : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30",
                    )}
                  >
                    <Upload size={24} className="text-muted-foreground/40" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">Click to upload CSV</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Google Sheets attendance export
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>

                {/* Format hint */}
                <div className={cn(
                  "rounded-lg p-3 text-xs space-y-1",
                  isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-slate-50 border border-slate-100",
                )}>
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <AlertCircle size={11} className="text-amber-400" /> Expected format
                  </p>
                  <p className="text-muted-foreground">
                    Columns: <code className="text-indigo-400">id, code, NAME, 4/1, 4/3, …, Present, Absent, …</code>
                  </p>
                  <p className="text-muted-foreground">
                    Statuses: <code className="text-emerald-400">P</code> = Present · <code className="text-red-400">A</code> = Absent · <code className="text-orange-400">I</code> = Injured
                  </p>
                </div>
              </div>
            )}

            {/* ── Step 2: Preview ── */}
            {importStep === "preview" && importPreview && parsedCsv && (
              <div className="space-y-4">
                {/* Year adjustment */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Year:</span>
                  <div className="relative inline-block">
                    <select
                      value={importYear}
                      onChange={(e) => handleYearChange(Number(e.target.value))}
                      className={cn(
                        "appearance-none pl-2 pr-7 py-1 rounded-lg text-xs border transition-colors",
                        isDark ? "bg-card border-white/10 text-foreground" : "bg-white border-slate-200 text-slate-800",
                      )}
                    >
                      {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Sessions */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sessions ({importPreview.matchedDates.filter(d => d.session).length}/{parsedCsv.dateColumns.length} matched)</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importPreview.matchedDates.map((md) => (
                      <div
                        key={md.col}
                        className={cn(
                          "flex items-center justify-between px-3 py-1.5 rounded-lg text-xs",
                          md.session
                            ? isDark ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-50 border border-emerald-100"
                            : isDark ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-100",
                        )}
                      >
                        <span className={md.session ? "text-foreground" : "text-amber-500"}>
                          {md.isoDate || md.col}
                        </span>
                        {md.session ? (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            SESSION_TYPE_CFG[md.session.session_type].bg,
                            SESSION_TYPE_CFG[md.session.session_type].text,
                          )}>
                            {md.session.session_type}
                          </span>
                        ) : (
                          <span className="text-amber-500 text-[10px] font-medium">will be created</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Players */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Players ({importPreview.matchedPlayers.filter(p => p.player).length}/{parsedCsv.playerRows.length} matched)
                  </p>
                  {importPreview.matchedPlayers.some(p => !p.player) && (
                    <div className={cn(
                      "flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-2",
                      isDark ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200",
                    )}>
                      <AlertCircle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-amber-600 dark:text-amber-400">
                        {importPreview.matchedPlayers.filter(p => !p.player).length} new player{importPreview.matchedPlayers.filter(p => !p.player).length > 1 ? "s" : ""} will be added to the Sharks roster on import.
                      </span>
                    </div>
                  )}
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importPreview.matchedPlayers.map((mp, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center justify-between px-3 py-1.5 rounded-lg text-xs",
                          mp.player
                            ? isDark ? "bg-white/[0.03] border border-white/[0.06]" : "bg-white border border-slate-100"
                            : isDark ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-100",
                        )}
                      >
                        <span className={mp.player ? "text-foreground" : "text-amber-500"}>{mp.csvName}</span>
                        {mp.player ? (
                          <span className="text-muted-foreground text-[10px]">matched</span>
                        ) : (
                          <span className="text-amber-500 text-[10px] font-medium">will be added</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Summary + confirm */}
                <div className={cn(
                  "rounded-lg px-4 py-3 space-y-3",
                  isDark ? "bg-indigo-500/10 border border-indigo-500/20" : "bg-indigo-50 border border-indigo-100",
                )}>
                  <p className="text-sm font-medium text-foreground">
                    Ready to import <span className="text-indigo-400">{importPreview.recordCount}</span> attendance records across{" "}
                    <span className="text-indigo-400">{importPreview.matchedDates.filter(d => d.isoDate).length}</span> sessions
                  </p>
                  {(importPreview.matchedDates.some(d => !d.session && d.isoDate) || importPreview.matchedPlayers.some(p => !p.player)) && (
                    <p className="text-xs text-amber-500">
                      {[
                        importPreview.matchedDates.filter(d => !d.session && d.isoDate).length > 0 && `${importPreview.matchedDates.filter(d => !d.session && d.isoDate).length} new session${importPreview.matchedDates.filter(d => !d.session && d.isoDate).length > 1 ? "s" : ""} will be created`,
                        importPreview.matchedPlayers.filter(p => !p.player).length > 0 && `${importPreview.matchedPlayers.filter(p => !p.player).length} new player${importPreview.matchedPlayers.filter(p => !p.player).length > 1 ? "s" : ""} will be added to the roster`,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Existing records for matched sessions will be overwritten.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={resetImport}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-medium border transition-colors",
                        isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                      )}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleConfirmImport}
                      disabled={importing || importPreview.recordCount === 0}
                      className="flex-1 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                    >
                      {importing ? <RefreshCw size={11} className="animate-spin" /> : null}
                      {importing ? "Importing…" : "Confirm Import"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 3: Done ── */}
            {importStep === "done" && (
              <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCheck size={22} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">Import complete!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Attendance records have been saved. Click any session date on the calendar to verify.
                  </p>
                </div>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => { resetImport(); }}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                      isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    Import another
                  </button>
                  <button
                    onClick={() => setImportOpen(false)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
