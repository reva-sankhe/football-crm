import { onFieldGoals, shootoutResult } from "./lineup";
import { MATCH_RPE } from "./report";
import { squadsInScope, type ScopeSubject } from "./scope";
import {
  CLUB_NAME, matchOutcome, stageRank, tournamentFinish, tournamentPlacings, tournamentRecord,
  type MatchResult, type TournamentFinish, type TournamentPlacings, type TournamentRecord,
} from "./tournaments";
import type {
  MatchPenaltyKick, MatchStage, MatchWithSession, OpponentH2H, Player, Tournament,
} from "./types";
import type { MatchWithTournament, PlayerMatchStat } from "./queries";

/**
 * Tournament analytics — the figures behind the Tournaments → Overview tab and
 * the printed per-tournament report.
 *
 * Pure: no Supabase imports, so the arithmetic can be reasoned about on its own.
 * Everything here counts with `matchOutcome`, not `matchResult` — this is
 * bracket territory, and a knockout won on penalties is a win. Head-to-head is
 * deliberately *not* computed here: it lives in the `v_opponent_h2h` SQL view
 * (see lib/opponents.ts) so every screen reports the same numbers, and that view
 * counts goals only. The two disagreeing on a shootout is correct, not a bug.
 *
 * Like lib/squad.ts, the `interpret*` functions are deterministic and written
 * from the actual figures, so the prose can never claim what the data doesn't
 * show. Change a threshold and change the sentence that reports it.
 */

// ── Shared shapes ─────────────────────────────────────────────────────────────
/** One row of a per-player table — a player's whole tournament on one line. */
export interface PlayerLine {
  player: Player;
  appearances: number;
  /** Squad call-ups, whether or not they got on the pitch. */
  callUps: number;
  minutes: number;
  minsPerApp: number;
  goals: number;
  goalsOpen: number;
  goalsFk: number;
  goalsPen: number;
  assists: number;
  yellow: number;
  red: number;
  injuries: number;
  /** MATCH_RPE × minutes — the same unit the load charts use. */
  loadAu: number;
  /**
   * Minutes as a share of the minutes available to them, 0–1. null when the
   * fixtures they were named in have no duration recorded.
   */
  minutesShare: number | null;
}

export interface InjuryFlag {
  player: Player;
  note: string | null;
  date: string | null;
  opponent: string | null;
  minutes: number;
}

export interface KeeperLine {
  player: Player;
  /** Matches they were the busiest keeper in — see `creditedKeeper`. */
  started: number;
  cleanSheets: number;
  conceded: number;
  minutes: number;
}

export interface SquadReport {
  /** null on the combined roll-up, which is the only report a one-squad entry gets. */
  squadId: string | null;
  squadName: string;
  matches: MatchWithSession[];
  record: TournamentRecord;
  /**
   * This slice's own bracket. Two squads entered in one competition run two
   * brackets, so a squad's page reports the final it played rather than the
   * tournament's first final, and the placing and the podium can never disagree.
   */
  finish: TournamentFinish | null;
  placings: TournamentPlacings;
  byStage: { stage: MatchStage; record: TournamentRecord }[];
  /** Played fixtures only — an unplayed one is neither kept nor conceded. */
  cleanSheets: number;
  cleanSheetPct: number | null;
  scoredPerGame: number | null;
  concededPerGame: number | null;
  goalMethods: { open: number; fk: number; pen: number };
  shootouts: { played: number; won: number; lost: number };
  keepers: KeeperLine[];
  topScorers: PlayerLine[];
  topAssists: PlayerLine[];
  injuries: InjuryFlag[];
  /** Everyone who was called up, most minutes first. */
  players: PlayerLine[];
  /** Shootout kicks are never goals, so takers are reported on their own. */
  shootoutTakers: { player: Player; taken: number; scored: number }[];
}

/** Our record in one competition — a row of the "where we met them" breakdown. */
export interface CompetitionLine {
  /** null for the friendlies group. */
  tournamentId: string | null;
  name: string;
  record: TournamentRecord;
  matches: MatchWithSession[];
}

export interface ScopedReport {
  /** What this report is of — a tournament, the friendlies, or one opponent. */
  subject: ScopeSubject;
  /** Every match in scope together. */
  overall: SquadReport;
  /** One per squad. Empty unless the matches in scope span more than one. */
  bySquad: SquadReport[];
  /**
   * One per competition, newest first. Empty unless the scope spans more than
   * one — which in practice means an opponent we've met more than once.
   */
  byTournament: CompetitionLine[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** A fixture with a score entered. Everything else is a fixture, not a result. */
function isPlayed(m: Pick<MatchWithSession, "goals_for" | "goals_against">): boolean {
  return m.goals_for != null && m.goals_against != null;
}

/** Did this stat row amount to an appearance? Mirrors `didPlay` in lib/tournaments. */
function didPlay(r: PlayerMatchStat): boolean {
  return r.minutes_played > 0 || r.goals > 0 || r.assists > 0 || r.yellow_cards > 0 || r.red_cards > 0;
}

const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);
const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A per-game rate always carries its decimal, so "1.0 points per game" reads right. */
const rate = (n: number | null) => (n ?? 0).toFixed(1);
/** "Sharks'" rather than "Sharks's" — squad names ending in s are the common case. */
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** Points won, the way a league table counts them: 3 / 1 / 0 on the bracket result. */
export function pointsFor(result: MatchResult | null): number {
  return result === "W" ? 3 : result === "D" ? 1 : 0;
}

// ── Per-player lines ──────────────────────────────────────────────────────────
/**
 * One line per player who was named in a squad for these matches.
 *
 * `minutesShare` measures against the minutes that player could have played —
 * the summed `duration_mins` of the fixtures they were named in — not a constant
 * 90. Squads rotate and formats vary from 5-a-side up, so a fixed denominator
 * would quietly misreport every short-format tournament.
 */
function buildPlayerLines(stats: PlayerMatchStat[], players: Player[]): PlayerLine[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const grouped = new Map<string, PlayerMatchStat[]>();
  for (const s of stats) {
    const list = grouped.get(s.player_id);
    if (list) list.push(s);
    else grouped.set(s.player_id, [s]);
  }

  const lines: PlayerLine[] = [];
  for (const [playerId, rows] of grouped) {
    const player = byId.get(playerId);
    if (!player) continue; // a stat row whose player has since been removed

    const minutes = rows.reduce((s, r) => s + r.minutes_played, 0);
    const appearances = rows.filter(didPlay).length;
    const available = rows.reduce((s, r) => s + (r.matches?.sessions?.duration_mins ?? 0), 0);
    const goalsFk = rows.reduce((s, r) => s + r.goals_free_kick, 0);
    const goalsPen = rows.reduce((s, r) => s + r.goals_penalty, 0);

    lines.push({
      player,
      appearances,
      callUps: rows.length,
      minutes,
      minsPerApp: appearances > 0 ? Math.round(minutes / appearances) : 0,
      goals: rows.reduce((s, r) => s + r.goals, 0),
      goalsOpen: rows.reduce((s, r) => s + onFieldGoals(r), 0),
      goalsFk,
      goalsPen,
      assists: rows.reduce((s, r) => s + r.assists, 0),
      yellow: rows.reduce((s, r) => s + r.yellow_cards, 0),
      red: rows.reduce((s, r) => s + r.red_cards, 0),
      injuries: rows.filter((r) => r.injured).length,
      loadAu: MATCH_RPE * minutes,
      minutesShare: div(minutes, available),
    });
  }

  return lines.sort((a, b) => b.minutes - a.minutes || a.player.name.localeCompare(b.player.name));
}

/**
 * Which keeper a match's clean sheet belongs to.
 *
 * The schema has no per-keeper conceded column, so this is a derivation: the
 * goalkeeper with the most minutes in that fixture is credited. Crediting every
 * keeper who featured would count a shared match twice, and splitting it by
 * minutes would report fractional clean sheets, which no one means by the term.
 * A match with no goalkeeper on the sheet is credited to nobody.
 */
function creditedKeeper(rows: PlayerMatchStat[], isKeeper: (id: string) => boolean): string | null {
  let best: { id: string; minutes: number } | null = null;
  for (const r of rows) {
    if (!isKeeper(r.player_id) || r.minutes_played <= 0) continue;
    if (!best || r.minutes_played > best.minutes) best = { id: r.player_id, minutes: r.minutes_played };
  }
  return best?.id ?? null;
}

function buildKeeperLines(
  matches: MatchWithSession[],
  stats: PlayerMatchStat[],
  players: Player[],
): KeeperLine[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const keepers = new Set(
    players.filter((p) => p.primary_position === "Goalkeeper").map((p) => p.id),
  );
  if (keepers.size === 0) return [];

  const statsByMatch = new Map<string, PlayerMatchStat[]>();
  for (const s of stats) {
    if (!s.matches) continue;
    const list = statsByMatch.get(s.matches.id);
    if (list) list.push(s);
    else statsByMatch.set(s.matches.id, [s]);
  }

  const tally = new Map<string, KeeperLine>();
  const lineFor = (id: string): KeeperLine | null => {
    const held = tally.get(id);
    if (held) return held;
    const player = byId.get(id);
    if (!player) return null;
    const fresh: KeeperLine = { player, started: 0, cleanSheets: 0, conceded: 0, minutes: 0 };
    tally.set(id, fresh);
    return fresh;
  };

  for (const m of matches) {
    if (!isPlayed(m)) continue;
    const rows = statsByMatch.get(m.id) ?? [];
    const creditedId = creditedKeeper(rows, (id) => keepers.has(id));
    if (!creditedId) continue;
    const line = lineFor(creditedId);
    if (!line) continue;
    line.started += 1;
    line.conceded += m.goals_against ?? 0;
    line.minutes += rows.find((r) => r.player_id === creditedId)?.minutes_played ?? 0;
    if (m.goals_against === 0) line.cleanSheets += 1;
  }

  return [...tally.values()].sort((a, b) => b.started - a.started || a.player.name.localeCompare(b.player.name));
}

// ── Squad report ──────────────────────────────────────────────────────────────
function buildSquadReport(
  squadId: string | null,
  squadName: string,
  matches: MatchWithSession[],
  stats: PlayerMatchStat[],
  players: Player[],
  kicks: MatchPenaltyKick[],
): SquadReport {
  const played = matches.filter(isPlayed);
  const record = tournamentRecord(matches, matchOutcome);
  const cleanSheets = played.filter((m) => m.goals_against === 0).length;

  const byStageMap = new Map<MatchStage, MatchWithSession[]>();
  for (const m of matches) {
    const list = byStageMap.get(m.stage);
    if (list) list.push(m);
    else byStageMap.set(m.stage, [m]);
  }

  const lines = buildPlayerLines(stats, players);
  const scorers = lines.filter((l) => l.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.player.name.localeCompare(b.player.name));
  const assisters = lines.filter((l) => l.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.player.name.localeCompare(b.player.name));

  const byId = new Map(players.map((p) => [p.id, p] as const));
  const injuries: InjuryFlag[] = stats
    .filter((s) => s.injured && byId.has(s.player_id))
    .map((s) => ({
      player: byId.get(s.player_id)!,
      note: s.injury_note,
      date: s.matches?.sessions?.date ?? null,
      opponent: s.matches?.opponents?.name ?? null,
      minutes: s.minutes_played,
    }))
    // Most recent first — the knock that still matters is the newest one
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const shootoutMatches = played.filter((m) => shootoutResult(m) !== null);
  const matchIds = new Set(matches.map((m) => m.id));
  const ourKicks = kicks.filter((k) => matchIds.has(k.match_id));

  return {
    squadId,
    squadName,
    matches,
    record,
    finish: tournamentFinish(matches),
    placings: tournamentPlacings(matches),
    byStage: [...byStageMap.entries()]
      .sort(([a], [b]) => stageRank(a) - stageRank(b))
      .map(([stage, ms]) => ({ stage, record: tournamentRecord(ms, matchOutcome) })),
    cleanSheets,
    cleanSheetPct: div(cleanSheets * 100, played.length),
    scoredPerGame: div(record.goalsFor, record.played),
    concededPerGame: div(record.goalsAgainst, record.played),
    goalMethods: {
      open: lines.reduce((s, l) => s + l.goalsOpen, 0),
      fk: lines.reduce((s, l) => s + l.goalsFk, 0),
      pen: lines.reduce((s, l) => s + l.goalsPen, 0),
    },
    shootouts: {
      played: shootoutMatches.length,
      won: shootoutMatches.filter((m) => shootoutResult(m) === "W").length,
      lost: shootoutMatches.filter((m) => shootoutResult(m) === "L").length,
    },
    keepers: buildKeeperLines(matches, stats, players),
    topScorers: scorers,
    topAssists: assisters,
    injuries,
    players: lines,
    shootoutTakers: shootoutLines(ourKicks, players),
  };
}

/**
 * Everything in scope, plus one report per squad when the matches span more
 * than one, and one per competition when they span more than one of those.
 *
 * Squads are read off the matches rather than fetched: `MATCH_SELECT` already
 * embeds `squads(id, name)`, and a squad that played nothing has no report to
 * write. That is also what lets an opponent scope split by squad at all — squad
 * rows belong to a tournament, so there is no list to fetch across competitions.
 * A single-squad scope gets `bySquad: []`; repeating the combined figures under
 * a squad heading would read as two different sets of numbers that agree.
 */
export function buildScopedReport(
  subject: ScopeSubject,
  matches: MatchWithSession[],
  stats: PlayerMatchStat[],
  players: Player[],
  kicks: MatchPenaltyKick[],
  tournamentsById: Map<string, Tournament> = new Map(),
): ScopedReport {
  const overall = buildSquadReport("__all__", "All squads", matches, stats, players, kicks);
  overall.squadId = null;

  const squads = squadsInScope(matches);
  const bySquad = squads.length > 1
    ? squads.map((sq) =>
        buildSquadReport(
          sq.id,
          sq.name,
          matches.filter((m) => m.squad_id === sq.id),
          stats.filter((s) => s.matches?.squad_id === sq.id),
          players,
          kicks,
        ),
      )
    : [];

  return { subject, overall, bySquad, byTournament: buildCompetitionLines(matches, tournamentsById) };
}

/**
 * The matches in scope grouped by competition, newest first, or `[]` when they
 * all belong to the same one — a breakdown with a single row says nothing the
 * heading didn't.
 */
export function buildCompetitionLines(
  matches: MatchWithSession[],
  tournamentsById: Map<string, Tournament>,
): CompetitionLine[] {
  const grouped = new Map<string, MatchWithSession[]>();
  // "" keys the friendlies group — a Map can hold null, but the sort below can't
  for (const m of matches) {
    const key = m.tournament_id ?? "";
    const list = grouped.get(key);
    if (list) list.push(m);
    else grouped.set(key, [m]);
  }
  if (grouped.size < 2) return [];

  return [...grouped.entries()]
    .map(([key, ms]) => ({
      tournamentId: key || null,
      name: key ? tournamentsById.get(key)?.name ?? "Unknown tournament" : "Friendlies",
      record: tournamentRecord(ms, matchOutcome),
      matches: ms,
      date: latestDate(ms),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name))
    .map(({ date: _date, ...line }) => line);
}

/** The last date anything in this set was played. null when none of it was. */
function latestDate(matches: MatchWithSession[]): string | null {
  return matches.reduce<string | null>((max, m) => {
    const d = m.sessions?.date ?? null;
    return d && (max === null || d > max) ? d : max;
  }, null);
}

/**
 * The podium in words. Says who won it and who lost the final by name, and says
 * plainly when the bracket can't know — we only hold our own results, so a
 * tournament we left at the semi-final has no recorded winner.
 */
export function interpretPlacings(
  placings: TournamentPlacings,
  finish: TournamentFinish | null,
  us: string = CLUB_NAME,
): string {
  const { first, second, third } = placings;

  if (!first && !second) {
    return finish === "Third"
      ? `${us} took third place. The final wasn't ours to play, so who won it isn't recorded here.`
      : "No final on our schedule, so who finished first and second isn't recorded here — "
        + "the database holds our own results only.";
  }

  const parts: string[] = [];
  const winner = first ?? "an unnamed side";
  const runnerUp = second ?? "an unnamed side";
  parts.push(
    first === us
      ? `${us} won the tournament, beating ${runnerUp} in the final.`
      : second === us
        ? `${winner} won the tournament; ${us} finished runners-up to them in the final.`
        : `${winner} won the tournament, with ${runnerUp} runners-up.`,
  );
  if (third) {
    parts.push(third === us ? `${us} took third.` : `${third} took third place.`);
  }
  return parts.join(" ");
}

/**
 * How we've stood against one opponent, and where we met them.
 *
 * Counted with `matchOutcome` like everything else here, so a knockout tie won
 * on penalties is a win. The head-to-head card on screen reads the SQL view
 * instead, which counts goals only — the two disagreeing on a shootout is the
 * documented divergence, not a bug, and this sentence says so when it applies.
 */
export function interpretOpponentHistory(
  lines: CompetitionLine[],
  overall: TournamentRecord,
  opponentName: string,
  shootouts = 0,
): string {
  if (overall.played === 0) {
    return `No played match against ${opponentName} yet. Enter a score and this fills in.`;
  }

  const parts: string[] = [];
  const gd = overall.goalsFor - overall.goalsAgainst;
  parts.push(
    `${plural(overall.played, "meeting")} with ${opponentName}: `
    + `${overall.won}W ${overall.drawn}D ${overall.lost}L, ${overall.goalsFor}–${overall.goalsAgainst} `
    + `on goals (${gd >= 0 ? "+" : ""}${gd}).`,
  );

  if (lines.length > 1) {
    parts.push(
      "Met at "
      + lines
          .map((l) => `${l.name} (${l.record.won}W ${l.record.drawn}D ${l.record.lost}L)`)
          .join(", ")
      + ".",
    );
  }

  parts.push(
    overall.won === overall.played ? "Won every one of them."
    : overall.lost === overall.played ? "Lost every one of them."
    : overall.won > overall.lost ? "We hold the better record."
    : overall.won < overall.lost ? "They hold the better record."
    : "Honours even.",
  );

  if (shootouts > 0) {
    parts.push(
      `${plural(shootouts, "tie")} went to penalties, counted here as won or lost — the `
      + "head-to-head card counts goals only, so it reads those as draws.",
    );
  }

  return parts.join(" ");
}

// ── Squad against squad ───────────────────────────────────────────────────────
/** One squad's tournament reduced to the figures the other squad can be read against. */
export interface SquadCompareLine {
  squadId: string | null;
  squadName: string;
  record: TournamentRecord;
  ppg: number | null;
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  cleanSheetPct: number | null;
  /** Named in a squad, and of those the number who actually got on the pitch. */
  squadSize: number;
  playersUsed: number;
  totalLoadAu: number;
  /** Load spread over the players who played, so squad sizes stay comparable. */
  loadPerPlayer: number | null;
  topScorer: PlayerLine | null;
}

/**
 * Both squads side by side, in the order they were entered.
 *
 * Rates rather than totals wherever a total would mislead: one squad playing
 * four games and the other two makes every raw column incomparable, and the
 * question being asked of this table is which squad went better, not which
 * played more.
 */
export function buildSquadComparison(squads: SquadReport[]): SquadCompareLine[] {
  return squads.map((s) => {
    const played = s.players.filter((l) => l.minutes > 0);
    const totalLoadAu = s.players.reduce((sum, l) => sum + l.loadAu, 0);
    return {
      squadId: s.squadId,
      squadName: s.squadName,
      record: s.record,
      ppg: div(s.record.won * 3 + s.record.drawn, s.record.played),
      goalsForPerGame: s.scoredPerGame,
      goalsAgainstPerGame: s.concededPerGame,
      cleanSheetPct: s.cleanSheetPct,
      squadSize: s.players.length,
      playersUsed: played.length,
      totalLoadAu,
      loadPerPlayer: div(totalLoadAu, played.length),
      topScorer: s.topScorers[0] ?? null,
    };
  });
}

/**
 * What separates the squads. Only ever compares squads that actually played —
 * ranking a squad with no result would read as a verdict on it.
 */
export function interpretSquadComparison(squads: SquadReport[]): string {
  const lines = buildSquadComparison(squads).filter((l) => l.record.played > 0);
  if (lines.length < 2) {
    return lines.length === 1
      ? `Only ${lines[0].squadName} has a result on record, so there's nothing to compare it against yet.`
      : "No squad has a result on record yet.";
  }

  const parts: string[] = [];

  // Points per game first: it is the one column that answers "which went better"
  const byPpg = [...lines].sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0));
  const best = byPpg[0], worst = byPpg[byPpg.length - 1];
  parts.push(
    (best.ppg ?? 0) === (worst.ppg ?? 0)
      ? `Both squads returned ${rate(best.ppg)} points per game.`
      : `${best.squadName} returned ${rate(best.ppg)} points per game to ${possessive(worst.squadName)} `
        + `${rate(worst.ppg)} — ${best.record.won}W ${best.record.drawn}D ${best.record.lost}L `
        + `against ${worst.record.won}W ${worst.record.drawn}D ${worst.record.lost}L.`,
  );

  // Whether the gap was made at one end of the pitch or the other
  const byScoring = [...lines].sort((a, b) => (b.goalsForPerGame ?? 0) - (a.goalsForPerGame ?? 0));
  const byConceding = [...lines].sort((a, b) => (a.goalsAgainstPerGame ?? 0) - (b.goalsAgainstPerGame ?? 0));
  const leanest = byScoring[byScoring.length - 1];
  parts.push(
    `${byScoring[0].squadName} scored the more freely at ${rate(byScoring[0].goalsForPerGame)} a game `
    + `(${rate(leanest.goalsForPerGame)} for ${leanest.squadName}), `
    + `and ${byConceding[0].squadName} defended the better at ${rate(byConceding[0].goalsAgainstPerGame)} conceded a game.`,
  );

  const withSheets = lines.filter((l) => l.cleanSheetPct != null);
  if (withSheets.length === lines.length) {
    const bySheets = [...withSheets].sort((a, b) => (b.cleanSheetPct ?? 0) - (a.cleanSheetPct ?? 0));
    parts.push(
      bySheets.every((l) => l.cleanSheetPct === 0)
        ? "Neither squad kept a clean sheet."
        : `Clean sheets: ${bySheets.map((l) => `${l.squadName} ${Math.round(l.cleanSheetPct ?? 0)}%`).join(", ")}.`,
    );
  }

  // Load is the other reason to run two squads — it says which set of legs paid for it
  const byLoad = [...lines].sort((a, b) => (b.loadPerPlayer ?? 0) - (a.loadPerPlayer ?? 0));
  const heavy = byLoad[0], light = byLoad[byLoad.length - 1];
  if ((heavy.loadPerPlayer ?? 0) > 0) {
    parts.push(
      `${heavy.squadName} carried the heavier load at ${Math.round(heavy.loadPerPlayer ?? 0).toLocaleString()} AU `
      + `per player who played, against ${Math.round(light.loadPerPlayer ?? 0).toLocaleString()} AU for ${light.squadName}.`,
    );
  }

  // A player named in both squads is counted in both columns above
  const shared = sharedPlayers(squads);
  if (shared.length > 0) {
    parts.push(
      `${shared.slice(0, 6).map((p) => p.name).join(", ")}${shared.length > 6 ? ` and ${shared.length - 6} more` : ""} `
      + `${shared.length === 1 ? "was" : "were"} named in both squads, so those minutes and that load `
      + "appear in both columns.",
    );
  }

  return parts.join(" ");
}

/** Players named in more than one of these squads, by name. */
function sharedPlayers(squads: SquadReport[]): Player[] {
  const seen = new Map<string, { player: Player; squads: number }>();
  for (const s of squads) {
    for (const id of new Set(s.players.map((l) => l.player.id))) {
      const line = s.players.find((l) => l.player.id === id)!;
      const held = seen.get(id);
      if (held) held.squads += 1;
      else seen.set(id, { player: line.player, squads: 1 });
    }
  }
  return [...seen.values()]
    .filter((e) => e.squads > 1)
    .map((e) => e.player)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Form: the last N games ────────────────────────────────────────────────────
export interface FormSummary {
  /** Newest first — how the list reads. Results only; a fixture isn't form. */
  matches: MatchWithSession[];
  record: TournamentRecord;
  /** Oldest → newest, so the pills read left to right like a form guide. */
  form: MatchResult[];
  points: number;
  headline: string;
}

/**
 * The last `n` results. `matches` may arrive in any order; this sorts by date.
 * Undated matches are dropped — form is a sequence, and a row with no date has
 * no place in one.
 */
export function buildFormSummary(matches: MatchWithSession[], n = 5): FormSummary {
  const recent = matches
    .filter((m) => isPlayed(m) && m.sessions?.date)
    .sort((a, b) => (b.sessions?.date ?? "").localeCompare(a.sessions?.date ?? ""))
    .slice(0, n);

  const record = tournamentRecord(recent, matchOutcome);
  const form = [...recent]
    .reverse()
    .map((m) => matchOutcome(m))
    .filter((r): r is MatchResult => r !== null);
  const points = form.reduce((s, r) => s + pointsFor(r), 0);

  return { matches: recent, record, form, points, headline: interpretForm(recent, record, points) };
}

function interpretForm(
  recent: MatchWithSession[],
  record: TournamentRecord,
  points: number,
): string {
  if (recent.length === 0) {
    return "No results logged yet. Enter a score on a match and the form guide fills in.";
  }

  const parts: string[] = [];
  const gd = record.goalsFor - record.goalsAgainst;
  parts.push(
    `${plural(record.won, "win")}, ${record.drawn} ${record.drawn === 1 ? "draw" : "draws"} and ${plural(record.lost, "loss", "losses")} `
    + `in the last ${plural(recent.length, "game")} — ${points} of ${recent.length * 3} points, `
    + `${record.goalsFor} scored and ${record.goalsAgainst} conceded (${gd >= 0 ? "+" : ""}${gd}).`,
  );

  // An unbeaten or winless run is the thing a coach actually reads this for
  const results = [...recent].map((m) => matchOutcome(m));
  let streak = 0;
  const head = results[0];
  if (head) {
    for (const r of results) {
      if (r !== head) break;
      streak += 1;
    }
  }
  if (streak >= 3 && head) {
    const word = head === "W" ? "wins" : head === "L" ? "defeats" : "draws";
    parts.push(`The last ${streak} were all ${word}.`);
  } else if (record.lost === 0 && recent.length >= 3) {
    parts.push(`Unbeaten across all ${recent.length}.`);
  } else if (record.won === 0 && recent.length >= 3) {
    parts.push(`Still waiting on a win across those ${recent.length}.`);
  }

  const cleanSheets = recent.filter((m) => m.goals_against === 0).length;
  if (cleanSheets > 0) {
    parts.push(`${plural(cleanSheets, "clean sheet")} in that run.`);
  } else {
    parts.push("No clean sheets in that run.");
  }

  return parts.join(" ");
}

// ── Trend across tournaments ──────────────────────────────────────────────────
export interface TrendPoint {
  tournamentId: string;
  name: string;
  /** Sort key — the tournament's end date, falling back to its last match. */
  date: string | null;
  played: number;
  ppg: number | null;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  cleanSheetPct: number | null;
  finish: TournamentFinish | null;
}

/**
 * One point per tournament that was actually played, oldest → newest.
 *
 * Points per game rather than raw wins, so a three-match group stage and a
 * seven-match run are comparable. Tournaments with no played match are dropped:
 * a scheduled entry has no form to plot, and plotting it at zero would read as
 * a hammering.
 */
export function buildTournamentTrend(
  tournaments: Tournament[],
  matches: MatchWithTournament[],
  finishes: Map<string, TournamentFinish>,
): TrendPoint[] {
  const byTournament = new Map<string, MatchWithTournament[]>();
  for (const m of matches) {
    if (!m.tournament_id) continue; // a standalone friendly belongs to no competition
    const list = byTournament.get(m.tournament_id);
    if (list) list.push(m);
    else byTournament.set(m.tournament_id, [m]);
  }

  const points: TrendPoint[] = [];
  for (const t of tournaments) {
    const ms = byTournament.get(t.id) ?? [];
    const record = tournamentRecord(ms, matchOutcome);
    if (record.played === 0) continue;

    const played = ms.filter(isPlayed);
    const lastPlayed = played.reduce<string | null>(
      (max, m) => {
        const d = m.sessions?.date ?? null;
        return d && (max === null || d > max) ? d : max;
      },
      null,
    );

    points.push({
      tournamentId: t.id,
      name: t.name,
      date: t.end_date ?? t.start_date ?? lastPlayed,
      played: record.played,
      ppg: div(record.won * 3 + record.drawn, record.played),
      goalsFor: record.goalsFor,
      goalsAgainst: record.goalsAgainst,
      goalDiff: record.goalsFor - record.goalsAgainst,
      cleanSheetPct: div(played.filter((m) => m.goals_against === 0).length * 100, played.length),
      finish: finishes.get(t.id) ?? null,
    });
  }

  // Undated tournaments sort last rather than jumping to the front as ""
  return points.sort((a, b) => {
    if (!a.date && !b.date) return a.name.localeCompare(b.name);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

/**
 * How the most recent tournament compares with what came before it. Every figure
 * named here is read off `points` — nothing is inferred.
 */
export function interpretTrend(points: TrendPoint[]): string {
  if (points.length === 0) {
    return "No completed tournaments yet. Log a result and the trend fills in.";
  }
  const latest = points[points.length - 1];
  if (points.length === 1) {
    return `One tournament on record: ${latest.name}, ${round1(latest.ppg ?? 0)} points per game across ${plural(latest.played, "match", "matches")}`
      + `${latest.finish ? `, finishing as ${latest.finish.toLowerCase()}` : ""}.`;
  }

  const prior = points.slice(0, -1);
  const priorPpg = prior.reduce((s, p) => s + (p.ppg ?? 0), 0) / prior.length;
  const parts: string[] = [];

  const latestPpg = latest.ppg ?? 0;
  const gap = latestPpg - priorPpg;
  const direction =
    Math.abs(gap) < 0.25 ? `in line with the ${round1(priorPpg)} averaged across the previous ${plural(prior.length, "tournament")}`
    : gap > 0 ? `up on the ${round1(priorPpg)} averaged across the previous ${plural(prior.length, "tournament")}`
    : `down on the ${round1(priorPpg)} averaged across the previous ${plural(prior.length, "tournament")}`;
  parts.push(`${latest.name} returned ${round1(latestPpg)} points per game, ${direction}.`);

  const best = [...points].sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0))[0];
  if (best.tournamentId !== latest.tournamentId) {
    parts.push(`The strongest return so far is ${best.name} at ${round1(best.ppg ?? 0)}.`);
  } else {
    parts.push("That is the strongest return on record.");
  }

  // Goal difference is the other half of the story — a good PPG on a negative GD
  // is a run of narrow wins, and worth knowing about
  parts.push(
    `Goal difference across ${plural(points.length, "tournament")} is `
    + `${points.reduce((s, p) => s + p.goalDiff, 0) >= 0 ? "+" : ""}`
    + `${points.reduce((s, p) => s + p.goalDiff, 0)}, with ${latest.name} at `
    + `${latest.goalDiff >= 0 ? "+" : ""}${latest.goalDiff}.`,
  );

  const medals = points.filter((p) => p.finish !== null);
  if (medals.length > 0) {
    parts.push(`${plural(medals.length, "tournament")} ended on the podium.`);
  }

  return parts.join(" ");
}

// ── Reading a single tournament ───────────────────────────────────────────────
/** The one-paragraph summary above a tournament report. Deterministic. */
export function interpretSquadReport(r: SquadReport): string {
  if (r.record.played === 0) {
    return "No results logged for this squad yet.";
  }

  const parts: string[] = [];
  parts.push(
    `${plural(r.record.played, "match", "matches")} played: ${r.record.won}W ${r.record.drawn}D ${r.record.lost}L, `
    + `${r.record.goalsFor} scored and ${r.record.goalsAgainst} conceded.`,
  );

  if (r.scoredPerGame != null && r.concededPerGame != null) {
    parts.push(`That's ${round1(r.scoredPerGame)} scored and ${round1(r.concededPerGame)} conceded per game.`);
  }
  if (r.cleanSheetPct != null) {
    parts.push(
      r.cleanSheets === 0
        ? "No clean sheets."
        : `${plural(r.cleanSheets, "clean sheet")} — ${Math.round(r.cleanSheetPct)}% of games.`,
    );
  }

  const top = r.topScorers[0];
  if (top) {
    const share = r.record.goalsFor > 0 ? Math.round((top.goals / r.record.goalsFor) * 100) : null;
    parts.push(
      `${top.player.name} led the scoring with ${plural(top.goals, "goal")}`
      + `${share !== null ? `, ${share}% of the total` : ""}.`,
    );
  }

  if (r.injuries.length > 0) {
    const names = [...new Set(r.injuries.map((i) => i.player.name))];
    parts.push(`${plural(names.length, "player")} picked up a knock: ${names.join(", ")}.`);
  }

  if (r.shootouts.played > 0) {
    parts.push(`${plural(r.shootouts.played, "tie")} went to penalties — ${r.shootouts.won} won, ${r.shootouts.lost} lost.`);
  }

  return parts.join(" ");
}

/**
 * What the goal breakdown says. Set pieces are the interesting part: a side that
 * scores a third of its goals from dead balls is a different side from one that
 * scores none, and it's not something the totals show on their own.
 */
export function interpretGoals(r: SquadReport): string {
  const { open, fk, pen } = r.goalMethods;
  const attributed = open + fk + pen;
  if (r.record.goalsFor === 0) {
    return "No goals scored yet, so there's nothing to break down. Log a scorer on a match and this fills in.";
  }

  const parts: string[] = [];
  const setPieces = fk + pen;
  const setShare = attributed > 0 ? Math.round((setPieces / attributed) * 100) : 0;

  parts.push(
    setPieces === 0
      ? `All ${plural(attributed, "goal")} came from open play — nothing from a dead ball.`
      : `${setShare}% of the goals came from a dead ball (${fk} free ${fk === 1 ? "kick" : "kicks"}, ${pen} ${pen === 1 ? "penalty" : "penalties"}), the other ${open} from open play.`,
  );

  const scorers = r.topScorers.length;
  if (scorers > 0) {
    const top = r.topScorers[0];
    const topShare = Math.round((top.goals / attributed) * 100);
    parts.push(
      scorers === 1
        ? `Every goal came from one player, ${top.player.name} — nobody else has scored.`
        : topShare >= 40
          ? `${plural(scorers, "player")} scored, but ${top.player.name} alone accounts for ${topShare}% of them — the scoring leans heavily on one player.`
          : `${plural(scorers, "player")} scored, the most from ${top.player.name} on ${top.goals} (${topShare}%) — the goals are spread rather than carried by one player.`,
    );
  }

  if (r.record.played > 0) {
    const perGame = r.record.goalsFor / r.record.played;
    parts.push(
      perGame >= 2
        ? `At ${round1(perGame)} a game, scoring hasn't been the problem.`
        : perGame >= 1
          ? `That's ${round1(perGame)} a game.`
          : `At ${round1(perGame)} a game, goals have been hard to come by.`,
    );
  }

  // The two can only differ if a scoreline was entered without naming a scorer
  if (attributed !== r.record.goalsFor) {
    const gap = r.record.goalsFor - attributed;
    parts.push(
      gap > 0
        ? `${plural(gap, "goal")} on the scorelines ${gap === 1 ? "has" : "have"} no scorer recorded, so the split above is short by that much.`
        : `Players are credited with ${-gap} more ${-gap === 1 ? "goal" : "goals"} than the scorelines show — worth checking a match's score.`,
    );
  }

  return parts.join(" ");
}

/**
 * What the goalkeeping numbers say. Clean sheets alone flatter a keeper who
 * played the easy games, so this reads them against matches and goals conceded.
 */
export function interpretGoalkeeping(r: SquadReport): string {
  const played = r.record.played;
  if (played === 0) return "No played matches yet, so there's nothing to read.";
  if (r.keepers.length === 0) {
    return `No goalkeeper is on the team sheet for any of these ${plural(played, "match", "matches")}, `
      + `so the ${plural(r.record.goalsAgainst, "goal")} conceded can't be attributed. `
      + "Add the keeper to the match grid and this fills in.";
  }

  const parts: string[] = [];
  const covered = r.keepers.reduce((s, k) => s + k.started, 0);
  parts.push(
    r.cleanSheets === 0
      ? `No clean sheets in ${plural(played, "match", "matches")}; ${r.record.goalsAgainst} conceded, ${round1(r.record.goalsAgainst / played)} a game.`
      : `${plural(r.cleanSheets, "clean sheet")} in ${plural(played, "match", "matches")} — ${Math.round((r.cleanSheets / played) * 100)}% — with ${round1(r.record.goalsAgainst / played)} conceded a game.`,
  );

  if (r.keepers.length === 1) {
    const k = r.keepers[0];
    parts.push(`${k.player.name} played all ${k.started} of them, conceding ${k.conceded}.`);
  } else {
    // Busiest first, not best-rate first: over one or two games a concede rate
    // says almost nothing, and leading with it would rank a stand-in above the
    // keeper who actually played the tournament.
    const busiest = [...r.keepers].filter((k) => k.started > 0).sort((a, b) => b.started - a.started);
    parts.push(
      `${plural(busiest.length, "keeper")} shared the games: `
      + busiest
        .map((k) =>
          `${k.player.name} ${plural(k.started, "match", "matches")}, ${k.conceded} conceded `
          + `(${round1(k.conceded / k.started)} a game), ${k.cleanSheets} clean ${k.cleanSheets === 1 ? "sheet" : "sheets"}`)
        .join("; ")
      + ".",
    );
    // Only worth ranking when both keepers have played enough to mean something
    const comparable = busiest.filter((k) => k.started >= 3);
    if (comparable.length > 1) {
      const sorted = [...comparable].sort((a, b) => a.conceded / a.started - b.conceded / b.started);
      const best = sorted[0], worst = sorted[sorted.length - 1];
      if (best.conceded / best.started < worst.conceded / worst.started) {
        parts.push(`On a comparable run of games ${best.player.name} has the better rate.`);
      }
    }
  }

  if (covered < played) {
    parts.push(
      `${played - covered} of the ${played} played matches had no goalkeeper on the sheet, so those goals aren't counted against anyone here.`,
    );
  }

  return parts.join(" ");
}

/**
 * How the minutes were shared out. The question a coach is asking is whether the
 * squad was rotated or whether the same few carried it, so that's what this
 * answers — with the actual share of available minutes, not raw totals.
 */
export function interpretRotation(r: SquadReport): string {
  const squad = r.players.length;
  if (squad === 0) return "No squad call-ups recorded for these matches.";

  const withMinutes = r.players.filter((l) => l.minutes > 0);
  const parts: string[] = [];
  parts.push(
    withMinutes.length === squad
      ? `All ${plural(squad, "player")} named got on the pitch.`
      : `${withMinutes.length} of ${plural(squad, "named player")} got on the pitch; ${squad - withMinutes.length} didn't.`,
  );

  if (withMinutes.length === 0) return parts.join(" ");

  const totalMinutes = withMinutes.reduce((s, l) => s + l.minutes, 0);
  const topFive = [...withMinutes].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  const topShare = Math.round((topFive.reduce((s, l) => s + l.minutes, 0) / totalMinutes) * 100);
  parts.push(
    topShare >= 60
      ? `The top ${topFive.length} took ${topShare}% of all minutes played — this was carried by a small group.`
      : `The top ${topFive.length} took ${topShare}% of all minutes played, so the load was spread reasonably wide.`,
  );

  const everPresent = withMinutes.filter((l) => l.minutesShare != null && l.minutesShare >= 0.95);
  if (everPresent.length > 0) {
    parts.push(
      `${everPresent.map((l) => l.player.name).join(", ")} played essentially every available minute — the ${everPresent.length === 1 ? "one to watch" : "ones to watch"} for fatigue.`,
    );
  }

  const barely = withMinutes.filter((l) => l.minutesShare != null && l.minutesShare < 0.2);
  if (barely.length > 0) {
    parts.push(`${plural(barely.length, "player")} saw under a fifth of the minutes available to them.`);
  }

  const heaviest = topFive[0];
  parts.push(`Heaviest load was ${heaviest.player.name} on ${heaviest.loadAu.toLocaleString()} AU.`);

  return parts.join(" ");
}

/** What the head-to-head record says — who we beat, and who has our number. */
export function interpretOpponents(rows: OpponentH2H[]): string {
  const played = rows.filter((r) => r.played > 0);
  if (played.length === 0) {
    return "No matches against a recorded opponent yet. Set an opponent on a match and this fills in.";
  }

  const parts: string[] = [];
  const total = played.reduce((s, r) => s + r.played, 0);
  parts.push(`${plural(played.length, "opponent")} faced across ${plural(total, "match", "matches")}.`);

  const mostPlayed = [...played].sort((a, b) => b.played - a.played)[0];
  if (mostPlayed.played > 1) {
    parts.push(
      `${mostPlayed.opponent_name} is the most familiar on ${plural(mostPlayed.played, "meeting")} — `
      + `${mostPlayed.won}W ${mostPlayed.drawn}D ${mostPlayed.lost}L.`,
    );
  }

  const bogey = [...played]
    .filter((r) => r.lost > r.won)
    .sort((a, b) => (b.lost - b.won) - (a.lost - a.won) || (b.goals_against - b.goals_for) - (a.goals_against - a.goals_for))[0];
  if (bogey) {
    parts.push(
      `${bogey.opponent_name} has the better of it: ${bogey.won}W ${bogey.drawn}D ${bogey.lost}L, `
      + `${bogey.goals_for}–${bogey.goals_against} on goals.`,
    );
  } else {
    parts.push("No opponent holds a winning record against us.");
  }

  const beaten = played.filter((r) => r.won > 0 && r.lost === 0);
  if (beaten.length > 0) {
    parts.push(`Unbeaten against ${plural(beaten.length, "opponent")}.`);
  }

  const neverBeaten = played.filter((r) => r.won === 0);
  if (neverBeaten.length > 0) {
    parts.push(`Still to beat ${neverBeaten.map((r) => r.opponent_name).slice(0, 4).join(", ")}${neverBeaten.length > 4 ? ` and ${neverBeaten.length - 4} more` : ""}.`);
  }

  return parts.join(" ");
}

/** Per-player shootout tallies across a set of kicks, best record first. */
export function shootoutLines(
  kicks: MatchPenaltyKick[],
  players: Player[],
): { player: Player; taken: number; scored: number }[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const tally = new Map<string, { player: Player; taken: number; scored: number }>();
  for (const k of kicks) {
    const player = byId.get(k.player_id);
    if (!player) continue;
    const held = tally.get(k.player_id) ?? { player, taken: 0, scored: 0 };
    held.taken += 1;
    if (k.scored) held.scored += 1;
    tally.set(k.player_id, held);
  }
  return [...tally.values()].sort(
    (a, b) => b.scored - a.scored || a.taken - b.taken || a.player.name.localeCompare(b.player.name),
  );
}
