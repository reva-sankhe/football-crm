import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarRange, MapPin, Plus, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  createTournament,
  fetchMatchCountsByTournament,
  fetchTournaments,
} from "@/lib/queries";
import { formatDateRange } from "@/lib/tournaments";
import { todayISO } from "@/lib/attendance";
import type { Tournament } from "@/lib/types";

export function TournamentsTab() {
  const { toast } = useToast();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, counts] = await Promise.all([fetchTournaments(), fetchMatchCountsByTournament()]);
      setTournaments(list);
      setMatchCounts(counts);
    } catch (err) {
      toast({ title: "Failed to load tournaments", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Competitions, squads and match results
        </p>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold shrink-0"
          data-testid="button-new-tournament"
        >
          <Plus size={15} />
          New Tournament
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl h-32 animate-pulse" />
          ))}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Trophy size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">No tournaments yet</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
            Create your first tournament →
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => {
            const range = formatDateRange(t.start_date, t.end_date);
            const count = matchCounts[t.id] ?? 0;
            return (
              <Link
                key={t.id}
                href={`/tournaments/${t.id}`}
                className="block bg-card border border-border rounded-2xl p-4 hover:border-indigo-500/40 transition-colors"
                data-testid={`card-tournament-${t.id}`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                    <Trophy size={16} className="text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground truncate">{t.name}</div>
                    {range && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <CalendarRange size={10} /> {range}
                      </div>
                    )}
                    {t.location && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                        <MapPin size={10} className="shrink-0" /> {t.location}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
                  <span className="font-time">{count} match{count !== 1 ? "es" : ""}</span>
                  <span className="font-time">{t.default_match_mins} min default</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewTournamentModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}

// ── New tournament modal ──────────────────────────────────────────────────────
function NewTournamentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    start_date: todayISO(),
    end_date: "",
    location: "",
    default_match_mins: 90,
    default_planned_rpe: 8,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createTournament({
        name: form.name.trim(),
        team: "Sharks",
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        location: form.location.trim() || null,
        default_match_mins: form.default_match_mins,
        default_planned_rpe: form.default_planned_rpe,
        notes: null,
      });
      toast({ title: "Tournament created" });
      onSaved();
    } catch (err) {
      toast({ title: "Failed to create tournament", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Tournament</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mumbai Women's Cup 2026"
              className={inputCls}
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Start date</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">End date <span className="text-muted-foreground/50">(optional)</span></label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Location <span className="text-muted-foreground/50">(optional)</span></label>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Cooperage Ground" className={inputCls} />
          </div>

          <div className={cn("rounded-xl border p-3 space-y-3", isDark ? "border-white/[0.06] bg-white/[0.02]" : "border-slate-200 bg-slate-50")}>
            <p className="text-[11px] text-muted-foreground">
              Defaults used when creating a match — you can override them per match.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Match duration (min)</label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={form.default_match_mins}
                  onChange={(e) => setForm({ ...form, default_match_mins: parseInt(e.target.value) || 0 })}
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Planned RPE <span className="font-time text-foreground">{form.default_planned_rpe.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={form.default_planned_rpe}
                  onChange={(e) => setForm({ ...form, default_planned_rpe: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500 mt-3"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || form.default_match_mins <= 0}
              className="flex-1 px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create Tournament"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
