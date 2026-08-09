import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
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

const UNSAVED_WARNING = "You have unsaved attendance changes. Discard them?";

export default function Attendance() {
  const { toast } = useToast();

  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"mark" | "overview">("mark");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

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

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-12 flex items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-muted-foreground/40" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="justify-end">
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
    </div>
  );
}
