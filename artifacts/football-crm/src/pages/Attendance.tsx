import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAttendanceSummaryForSessions,
  fetchPlayers,
  fetchTrainingSessions,
  fetchTrainingSessionsPage,
} from "@/lib/queries";
import { collapseMatchDays } from "@/lib/attendance";
import { getErrorMessage } from "@/lib/utils";
import type { Player, TrainingSession } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionStrip } from "@/components/attendance/SessionStrip";
import { MarkAttendance } from "@/components/attendance/MarkAttendance";
import { AttendanceMatrix } from "@/components/attendance/AttendanceMatrix";

const UNSAVED_WARNING = "You have unsaved attendance changes. Discard them?";
const STRIP_PAGE_SIZE = 8;

type SummaryMap = Record<string, { total: number; present: number }>;

export default function Attendance() {
  const { toast } = useToast();

  // ── Mark tab — paginated, newest first. A full unpaginated fetch got
  // slower as sessions piled up; this loads fast and the strip's arrow pulls
  // in older ones on demand. ───────────────────────────────────────────────
  const [recentSessions, setRecentSessions] = useState<TrainingSession[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [summary, setSummary] = useState<SummaryMap>({});
  // How many rows true sequential pagination has fetched — kept separate from
  // recentSessions.length because handleJumpToSession can splice an older,
  // out-of-sequence session in, which must NOT shift where the next page starts.
  const [sessionOffset, setSessionOffset] = useState(0);

  // ── Overview tab — the full history, needed for its "all time" range and
  // date-picker highlights. Loaded once, lazily, the first time that tab is
  // actually opened, so it never slows down the common "mark attendance" path.
  const [fullSessions, setFullSessions] = useState<TrainingSession[] | null>(null);
  const [fullSummary, setFullSummary] = useState<SummaryMap | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"mark" | "overview">("mark");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Bumped after a save/import so the matrix refetches
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Initial load — first page of sessions + players only ──────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [page, plist] = await Promise.all([
        fetchTrainingSessionsPage(0, STRIP_PAGE_SIZE),
        fetchPlayers(),
      ]);
      setSummary(await fetchAttendanceSummaryForSessions(page.sessions.map((s) => s.id)));
      setRecentSessions(page.sessions);
      setSessionOffset(page.sessions.length);
      setHasMoreSessions(page.hasMore);
      setPlayers(plist.filter((p) => p.is_active));
    } catch (err) {
      toast({ title: "Error loading data", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadMoreSessions = useCallback(async () => {
    setLoadingMoreSessions(true);
    try {
      const page = await fetchTrainingSessionsPage(sessionOffset, STRIP_PAGE_SIZE);
      const nextSummary = await fetchAttendanceSummaryForSessions(page.sessions.map((s) => s.id));
      setRecentSessions((prev) => [...prev, ...page.sessions]);
      setSessionOffset((o) => o + page.sessions.length);
      setSummary((prev) => ({ ...prev, ...nextSummary }));
      setHasMoreSessions(page.hasMore);
    } catch (err) {
      toast({ title: "Failed to load more sessions", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setLoadingMoreSessions(false);
    }
  }, [sessionOffset, toast]);

  // ── Overview's full history, fetched once on first visit to that tab ──────
  const loadFullSessions = useCallback(async () => {
    setLoadingFull(true);
    try {
      const all = await fetchTrainingSessions();
      setFullSummary(await fetchAttendanceSummaryForSessions(all.map((s) => s.id)));
      setFullSessions(all);
    } catch (err) {
      toast({ title: "Error loading attendance history", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setLoadingFull(false);
    }
  }, [toast]);

  // One entry per training session, but only one per match day.
  const { sessions, matchesOnDay } = useMemo(
    () => collapseMatchDays(recentSessions, (id) => (summary[id]?.total ?? 0) > 0),
    [recentSessions, summary],
  );

  const { sessions: overviewSessions, matchesOnDay: overviewMatchesOnDay } = useMemo(
    () => fullSessions
      ? collapseMatchDays(fullSessions, (id) => (fullSummary?.[id]?.total ?? 0) > 0)
      : { sessions: [] as TrainingSession[], matchesOnDay: {} as Record<string, number> },
    [fullSessions, fullSummary],
  );

  // Keep the selection pointing at something visible. A match session created on a
  // date that already has one gets collapsed away, so fall back to that day's
  // entry rather than jumping the user to the top of the strip.
  useEffect(() => {
    if (loading || sessions.length === 0) return;
    setActiveSessionId((prev) => {
      if (prev && sessions.some((s) => s.id === prev)) return prev;
      const prevDate = recentSessions.find((s) => s.id === prev)?.date;
      return sessions.find((s) => s.date === prevDate)?.id ?? sessions[0].id;
    });
  }, [sessions, recentSessions, loading]);

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
    if (next === "overview" && fullSessions === null) loadFullSessions();
  };

  // ── Mutations from children ────────────────────────────────────────────────
  const handleSessionCreated = useCallback((session: TrainingSession) => {
    // Added to the raw list; collapsing and selection are handled by the effects
    // above, so a match on an existing match day folds into that day's entry.
    setRecentSessions((prev) => [session, ...prev]);
    // The new row sorts newest-first on the server too, pushing every already
    // -fetched row's position down by one — the next page has to start one
    // further in, or its first row would just be the last one we already have.
    setSessionOffset((o) => o + 1);
    setFullSessions((prev) => (prev ? [session, ...prev] : prev));
    setActiveSessionId(session.id);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSaved = useCallback(async (sessionId: string) => {
    setRefreshKey((k) => k + 1);
    try {
      const next = await fetchAttendanceSummaryForSessions([sessionId]);
      setSummary((prev) => ({ ...prev, ...next }));
      setFullSummary((prev) => (prev ? { ...prev, ...next } : prev));
    } catch {
      /* the counts are cosmetic — a stale chip isn't worth a toast */
    }
  }, []);

  // A session Overview points at might be older than what's paginated into
  // the strip — pull it in so Mark tab has something to show.
  const handleJumpToSession = useCallback((sessionId: string) => {
    setRecentSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev;
      const extra = fullSessions?.find((s) => s.id === sessionId);
      return extra ? [...prev, extra].sort((a, b) => b.date.localeCompare(a.date)) : prev;
    });
    if (fullSummary?.[sessionId]) {
      setSummary((prev) => ({ ...prev, [sessionId]: fullSummary[sessionId] }));
    }
    setActiveSessionId(sessionId);
    setTab("mark");
  }, [fullSessions, fullSummary]);

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
              hasMore={hasMoreSessions}
              onLoadMore={loadMoreSessions}
              loadingMore={loadingMoreSessions}
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
            {loadingFull || fullSessions === null ? (
              <div className="bg-card border border-border rounded-2xl p-12 flex items-center justify-center">
                <RefreshCw size={20} className="animate-spin text-muted-foreground/40" />
              </div>
            ) : (
              <AttendanceMatrix
                sessions={overviewSessions}
                matchesOnDay={overviewMatchesOnDay}
                players={players}
                refreshKey={refreshKey}
                onJumpToSession={handleJumpToSession}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
