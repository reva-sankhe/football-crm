import { supabase } from "./supabase";
import type {
  Player, TestSession, TestResult, TrainingSession, SessionRPE, SessionAttendance, AttendanceStatus,
  Tournament, TournamentLink, Squad, SquadWithPlayers, Match, MatchWithSession, MatchPlayerStat,
  MatchStatInput, MatchStage,
} from "./types";

/**
 * PostgREST silently truncates a response at 1000 rows — no error, just a short
 * payload. Any table that can outgrow that (session_attendance passed 1000 in
 * Aug 2026) must be paged, or it under-reports without anyone noticing.
 *
 * `page` must apply a stable `.order()`, otherwise rows can repeat or vanish
 * between pages.
 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

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

// Most improved player: finds player with the biggest Bronco improvement (lower is better)
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

export interface TeamAvgBronco {
  session: TestSession;
  avgBroncoMins: number;
  playerCount: number;
}

export async function fetchTeamAvgBronco(team: string): Promise<TeamAvgBronco[]> {
  const sessions = await fetchSessions();
  const results: TeamAvgBronco[] = [];

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
      results.push({ session, avgBroncoMins: avg, playerCount: data.length });
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
  const day = new Date(session.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const { data, error } = await supabase
    .from("sessions")
    .insert({ ...session, day })
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
export async function fetchAttendanceByPlayer(
  playerId: string
): Promise<(SessionAttendance & { sessions: { id: string; date: string; session_type: string } })[]> {
  const { data, error } = await supabase
    .from("session_attendance")
    .select("*, sessions(id, date, session_type)")
    .eq("player_id", playerId);
  if (error) throw error;
  return data as (SessionAttendance & { sessions: { id: string; date: string; session_type: string } })[];
}

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

// ── Analytics: All RPE with session + player info ─────────────────────────────
export async function fetchAllRPEWithSessions(): Promise<
  (SessionRPE & { sessions: TrainingSession; players: Pick<Player, "id" | "name" | "team" | "primary_position" | "age_range"> })[]
> {
  const { data, error } = await supabase
    .from("session_rpe")
    .select("*, sessions(*), players(id, name, team, primary_position, age_range)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as (SessionRPE & { sessions: TrainingSession; players: Pick<Player, "id" | "name" | "team" | "primary_position" | "age_range"> })[];
}

// ── Analytics: All attendance with player info ────────────────────────────────
export async function fetchAllAttendanceStats(): Promise<
  (SessionAttendance & { players: Pick<Player, "id" | "name" | "primary_position" | "team"> })[]
> {
  return fetchAllRows<SessionAttendance & { players: Pick<Player, "id" | "name" | "primary_position" | "team"> }>(
    (from, to) =>
      supabase
        .from("session_attendance")
        .select("*, players(id, name, primary_position, team)")
        .order("id")
        .range(from, to),
  );
}

export async function bulkUpsertAttendance(
  sessionId: string,
  records: { player_id: string; status: AttendanceStatus; notes?: string | null }[]
): Promise<void> {
  // Deduplicate by player_id — last entry wins, preventing the Postgres
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" error
  // which fires when the same player appears more than once in the batch.
  const deduped = new Map<string, { player_id: string; status: AttendanceStatus; notes?: string | null }>();
  for (const r of records) deduped.set(r.player_id, r);

  const rows = Array.from(deduped.values()).map((r) => ({
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

/**
 * Raw attendance rows for a specific set of sessions — backs the attendance
 * matrix. Scoped by session so we don't pull the whole table like
 * fetchAllAttendanceStats does.
 */
export async function fetchAttendanceForSessions(
  sessionIds: string[]
): Promise<{ session_id: string; player_id: string; status: AttendanceStatus }[]> {
  if (sessionIds.length === 0) return [];
  return fetchAllRows<{ session_id: string; player_id: string; status: AttendanceStatus }>((from, to) =>
    supabase
      .from("session_attendance")
      .select("session_id, player_id, status")
      .in("session_id", sessionIds)
      .order("id")
      .range(from, to),
  );
}

export async function fetchAttendanceSummaryForSessions(
  sessionIds: string[]
): Promise<Record<string, { total: number; present: number }>> {
  if (sessionIds.length === 0) return {};
  const data = await fetchAllRows<{ session_id: string; status: AttendanceStatus }>((from, to) =>
    supabase
      .from("session_attendance")
      .select("session_id, status")
      .in("session_id", sessionIds)
      .order("id")
      .range(from, to),
  );

  const summary: Record<string, { total: number; present: number }> = {};
  for (const row of data) {
    if (!summary[row.session_id]) summary[row.session_id] = { total: 0, present: 0 };
    summary[row.session_id].total += 1;
    if (row.status === "Present" || row.status === "Late") {
      summary[row.session_id].present += 1;
    }
  }
  return summary;
}

// ── Tournaments ───────────────────────────────────────────────────────────────
export async function fetchTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .order("start_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Tournament[];
}

export async function fetchTournament(id: string): Promise<Tournament> {
  const { data, error } = await supabase.from("tournaments").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Tournament;
}

/**
 * `default_planned_rpe` is optional: RPE is a training concept, so nothing in the
 * tournament UI sets it and the column's DB default fills it in.
 */
export async function createTournament(
  t: Omit<Tournament, "id" | "created_at" | "default_planned_rpe">
    & Partial<Pick<Tournament, "default_planned_rpe">>
): Promise<Tournament> {
  const { data, error } = await supabase.from("tournaments").insert(t).select().single();
  if (error) throw error;
  return data as Tournament;
}

export async function updateTournament(id: string, updates: Partial<Tournament>): Promise<Tournament> {
  const { data, error } = await supabase.from("tournaments").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as Tournament;
}

export async function deleteTournament(id: string): Promise<void> {
  // squads, matches and stats cascade; the underlying sessions rows survive
  const { error } = await supabase.from("tournaments").delete().eq("id", id);
  if (error) throw error;
}

// ── Tournament links ──────────────────────────────────────────────────────────
export async function fetchTournamentLinks(tournamentId: string): Promise<TournamentLink[]> {
  const { data, error } = await supabase
    .from("tournament_links")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as TournamentLink[];
}

export async function createTournamentLink(
  link: Omit<TournamentLink, "id" | "created_at">
): Promise<TournamentLink> {
  const { data, error } = await supabase.from("tournament_links").insert(link).select().single();
  if (error) throw error;
  return data as TournamentLink;
}

export async function updateTournamentLink(
  id: string,
  updates: Partial<Pick<TournamentLink, "title" | "url">>
): Promise<TournamentLink> {
  const { data, error } = await supabase.from("tournament_links").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as TournamentLink;
}

export async function deleteTournamentLink(id: string): Promise<void> {
  const { error } = await supabase.from("tournament_links").delete().eq("id", id);
  if (error) throw error;
}

// ── Squads ────────────────────────────────────────────────────────────────────
export async function fetchSquadsForTournament(tournamentId: string): Promise<SquadWithPlayers[]> {
  const { data, error } = await supabase
    .from("squads")
    .select("*, squad_players(*, players(*))")
    .eq("tournament_id", tournamentId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as SquadWithPlayers[];
}

export async function createSquad(squad: Omit<Squad, "id" | "created_at">): Promise<Squad> {
  const { data, error } = await supabase.from("squads").insert(squad).select().single();
  if (error) throw error;
  return data as Squad;
}

export async function updateSquad(id: string, updates: Partial<Squad>): Promise<Squad> {
  const { data, error } = await supabase.from("squads").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as Squad;
}

export async function deleteSquad(id: string): Promise<void> {
  const { error } = await supabase.from("squads").delete().eq("id", id);
  if (error) throw error;
}

/** Replaces a squad's roster wholesale — delete-then-insert in one pass. */
export async function setSquadPlayers(squadId: string, playerIds: string[]): Promise<void> {
  const { error: delError } = await supabase.from("squad_players").delete().eq("squad_id", squadId);
  if (delError) throw delError;
  if (playerIds.length === 0) return;

  // Dedupe so a repeated id can't trip the (squad_id, player_id) unique index
  const rows = Array.from(new Set(playerIds)).map((player_id) => ({ squad_id: squadId, player_id }));
  const { error } = await supabase.from("squad_players").insert(rows);
  if (error) throw error;
}

// ── Matches ───────────────────────────────────────────────────────────────────
const MATCH_SELECT = "*, sessions(*), squads(id, name)";

export async function fetchMatchesForTournament(tournamentId: string): Promise<MatchWithSession[]> {
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .eq("tournament_id", tournamentId);
  if (error) throw error;
  // Date lives on the joined session, so ordering happens here rather than in SQL
  return ((data ?? []) as MatchWithSession[]).sort((a, b) =>
    (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""),
  );
}

export async function fetchMatch(id: string): Promise<MatchWithSession> {
  const { data, error } = await supabase.from("matches").select(MATCH_SELECT).eq("id", id).single();
  if (error) throw error;
  return data as MatchWithSession;
}

export interface CreateMatchInput {
  tournament_id: string;
  squad_id: string | null;
  stage: MatchStage;
  opponent: string | null;
  date: string;
  duration_mins: number;
  planned_rpe: number;
  notes?: string | null;
}

/**
 * Creates the backing `sessions` row first, then the `matches` row that extends
 * it. This is the only place the 1:1 session↔match invariant is established.
 */
export async function createMatch(input: CreateMatchInput): Promise<Match> {
  const session = await createTrainingSession({
    date: input.date,
    session_type: "Match",
    duration_mins: input.duration_mins,
    planned_rpe: input.planned_rpe,
    notes: null,
  });

  const { data, error } = await supabase
    .from("matches")
    .insert({
      tournament_id: input.tournament_id,
      session_id: session.id,
      squad_id: input.squad_id,
      stage: input.stage,
      opponent: input.opponent,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    // Don't strand an orphan session if the matches insert fails
    await supabase.from("sessions").delete().eq("id", session.id);
    throw error;
  }
  return data as Match;
}

/** Match-type sessions that aren't yet linked to a match row. */
export async function fetchAdoptableSessions(): Promise<TrainingSession[]> {
  const [{ data: sessions, error: sErr }, { data: linked, error: mErr }] = await Promise.all([
    supabase.from("sessions").select("*").eq("session_type", "Match").order("date", { ascending: false }),
    supabase.from("matches").select("session_id"),
  ]);
  if (sErr) throw sErr;
  if (mErr) throw mErr;

  const taken = new Set((linked ?? []).map((r: { session_id: string }) => r.session_id));
  return ((sessions ?? []) as TrainingSession[]).filter((s) => !taken.has(s.id));
}

/** Pulls an existing Match session into a tournament, keeping its attendance/RPE. */
export async function adoptSessionAsMatch(
  sessionId: string,
  input: Omit<CreateMatchInput, "date" | "duration_mins" | "planned_rpe">
): Promise<Match> {
  const { data, error } = await supabase
    .from("matches")
    .insert({
      tournament_id: input.tournament_id,
      session_id: sessionId,
      squad_id: input.squad_id,
      stage: input.stage,
      opponent: input.opponent,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Match;
}

export async function updateMatch(id: string, updates: Partial<Match>): Promise<Match> {
  const { data, error } = await supabase.from("matches").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as Match;
}

/** Deletes the match and its backing session (cascade only runs session → match). */
export async function deleteMatch(id: string, sessionId: string): Promise<void> {
  const { error } = await supabase.from("matches").delete().eq("id", id);
  if (error) throw error;
  const { error: sErr } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (sErr) throw sErr;
}

// ── Match player stats ────────────────────────────────────────────────────────
export async function fetchMatchPlayerStats(
  matchId: string
): Promise<(MatchPlayerStat & { players: Player | null })[]> {
  const { data, error } = await supabase
    .from("match_player_stats")
    .select("*, players(*)")
    .eq("match_id", matchId);
  if (error) throw error;
  return (data ?? []) as (MatchPlayerStat & { players: Player | null })[];
}

export async function bulkUpsertMatchStats(matchId: string, rows: MatchStatInput[]): Promise<void> {
  // Dedupe by player_id — last entry wins. Without this, a repeated player would
  // trigger "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const deduped = new Map<string, MatchStatInput>();
  for (const r of rows) deduped.set(r.player_id, r);

  const payload = Array.from(deduped.values()).map((r) => ({ match_id: matchId, ...r }));
  if (payload.length === 0) return;

  const { error } = await supabase
    .from("match_player_stats")
    .upsert(payload, { onConflict: "match_id,player_id" });
  if (error) throw error;
}

/** One stat line per match a player featured in, newest first. */
export type PlayerMatchStat = MatchPlayerStat & {
  matches: (Pick<Match, "id" | "stage" | "opponent" | "goals_for" | "goals_against" | "tournament_id"> & {
    tournaments: Pick<Tournament, "id" | "name"> | null;
    sessions: Pick<TrainingSession, "id" | "date"> | null;
  }) | null;
};

const PLAYER_MATCH_STAT_SELECT =
  "*, matches(id, stage, opponent, goals_for, goals_against, tournament_id, tournaments(id, name), sessions(id, date))";

/** Every player's match stats in one request — backs the bulk report page. */
export async function fetchAllMatchStats(): Promise<PlayerMatchStat[]> {
  const { data, error } = await supabase.from("match_player_stats").select(PLAYER_MATCH_STAT_SELECT);
  if (error) throw error;
  return ((data ?? []) as PlayerMatchStat[]).sort((a, b) =>
    (b.matches?.sessions?.date ?? "").localeCompare(a.matches?.sessions?.date ?? ""),
  );
}

export async function fetchMatchStatsByPlayer(playerId: string): Promise<PlayerMatchStat[]> {
  const { data, error } = await supabase
    .from("match_player_stats")
    .select(
      "*, matches(id, stage, opponent, goals_for, goals_against, tournament_id, tournaments(id, name), sessions(id, date))"
    )
    .eq("player_id", playerId);
  if (error) throw error;
  // Match date lives on the joined session, so sort here rather than in SQL
  return ((data ?? []) as PlayerMatchStat[]).sort((a, b) =>
    (b.matches?.sessions?.date ?? "").localeCompare(a.matches?.sessions?.date ?? ""),
  );
}

export interface TournamentLeader {
  player: Pick<Player, "id" | "name" | "primary_position">;
  minutes: number;
  goals: number;
  assists: number;
  appearances: number;
}

/**
 * Per-player totals across a tournament's matches, best scorers first.
 * Pass `squadId` to scope the table to one squad — a tournament entered with
 * two squads has two independent sets of leaders.
 */
export async function fetchTournamentLeaders(
  tournamentId: string,
  squadId?: string | null,
): Promise<TournamentLeader[]> {
  let q = supabase
    .from("match_player_stats")
    .select("*, players(id, name, primary_position), matches!inner(tournament_id, squad_id)")
    .eq("matches.tournament_id", tournamentId);
  if (squadId) q = q.eq("matches.squad_id", squadId);
  const { data, error } = await q;
  if (error) throw error;

  const byPlayer = new Map<string, TournamentLeader>();
  for (const row of (data ?? []) as (MatchPlayerStat & {
    players: Pick<Player, "id" | "name" | "primary_position"> | null;
  })[]) {
    if (!row.players) continue;
    const entry = byPlayer.get(row.player_id) ?? {
      player: row.players,
      minutes: 0,
      goals: 0,
      assists: 0,
      appearances: 0,
    };
    entry.minutes += row.minutes_played;
    entry.goals += row.goals;
    entry.assists += row.assists;
    if (row.minutes_played > 0) entry.appearances += 1;
    byPlayer.set(row.player_id, entry);
  }

  return Array.from(byPlayer.values()).sort(
    (a, b) => b.goals - a.goals || b.assists - a.assists || b.minutes - a.minutes,
  );
}

/** Match counts per tournament, for the tournament cards. */
export async function fetchMatchCountsByTournament(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("matches").select("tournament_id");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { tournament_id: string }[]) {
    counts[row.tournament_id] = (counts[row.tournament_id] ?? 0) + 1;
  }
  return counts;
}
