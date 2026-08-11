import { computeAcwr, collapseLoadByDay, type AcwrResult, type LoadRow } from "./report";
import type { Player } from "./types";

/**
 * Team training-load analytics — the figures behind Training → Overview.
 *
 * Pure: no Supabase imports. It takes `LoadRow`s, which means it inherits the
 * one definition of load the rest of the app already uses — `buildLoadRows` in
 * lib/report.ts folds rated sessions and match minutes together, scoring every
 * match at `MATCH_RPE` however hard it felt. The player profile, the printed
 * report and the Dashboard alerts all read the same rows, so the team view here
 * cannot disagree with any of them.
 *
 * (The old Analytics page summed `session_rpe.load_au` directly, which counted a
 * match at whatever RPE the player rated it and missed match days nobody rated.
 * Figures here differ from that page for exactly that reason.)
 *
 * The `interpret*` functions are deterministic and written from the figures they
 * name. Change a threshold and change the sentence that reports it.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The Monday of the week a date falls in, as ISO. Weeks start Monday here. */
function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const offset = (d.getDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Rows inside the last `weeks` weeks. null keeps everything. */
export function withinWeeks(rows: LoadRow[], weeks: number | null, now: Date = new Date()): LoadRow[] {
  if (!weeks) return rows;
  const cutoff = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return rows.filter((r) => r.date != null && r.date >= cutoffIso);
}

// ── Weekly team load ──────────────────────────────────────────────────────────
export interface WeekLoad {
  /** ISO date of the Monday. Sorts correctly as a string. */
  weekStart: string;
  label: string;
  totalAu: number;
  /** Spread over the players who actually did something that week. */
  perPlayerAu: number;
  players: number;
  /** Distinct days trained or played. */
  days: number;
}

/**
 * One point per week, oldest first. Weeks nobody worked are omitted rather than
 * plotted at zero — a blank week in the calendar is not a week of no training,
 * it is usually a week nobody logged.
 */
export function buildWeeklyTeamLoad(rows: LoadRow[]): WeekLoad[] {
  const byWeek = new Map<string, { total: number; players: Set<string>; days: Set<string> }>();

  for (const r of rows) {
    if (r.date == null) continue; // an undated row has no week to belong to
    const key = weekStart(r.date);
    const held = byWeek.get(key) ?? { total: 0, players: new Set<string>(), days: new Set<string>() };
    held.total += r.load_au;
    held.players.add(r.player_id);
    held.days.add(r.date);
    byWeek.set(key, held);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartIso, v]) => ({
      weekStart: weekStartIso,
      label: weekLabel(weekStartIso),
      totalAu: Math.round(v.total),
      perPlayerAu: Math.round(v.total / v.players.size),
      players: v.players.size,
      days: v.days.size,
    }));
}

// ── Player load distribution ──────────────────────────────────────────────────
export interface PlayerLoadLine {
  player: Player;
  totalAu: number;
  /** Per day worked, not per calendar day — a rest day isn't a light day. */
  perDayAu: number;
  days: number;
  /** Share of the load that came from matches rather than rated sessions. */
  matchShare: number;
  acwr: AcwrResult;
}

/**
 * One line per player who did anything in the window, heaviest first.
 *
 * ACWR is computed from the *whole* set of rows for that player, not the
 * windowed ones: the ratio needs 28 days behind the anchor, and a 4-week window
 * would leave it comparing a period against itself.
 */
export function buildPlayerLoadDistribution(
  windowed: LoadRow[],
  all: LoadRow[],
  players: Player[],
  now: Date = new Date(),
): PlayerLoadLine[] {
  const byId = new Map(players.map((p) => [p.id, p] as const));

  const grouped = new Map<string, LoadRow[]>();
  for (const r of windowed) {
    const list = grouped.get(r.player_id);
    if (list) list.push(r);
    else grouped.set(r.player_id, [r]);
  }

  const allByPlayer = new Map<string, LoadRow[]>();
  for (const r of all) {
    const list = allByPlayer.get(r.player_id);
    if (list) list.push(r);
    else allByPlayer.set(r.player_id, [r]);
  }

  const lines: PlayerLoadLine[] = [];
  for (const [playerId, rows] of grouped) {
    const player = byId.get(playerId);
    if (!player) continue; // a row whose player has since left the squad

    const days = collapseLoadByDay(rows);
    const totalAu = rows.reduce((s, r) => s + r.load_au, 0);
    const matchAu = rows.reduce((s, r) => (r.source === "match" ? s + r.load_au : s), 0);

    lines.push({
      player,
      totalAu: Math.round(totalAu),
      perDayAu: days.length > 0 ? Math.round(totalAu / days.length) : 0,
      days: days.length,
      matchShare: totalAu > 0 ? matchAu / totalAu : 0,
      acwr: computeAcwr(collapseLoadByDay(allByPlayer.get(playerId) ?? []), now),
    });
  }

  return lines.sort((a, b) => b.totalAu - a.totalAu || a.player.name.localeCompare(b.player.name));
}

// ── Readings ──────────────────────────────────────────────────────────────────
/** What the weekly line says: the shape of the block, and any spike in it. */
export function interpretWeeklyLoad(weeks: WeekLoad[]): string {
  if (weeks.length === 0) {
    return "No load logged in this window. Rate a session or log match minutes and this fills in.";
  }

  const latest = weeks[weeks.length - 1];
  const parts: string[] = [
    `${plural(weeks.length, "week")} with load on record. The most recent, from ${latest.label}, `
    + `came to ${latest.totalAu.toLocaleString()} AU across ${plural(latest.players, "player")} `
    + `and ${plural(latest.days, "day")} — ${latest.perPlayerAu.toLocaleString()} AU each.`,
  ];

  if (weeks.length > 1) {
    const previous = weeks[weeks.length - 2];
    const change = previous.perPlayerAu > 0
      ? Math.round(((latest.perPlayerAu - previous.perPlayerAu) / previous.perPlayerAu) * 100)
      : null;
    // Per player, not total: a week with twice the turnout isn't twice the work
    if (change !== null) {
      parts.push(
        Math.abs(change) < 10
          ? `That's level with the week before (${previous.perPlayerAu.toLocaleString()} AU each).`
          : `That's ${Math.abs(change)}% ${change > 0 ? "up on" : "down on"} the week before `
            + `(${previous.perPlayerAu.toLocaleString()} AU each).`,
      );
    }

    const peak = [...weeks].sort((a, b) => b.perPlayerAu - a.perPlayerAu)[0];
    parts.push(
      peak.weekStart === latest.weekStart
        ? "That is the heaviest week per player in the window."
        : `The heaviest week per player was ${peak.label} at ${peak.perPlayerAu.toLocaleString()} AU.`,
    );
  }

  return parts.join(" ");
}

/** Who is carrying the load, and who the ratio says to watch. */
export function interpretLoadDistribution(lines: PlayerLoadLine[]): string {
  if (lines.length === 0) {
    return "Nobody has load logged in this window.";
  }

  const parts: string[] = [];
  const total = lines.reduce((s, l) => s + l.totalAu, 0);
  const heaviest = lines[0];
  const lightest = lines[lines.length - 1];

  parts.push(
    `${plural(lines.length, "player")} carried ${total.toLocaleString()} AU between them. `
    + `${heaviest.player.name} took the most at ${heaviest.totalAu.toLocaleString()} AU across `
    + `${plural(heaviest.days, "day")} (${heaviest.perDayAu.toLocaleString()} AU a day).`,
  );

  if (lines.length > 1) {
    parts.push(
      `${lightest.player.name} the least at ${lightest.totalAu.toLocaleString()} AU across `
      + `${plural(lightest.days, "day")}.`,
    );
    const topThird = lines.slice(0, Math.max(1, Math.ceil(lines.length / 3)));
    const share = Math.round((topThird.reduce((s, l) => s + l.totalAu, 0) / total) * 100);
    parts.push(
      share >= 50
        ? `The busiest third took ${share}% of all load — it is being carried by a small group.`
        : `The busiest third took ${share}% of all load, so it is spread reasonably wide.`,
    );
  }

  // The ratio is the actual injury-risk signal, and it reads the full history
  const flagged = lines.filter((l) => l.acwr.status === "danger" || l.acwr.status === "caution");
  if (flagged.length > 0) {
    parts.push(
      `${flagged.map((l) => `${l.player.name} (${round1(l.acwr.acwr ?? 0)})`).join(", ")} `
      + `${flagged.length === 1 ? "is" : "are"} above the 1.3 acute:chronic ratio — the last week is `
      + "heavy against their own four-week baseline.",
    );
  } else {
    parts.push("Nobody is above the 1.3 acute:chronic ratio.");
  }

  const matchHeavy = lines.filter((l) => l.matchShare >= 0.5);
  if (matchHeavy.length > 0) {
    parts.push(
      `${plural(matchHeavy.length, "player")} took at least half their load from matches, which are `
      + "scored at a fixed intensity rather than rated.",
    );
  }

  return parts.join(" ");
}
