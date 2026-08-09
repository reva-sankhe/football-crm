import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { createTrainingSession } from "@/lib/queries";
import { SESSION_TYPE_CFG, SESSION_TYPES, dayFromISO, formatDateShort, todayISO } from "@/lib/attendance";
import type { SessionType, TrainingSession } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface SessionStripProps {
  sessions: TrainingSession[];           // newest first
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** playerId-count of attended players per session, keyed by session id. */
  marked: Record<string, { total: number; present: number }>;
  rosterSize: number;
  onSessionCreated: (session: TrainingSession) => void;
  /** Guard hook — return false to block switching away from an unsaved session. */
  canLeaveSession?: () => boolean;
}

export function SessionStrip({
  sessions,
  activeSessionId,
  onSelect,
  marked,
  rosterSize,
  onSessionCreated,
  canLeaveSession,
}: SessionStripProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const existingDates = useMemo(() => new Set(sessions.map((s) => s.date)), [sessions]);

  // Keep the selected chip in view whenever it changes
  useEffect(() => {
    if (!activeSessionId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-session-id="${activeSessionId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeSessionId]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const handleSelect = (id: string) => {
    if (id === activeSessionId) return;
    if (canLeaveSession && !canLeaveSession()) return;
    onSelect(id);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => scrollBy(-320)}
        aria-label="Scroll sessions left"
        className={cn(
          "hidden sm:flex w-8 h-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          isDark ? "text-slate-400 hover:bg-white/8" : "text-slate-500 hover:bg-slate-100",
        )}
      >
        <ChevronLeft size={15} />
      </button>

      <div
        ref={scrollRef}
        className="flex-1 min-w-0 flex gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:thin]"
      >
        {sessions.map((s) => {
          const cfg = SESSION_TYPE_CFG[s.session_type] ?? SESSION_TYPE_CFG.Training;
          const isActive = s.id === activeSessionId;
          const summary = marked[s.id];
          const taken = summary != null && summary.total > 0;

          return (
            <button
              key={s.id}
              data-session-id={s.id}
              onClick={() => handleSelect(s.id)}
              className={cn(
                "shrink-0 w-[104px] px-2.5 py-2 rounded-xl border text-left transition-all duration-100",
                isActive
                  ? "border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/30"
                  : isDark
                    ? "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <div className={cn("text-sm font-semibold leading-tight", isActive ? "text-indigo-400" : "text-foreground")}>
                {formatDateShort(s.date)}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
                <span className="text-[10px] text-muted-foreground truncate">{s.session_type}</span>
              </div>
              <div
                className={cn(
                  "mt-1.5 text-[10px] font-medium font-time",
                  taken ? "text-status-good" : "text-muted-foreground/50",
                )}
              >
                {taken ? `${summary.present}/${rosterSize}` : "not taken"}
              </div>
            </button>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-sm text-muted-foreground py-3">No sessions yet — create one →</div>
        )}
      </div>

      <button
        onClick={() => scrollBy(320)}
        aria-label="Scroll sessions right"
        className={cn(
          "hidden sm:flex w-8 h-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          isDark ? "text-slate-400 hover:bg-white/8" : "text-slate-500 hover:bg-slate-100",
        )}
      >
        <ChevronRight size={15} />
      </button>

      <Popover open={newOpen} onOpenChange={setNewOpen}>
        <PopoverTrigger asChild>
          <button
            className="shrink-0 flex items-center gap-1.5 px-3 h-[74px] sm:h-auto sm:py-2.5 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            data-testid="button-new-session-inline"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <NewSessionForm
            onCancel={() => setNewOpen(false)}
            onCreated={(session) => {
              setNewOpen(false);
              onSessionCreated(session);
            }}
            existingDates={existingDates}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Inline new-session form ───────────────────────────────────────────────────
function NewSessionForm({
  onCreated,
  onCancel,
  existingDates,
}: {
  onCreated: (session: TrainingSession) => void;
  onCancel: () => void;
  existingDates: Set<string>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(),
    session_type: "Training" as SessionType,
    duration_mins: 90,
    planned_rpe: 7,
  });

  // Lectures are attendance only, so they neither plan nor accumulate load
  const carriesLoad = form.session_type !== "Lecture";
  const plannedLoad = Math.round(form.planned_rpe * form.duration_mins);
  const duplicate = existingDates.has(form.date);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date) {
      toast({ title: "Date is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const session = await createTrainingSession({
        date: form.date,
        session_type: form.session_type,
        duration_mins: form.duration_mins,
        planned_rpe: carriesLoad ? form.planned_rpe : 0,
        notes: null,
      });
      onCreated(session);
    } catch (err) {
      toast({ title: "Failed to create session", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">New session</p>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">Date</label>
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          required
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {duplicate ? (
            <span className="text-status-warn">A session already exists on this date</span>
          ) : (
            dayFromISO(form.date)
          )}
        </p>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">Type</label>
        <div className="grid grid-cols-4 gap-1">
          {SESSION_TYPES.map((t) => {
            const cfg = SESSION_TYPE_CFG[t];
            const active = form.session_type === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, session_type: t })}
                className={cn(
                  "px-1 py-1.5 rounded-lg text-[10px] font-medium border transition-colors",
                  active ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Duration (min)</label>
          <input
            type="number"
            min={1}
            max={300}
            value={form.duration_mins}
            onChange={(e) => setForm({ ...form, duration_mins: parseInt(e.target.value) || 0 })}
            className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>
        {carriesLoad && (
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Planned RPE <span className="font-time text-foreground">{form.planned_rpe.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={form.planned_rpe}
              onChange={(e) => setForm({ ...form, planned_rpe: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 mt-2"
            />
          </div>
        )}
      </div>

      {carriesLoad && (
        <div className="flex items-center justify-between rounded-lg bg-status-warn border border-status-warn px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
            <Zap size={11} /> Planned Load
          </span>
          <span className="text-sm font-bold text-status-warn font-time">{plannedLoad} AU</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || form.duration_mins <= 0}
          className="flex-1 py-2 text-xs bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 disabled:opacity-60 transition-colors"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
