import {
  collapseLoadByDay, computeWeeklyMonotonyStrain, computeZScore,
  USUAL_RANGE_SD, Z_SCORE_MIN_WEEKS,
  type LoadRow, type UsualRange,
} from "./report";
import { isoOfDate, weekLabel, weekStart } from "./trainingAnalytics";

/**
 * Player-load analytics — the figures behind a player profile's Training Load
 * section, in the same shape `trainingAnalytics.ts` holds the squad's.
 *
 * Pure: no Supabase imports. It takes `LoadRow`s, so it inherits the one
 * definition of load the rest of the app uses (`buildLoadRows`), and cannot
 * disagree with the squad view, the printed report or the Dashboard alerts.
 *
 * Both functions here answer the same question from different angles — "is
 * this unusual *for this player*" — and both answer it against the player's
 * own history, never a squad norm. A 900 AU session is a heavy day for one
 * player and a Tuesday for another, and nothing on this page should imply
 * otherwise.
 */

// ── Usual session range ───────────────────────────────────────────────────────
/**
 * Linear-interpolated quantile of an already-sorted ascending array.
 * Population convention, matching the rest of the workload maths.
 */
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The band's edges: the middle half of the baseline's session days. */
const USUAL_SESSION_LOW_Q = 0.25;
const USUAL_SESSION_HIGH_Q = 0.75;

/**
 * The shaded band on the Load Trend chart: what a normal *training session*
 * day looks like for this player, from their own recent history.
 *
 * Deliberately the interquartile range, NOT mean ± `USUAL_RANGE_SD` the way
 * the squad's weekly band is built. Session load is duration × RPE, and on
 * this squad's real data that produces a lumpy, long-left-tailed
 * distribution rather than anything bell-shaped: clusters around 360 AU
 * (90 min at RPE 4) and 540 AU (90 min at RPE 6), a tail up at 720+, and a
 * scatter of 60 AU days from short or very light sessions. A standard
 * deviation fitted across that is inflated by the tail — the ±1.5 sd band it
 * produced spanned a median 511 AU and contained 95% of the days it was
 * meant to be judging, which is a band that excludes nothing and so says
 * nothing. The IQR ignores the tail by construction: median width 180 AU,
 * containing about half the plotted days.
 *
 * Known limit, worth stating: because the squad trains to a shared plan, the
 * resulting band lands on very nearly 360–540 for almost every player. It is
 * closer to "a normal session here" than to anything personal, and should
 * not be captioned as the player's own private norm.
 *
 * Training-session days only, matches excluded. A squad training Wed/Fri/Sun
 * with occasional fixtures has two quite separate load populations, and a
 * band fitted across both is wider still. The chart draws match days with
 * their own mark so a fixture above the band reads as a different kind of
 * day rather than a monstrous session.
 *
 * `beforeIso` is the first day the chart plots. Days on or after it are
 * excluded from the baseline: the band is the yardstick the plotted days are
 * measured against, so the days being judged must not also set the mark.
 *
 * Null below `minDays` — a band built from too little means nothing, and the
 * chart draws bare lines instead.
 */
export function computeUsualSessionRange(
  rows: LoadRow[],
  beforeIso: string,
  minDays: number,
): UsualRange | null {
  const sessionDayLoads = collapseLoadByDay(rows.filter((r) => r.source === "session"))
    .filter((r) => r.date != null && r.date < beforeIso)
    .map((r) => r.load_au)
    .sort((a, b) => a - b);

  if (sessionDayLoads.length < minDays) return null;

  return {
    low: quantile(sessionDayLoads, USUAL_SESSION_LOW_Q),
    high: quantile(sessionDayLoads, USUAL_SESSION_HIGH_Q),
  };
}

// ── Week-to-week variation ────────────────────────────────────────────────────
/**
 * One week of the variation trend. Deliberately carries no `strain` field:
 * strain is weekly load × monotony, an AU² quantity with no units anyone can
 * hold in their head, and a coach reading "18,400" learns nothing they could
 * act on. Only its position against this player's own history survives, as
 * `strainZ`.
 */
export interface VariationWeek {
  weekStart: string;
  weekEnd: string;
  label: string;
  /** Mean daily load ÷ SD of daily load. Shown in the tooltip only; null when every day in the week was identical. */
  monotony: number | null;
  /** How far this week's monotony sits from this player's own recent average, in SDs. Null until `Z_SCORE_MIN_WEEKS` prior weeks exist. */
  monotonyZ: number | null;
  /** The same for strain. The raw figure is intentionally not carried — see the interface docs. */
  strainZ: number | null;
  /** True when either z-score is outside ±`USUAL_RANGE_SD` — the band drawn on the chart. Never true on a partial week. */
  flagged: boolean;
  /** Same meaning as elsewhere: a trailing week cut short by `end`. Only the final entry can be true. */
  isPartial: boolean;
}

/**
 * Weekly monotony and strain, each expressed as distance from what is usual
 * for this player rather than as a raw figure.
 *
 * This is what lets two incomparable units — a dimensionless ratio and an AU²
 * product — share one axis honestly: neither line plots its own value, both
 * plot "how far from your normal is this". It is also what makes "flagged
 * only when unusual for that player" the literal geometry of the chart
 * instead of a threshold bolted on afterwards.
 *
 * Each week is scored against the weeks before it, so the series warms up:
 * early weeks have null z-scores and are drawn as a bare gap, not as zero.
 * `computeZScore` caps its own lookback at `Z_SCORE_MAX_WEEKS`.
 *
 * The trailing partial week gets null z-scores and is never flagged. A
 * three-day week carries less load and varies less than a seven-day one, so
 * scoring it against full weeks would reliably report "less than usual" for a
 * week that has simply not finished yet — the same rule `SquadWeekLoad`
 * applies to `weekOnWeekPerPlayerPct`, for the same reason.
 *
 * `rows` should be one entry per day (`collapseLoadByDay`) and `start` is
 * snapped to its Monday, so these weeks tile on the same boundary as every
 * other weekly view in the app.
 */
export function buildVariationTrend(rows: LoadRow[], start: Date, end: Date): VariationWeek[] {
  const monday = new Date(weekStart(isoOfDate(start)) + "T00:00:00");
  const weeks = computeWeeklyMonotonyStrain(rows, monday, end);

  const priorMonotony: number[] = [];
  const priorStrain: number[] = [];

  return weeks.map((w) => {
    const scorable = !w.isPartial;
    const monotonyZ = scorable && w.monotony !== null && priorMonotony.length >= Z_SCORE_MIN_WEEKS
      ? computeZScore(w.monotony, priorMonotony).zScore
      : null;
    const strainZ = scorable && w.strain !== null && priorStrain.length >= Z_SCORE_MIN_WEEKS
      ? computeZScore(w.strain, priorStrain).zScore
      : null;

    // Only complete weeks with a defined value join the baseline for the
    // weeks that follow — a partial week would drag the mean down for every
    // later week, long after it had itself finished.
    if (scorable && w.monotony !== null) priorMonotony.push(w.monotony);
    if (scorable && w.strain !== null) priorStrain.push(w.strain);

    return {
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      label: weekLabel(w.weekStart),
      monotony: w.monotony,
      monotonyZ,
      strainZ,
      flagged:
        (monotonyZ !== null && Math.abs(monotonyZ) > USUAL_RANGE_SD) ||
        (strainZ !== null && Math.abs(strainZ) > USUAL_RANGE_SD),
      isPartial: w.isPartial,
    };
  });
}

/**
 * The one-line read under the variation chart. Deterministic and written from
 * the figures it names — change a threshold and change the sentence.
 */
export function interpretVariationTrend(weeks: VariationWeek[]): string {
  const scored = weeks.filter((w) => w.monotonyZ !== null || w.strainZ !== null);
  if (scored.length === 0) {
    return "Not enough history yet to say what a usual week looks like for this player.";
  }
  const flagged = scored.filter((w) => w.flagged);
  if (flagged.length === 0) {
    return "Every week here varied about as much as this player's weeks usually do.";
  }
  const latest = flagged[flagged.length - 1];
  const repetitive = latest.monotonyZ !== null && latest.monotonyZ > USUAL_RANGE_SD;
  const detail = repetitive
    ? "the work was spread more evenly across the days than usual"
    : latest.monotonyZ !== null && latest.monotonyZ < -USUAL_RANGE_SD
      ? "the week was more up-and-down than usual"
      : "the combination of volume and evenness was unusual for him";
  return `${flagged.length} week${flagged.length === 1 ? "" : "s"} stood out; most recently ${latest.label}, where ${detail}.`;
}
