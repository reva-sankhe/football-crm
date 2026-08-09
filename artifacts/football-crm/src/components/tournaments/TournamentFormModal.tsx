import { useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { createTournament, deleteTournament, updateTournament } from "@/lib/queries";
import { todayISO } from "@/lib/attendance";
import type { Tournament } from "@/lib/types";

interface TournamentFormModalProps {
  /** Absent creates a tournament; present edits that one. */
  tournament?: Tournament;
  onClose: () => void;
  onSaved: () => void;
  /** Called after a delete — the detail page navigates away. */
  onDeleted?: () => void;
}

export function TournamentFormModal({
  tournament,
  onClose,
  onSaved,
  onDeleted,
}: TournamentFormModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();
  const editing = tournament != null;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: tournament?.name ?? "",
    start_date: tournament?.start_date ?? todayISO(),
    end_date: tournament?.end_date ?? "",
    location: tournament?.location ?? "",
    default_match_mins: tournament?.default_match_mins ?? 90,
    default_planned_rpe: tournament?.default_planned_rpe ?? 8,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const fields = {
        name: form.name.trim(),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        location: form.location.trim() || null,
        default_match_mins: form.default_match_mins,
        default_planned_rpe: form.default_planned_rpe,
      };
      if (editing) {
        await updateTournament(tournament.id, fields);
        toast({ title: "Tournament updated" });
      } else {
        await createTournament({ ...fields, team: "Sharks", notes: null });
        toast({ title: "Tournament created" });
      }
      onSaved();
    } catch (err) {
      toast({
        title: editing ? "Failed to update tournament" : "Failed to create tournament",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tournament) return;
    const ok = window.confirm(
      `Delete "${tournament.name}"?\n\nIts squads, matches and match stats are removed. ` +
      `The underlying session rows survive, so attendance and RPE for those days are kept.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteTournament(tournament.id);
      toast({ title: "Tournament deleted" });
      onDeleted?.();
    } catch (err) {
      toast({ title: "Failed to delete tournament", description: String(err), variant: "destructive" });
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
          <h2 className="text-base font-semibold text-foreground">
            {editing ? "Edit Tournament" : "New Tournament"}
          </h2>
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
              data-testid="input-tournament-name"
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
              data-testid="button-save-tournament"
            >
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Tournament"}
            </button>
          </div>

          {editing && (
            <div className="pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-status-bad transition-colors disabled:opacity-60"
                data-testid="button-delete-tournament"
              >
                <Trash2 size={12} /> Delete this tournament
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
