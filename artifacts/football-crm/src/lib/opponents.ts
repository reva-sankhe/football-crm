import { supabase } from "./supabase";
import { fetchAllRows, MATCH_SELECT } from "./queries";
import type {
  Opponent, OpponentH2H, PlayerVsOpponent, PlayerMatchTotals, MatchWithSession,
} from "./types";

/**
 * Opponent tracking and head-to-head analytics.
 *
 * Aggregation lives in Postgres views (v_opponent_h2h, v_player_vs_opponent,
 * v_player_match_totals) rather than in TypeScript, so every screen reports the
 * same numbers. These functions are thin readers over those views — if a figure
 * looks wrong, fix the view, not the caller.
 */

// ── Opponents CRUD ────────────────────────────────────────────────────────────
export async function fetchOpponents(activeOnly = false): Promise<Opponent[]> {
  let q = supabase.from("opponents").select("*").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Opponent[];
}

export async function fetchOpponent(id: string): Promise<Opponent> {
  const { data, error } = await supabase.from("opponents").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Opponent;
}

export type OpponentInput = Partial<Omit<Opponent, "id" | "created_at" | "name">> & { name: string };

export async function createOpponent(input: OpponentInput): Promise<Opponent> {
  const { data, error } = await supabase
    .from("opponents")
    .insert({ ...input, name: input.name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as Opponent;
}

export async function updateOpponent(id: string, updates: Partial<Opponent>): Promise<Opponent> {
  const payload = updates.name ? { ...updates, name: updates.name.trim() } : updates;
  const { data, error } = await supabase.from("opponents").update(payload).eq("id", id).select().single();
  if (error) throw error;
  return data as Opponent;
}

/**
 * The FK is ON DELETE RESTRICT, so Postgres refuses to drop an opponent that has
 * match history. Translate that into something a coach can act on.
 */
export async function deleteOpponent(id: string): Promise<void> {
  const { error } = await supabase.from("opponents").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "This opponent has matches recorded against it. Mark them inactive instead of deleting.",
      );
    }
    throw error;
  }
}

/**
 * Case-insensitive lookup, then insert — backs "add a new opponent" inline in the
 * match form. The unique index is on lower(name), so a racing duplicate insert
 * fails with 23505; re-read rather than surfacing the error.
 */
export async function findOrCreateOpponent(name: string): Promise<Opponent> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Opponent name is required.");

  const existing = await findOpponentByName(trimmed);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("opponents")
    .insert({ name: trimmed })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      const raced = await findOpponentByName(trimmed);
      if (raced) return raced;
    }
    throw error;
  }
  return data as Opponent;
}

async function findOpponentByName(name: string): Promise<Opponent | null> {
  const { data, error } = await supabase
    .from("opponents")
    .select("*")
    .ilike("name", name)
    .maybeSingle();
  if (error) throw error;
  return (data as Opponent) ?? null;
}

// ── Head-to-head ──────────────────────────────────────────────────────────────
/** Our record against every opponent, most-played first. */
export async function fetchOpponentH2H(): Promise<OpponentH2H[]> {
  const { data, error } = await supabase
    .from("v_opponent_h2h")
    .select("*")
    .order("played", { ascending: false })
    .order("opponent_name");
  if (error) throw error;
  return (data ?? []) as OpponentH2H[];
}

export async function fetchOpponentH2HById(opponentId: string): Promise<OpponentH2H | null> {
  const { data, error } = await supabase
    .from("v_opponent_h2h")
    .select("*")
    .eq("opponent_id", opponentId)
    .maybeSingle();
  if (error) throw error;
  return (data as OpponentH2H) ?? null;
}

/** Every match played against one opponent, oldest first. */
export async function fetchMatchesVsOpponent(opponentId: string): Promise<MatchWithSession[]> {
  const { data, error } = await supabase
    .from("matches")
    .select(MATCH_SELECT)
    .eq("opponent_id", opponentId);
  if (error) throw error;
  // Date lives on the joined session, so ordering happens here rather than in SQL
  return ((data ?? []) as MatchWithSession[]).sort((a, b) =>
    (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""),
  );
}

// ── Player vs opponent ────────────────────────────────────────────────────────
// This view grows as players × opponents, so it is paged via fetchAllRows to avoid
// PostgREST's silent 1000-row truncation.

/** How each of our players has fared against one opponent, best scorers first. */
export async function fetchPlayersVsOpponent(opponentId: string): Promise<PlayerVsOpponent[]> {
  return fetchAllRows<PlayerVsOpponent>((from, to) =>
    supabase
      .from("v_player_vs_opponent")
      .select("*")
      .eq("opponent_id", opponentId)
      .order("goals", { ascending: false })
      .order("player_id")
      .range(from, to),
  );
}

/** One player's record against every opponent they've faced. */
export async function fetchOpponentsForPlayer(playerId: string): Promise<PlayerVsOpponent[]> {
  return fetchAllRows<PlayerVsOpponent>((from, to) =>
    supabase
      .from("v_player_vs_opponent")
      .select("*")
      .eq("player_id", playerId)
      .order("opponent_name")
      .range(from, to),
  );
}

/** The whole splits table in one request — backs squad-wide "who turns up vs whom". */
export async function fetchAllPlayerVsOpponent(): Promise<PlayerVsOpponent[]> {
  return fetchAllRows<PlayerVsOpponent>((from, to) =>
    supabase
      .from("v_player_vs_opponent")
      .select("*")
      .order("player_id")
      .order("opponent_id")
      .range(from, to),
  );
}

/** Per-player career rates, keyed by player_id for O(1) baseline lookup. */
export async function fetchPlayerMatchTotals(): Promise<Map<string, PlayerMatchTotals>> {
  const rows = await fetchAllRows<PlayerMatchTotals>((from, to) =>
    supabase.from("v_player_match_totals").select("*").order("player_id").range(from, to),
  );
  return new Map(rows.map((r) => [r.player_id, r]));
}

// ── Derived helpers ───────────────────────────────────────────────────────────
/**
 * How much better (or worse) a player is against one opponent than they are in
 * general. This is the actual "plays well against this team" signal — a raw
 * per-90 means little without the player's own baseline next to it.
 *
 * null when either side has no logged minutes to rate.
 */
export function per90Delta(
  split: Pick<PlayerVsOpponent, "goals_per90" | "assists_per90">,
  baseline: Pick<PlayerMatchTotals, "goals_per90" | "assists_per90"> | undefined,
): { goals: number | null; assists: number | null } {
  const diff = (a: number | null, b: number | null | undefined) =>
    a == null || b == null ? null : Number((a - b).toFixed(2));
  return {
    goals: diff(split.goals_per90, baseline?.goals_per90),
    assists: diff(split.assists_per90, baseline?.assists_per90),
  };
}

/**
 * Win rate across the matches a player actually featured in, 0–1. null when they
 * haven't played this opponent — which is different from having played and lost.
 */
export function playerWinRate(
  split: Pick<PlayerVsOpponent, "team_won" | "team_drawn" | "team_lost">,
): number | null {
  const played = split.team_won + split.team_drawn + split.team_lost;
  return played === 0 ? null : split.team_won / played;
}

/** "W2 D1 L0" — compact record for a table cell. */
export function formatRecord(r: { won: number; drawn: number; lost: number }): string {
  return `W${r.won} D${r.drawn} L${r.lost}`;
}

/** Goal difference, positive when we outscore them. */
export function goalDifference(r: { goals_for: number; goals_against: number }): number {
  return r.goals_for - r.goals_against;
}
