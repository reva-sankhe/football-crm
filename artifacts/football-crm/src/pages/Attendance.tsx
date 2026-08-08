import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAttendanceSummaryForSessions,
  fetchPlayers,
  fetchTrainingSessions,
} from "@/lib/queries";
import type { Player, TrainingSession } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionStrip } from "@/components/attendance/SessionStrip";
import { MarkAttendance } from "@/components/attendance/MarkAttendance";
import { AttendanceMatrix } from "@/components/attendance/AttendanceMatrix";
import { ImportAttendanceSheet } from "@/components/attendance/ImportAttendanceSheet";

const UNSAVED_WARNING = "You have unsaved attendance changes. Discard them?";

export default function Attendance() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"mark" | "overview">("mark");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Per-session marked/attended counts for the strip
  const [summary, setSummary] = useState<Record<string, { total: number; present: number }>>({});
  // Bumped after a save/import so the matrix refetches
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Load sessions + players ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sess, plist] = await Promise.all([fetchTrainingSessions(), fetchPlayers()]);
      setSessions(sess);
      setPlayers(plist.filter((p) => p.is_active));
      setActiveSessionId((prev) =>
        prev && sess.some((s) => s.id === prev) ? prev : sess[0]?.id ?? null,
      );
      setSummary(await fetchAttendanceSummaryForSessions(sess.map((s) => s.id)));
    } catch (err) {
      toast({ title: "Error loading data", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  const confirmLeave = useCallback(
    () => !dirty || window.confirm(UNSAVED_WARNING),
    [dirty],
  );

  const handleTabChange = (next: string) => {
    if (next === tab) return;
    if (tab === "mark" && !confirmLeave()) return;
    // Leaving the tab unmounts MarkAttendance and discards its draft, so the
    // dirty flag has to be cleared here — the child won't report it again.
    setDirty(false);
    setTab(next as "mark" | "overview");
  };

  // ── Mutations from children ────────────────────────────────────────────────
  const handleSessionCreated = useCallback((session: TrainingSession) => {
    setSessions((prev) => [session, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    setActiveSessionId(session.id);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSaved = useCallback(async (sessionId: string) => {
    setRefreshKey((k) => k + 1);
    try {
      const next = await fetchAttendanceSummaryForSessions([sessionId]);
      setSummary((prev) => ({ ...prev, ...next }));
    } catch {
      /* the counts are cosmetic — a stale chip isn't worth a toast */
    }
  }, []);

  const handleJumpToSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setTab("mark");
  }, []);

  const handleImported = useCallback(() => {
    loadAll();
    setRefreshKey((k) => k + 1);
  }, [loadAll]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Attendance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Take attendance for a session, or review the whole squad
          </p>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors shrink-0",
            isDark
              ? "border-white/10 text-slate-300 hover:bg-white/5 hover:border-white/20"
              : "border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300",
          )}
        >
          <Upload size={14} />
          <span className="hidden sm:inline">Import CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-12 flex items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-muted-foreground/40" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="mark" data-testid="tab-mark">Mark</TabsTrigger>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          </TabsList>

          <TabsContent value="mark" className="space-y-4 mt-0">
            <SessionStrip
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={setActiveSessionId}
              marked={summary}
              rosterSize={players.length}
              onSessionCreated={handleSessionCreated}
              canLeaveSession={confirmLeave}
            />
            <MarkAttendance
              session={activeSession}
              players={players}
              onDirtyChange={setDirty}
              onSaved={handleSaved}
            />
          </TabsContent>

          <TabsContent value="overview" className="mt-0">
            <AttendanceMatrix
              sessions={sessions}
              players={players}
              refreshKey={refreshKey}
              onJumpToSession={handleJumpToSession}
            />
          </TabsContent>
        </Tabs>
      )}

      <ImportAttendanceSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        sessions={sessions}
        players={players}
        onImported={handleImported}
      />
    </div>
  );
}
