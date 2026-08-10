import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  ChevronDown,
  RefreshCw,
  Upload,
  FileSpreadsheet,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { SessionTypeBadge } from "@/components/Badges";
import {
  bulkUpsertAttendance,
  createTrainingSession,
  createPlayer,
} from "@/lib/queries";
import type { TrainingSession, Player, AttendanceStatus } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

// ── Component ─────────────────────────────────────────────────────────────────
interface ImportAttendanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: TrainingSession[];
  players: Player[];
  /** Called after a successful import so the parent can refetch. */
  onImported: () => void;
}

export function ImportAttendanceSheet({
  open,
  onOpenChange,
  sessions,
  players,
  onImported,
}: ImportAttendanceSheetProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [importStep, setImportStep] = useState<"upload" | "preview" | "done">("upload");
  const [importYear, setImportYear] = useState<number>(new Date().getFullYear());
  const [parsedCsv, setParsedCsv] = useState<ParsedCsv | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImport = () => {
    setImportStep("upload");
    setParsedCsv(null);
    setImportPreview(null);
  };

  const handleCsvText = (text: string) => {
    const parsed = parseCsvText(text);
    if (!parsed || parsed.dateColumns.length === 0) {
      toast({ title: "Invalid CSV", description: "Could not find date columns. Check the file format.", variant: "destructive" });
      return;
    }
    setParsedCsv(parsed);
    setImportPreview(buildPreview(parsed, importYear, sessions, players));
    setImportStep("preview");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvText(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = "";
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
          md.session = await createTrainingSession({
            date: md.isoDate,
            session_type: "Training",
            duration_mins: 90,
            planned_rpe: 5,
            notes: null,
          });
          newSessionCount++;
        }
      }

      // 2. Create any missing players
      for (const mp of matchedPlayers) {
        if (!mp.player) {
          mp.player = await createPlayer({
            name: mp.csvName,
            code: mp.csvName.toUpperCase().replace(/\s+/g, "_"),
            // A sheet import knows nothing about squad numbers — assign later
            jersey_number: null,
            primary_position: "",
            secondary_position: null,
            age: null,
            year_of_birth: null,
            age_range: null,
            team: "Sharks",
            is_active: true,
          });
          newPlayerCount++;
        }
      }

      // 3. Upsert attendance
      for (let di = 0; di < matchedDates.length; di++) {
        const md = matchedDates[di];
        if (!md.session) continue;

        const records: { player_id: string; status: AttendanceStatus }[] = [];
        for (let pi = 0; pi < parsedCsv.playerRows.length; pi++) {
          const mp = matchedPlayers[pi];
          if (!mp.player) continue;
          const status = CSV_STATUS_MAP[parsedCsv.playerRows[pi].statuses[di]];
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
      onImported();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const yearOptions = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) resetImport();
      }}
    >
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
                        ? "bg-status-good text-status-good"
                        : importStep === "done"
                          ? "bg-status-good text-status-good"
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
                    {yearOptions.map((y) => (
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
                  <AlertCircle size={11} className="text-status-warn" /> Expected format
                </p>
                <p className="text-muted-foreground">
                  Columns: <code className="text-indigo-400">id, code, NAME, 4/1, 4/3, …, Present, Absent, …</code>
                </p>
                <p className="text-muted-foreground">
                  Statuses: <code className="text-status-good">P</code> = Present · <code className="text-status-bad">A</code> = Absent · <code className="text-status-warn">I</code> = Injured
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
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Sessions */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Sessions ({importPreview.matchedDates.filter(d => d.session).length}/{parsedCsv.dateColumns.length} matched)
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {importPreview.matchedDates.map((md) => (
                    <div
                      key={md.col}
                      className={cn(
                        "flex items-center justify-between px-3 py-1.5 rounded-lg text-xs",
                        md.session
                          ? isDark ? "bg-status-good border border-status-good" : "bg-status-good border border-status-good"
                          : isDark ? "bg-status-warn border border-status-warn" : "bg-status-warn border border-status-warn",
                      )}
                    >
                      <span className={md.session ? "text-foreground" : "text-status-warn"}>
                        {md.isoDate || md.col}
                      </span>
                      {md.session ? (
                        <SessionTypeBadge type={md.session.session_type} className="text-[10px] px-1.5" />
                      ) : (
                        <span className="text-status-warn text-[10px] font-medium">will be created</span>
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
                    isDark ? "bg-status-warn border border-status-warn" : "bg-status-warn border border-status-warn",
                  )}>
                    <AlertCircle size={12} className="text-status-warn mt-0.5 shrink-0" />
                    <span className="text-status-warn dark:text-status-warn">
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
                          : isDark ? "bg-status-warn border border-status-warn" : "bg-status-warn border border-status-warn",
                      )}
                    >
                      <span className={mp.player ? "text-foreground" : "text-status-warn"}>{mp.csvName}</span>
                      {mp.player ? (
                        <span className="text-muted-foreground text-[10px]">matched</span>
                      ) : (
                        <span className="text-status-warn text-[10px] font-medium">will be added</span>
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
                  <p className="text-xs text-status-warn">
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
              <div>
                <p className="text-base font-semibold text-foreground">Import complete</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Attendance records have been saved. Check the Overview tab to verify.
                </p>
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={resetImport}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                    isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                  )}
                >
                  Import another
                </button>
                <button
                  onClick={() => onOpenChange(false)}
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
  );
}
