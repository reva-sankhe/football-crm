import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createEvent, deleteEvent, fetchEvents, updateEvent } from "@/lib/queries";
import { EVENT_TYPES, type CalendarEvent, type EventType } from "@/lib/types";

const TYPE_LABEL: Record<EventType, string> = {
  training: "Training",
  match: "Match",
  birthday: "Birthday",
  lecture: "Lecture",
  event: "Event",
  tournament: "Tournament",
};

// Same tier-color approach as MAS_TIERS/BRONCO_TIERS in lib/types — a fixed
// palette keyed by category, not computed, so colors stay stable as events change.
const TYPE_DOT: Record<EventType, string> = {
  training: "bg-emerald-500",
  match: "bg-indigo-500",
  birthday: "bg-pink-500",
  lecture: "bg-amber-500",
  event: "bg-sky-500",
  tournament: "bg-violet-500",
};

const TYPE_BADGE: Record<EventType, string> = {
  training: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  match: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  birthday: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30",
  lecture: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  event: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  tournament: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
};

// A solid version for the small chips inside a grid cell — the tinted badge
// background reads too faint at that size.
const TYPE_CHIP: Record<EventType, string> = {
  training: "bg-emerald-500 text-white",
  match: "bg-indigo-500 text-white",
  birthday: "bg-pink-500 text-white",
  lecture: "bg-amber-500 text-white",
  event: "bg-sky-500 text-white",
  tournament: "bg-violet-500 text-white",
};

function TypeBadge({ type }: { type: EventType }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium", TYPE_BADGE[type])}>
      <span className={cn("w-1.5 h-1.5 rounded-full", TYPE_DOT[type])} />
      {TYPE_LABEL[type]}
    </span>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function dateKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ── Add / edit form ──────────────────────────────────────────────────────────
function EventModal({
  event,
  initialDate,
  onClose,
  onSaved,
}: {
  /** null when adding a new event. */
  event: CalendarEvent | null;
  /** Prefills the start date when adding from a specific day cell. */
  initialDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => {
    if (event) {
      return {
        title: event.title,
        event_type: event.event_type,
        start_time: toLocalInput(event.start_time),
        end_time: toLocalInput(event.end_time),
        location: event.location ?? "",
        description: event.description ?? "",
      };
    }
    const base = initialDate ?? new Date();
    const defaultStart = new Date(base);
    defaultStart.setHours(9, 0, 0, 0);
    return {
      title: "",
      event_type: "training" as EventType,
      start_time: toLocalInput(defaultStart.toISOString()),
      end_time: "",
      location: "",
      description: "",
    };
  });

  const inputCls = "w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  const field = (label: string, children: React.ReactNode) => (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!form.start_time) {
      toast({ title: "Start date/time is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        event_type: form.event_type,
        start_time: fromLocalInput(form.start_time)!,
        end_time: fromLocalInput(form.end_time),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      };
      if (event) {
        await updateEvent(event.id, payload);
        toast({ title: "Event updated" });
      } else {
        await createEvent(payload);
        toast({ title: "Event added" });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast({ title: "Failed to save event", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" data-testid="event-modal">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{event ? "Edit event" : "Add event"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {field("Title *", (
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Saturday training"
              data-testid="input-event-title"
              className={inputCls}
            />
          ))}
          {field("Type", (
            <select
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value as EventType })}
              className={inputCls}
              data-testid="select-event-type"
            >
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {field("Starts *", (
              <input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                data-testid="input-event-start"
                className={inputCls}
              />
            ))}
            {field("Ends", (
              <input
                type="datetime-local"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                data-testid="input-event-end"
                className={inputCls}
              />
            ))}
          </div>
          {field("Location", (
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Bombay Gymkhana ground"
              className={inputCls}
            />
          ))}
          {field("Notes", (
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={inputCls}
            />
          ))}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm rounded-xl btn-primary text-white font-semibold disabled:opacity-60"
              data-testid="button-submit-event"
            >
              {saving ? "Saving…" : event ? "Save changes" : "Add event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Day agenda — everything on one day, opened by clicking that day's cell ───
function DayAgendaModal({
  date,
  events,
  isAdmin,
  onClose,
  onAdd,
  onEdit,
  onDelete,
}: {
  date: Date;
  events: CalendarEvent[];
  isAdmin: boolean;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (ev: CalendarEvent) => void;
  onDelete: (ev: CalendarEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" data-testid="day-agenda-modal">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </h2>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={onAdd}
                className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 transition-colors text-xs font-medium"
                data-testid="button-add-event-for-day"
              >
                <Plus size={13} /> Add
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
          </div>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-2">
          {events.length === 0 ? (
            <EmptyState title="No events on this day" />
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="bg-muted/50 border border-border rounded-lg px-4 py-3 flex items-start justify-between gap-3" data-testid={`event-row-${ev.id}`}>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{ev.title}</span>
                    <TypeBadge type={ev.event_type} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {ev.end_time && ` – ${new Date(ev.end_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
                    {ev.location && ` · ${ev.location}`}
                  </p>
                  {ev.description && <p className="text-xs text-muted-foreground">{ev.description}</p>}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onEdit(ev)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                      aria-label="Edit event"
                      data-testid={`button-edit-event-${ev.id}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(ev)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                      aria-label="Delete event"
                      data-testid={`button-delete-event-${ev.id}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subscribe panel ───────────────────────────────────────────────────────────
const FEED_TOKEN = (import.meta.env.VITE_CALENDAR_FEED_TOKEN as string) || "";

function SubscribePanel() {
  const [copied, setCopied] = useState(false);
  if (!FEED_TOKEN) return null;
  const feedUrl = `${window.location.origin}/api/calendar/${FEED_TOKEN}.ics`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS); the URL is still selectable text.
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground shrink-0">
        <CalendarIcon size={13} className="text-muted-foreground" />
        Subscribe in Google Calendar:
      </div>
      <input
        readOnly
        value={feedUrl}
        onFocus={(e) => e.currentTarget.select()}
        data-testid="input-calendar-feed-url"
        className="flex-1 min-w-[200px] bg-muted border border-border rounded-md px-2.5 py-1 text-[11px] text-foreground font-mono"
      />
      <button
        onClick={copy}
        data-testid="button-copy-calendar-feed"
        className="h-6 w-6 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="Copy link"
        aria-label="Copy link"
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// ── Month grid ────────────────────────────────────────────────────────────────
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CHIPS_PER_CELL = 3;

function buildMonthGrid(monthStart: Date): Date[] {
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

export default function Calendar() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [agendaDate, setAgendaDate] = useState<Date | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const { toast } = useToast();

  // Used both for the initial load and to refresh after add/edit/delete. Only
  // the initial call should blank the page with the skeleton — a mutation's
  // refresh must not, or any open modal (day agenda, edit form) would flash
  // away mid-interaction while it refetches.
  const refresh = useCallback(async () => {
    setEvents(await fetchEvents());
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = dateKey(ev.start_time);
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [events]);

  const gridDays = useMemo(() => buildMonthGrid(month), [month]);
  const today = new Date();

  const handleDelete = async (ev: CalendarEvent) => {
    if (!window.confirm(`Delete "${ev.title}"?`)) return;
    try {
      await deleteEvent(ev.id);
      toast({ title: "Event deleted" });
      refresh();
    } catch (err: unknown) {
      toast({ title: "Failed to delete event", description: String(err), variant: "destructive" });
    }
  };

  if (loading) {
    return <TableSkeleton rows={6} cols={1} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Previous month"
            data-testid="button-prev-month"
          >
            <ChevronLeft size={15} />
          </button>
          <h2 className="text-base font-semibold text-foreground w-40 text-center" data-testid="text-current-month">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <button
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Next month"
            data-testid="button-next-month"
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="h-8 px-3 flex items-center rounded-md border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Today
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="h-9 px-3.5 flex items-center gap-1.5 rounded-lg border border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 transition-colors text-sm font-medium"
            data-testid="button-add-event"
          >
            <Plus size={15} /> Add event
          </button>
        )}
      </div>

      <SubscribePanel />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day) => {
            const inMonth = day.getMonth() === month.getMonth();
            const isToday = dateKey(day) === dateKey(today);
            const dayEvents = eventsByDay.get(dateKey(day)) ?? [];
            const overflow = dayEvents.length - CHIPS_PER_CELL;

            return (
              <button
                key={day.toISOString()}
                onClick={() => setAgendaDate(day)}
                className={cn(
                  "min-h-[86px] sm:min-h-[120px] border-b border-r border-border p-1.5 sm:p-2 text-left flex flex-col gap-1 transition-colors hover:bg-muted/50",
                  !inMonth && "bg-muted/20",
                )}
                data-testid={`calendar-day-${dateKey(day)}`}
              >
                <span
                  className={cn(
                    "text-xs w-5 h-5 flex items-center justify-center rounded-full shrink-0",
                    isToday ? "bg-indigo-500 text-white font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {day.getDate()}
                </span>
                <div className="space-y-0.5 min-w-0">
                  {dayEvents.slice(0, CHIPS_PER_CELL).map((ev) => (
                    <div
                      key={ev.id}
                      className={cn("truncate rounded px-1 py-0.5 text-[10px] sm:text-[11px] font-medium leading-tight", TYPE_CHIP[ev.event_type])}
                      title={ev.title}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground font-medium px-1">
                      +{overflow} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {agendaDate && (
        <DayAgendaModal
          date={agendaDate}
          events={eventsByDay.get(dateKey(agendaDate)) ?? []}
          isAdmin={isAdmin}
          onClose={() => setAgendaDate(null)}
          onAdd={() => setShowAdd(true)}
          onEdit={(ev) => setEditEvent(ev)}
          onDelete={handleDelete}
        />
      )}

      {showAdd && (
        <EventModal
          event={null}
          initialDate={agendaDate ?? undefined}
          onClose={() => setShowAdd(false)}
          onSaved={refresh}
        />
      )}
      {editEvent && <EventModal event={editEvent} onClose={() => setEditEvent(null)} onSaved={refresh} />}
    </div>
  );
}
