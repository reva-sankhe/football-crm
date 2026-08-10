import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAttendanceSummaryForSessions,
  fetchPlayers,
  fetchTrainingSessions,
} from "@/lib/queries";
import { collapseMatchDays } from "@/lib/attendance";
import type { Player, TrainingSession } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionStrip } from "@/components/attendance/SessionStrip";
import { MarkAttendance } from "@/components/attendance/MarkAttendance";
import { AttendanceMatrix } from "@/components/attendance/AttendanceMatrix";

const UNSAVED_WARNING = "You have unsaved attendance changes. Discard them?";

export default function Attendance() {
  const { toast } = useToast();

  /** Every session as stored. The list shown is derived from this, not held. */
  const [allSessions, setAllSessions] = useState<TrainingSession[]>([]);
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
      const [all, plist] = await Promise.all([fetchTrainingSessions(), fetchPlayers()]);

      // Counts are fetched for every session, not just the visible ones: they are
      // what tells collapseMatchDays which session on a match day already holds
      // that day's attendance, so existing rows are never stranded.
      setSummary(await fetchAttendanceSummaryForSessions(all.map((s) => s.id)));
      setAllSessions(all);
      setPlayers(plist.filter((p) => p.is_active));
    } catch (err) {
      toast({ title: "Error loading data", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // One entry per training session, but only one per match day.
  const { sessions, matchesOnDay } = useMemo(
    () => collapseMatchDays(allSessions, (id) => (summary[id]?.total ?? 0) > 0),
    [allSessions, summary],
  );

  // Keep the selection pointing at something visible. A match session created on a
  // date that already has one gets collapsed away, so fall back to that day's
  // entry rather than jumping the user to the top of the strip.
  useEffect(() => {
    if (loading || sessions.length === 0) return;
    setActiveSessionId((prev) => {
      if (prev && sessions.some((s) => s.id === prev)) return prev;
      const prevDate = allSessions.find((s) => s.id === prev)?.date;
      return sessions.find((s) => s.date === prevDate)?.id ?? sessions[0].id;
    });
  }, [sessions, allSessions, loading]);

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
    // Added to the raw list; collapsing and selection are handled by the effects
    // above, so a match on an existing match day folds into that day's entry.
    setAllSessions((prev) => [session, ...prev]);
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
              matchesOnDay={matchesOnDay}
              rosterSize={players.length}
              onSessionCreated={handleSessionCreated}
              canLeaveSession={confirmLeave}
            />
            <MarkAttendance
              session={activeSession}
              matchesOnDay={activeSessionId ? matchesOnDay[activeSessionId] : undefined}
              players={players}
              onDirtyChange={setDirty}
              onSaved={handleSaved}
            />
          </TabsContent>

          <TabsContent value="overview" className="mt-0">
            <AttendanceMatrix
              sessions={sessions}
              matchesOnDay={matchesOnDay}
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
