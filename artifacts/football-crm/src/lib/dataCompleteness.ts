import type { Match, TrainingSession } from "./types";

/**
 * Where a session's records stand. Lectures are excluded entirely by
 * `computeSessionCompleteness` — attendance-only by design, they were never
 * part of the RPE/lineup gaps this tracks.
 */
export interface SessionCompleteness {
  session: TrainingSession;
  attendanceCount: number;
  /** Distinct players with an RPE row for this session. */
  rpeCount: number;
  attendanceMissing: boolean;
  /** No RPE from anyone at all — the unrecoverable case, not just a gap. */
  rpeMissingEntirely: boolean;
  /** Attendance was taken, but at least one attended player has no RPE. */
  rpePartial: boolean;
  /** The attended players `rpePartial` is about. Empty when not partial. */
  missingRpePlayerIds: string[];
}

/**
 * Per non-Lecture session: is attendance missing, is RPE missing entirely,
 * or is it partial (attendance exists, some attended players have no RPE)?
 * The three flags aren't mutually exclusive — a session with attendance but
 * zero RPE from anyone is both "missing entirely" and "partial".
 */
export function computeSessionCompleteness(
  sessions: TrainingSession[],
  attendance: { session_id: string; player_id: string; status: string }[],
  rpe: { session_id: string; player_id: string }[],
): SessionCompleteness[] {
  const attBySession = new Map<string, typeof attendance>();
  for (const a of attendance) {
    const list = attBySession.get(a.session_id);
    if (list) list.push(a);
    else attBySession.set(a.session_id, [a]);
  }
  const rpePlayersBySession = new Map<string, Set<string>>();
  for (const r of rpe) {
    const set = rpePlayersBySession.get(r.session_id);
    if (set) set.add(r.player_id);
    else rpePlayersBySession.set(r.session_id, new Set([r.player_id]));
  }

  const out: SessionCompleteness[] = [];
  for (const session of sessions) {
    if (session.session_type === "Lecture") continue;

    const attRows = attBySession.get(session.id) ?? [];
    const rpePlayers = rpePlayersBySession.get(session.id) ?? new Set<string>();
    const attendedPlayerIds = attRows
      .filter((a) => a.status === "Present" || a.status === "Late")
      .map((a) => a.player_id);
    const missingRpePlayerIds = attendedPlayerIds.filter((id) => !rpePlayers.has(id));

    out.push({
      session,
      attendanceCount: attRows.length,
      rpeCount: rpePlayers.size,
      attendanceMissing: attRows.length === 0,
      rpeMissingEntirely: rpePlayers.size === 0,
      rpePartial: attRows.length > 0 && missingRpePlayerIds.length > 0,
      missingRpePlayerIds,
    });
  }
  return out;
}

export interface MatchWithoutLineup {
  session: TrainingSession;
  matchId: string;
}

/** Match sessions with a real `matches` row but zero `match_player_stats` rows. */
export function matchesWithoutLineup(
  sessions: TrainingSession[],
  matches: Pick<Match, "id" | "session_id">[],
  matchStats: { match_id: string }[],
): MatchWithoutLineup[] {
  const griddedMatchIds = new Set(matchStats.map((m) => m.match_id));
  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));

  const out: MatchWithoutLineup[] = [];
  for (const m of matches) {
    if (griddedMatchIds.has(m.id)) continue;
    const session = sessionById.get(m.session_id);
    if (session) out.push({ session, matchId: m.id });
  }
  return out;
}
