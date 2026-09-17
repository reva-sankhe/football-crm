/**
 * Recurring-event support for the calendar. A recurring event is one `events`
 * row (start_time + recurrence_rule) representing the whole series — same
 * model Google Calendar itself uses — expanded into individual occurrences
 * only for display. Editing or deleting a series always acts on the row, so
 * there's no per-occurrence override; keep it that way unless someone
 * actually needs to split off a single occurrence, which is a much bigger
 * feature (RFC 5545 EXDATE/RECURRENCE-ID).
 */

export type RepeatFreq = "daily" | "weekly" | "monthly";

export interface RepeatConfig {
  freq: RepeatFreq;
  /** ISO date (yyyy-mm-dd), inclusive last day the series can occur on. */
  until: string | null;
  /** Total number of occurrences, including the first. */
  count: number | null;
}

/** Builds the bare RRULE value `ics` and Google Calendar both expect. */
export function buildRecurrenceRule(config: RepeatConfig): string {
  const freqMap: Record<RepeatFreq, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };
  const parts = [`FREQ=${freqMap[config.freq]}`];
  if (config.until) {
    // UNTIL must be a UTC timestamp; use end-of-day so the chosen date itself is included.
    const untilDate = new Date(`${config.until}T23:59:59Z`);
    const pad = (n: number) => String(n).padStart(2, "0");
    parts.push(
      `UNTIL=${untilDate.getUTCFullYear()}${pad(untilDate.getUTCMonth() + 1)}${pad(untilDate.getUTCDate())}T${pad(untilDate.getUTCHours())}${pad(untilDate.getUTCMinutes())}${pad(untilDate.getUTCSeconds())}Z`,
    );
  } else if (config.count) {
    parts.push(`COUNT=${config.count}`);
  }
  return parts.join(";");
}

/** Parses a stored RRULE value back into form state, for editing a series. */
export function parseRecurrenceRule(rule: string): RepeatConfig | null {
  const fields = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
  const freqMap: Record<string, RepeatFreq> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" };
  const freq = freqMap[fields.FREQ];
  if (!freq) return null;

  let until: string | null = null;
  if (fields.UNTIL) {
    // UNTIL is "YYYYMMDDTHHMMSSZ" — pull the date part back out to yyyy-mm-dd.
    const m = fields.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const count = fields.COUNT ? parseInt(fields.COUNT, 10) : null;
  return { freq, until, count };
}

function advance(date: Date, freq: RepeatFreq): Date {
  const next = new Date(date);
  if (freq === "daily") next.setDate(next.getDate() + 1);
  else if (freq === "weekly") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

/** Safety valve for a series with no UNTIL/COUNT — bounds any single expansion. */
const MAX_OCCURRENCES = 1000;

/**
 * Occurrence start times for one event, clipped to [rangeStart, rangeEnd].
 * A non-recurring event yields at most its own start_time (if in range).
 */
export function expandOccurrences(
  startTimeISO: string,
  recurrenceRule: string | null,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const start = new Date(startTimeISO);
  if (!recurrenceRule) {
    return start >= rangeStart && start <= rangeEnd ? [start] : [];
  }

  const config = parseRecurrenceRule(recurrenceRule);
  if (!config) return start >= rangeStart && start <= rangeEnd ? [start] : [];

  const until = config.until ? new Date(`${config.until}T23:59:59Z`) : null;
  const occurrences: Date[] = [];
  let current = start;
  let n = 0;

  while (current <= rangeEnd && n < MAX_OCCURRENCES) {
    if (until && current > until) break;
    if (config.count && n >= config.count) break;
    if (current >= rangeStart) occurrences.push(current);
    n++;
    current = advance(current, config.freq);
  }
  return occurrences;
}
