import { POSITION_ORDER } from "./viz";
import type { Player } from "./types";

/**
 * Squad composition — the numbers behind the Players → Overview tab, and the
 * plain-English reading of each one.
 *
 * The `interpret*` functions are deliberately deterministic: they are written
 * from the actual figures rather than generated, so the same squad always reads
 * the same way and the text can never claim something the data doesn't show.
 * Each one names real numbers; if you change a threshold here, change the
 * sentence that reports it.
 */

// ── Shape ─────────────────────────────────────────────────────────────────────
export interface AgeBin {
  age: number;
  players: number;
}

export interface PositionBin {
  position: string;
  players: number;
  avgAge: number | null;
}

export interface SquadOverview {
  /** Active players — the squad as it stands. */
  total: number;
  /** On file but not active; context for the headline, never counted in it. */
  inactive: number;
  /** Of `total`, how many have a birth year. The age chart can only see these. */
  withAge: number;
  avgAge: number | null;
  medianAge: number | null;
  minAge: number | null;
  maxAge: number | null;
  /** Every integer age from youngest to oldest, gaps included as zero. */
  ageCurve: AgeBin[];
  under20: number;
  thirtyPlus: number;
  /** The 3-year window holding the most players — where the squad's mass sits. */
  peakBand: { from: number; to: number; players: number } | null;
  byPosition: PositionBin[];
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Players whose position is blank still belong to the squad; they get a slot. */
const UNASSIGNED = "Unassigned";

export function buildSquadOverview(players: Player[]): SquadOverview {
  const active = players.filter((p) => p.is_active);
  const ages = active.map((p) => p.age).filter((a): a is number => a != null);

  const minAge = ages.length ? Math.min(...ages) : null;
  const maxAge = ages.length ? Math.max(...ages) : null;

  // Every year in range, including the empty ones — dropping them would bunch
  // the curve up and hide the gaps, which are the interesting part.
  const ageCurve: AgeBin[] = [];
  if (minAge != null && maxAge != null) {
    for (let age = minAge; age <= maxAge; age++) {
      ageCurve.push({ age, players: ages.filter((a) => a === age).length });
    }
  }

  let peakBand: SquadOverview["peakBand"] = null;
  for (const bin of ageCurve) {
    const players = ages.filter((a) => a >= bin.age && a <= bin.age + 2).length;
    if (!peakBand || players > peakBand.players) {
      peakBand = { from: bin.age, to: bin.age + 2, players };
    }
  }

  // Known positions in their fixed order first, then anything unrecognised
  const names = [
    ...POSITION_ORDER.filter((pos) => active.some((p) => p.primary_position === pos)),
    ...(active.some((p) => !p.primary_position) ? [UNASSIGNED] : []),
  ];

  const byPosition: PositionBin[] = names.map((position) => {
    const inPos = active.filter((p) =>
      position === UNASSIGNED ? !p.primary_position : p.primary_position === position);
    const posAges = inPos.map((p) => p.age).filter((a): a is number => a != null);
    const avg = mean(posAges);
    return { position, players: inPos.length, avgAge: avg == null ? null : round1(avg) };
  });

  const avg = mean(ages);
  const med = median(ages);

  return {
    total: active.length,
    inactive: players.length - active.length,
    withAge: ages.length,
    avgAge: avg == null ? null : round1(avg),
    medianAge: med == null ? null : round1(med),
    minAge,
    maxAge,
    ageCurve,
    under20: ages.filter((a) => a < 20).length,
    thirtyPlus: ages.filter((a) => a >= 30).length,
    peakBand,
    byPosition,
  };
}

// ── Interpretations ───────────────────────────────────────────────────────────
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Roughly how many elevens the roster covers — the practical read on squad size. */
export function interpretSize(o: SquadOverview): string {
  if (o.total === 0) return "No active players yet. Add players on the All tab and this fills in.";

  const parts: string[] = [];
  const elevens = o.total / 11;
  const depth =
    elevens >= 2.5 ? `comfortably more than two full elevens, so you can rotate hard and still field a side`
    : elevens >= 2 ? `just over two elevens — enough to rotate, but injuries start to bite quickly`
    : elevens >= 1.5 ? `about one and a half elevens, so a couple of absences leave you short`
    : `under two elevens' worth, so availability drives selection more than form does`;
  parts.push(`${plural(o.total, "active player")} — ${depth}.`);

  if (o.inactive > 0) {
    parts.push(`${plural(o.inactive, "other player")} ${o.inactive === 1 ? "is" : "are"} on file as inactive and ${o.inactive === 1 ? "is" : "are"} not counted here.`);
  }

  // Birth-year coverage is deliberately not mentioned here — it qualifies the
  // age chart, not the squad's size, and the age card's subtitle carries it.
  return parts.join(" ");
}

export function interpretAge(o: SquadOverview): string {
  if (o.withAge === 0 || o.avgAge == null || o.minAge == null || o.maxAge == null) {
    return "No birth years recorded yet, so there's no age profile to read. Add a year of birth to a player and this fills in.";
  }

  const parts: string[] = [];
  parts.push(`The squad averages ${o.avgAge} years and spans ${o.maxAge - o.minAge} years, from ${o.minAge} to ${o.maxAge}.`);

  // A mean well above the median means a few older players are dragging it up
  if (o.medianAge != null && Math.abs(o.avgAge - o.medianAge) >= 1) {
    const higher = o.avgAge > o.medianAge;
    parts.push(
      `The median is ${o.medianAge}, ${higher ? "below" : "above"} the average — a ${higher ? "handful of older players pulls the mean up" : "handful of younger players pulls the mean down"}, so the typical player is ${higher ? "younger" : "older"} than the average suggests.`,
    );
  }

  if (o.peakBand && o.peakBand.players >= 3) {
    const share = Math.round((o.peakBand.players / o.withAge) * 100);
    parts.push(`The bulk of it sits between ${o.peakBand.from} and ${o.peakBand.to}, which holds ${o.peakBand.players} of ${o.withAge} players (${share}%).`);
  }

  if (o.under20 > 0) {
    const share = Math.round((o.under20 / o.withAge) * 100);
    parts.push(
      share >= 25
        ? `${plural(o.under20, "player")} ${o.under20 === 1 ? "is" : "are"} under 20 (${share}%) — a substantial intake coming through behind the core.`
        : `${plural(o.under20, "player")} ${o.under20 === 1 ? "is" : "are"} under 20, a thin pipeline behind the current core.`,
    );
  } else {
    parts.push("Nobody is under 20, so there is no youth intake behind the current group.");
  }

  if (o.thirtyPlus > 0) {
    parts.push(`${plural(o.thirtyPlus, "player")} ${o.thirtyPlus === 1 ? "is" : "are"} 30 or over.`);
  }

  return parts.join(" ");
}

export function interpretPositions(o: SquadOverview): string {
  if (o.total === 0 || o.byPosition.length === 0) {
    return "No positions recorded yet. Set a primary position on a player and this fills in.";
  }

  const parts: string[] = [];
  const counts = o.byPosition.map((p) => p.players);
  const most = Math.max(...counts);
  const fewest = Math.min(...counts);

  // Ties are common with four positions and a small squad — naming only the
  // first would quietly misreport a level unit as the deepest one.
  const namesAt = (n: number) =>
    o.byPosition.filter((p) => p.players === n).map((p) => `${p.position}s`);
  const list = (xs: string[]) =>
    xs.length <= 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

  const deepest = namesAt(most);
  parts.push(
    deepest.length > 1
      ? `${list(deepest)} are level as the deepest units on ${plural(most, "player")} each.`
      : `${deepest[0]} are the deepest unit with ${plural(most, "player")}.`,
  );

  if (fewest !== most) {
    const thinnest = namesAt(fewest);
    parts.push(
      thinnest.length > 1
        ? `${list(thinnest)} are thinnest on ${fewest} each.`
        : `${thinnest[0]} are thinnest with ${fewest}.`,
    );
  }

  // Goalkeepers are the one position you cannot cover from another unit
  const gk = o.byPosition.find((p) => p.position === "Goalkeeper");
  if (!gk || gk.players === 0) {
    parts.push("No goalkeeper is on the active roster — that's the one position another player can't cover.");
  } else if (gk.players < 2) {
    parts.push("Only one goalkeeper is active, so a single injury or absence leaves you without one.");
  } else if (gk.players === 2) {
    parts.push("Two goalkeepers means cover for one absence, but no more than that.");
  }

  // A unit ageing well away from the rest of the squad is worth naming
  if (o.avgAge != null) {
    const outlier = o.byPosition
      .filter((p) => p.avgAge != null && p.players > 0)
      .map((p) => ({ ...p, gap: (p.avgAge as number) - (o.avgAge as number) }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
    if (outlier && Math.abs(outlier.gap) >= 4) {
      parts.push(
        outlier.gap > 0
          ? `${outlier.position}s average ${outlier.avgAge}, ${round1(Math.abs(outlier.gap))} years above the squad average — the unit most in need of a successor being brought through.`
          : `${outlier.position}s average ${outlier.avgAge}, ${round1(Math.abs(outlier.gap))} years below the squad average — the youngest unit in the side.`,
      );
    }
  }

  const missing = POSITION_ORDER.filter((pos) => !o.byPosition.some((p) => p.position === pos));
  if (missing.length > 0 && missing.length < POSITION_ORDER.length) {
    parts.push(`No ${missing.map((m) => `${m.toLowerCase()}s`).join(" or ")} are recorded at all.`);
  }

  return parts.join(" ");
}
