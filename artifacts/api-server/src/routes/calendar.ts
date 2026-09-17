import { Router, type IRouter } from "express";
import { createClient } from "@supabase/supabase-js";
import { createEvents, type EventAttributes } from "ics";

const router: IRouter = Router();

interface EventRow {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string | null;
  location: string | null;
  description: string | null;
  recurrence_rule: string | null;
  excluded_dates: string[];
}

function toDateArray(iso: string): [number, number, number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

const IST_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar date (in the team's own timezone, not the server's) a stored
 * instant falls on — needed for an all-day event, which has no time
 * component at all. Naively reading UTC date parts would be off by a day
 * whenever IST midnight falls on the previous UTC day (it always does,
 * being UTC+5:30), so this goes through Asia/Kolkata explicitly.
 */
function toIstDateArray(iso: string): [number, number, number] {
  const [y, m, d] = IST_DATE_FORMAT.format(new Date(iso)).split("-").map(Number);
  return [y, m, d];
}

// Google Calendar ignores per-event color hints (CATEGORIES, etc.) on a
// calendar you've subscribed to by URL — the whole subscribed calendar only
// ever gets the one color you pick for it in Google's own UI. An emoji
// prefix is the practical substitute: it's visible right in the title even
// in month view, where Google would otherwise truncate a text tag.
const TYPE_EMOJI: Record<string, string> = {
  training: "🏃",
  match: "⚽",
  birthday: "🎂",
  lecture: "📘",
  event: "📌",
  tournament: "🏆",
};

// A birthday is a reminder, not time you're unavailable for — everything
// else blocks the calendar the way a real commitment should.
const FREE_TYPES = new Set(["birthday"]);

router.get("/calendar/:token.ics", async (req, res) => {
  const { token } = req.params;
  const expected = process.env.CALENDAR_FEED_TOKEN;

  if (!expected || token !== expected) {
    res.status(404).end();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Calendar feed is not configured" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("events")
    .select("id, title, event_type, start_time, end_time, location, description, recurrence_rule, excluded_dates")
    .order("start_time");

  if (error) {
    res.status(502).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as EventRow[];

  const events: EventAttributes[] = rows.map((row) => {
    const isBirthday = row.event_type === "birthday";
    return {
      uid: `${row.id}@bombay-gymkhana-crm`,
      title: `${TYPE_EMOJI[row.event_type] ?? ""} ${row.title}`.trim(),
      // Birthdays are all-day: a bare [y, m, d] start is how `ics` produces
      // a VALUE=DATE event instead of a timed one.
      ...(isBirthday
        ? { start: toIstDateArray(row.start_time), duration: { days: 1 } }
        : {
            start: toDateArray(row.start_time),
            startInputType: "utc" as const,
            ...(row.end_time
              ? { end: toDateArray(row.end_time), endInputType: "utc" as const }
              : { duration: { hours: 1 } }),
          }),
      location: row.location ?? undefined,
      description: row.description ?? undefined,
      recurrenceRule: row.recurrence_rule ?? undefined,
      // Each entry is the excluded occurrence's exact start_time, converted
      // through the same date form as `start` above so it matches exactly
      // (RFC 5545 requires an EXDATE to be the same value type as DTSTART).
      exclusionDates: row.excluded_dates.length
        ? row.excluded_dates.map((iso) => (isBirthday ? toIstDateArray(iso) : toDateArray(iso)))
        : undefined,
      categories: [row.event_type],
      // Google Calendar reads the standard TRANSP property for free/busy
      // display; busyStatus only adds the Outlook-specific extension property
      // alongside it, so both are set for cross-client compatibility.
      busyStatus: FREE_TYPES.has(row.event_type) ? "FREE" : "BUSY",
      transp: FREE_TYPES.has(row.event_type) ? "TRANSPARENT" : "OPAQUE",
    };
  });

  const { error: icsError, value } = createEvents(events, { calName: "BG Sharks" });
  if (icsError || !value) {
    res.status(500).json({ error: icsError?.message ?? "Failed to generate calendar feed" });
    return;
  }

  // `ics` has no first-class option for this — every event time is an
  // absolute UTC instant (see startInputType/endInputType above) so display
  // is already correct in any viewer's own timezone, but X-WR-TIMEZONE is
  // still the calendar-level hint some clients fall back to.
  const withTimezone = value.replace("CALSCALE:GREGORIAN\r\n", "CALSCALE:GREGORIAN\r\nX-WR-TIMEZONE:Asia/Kolkata\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(withTimezone);
});

export default router;
