import { formatBronco } from "./utils";
import { teamBandFor, type TeamBand } from "./report";
import { BRONCO_TIERS, getBroncoTier, type BroncoTier, type Player, type TestResult, type TestSession } from "./types";
import type { Mode } from "./viz";

/**
 * Fitness-test analytics — the figures behind Fitness → Overview.
 *
 * Pure: no Supabase imports, so the arithmetic can be reasoned about on its own,
 * the way `lib/tournamentAnalytics.ts` and `lib/squad.ts` are. Callers pass rows
 * already scoped to the team and to whichever test sessions are selected; this
 * module never decides who is in scope.
 *
 * Everything is keyed on the **bronco** time, and lower is faster — a negative
 * change is an improvement in the athlete's terms and a positive `deltaSecs`
 * here. Every comparison in this module respects that, so read the sign twice
 * before changing anything.
 *
 * The `interpret*` functions are deterministic and written from the figures they
 * name, so the prose can never claim what the data doesn't show. Change a
 * threshold and change the sentence that reports it.
 */

/** A player's result in one test session. Only bronco-bearing rows get here. */
export interface FitnessResult {
  sessionId: string;
  sessionName: string;
  date: string;
  bronco: number;
  mas: number | null;
}

export interface FitnessLine {
  player: Player;
  /** Chronological, oldest first. */
  results: FitnessResult[];
  first: FitnessResult | null;
  latest: FitnessResult | null;
  /**
   * Seconds knocked off since their first test — positive is faster. null when
   * they have fewer than two tests, which is different from having not improved.
   */
  deltaSecs: number | null;
  /** The tier their latest time falls in. */
  tier: BroncoTier | null;
  tested: number;
}

/**
 * The deadband on "improved". A couple of seconds across a five-minute effort is
 * timing noise, not a fitness change, so movement inside ±3s counts as neither.
 */
export const IMPROVEMENT_SECS = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const avg = (ns: number[]): number | null =>
  ns.length === 0 ? null : ns.reduce((s, n) => s + n, 0) / ns.length;

// ── Per-player lines ──────────────────────────────────────────────────────────
type ResultRow = TestResult & { test_sessions?: Pick<TestSession, "test_date" | "test_name" | "type"> | null };

/**
 * One line per player, over the sessions given.
 *
 * `sessions` fixes both the scope and the order: a player's first and latest are
 * their first and latest *within the selection*, so narrowing to two sessions
 * compares exactly those two rather than silently reaching outside them.
 */
export function buildFitnessLines(
  players: Player[],
  results: ResultRow[],
  sessions: TestSession[],
): FitnessLine[] {
  const chronological = [...sessions].sort((a, b) => a.test_date.localeCompare(b.test_date));

  // One pass into a per-player, per-session index rather than a scan per cell
  const byPlayerSession = new Map<string, ResultRow>();
  for (const r of results) {
    if (r.bronco_mins == null) continue;
    byPlayerSession.set(`${r.player_id}:${r.session_id}`, r);
  }

  return players.map((player) => {
    const playerResults: FitnessResult[] = [];
    for (const s of chronological) {
      const r = byPlayerSession.get(`${player.id}:${s.id}`);
      if (!r) continue;
      playerResults.push({
        sessionId: s.id,
        sessionName: s.test_name,
        date: s.test_date,
        bronco: r.bronco_mins!,
        mas: r.mas_ms,
      });
    }

    const first = playerResults[0] ?? null;
    const latest = playerResults[playerResults.length - 1] ?? null;
    return {
      player,
      results: playerResults,
      first,
      latest,
      // Lower bronco is faster, so first − latest is the improvement
      deltaSecs: first && latest && playerResults.length > 1
        ? Math.round((first.bronco - latest.bronco) * 60)
        : null,
      tier: latest ? getBroncoTier(latest.bronco) : null,
      tested: playerResults.length,
    };
  });
}

/** Lines with a latest time, fastest first — the squad as a ranking. */
export function ranked(lines: FitnessLine[]): FitnessLine[] {
  return lines
    .filter((l) => l.latest)
    .sort((a, b) => a.latest!.bronco - b.latest!.bronco || a.player.name.localeCompare(b.player.name));
}

/** Players with two or more tests in scope — the only ones a change applies to. */
export function comparable(lines: FitnessLine[]): FitnessLine[] {
  return lines.filter((l) => l.deltaSecs !== null);
}

export interface Movers {
  improved: FitnessLine[];
  declined: FitnessLine[];
  /** Moved, but inside the noise band. */
  steady: FitnessLine[];
}

/** Who moved, biggest change first. Sorted by seconds, not by percentage. */
export function movers(lines: FitnessLine[]): Movers {
  const rows = comparable(lines);
  return {
    improved: rows.filter((l) => l.deltaSecs! > IMPROVEMENT_SECS).sort((a, b) => b.deltaSecs! - a.deltaSecs!),
    declined: rows.filter((l) => l.deltaSecs! < -IMPROVEMENT_SECS).sort((a, b) => a.deltaSecs! - b.deltaSecs!),
    steady: rows.filter((l) => Math.abs(l.deltaSecs!) <= IMPROVEMENT_SECS),
  };
}

// ── Team trend ────────────────────────────────────────────────────────────────
export interface FitnessTrendPoint {
  sessionId: string;
  name: string;
  date: string;
  tested: number;
  avgBronco: number;
}

/**
 * Squad average per test session, oldest → newest. Sessions nobody was tested in
 * are dropped rather than plotted at zero, which would read as a catastrophe.
 */
export function buildTeamTrend(results: ResultRow[], sessions: TestSession[]): FitnessTrendPoint[] {
  const chronological = [...sessions].sort((a, b) => a.test_date.localeCompare(b.test_date));
  const points: FitnessTrendPoint[] = [];

  for (const s of chronological) {
    const broncos = results
      .filter((r) => r.session_id === s.id && r.bronco_mins != null)
      .map((r) => r.bronco_mins!);
    const mean = avg(broncos);
    if (mean == null) continue;
    points.push({
      sessionId: s.id,
      name: s.test_name,
      date: s.test_date,
      tested: broncos.length,
      avgBronco: mean,
    });
  }
  return points;
}

// ── Group breakdowns ──────────────────────────────────────────────────────────
export interface GroupLine {
  group: string;
  tested: number;
  avgBronco: number;
  improved: number;
  declined: number;
  fastest: FitnessLine | null;
}

export interface GroupBreakdown {
  groups: GroupLine[];
  /** The session every average is measured on, or null when each player's own latest was used. */
  sessionName: string | null;
  /** Players with a time on record but none in that session — outside these averages. */
  excluded: number;
}

/** A line's result in one session, or its latest when no session is named. */
function pointFor(line: FitnessLine, sessionId: string | null): FitnessResult | null {
  if (!sessionId) return line.latest;
  return line.results.find((r) => r.sessionId === sessionId) ?? null;
}

/**
 * The squad cut by position or age band, in the fixed order the palette assigns
 * its slots. Groups nobody was tested in are dropped — a bar at zero would say
 * a group ran the bronco in no time at all.
 *
 * `sessionId` decides what is being compared, and the two answers differ:
 * naming a session compares everyone on **one day**, under the same conditions,
 * and leaves out whoever missed it; passing null uses each player's own latest
 * time, which counts everybody but sets a January time beside a March one. The
 * caller has to say which, because a chart that quietly mixes the two — as the
 * old Analytics page did, chart against cards — reports two different averages
 * for the same group on the same screen.
 */
export function buildGroupBreakdown<T extends string>(
  lines: FitnessLine[],
  order: readonly T[],
  groupOf: (l: FitnessLine) => string | null | undefined,
  sessionId: string | null = null,
): GroupBreakdown {
  const withTime = lines.filter((l) => l.latest);
  const inScope = withTime.filter((l) => pointFor(l, sessionId));

  const groups = order
    .map((group) => {
      const inGroup = inScope.filter((l) => groupOf(l) === group);
      const mean = avg(inGroup.map((l) => pointFor(l, sessionId)!.bronco));
      if (mean == null) return null;
      const moved = movers(inGroup);
      return {
        group,
        tested: inGroup.length,
        avgBronco: mean,
        improved: moved.improved.length,
        declined: moved.declined.length,
        fastest: [...inGroup].sort(
          (a, b) => pointFor(a, sessionId)!.bronco - pointFor(b, sessionId)!.bronco,
        )[0] ?? null,
      };
    })
    .filter(Boolean) as GroupLine[];

  return {
    groups,
    sessionName: sessionId ? inScope[0]?.results.find((r) => r.sessionId === sessionId)?.sessionName ?? null : null,
    excluded: withTime.length - inScope.length,
  };
}

// ── Where the squad sits ──────────────────────────────────────────────────────
export interface BandLine {
  band: TeamBand;
  players: FitnessLine[];
}

/**
 * The squad split into quartiles of its own latest times, via the same
 * `teamBandFor` the player profile and the printed report use — so a player's
 * band on their own page and their band here can never disagree.
 */
export function buildBands(lines: FitnessLine[], mode: Mode): BandLine[] {
  const rows = ranked(lines);
  const squadBroncos = rows.map((l) => l.latest!.bronco);
  const byLabel = new Map<string, BandLine>();

  for (const line of rows) {
    const band = teamBandFor(line.latest!.bronco, squadBroncos, mode);
    if (!band) continue;
    const held = byLabel.get(band.label);
    if (held) held.players.push(line);
    else byLabel.set(band.label, { band, players: [line] });
  }
  return [...byLabel.values()];
}

export interface TierLine {
  tier: BroncoTier;
  players: FitnessLine[];
}

/** The squad against the published bronco benchmarks, fastest tier first. */
export function buildTierDistribution(lines: FitnessLine[]): TierLine[] {
  return BRONCO_TIERS
    .map((tier) => ({
      tier,
      players: ranked(lines).filter((l) => l.tier?.label === tier.label),
    }))
    .filter((t) => t.players.length > 0);
}

// ── Readings ──────────────────────────────────────────────────────────────────
/** What the trend line says. Names the sessions, never "recent performance". */
export function interpretTrend(points: FitnessTrendPoint[]): string {
  if (points.length === 0) {
    return "No bronco times logged yet. Record a test session and the trend fills in.";
  }
  const latest = points[points.length - 1];
  if (points.length === 1) {
    return `One session on record: ${latest.name}, ${plural(latest.tested, "player")} averaging `
      + `${formatBronco(latest.avgBronco)}.`;
  }

  const previous = points[points.length - 2];
  const deltaSecs = Math.round((previous.avgBronco - latest.avgBronco) * 60);
  const parts: string[] = [];
  parts.push(
    Math.abs(deltaSecs) <= IMPROVEMENT_SECS
      ? `The squad averaged ${formatBronco(latest.avgBronco)} at ${latest.name}, level with ${previous.name} `
        + `(${formatBronco(previous.avgBronco)}).`
      : `The squad averaged ${formatBronco(latest.avgBronco)} at ${latest.name}, `
        + `${Math.abs(deltaSecs)}s ${deltaSecs > 0 ? "faster" : "slower"} than ${previous.name} `
        + `(${formatBronco(previous.avgBronco)}).`,
  );

  const best = [...points].sort((a, b) => a.avgBronco - b.avgBronco)[0];
  parts.push(
    best.sessionId === latest.sessionId
      ? "That is the squad's fastest average on record."
      : `The fastest average on record is ${best.name} at ${formatBronco(best.avgBronco)}.`,
  );

  // Turnout drives the average as much as fitness does, so it belongs in the reading
  if (latest.tested !== previous.tested) {
    parts.push(
      `${plural(latest.tested, "player")} were tested, against ${previous.tested} at ${previous.name} — `
      + "averages across different groups aren't strictly comparable.",
    );
  }
  return parts.join(" ");
}

/** Who moved, and by how much. */
export function interpretMovers(lines: FitnessLine[]): string {
  const rows = comparable(lines);
  if (rows.length === 0) {
    return "Nobody has two tests in this selection yet, so there's no change to report. "
      + "A second session is what makes a time a trend.";
  }

  const { improved, declined, steady } = movers(lines);
  const parts: string[] = [];
  parts.push(
    `${plural(rows.length, "player")} have been tested twice or more: `
    + `${improved.length} faster, ${declined.length} slower, ${steady.length} unchanged `
    + `(a change under ${IMPROVEMENT_SECS}s counts as unchanged).`,
  );

  if (improved.length > 0) {
    const best = improved[0];
    parts.push(
      `${best.player.name} has improved the most, ${best.deltaSecs}s faster — `
      + `${formatBronco(best.first!.bronco)} to ${formatBronco(best.latest!.bronco)}.`,
    );
  }
  if (declined.length > 0) {
    const worst = declined[0];
    parts.push(
      `${worst.player.name} has dropped off the most, ${Math.abs(worst.deltaSecs!)}s slower — `
      + `${formatBronco(worst.first!.bronco)} to ${formatBronco(worst.latest!.bronco)}. `
      + "Worth checking for illness, load or a missed block.",
    );
  }
  return parts.join(" ");
}

/** What the position or age split says. */
export function interpretGroups(breakdown: GroupBreakdown, label: string): string {
  const { groups, sessionName, excluded } = breakdown;
  if (groups.length === 0) {
    return `No bronco times to break down by ${label} yet.`;
  }

  const basis = sessionName
    ? ` Measured on ${sessionName}${excluded > 0 ? `, so ${plural(excluded, "player")} with a time from another session ${excluded === 1 ? "is" : "are"} not counted` : ""}.`
    : " Measured on each player's own latest time, which may come from different sessions.";

  if (groups.length === 1) {
    const only = groups[0];
    return `Only ${only.group} has times on record — ${plural(only.tested, "player")} averaging `
      + `${formatBronco(only.avgBronco)}.${basis}`;
  }

  const sorted = [...groups].sort((a, b) => a.avgBronco - b.avgBronco);
  const fastest = sorted[0], slowest = sorted[sorted.length - 1];
  const gapSecs = Math.round((slowest.avgBronco - fastest.avgBronco) * 60);
  const parts: string[] = [];
  parts.push(
    `${fastest.group} is the fastest group at ${formatBronco(fastest.avgBronco)}, `
    + `${gapSecs}s clear of ${slowest.group} at ${formatBronco(slowest.avgBronco)}.`,
  );

  parts.push(basis.trim());

  const thin = groups.filter((g) => g.tested < 3);
  if (thin.length > 0) {
    parts.push(
      `${thin.map((g) => `${g.group} (${g.tested})`).join(", ")} rest on fewer than three players, `
      + "so read those averages lightly.",
    );
  }

  const totalImproved = groups.reduce((s, g) => s + g.improved, 0);
  const totalDeclined = groups.reduce((s, g) => s + g.declined, 0);
  if (totalImproved + totalDeclined > 0) {
    const movingGroup = [...groups].sort((a, b) => b.improved - a.improved)[0];
    if (movingGroup.improved > 0) {
      parts.push(`Most of the improvement sits with ${movingGroup.group} — ${plural(movingGroup.improved, "player")} faster.`);
    }
  }
  return parts.join(" ");
}

/** What the quartile split says — a reading of the squad's own spread. */
export function interpretBands(bands: BandLine[], lines: FitnessLine[]): string {
  const rows = ranked(lines);
  if (rows.length === 0) return "No latest times to band yet.";
  if (rows.length < 4) {
    return `Only ${plural(rows.length, "player")} have a time in this selection — too few to split into `
      + "quartiles that mean anything.";
  }

  const fastest = rows[0], slowest = rows[rows.length - 1];
  const spreadSecs = Math.round((slowest.latest!.bronco - fastest.latest!.bronco) * 60);
  const parts: string[] = [];
  parts.push(
    `${plural(rows.length, "player")} have a time, from ${formatBronco(fastest.latest!.bronco)} `
    + `(${fastest.player.name}) to ${formatBronco(slowest.latest!.bronco)} (${slowest.player.name}) — `
    + `a spread of ${spreadSecs}s.`,
  );
  parts.push(
    "Bands are quartiles of this squad on this selection, so they move as the squad moves — "
    + "they say where a player sits here, not how fit they are in absolute terms.",
  );
  const bottom = bands.find((b) => b.band.label === "Bottom 25%");
  if (bottom && bottom.players.length > 0) {
    parts.push(`${plural(bottom.players.length, "player")} sit in the bottom quartile.`);
  }
  return parts.join(" ");
}

/** What the benchmark tiers say — the absolute reading the bands deliberately aren't. */
export function interpretTiers(tiers: TierLine[], lines: FitnessLine[]): string {
  const rows = ranked(lines);
  if (rows.length === 0) return "No latest times to place against the benchmarks yet.";

  const parts: string[] = [];
  const biggest = [...tiers].sort((a, b) => b.players.length - a.players.length)[0];
  parts.push(
    `${plural(rows.length, "player")} placed against the published bronco benchmarks. `
    + `Most sit in ${biggest.tier.label} (${biggest.players.length}) — ${biggest.tier.displayRange}.`,
  );

  const top = tiers.filter((t) => ["World Record", "Elite Professional", "Outstanding"].includes(t.tier.label));
  const topCount = top.reduce((s, t) => s + t.players.length, 0);
  if (topCount > 0) {
    parts.push(`${plural(topCount, "player")} reach Outstanding or better.`);
  }

  // Only worth calling out separately when it isn't already the sentence above
  const below = tiers.find((t) => t.tier.label === "Below Average");
  if (below && below.players.length < rows.length) {
    parts.push(
      `${plural(below.players.length, "player")} sit in Below Average — `
      + "the group where conditioning work pays back fastest.",
    );
  }
  return parts.join(" ");
}

/** What separates the players picked for comparison. */
export function interpretCompare(picked: FitnessLine[]): string {
  const withTimes = picked.filter((l) => l.latest);
  if (withTimes.length === 0) return "Pick players to compare their test results.";
  if (withTimes.length === 1) {
    const only = withTimes[0];
    return `${only.player.name} last ran ${formatBronco(only.latest!.bronco)} at ${only.latest!.sessionName}`
      + `${only.deltaSecs !== null ? `, ${Math.abs(only.deltaSecs)}s ${only.deltaSecs > 0 ? "faster" : "slower"} than their first test` : ""}. `
      + "Add another player to compare.";
  }

  const sorted = [...withTimes].sort((a, b) => a.latest!.bronco - b.latest!.bronco);
  const fastest = sorted[0], slowest = sorted[sorted.length - 1];
  const gapSecs = Math.round((slowest.latest!.bronco - fastest.latest!.bronco) * 60);
  const parts: string[] = [];
  parts.push(
    gapSecs === 0
      ? `${fastest.player.name} and ${slowest.player.name} last ran the same time, ${formatBronco(fastest.latest!.bronco)}.`
      : `${fastest.player.name} is fastest of the ${withTimes.length} at ${formatBronco(fastest.latest!.bronco)}, `
        + `${gapSecs}s ahead of ${slowest.player.name} (${formatBronco(slowest.latest!.bronco)}).`,
  );

  const moving = withTimes.filter((l) => l.deltaSecs !== null && Math.abs(l.deltaSecs) > IMPROVEMENT_SECS);
  if (moving.length > 0) {
    parts.push(
      moving
        .map((l) => `${l.player.name} is ${Math.abs(l.deltaSecs!)}s ${l.deltaSecs! > 0 ? "faster" : "slower"} than their first test`)
        .join(", ") + ".",
    );
  }

  const untested = picked.length - withTimes.length;
  if (untested > 0) {
    parts.push(`${plural(untested, "player")} picked ${untested === 1 ? "has" : "have"} no time in this selection.`);
  }
  return parts.join(" ");
}

/** The one-line summary above the whole tab. */
export function interpretSquadFitness(lines: FitnessLine[], trend: FitnessTrendPoint[]): string {
  const rows = ranked(lines);
  if (rows.length === 0) {
    return "No bronco times in this selection. Record a test session and this fills in.";
  }
  const latest = trend[trend.length - 1];
  const { improved, declined } = movers(lines);
  // Two different populations, so they are named separately rather than merged:
  // "has a time on record" is not "was tested at the most recent session"
  const parts: string[] = [
    `${plural(rows.length, "player")} have a time on record, averaging `
    + `${formatBronco(avg(rows.map((l) => l.latest!.bronco))!)} on their latest.`,
  ];
  if (latest) {
    parts.push(`The most recent session was ${latest.name}, with ${plural(latest.tested, "player")} tested.`);
  }
  const rest = comparable(lines).length;
  if (rest > 0) {
    parts.push(`Of the ${rest} with more than one test, ${improved.length} are faster and ${declined.length} slower.`);
  }
  const untested = lines.length - rows.length;
  if (untested > 0) {
    parts.push(`${plural(untested, "squad member")} ${untested === 1 ? "has" : "have"} no time in this selection.`);
  }
  return parts.join(" ");
}
