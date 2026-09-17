/**
 * Recurring-event support for the calendar. A recurring event is one `events`
 * row (start_time + recurrence_rule) representing the whole series — same
 * model Google Calendar itself uses — expanded into individual occurrences
 * only for display. Editing or deleting a series always acts on the row, so
 * there's no per-occurrence override; keep it that way unless someone
 * actually needs to split off a single occurrence, which is a much bigger
 * feature (RFC 5545 EXDATE/RECURRENCE-ID).
 *
 * The picker is deliberately just "which day(s) of the week" (matching the
 * common real-world shape — training every Tue/Thu, a match every Saturday —
 * and how most calendar apps present it), so the rule is always weekly on a
 * chosen set of days: FREQ=WEEKLY;BYDAY=<SU,MO,...>.
 */

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

/** Sunday-first, matching Date.getDay() and the month grid's own week order. */
export const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const WEEKDAY_LETTER: Record<Weekday, string> = {
  SU: "S", MO: "M", TU: "T", WE: "W", TH: "T", FR: "F", SA: "S",
};

export const WEEKDAY_FULL: Record<Weekday, string> = {
  SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday",
};

export interface RepeatConfig {
  /** At least one day; the days of the week this repeats on. */
  days: Weekday[];
  /** ISO date (yyyy-mm-dd), inclusive last day the series can occur on. */
  until: string | null;
  /** Total number of occurrences (across all selected days), including the first. */
  count: number | null;
}

/** Builds the bare RRULE value `ics` and Google Calendar both expect. */
export function buildRecurrenceRule(config: RepeatConfig): string {
  const parts = [`FREQ=WEEKLY`, `BYDAY=${config.days.join(",")}`];
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
  if (fields.FREQ !== "WEEKLY" || !fields.BYDAY) return null;

  const days = fields.BYDAY.split(",").filter((d): d is Weekday => (WEEKDAYS as string[]).includes(d));
  if (days.length === 0) return null;

  let until: string | null = null;
  if (fields.UNTIL) {
    // UNTIL is "YYYYMMDDTHHMMSSZ" — pull the date part back out to yyyy-mm-dd.
    const m = fields.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const count = fields.COUNT ? parseInt(fields.COUNT, 10) : null;
  return { days, until, count };
}

/** Safety valves for an open-ended or far-future series — bound any single expansion. */
const MAX_OCCURRENCES = 1000;
const MAX_DAYS_STEPPED = 20000;

/**
 * Occurrence start times for one event, clipped to [rangeStart, rangeEnd].
 * A non-recurring event yields at most its own start_time (if in range).
 *
 * Steps one calendar day at a time from the series' original start — not
 * from rangeStart — because `count` counts occurrences from the beginning of
 * the whole series, not just the ones inside the visible window.
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
  const daySet = new Set(config.days);
  const occurrences: Date[] = [];
  const current = new Date(start);
  let matched = 0;
  let steps = 0;

  while (current <= rangeEnd && matched < MAX_OCCURRENCES && steps < MAX_DAYS_STEPPED) {
    if (until && current > until) break;
    if (daySet.has(WEEKDAYS[current.getDay()])) {
      if (config.count && matched >= config.count) break;
      if (current >= rangeStart) occurrences.push(new Date(current));
      matched++;
    }
    current.setDate(current.getDate() + 1);
    steps++;
  }
  return occurrences;
}
