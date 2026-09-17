import { useCallback, useEffect, useState } from "react";
import { Calendar as CalendarIcon, Check, Copy, Pencil, Trash2 } from "lucide-react";
import { Calendar as DayPickerCalendar } from "@/components/ui/calendar";
import { AddButton } from "@/components/AddButton";
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

function EventModal({
  event,
  onClose,
  onSaved,
}: {
  /** null when adding a new event. */
  event: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: event?.title ?? "",
    event_type: event?.event_type ?? ("training" as EventType),
    start_time: toLocalInput(event?.start_time ?? null),
    end_time: toLocalInput(event?.end_time ?? null),
    location: event?.location ?? "",
    description: event?.description ?? "",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" data-testid="event-modal">
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
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarIcon size={15} className="text-muted-foreground" />
        Subscribe in Google Calendar
      </div>
      <p className="text-xs text-muted-foreground">
        Google Calendar → Other calendars → <span className="font-medium">From URL</span> → paste this link.
        New and updated events show up automatically (Google refreshes subscribed calendars on its own schedule, usually within a few hours).
      </p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={feedUrl}
          onFocus={(e) => e.currentTarget.select()}
          data-testid="input-calendar-feed-url"
          className="flex-1 bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground font-mono"
        />
        <button
          onClick={copy}
          data-testid="button-copy-calendar-feed"
          className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Copy link"
          aria-label="Copy link"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function Calendar() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await fetchEvents());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dateKey = (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d;
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  const eventDates = events.map((e) => new Date(e.start_time));
  const selectedEvents = selectedDate
    ? events.filter((e) => dateKey(e.start_time) === dateKey(selectedDate))
    : [];

  const handleDelete = async (ev: CalendarEvent) => {
    if (!window.confirm(`Delete "${ev.title}"?`)) return;
    try {
      await deleteEvent(ev.id);
      toast({ title: "Event deleted" });
      load();
    } catch (err: unknown) {
      toast({ title: "Failed to delete event", description: String(err), variant: "destructive" });
    }
  };

  if (loading) {
    return <TableSkeleton rows={6} cols={1} />;
  }

  return (
    <div className="space-y-5">
      <SubscribePanel />

      <div className="flex flex-col lg:flex-row gap-5">
        <div className="bg-card border border-border rounded-xl p-3 shrink-0">
          <DayPickerCalendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            modifiers={{ hasEvent: eventDates }}
            modifiersClassNames={{ hasEvent: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-indigo-500" }}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              {selectedDate?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h2>
            <AddButton label="Add event" onClick={() => setShowAdd(true)} data-testid="button-add-event" />
          </div>

          {selectedEvents.length === 0 ? (
            <EmptyState title="No events on this day" />
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((ev) => (
                <div key={ev.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-start justify-between gap-3" data-testid={`event-row-${ev.id}`}>
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
                        onClick={() => setEditEvent(ev)}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                        aria-label="Edit event"
                        data-testid={`button-edit-event-${ev.id}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(ev)}
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
              ))}
            </div>
          )}
        </div>
      </div>

      {showAdd && <EventModal event={null} onClose={() => setShowAdd(false)} onSaved={load} />}
      {editEvent && <EventModal event={editEvent} onClose={() => setEditEvent(null)} onSaved={load} />}
    </div>
  );
}
