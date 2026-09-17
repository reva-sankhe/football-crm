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
}

function toDateArray(iso: string): [number, number, number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

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
    .select("id, title, event_type, start_time, end_time, location, description")
    .order("start_time");

  if (error) {
    res.status(502).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as EventRow[];

  const events: EventAttributes[] = rows.map((row) => ({
    uid: `${row.id}@bombay-gymkhana-crm`,
    title: `[${row.event_type}] ${row.title}`,
    start: toDateArray(row.start_time),
    startInputType: "utc",
    ...(row.end_time
      ? { end: toDateArray(row.end_time), endInputType: "utc" as const }
      : { duration: { hours: 1 } }),
    location: row.location ?? undefined,
    description: row.description ?? undefined,
  }));

  const { error: icsError, value } = createEvents(events);
  if (icsError || !value) {
    res.status(500).json({ error: icsError?.message ?? "Failed to generate calendar feed" });
    return;
  }

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(value);
});

export default router;
