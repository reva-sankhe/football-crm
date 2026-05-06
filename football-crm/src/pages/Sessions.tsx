import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Plus, CalendarDays, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { fetchTrainingSessions, createTrainingSession } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import type { TrainingSession, SessionType } from "@/lib/types";

// ── Session type config ────────────────────────────────────────────────────────
const SESSION_TYPE_CFG: Record<SessionType, { text: string; bg: string }> = {
  Training: { text: "text-indigo-400", bg: "bg-indigo-500/15" },
  Match:    { text: "text-amber-400",  bg: "bg-amber-500/15"  },
  Gym:      { text: "text-emerald-400",bg: "bg-emerald-500/15"},
  Recovery: { text: "text-slate-400",  bg: "bg-slate-500/15"  },
};

function SessionTypeBadge({ type }: { type: SessionType }) {
  const cfg = SESSION_TYPE_CFG[type] ?? SESSION_TYPE_CFG.Training;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.bg, cfg.text)}>
      {type}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── New Session Modal ─────────────────────────────────────────────────────────
interface NewSessionModalProps {
  onClose: () => void;
  onSaved: (id: string) => void;
}

const SESSION_TYPES: SessionType[] = ["Training", "Match", "Gym", "Recovery"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayFromISO(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
}

function NewSessionModal({ onClose, onSaved }: NewSessionModalProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(),
    session_type: "Training" as SessionType,
    duration_mins: 90,
    planned_rpe: 7,
    notes: "",
  });

  const plannedLoad = Math.round(form.planned_rpe * form.duration_mins);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date) {
      toast({ title: "Date is required", variant: "destructive" });
      return;
    }
    if (form.duration_mins <= 0) {
      toast({ title: "Duration must be greater than 0", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const session = await createTrainingSession({
        date: form.date,
        session_type: form.session_type,
        duration_mins: form.duration_mins,
        planned_rpe: form.planned_rpe,
        notes: form.notes || null,
      });
      onSaved(session.id);
    } catch (err: unknown) {
      toast({ title: "Failed to create session", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Session</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Date + Day */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Day</label>
              <input
                readOnly
                value={dayFromISO(form.date)}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-default"
              />
            </div>
          </div>

          {/* Session Type */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Session Type</label>
            <select
              value={form.session_type}
              onChange={(e) => setForm({ ...form, session_type: e.target.value as SessionType })}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SESSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Duration (mins)</label>
            <input
              type="number"
              min={1}
              max={300}
              value={form.duration_mins}
              onChange={(e) => setForm({ ...form, duration_mins: parseInt(e.target.value) || 0 })}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          {/* Planned RPE slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">Planned RPE</label>
              <span className="text-sm font-bold text-foreground font-time">{form.planned_rpe.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={form.planned_rpe}
              onChange={(e) => setForm({ ...form, planned_rpe: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>1</span><span>10</span>
            </div>
          </div>

          {/* Planned Load AU */}
          <div className="rounded-xl bg-amber-400/10 border border-amber-400/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-amber-400" />
              <span className="text-xs text-amber-400/80 font-medium">Planned Load (AU)</span>
            </div>
            <span className="text-2xl font-bold text-amber-400 font-time">{plannedLoad}</span>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Notes <span className="text-muted-foreground/50">(optional)</span></label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any notes about this session…"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : "Create & Log RPE →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sessions Page ─────────────────────────────────────────────────────────────
export default function Sessions() {
  const [, setLocation] = useLocation();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loggedCounts, setLoggedCounts] = useState<Record<string, number>>({});
  const [avgLoads, setAvgLoads] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sess = await fetchTrainingSessions();
      setSessions(sess);

      if (sess.length > 0) {
        const counts: Record<string, number> = {};
        const avgs: Record<string, number | null> = {};
        await Promise.all(
          sess.map(async (s) => {
            const { data } = await supabase
              .from("session_rpe")
              .select("player_id, load_au")
              .eq("session_id", s.id);
            counts[s.id] = data ? data.length : 0;
            if (data && data.length > 0) {
              const total = data.reduce((sum: number, r: { load_au: number }) => sum + (r.load_au ?? 0), 0);
              avgs[s.id] = Math.round(total / data.length);
            } else {
              avgs[s.id] = null;
            }
          })
        );
        setLoggedCounts(counts);
        setAvgLoads(avgs);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Training load tracking</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold"
          data-testid="button-new-session"
        >
          <Plus size={15} />
          New Session
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <CalendarDays size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">No sessions yet</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
            Create your first session →
          </button>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="lg:hidden space-y-3">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setLocation(`/sessions/${s.id}`)}
                className="w-full text-left bg-card border border-border rounded-xl p-4 hover:border-indigo-500/40 transition-colors active:bg-muted/50"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{s.day}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(s.date)}</div>
                  </div>
                  <SessionTypeBadge type={s.session_type} />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock size={11} />{s.duration_mins} min</span>
                  <span className="flex items-center gap-1 text-amber-400 font-bold font-time">
                    <Zap size={11} />{Math.round(s.planned_load_au)} AU planned
                  </span>
                  {avgLoads[s.id] != null && (
                    <span className="text-emerald-400 font-time">{avgLoads[s.id]} AU avg</span>
                  )}
                  <span className="ml-auto text-muted-foreground/60">{loggedCounts[s.id] ?? 0} logged</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden lg:block bg-card border border-border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Day</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Duration</th>
                  <th className="px-4 py-3 text-right font-medium">Planned Load (AU)</th>
                  <th className="px-4 py-3 text-right font-medium">Avg Actual (AU)</th>
                  <th className="px-4 py-3 text-right font-medium">Logged</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setLocation(`/sessions/${s.id}`)}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    data-testid={`row-session-${s.id}`}
                  >
                    <td className="px-4 py-3 text-foreground font-medium">{s.day}</td>
                    <td className="px-4 py-3 text-muted-foreground font-time text-xs">{formatDate(s.date)}</td>
                    <td className="px-4 py-3"><SessionTypeBadge type={s.session_type} /></td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-time">{s.duration_mins} min</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-400 font-time">{Math.round(s.planned_load_au)}</td>
                    <td className="px-4 py-3 text-right font-time text-emerald-400">
                      {avgLoads[s.id] != null ? avgLoads[s.id] : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-time">{loggedCounts[s.id] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* New session modal */}
      {showNew && (
        <NewSessionModal
          onClose={() => setShowNew(false)}
          onSaved={(id) => {
            setShowNew(false);
            setLocation(`/sessions/${id}/rpe`);
          }}
        />
      )}
    </div>
  );
}
