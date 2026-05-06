import { supabase } from "./supabase";
import type { Player, TestSession, TestResult, TrainingSession, SessionRPE, SessionAttendance, AttendanceStatus } from "./types";

// Players
export async function fetchPlayers(team?: string): Promise<Player[]> {
  let q = supabase.from("players").select("*").order("name");
  if (team) q = q.eq("team", team);
  const { data, error } = await q;
  if (error) throw error;
  return data as Player[];
}

export async function fetchPlayer(id: string): Promise<Player | null> {
  const { data, error } = await supabase.from("players").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Player;
}

export async function createPlayer(player: Omit<Player, "id" | "created_at">): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .insert({ id: crypto.randomUUID(), ...player })
    .select()
    .single();
  if (error) throw error;
  return data as Player;
}

export async function updatePlayer(id: string, updates: Partial<Player>): Promise<Player> {
  const { data, error } = await supabase.from("players").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as Player;
}

// Test Sessions
export async function fetchSessions(): Promise<TestSession[]> {
  const { data, error } = await supabase.from("test_sessions").select("*").order("test_date", { ascending: false });
  if (error) throw error;
  return data as TestSession[];
}

export async function createSession(session: Omit<TestSession, "id" | "created_at">): Promise<TestSession> {
  const { data, error } = await supabase.from("test_sessions").insert(session).select().single();
  if (error) throw error;
  return data as TestSession;
}

// Test Results
export async function fetchResultsBySession(sessionId: string): Promise<TestResult[]> {
  const { data, error } = await supabase
    .from("test_results")
    .select("*")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data as TestResult[];
}

export async function fetchResultsBySessionWithPlayers(sessionId: string): Promise<(TestResult & { players: Player })[]> {
  const { data, error } = await supabase
    .from("test_results")
    .select("*, players(*)")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data as (TestResult & { players: Player })[];
}

export async function fetchResultsByPlayer(playerId: string): Promise<TestResult[]> {
  const { data, error } = await supabase
    .from("test_results")
    .select("*, test_sessions(test_date, test_name, type)")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as TestResult[];
}

export async function fetchAllResults(): Promise<TestResult[]> {
  const { data, error } = await supabase
    .from("test_results")
    .select("*, players(name, code, team, primary_position, age_range), test_sessions(test_date, test_name, type)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as TestResult[];
}

export async function bulkInsertResults(results: Omit<TestResult, "id" | "created_at">[]): Promise<void> {
  const { error } = await supabase.from("test_results").insert(results);
  if (error) throw error;
}

export async function updateResult(id: string, updates: Partial<TestResult>): Promise<TestResult> {
  const { data, error } = await supabase.from("test_results").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as TestResult;
}

export async function deleteResult(id: string): Promise<void> {
  const { error } = await supabase.from("test_results").delete().eq("id", id);
  if (error) throw error;
}

export async function insertResult(result: Omit<TestResult, "id" | "created_at">): Promise<TestResult> {
  const { data, error } = await supabase.from("test_results").insert(result).select().single();
  if (error) throw error;
  return data as TestResult;
}

// Most improved player: finds player with the biggest Broncho improvement (lower is better)
// Compares first-ever result to most-recent result per player
export async function fetchMostImprovedPlayer(team: string): Promise<{ name: string; improvementSecs: number } | null> {
  const { data, error } = await supabase
    .from("test_results")
    .select("player_id, bronco_mins, created_at, players!inner(name, team)")
    .eq("players.team", team)
    .not("bronco_mins", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return null;

  // Group by player
  const byPlayer: Record<string, { name: string; times: number[] }> = {};
  for (const row of data as unknown as Array<{ player_id: string; bronco_mins: number; players: { name: string } }>) {
    if (!byPlayer[row.player_id]) byPlayer[row.player_id] = { name: row.players.name, times: [] };
    byPlayer[row.player_id].times.push(row.bronco_mins);
  }

  // Find player with greatest improvement (first session - latest session, in seconds; positive = improvement)
  let best: { name: string; improvementSecs: number } | null = null;
  for (const { name, times } of Object.values(byPlayer)) {
    if (times.length < 2) continue;
    const first = times[0];
    const latest = times[times.length - 1];
    const improvementSecs = Math.round((first - latest) * 60); // positive = got faster
    if (!best || improvementSecs > best.improvementSecs) {
      best = { name, improvementSecs };
    }
  }
  return best;
}

// Dashboard helpers
export async function fetchLatestSessionResults(team: string): Promise<{
  session: TestSession | null;
  results: (TestResult & { players: Pick<Player, "name" | "code" | "team"> })[];
}> {
  // Get all sessions
  const sessions = await fetchSessions();
  if (!sessions.length) return { session: null, results: [] };

  // Find the most recent session with results for this team
  for (const session of sessions) {
    const { data, error } = await supabase
      .from("test_results")
      .select("*, players!inner(name, code, team)")
      .eq("session_id", session.id)
      .eq("players.team", team);
    if (error) throw error;
    if (data && data.length > 0) {
      return { session, results: data as (TestResult & { players: Pick<Player, "name" | "code" | "team"> })[] };
    }
  }
  return { session: null, results: [] };
}

export interface TeamAvgBroncho {
  session: TestSession;
  avgBronchoMins: number;
  playerCount: number;
}

export async function fetchTeamAvgBroncho(team: string): Promise<TeamAvgBroncho[]> {
  const sessions = await fetchSessions();
  const results: TeamAvgBroncho[] = [];

  for (const session of [...sessions].reverse()) {
    const { data, error } = await supabase
      .from("test_results")
      .select("bronco_mins, players!inner(team)")
      .eq("session_id", session.id)
      .eq("players.team", team)
      .not("bronco_mins", "is", null);
    if (error) throw error;
    if (data && data.length > 0) {
      const avg = data.reduce((sum: number, r: { bronco_mins: number | null }) => sum + (r.bronco_mins ?? 0), 0) / data.length;
      results.push({ session, avgBronchoMins: avg, playerCount: data.length });
    }
  }
  return results;
}

// ── Training Sessions ─────────────────────────────────────────────────────────
export async function fetchTrainingSessions(): Promise<TrainingSession[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data as TrainingSession[];
}

export async function fetchTrainingSession(id: string): Promise<TrainingSession> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as TrainingSession;
}

export async function createTrainingSession(
  session: Omit<TrainingSession, "id" | "day" | "planned_load_au" | "created_at">
): Promise<TrainingSession> {
  const { data, error } = await supabase
    .from("sessions")
    .insert(session)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingSession;
}

// ── Session RPE ───────────────────────────────────────────────────────────────
export async function fetchSessionRPEWithPlayers(
  sessionId: string
): Promise<(SessionRPE & { players: Player })[]> {
  const { data, error } = await supabase
    .from("session_rpe")
    .select("*, players(*)")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data as (SessionRPE & { players: Player })[];
}

export async function fetchLoggedPlayerIds(sessionId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("session_rpe")
    .select("player_id")
    .eq("session_id", sessionId);
  if (error) throw error;
  return (data ?? []).map((r: { player_id: string }) => r.player_id);
}

export async function insertSessionRPE(
  entry: Omit<SessionRPE, "id" | "created_at"> & { load_au?: number }
): Promise<SessionRPE> {
  // Compute load_au = RPE × minutes_played (if minutes_played provided),
  // falling back to whatever load_au was passed in.
  const payload = {
    ...entry,
    load_au:
      entry.minutes_played != null
        ? Math.round(entry.rpe * entry.minutes_played)
        : entry.load_au ?? 0,
  };
  const { data, error } = await supabase
    .from("session_rpe")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as SessionRPE;
}

export async function fetchPlayerRecentSessions(
  playerId: string,
  limit = 5
): Promise<(SessionRPE & { sessions: TrainingSession })[]> {
  const { data, error } = await supabase
    .from("session_rpe")
    .select("*, sessions(*)")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as (SessionRPE & { sessions: TrainingSession })[];
}

// ── Session Attendance ────────────────────────────────────────────────────────
export async function fetchAttendanceBySession(
  sessionId: string
): Promise<(SessionAttendance & { players: Player })[]> {
  const { data, error } = await supabase
    .from("session_attendance")
    .select("*, players(*)")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data as (SessionAttendance & { players: Player })[];
}

export async function upsertAttendance(
  sessionId: string,
  playerId: string,
  status: AttendanceStatus,
  notes?: string | null
): Promise<SessionAttendance> {
  const { data, error } = await supabase
    .from("session_attendance")
    .upsert(
      { session_id: sessionId, player_id: playerId, status, notes: notes ?? null },
      { onConflict: "session_id,player_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as SessionAttendance;
}

export async function bulkUpsertAttendance(
  sessionId: string,
  records: { player_id: string; status: AttendanceStatus; notes?: string | null }[]
): Promise<void> {
  const rows = records.map((r) => ({
    session_id: sessionId,
    player_id: r.player_id,
    status: r.status,
    notes: r.notes ?? null,
  }));
  const { error } = await supabase
    .from("session_attendance")
    .upsert(rows, { onConflict: "session_id,player_id" });
  if (error) throw error;
}

export async function deleteAttendance(sessionId: string, playerId: string): Promise<void> {
  const { error } = await supabase
    .from("session_attendance")
    .delete()
    .eq("session_id", sessionId)
    .eq("player_id", playerId);
  if (error) throw error;
}

export async function fetchAttendanceSummaryForSessions(
  sessionIds: string[]
): Promise<Record<string, { total: number; present: number }>> {
  if (sessionIds.length === 0) return {};
  const { data, error } = await supabase
    .from("session_attendance")
    .select("session_id, status")
    .in("session_id", sessionIds);
  if (error) throw error;

  const summary: Record<string, { total: number; present: number }> = {};
  for (const row of (data ?? []) as { session_id: string; status: AttendanceStatus }[]) {
    if (!summary[row.session_id]) summary[row.session_id] = { total: 0, present: 0 };
    summary[row.session_id].total += 1;
    if (row.status === "Present" || row.status === "Late") {
      summary[row.session_id].present += 1;
    }
  }
  return summary;
}
