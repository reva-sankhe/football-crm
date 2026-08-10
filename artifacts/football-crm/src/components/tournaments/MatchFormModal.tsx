import { useEffect, useState } from "react";
import { Link2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  adoptSessionAsMatch, createMatch, deleteMatch, fetchAdoptableSessions, updateMatch,
  updateTrainingSession,
} from "@/lib/queries";
import { MATCH_STAGES } from "@/lib/tournaments";
import { DEFAULT_MATCH_MINS } from "@/lib/lineup";
import { fetchOpponents, findOrCreateOpponent } from "@/lib/opponents";
import { todayISO } from "@/lib/attendance";
import type {
  MatchStage, MatchWithSession, Opponent, SquadWithPlayers, Tournament, TrainingSession,
} from "@/lib/types";

/** Sentinel select value meaning "I'll type a name" — never a real opponent id. */
const NEW_OPPONENT = "__new__";

interface MatchFormModalProps {
  /**
   * null creates a standalone friendly: no squad to pick, no stage to choose,
   * and `tournament_id` saved as null.
   */
  tournament: Tournament | null;
  /** Always empty for a friendly — squads belong to a tournament. */
  squads: SquadWithPlayers[];
  /** Absent creates a match; present edits that one. */
  match?: MatchWithSession;
  onClose: () => void;
  onSaved: () => void;
  /** Called after a delete — the caller navigates away or reloads its list. */
  onDeleted?: () => void;
}

export function MatchFormModal({
  tournament, squads, match, onClose, onSaved, onDeleted,
}: MatchFormModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();
  const friendly = tournament == null;
  const editing = match != null;

  const [saving, setSaving] = useState(false);
  // Adopting an orphan session only makes sense while creating.
  const [mode, setMode] = useState<"new" | "adopt">("new");
  const [adoptable, setAdoptable] = useState<TrainingSession[]>([]);
  const [adoptId, setAdoptId] = useState<string>("");
  const [opponents, setOpponents] = useState<Opponent[]>([]);

  const [form, setForm] = useState({
    date: match?.sessions?.date ?? todayISO(),
    stage: (match?.stage ?? (friendly ? "Friendly" : "Group Stage")) as MatchStage,
    // "" = opponent TBD, NEW_OPPONENT = type a name into newOpponent below
    opponent_id: match?.opponent_id ?? "",
    newOpponent: "",
    squad_id: match?.squad_id ?? squads[0]?.id ?? "",
    duration_mins:
      match?.sessions?.duration_mins ?? tournament?.default_match_mins ?? DEFAULT_MATCH_MINS,
  });

  // Existing Match-type sessions with no match row — lets old fixtures be
  // pulled in with their attendance and RPE intact instead of duplicated.
  useEffect(() => {
    if (!editing) {
      fetchAdoptableSessions()
        .then(setAdoptable)
        .catch(() => {/* the adopt tab just stays empty */});
    }
    fetchOpponents()
      .then(setOpponents)
      .catch(() => {/* the picker falls back to "＋ New opponent" only */});
  }, [editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // A typed-in name is resolved to a real opponent row here, so the same club
      // entered twice with different casing still lands on one head-to-head record.
      let opponentId: string | null = form.opponent_id || null;
      if (form.opponent_id === NEW_OPPONENT) {
        if (!form.newOpponent.trim()) {
          toast({ title: "Enter the new opponent's name", variant: "destructive" });
          setSaving(false);
          return;
        }
        const created = await findOrCreateOpponent(form.newOpponent);
        opponentId = created.id;
      }

      const shared = {
        tournament_id: tournament?.id ?? null,
        squad_id: friendly ? null : form.squad_id || null,
        stage: form.stage,
        opponent_id: opponentId,
      };

      if (editing) {
        // Date and duration live on the backing session; the rest on the match
        await updateTrainingSession(match.session_id, {
          date: form.date,
          duration_mins: form.duration_mins,
        });
        await updateMatch(match.id, {
          squad_id: shared.squad_id,
          stage: shared.stage,
          opponent_id: shared.opponent_id,
        });
        toast({ title: friendly ? "Friendly updated" : "Match updated" });
      } else if (mode === "adopt") {
        if (!adoptId) {
          toast({ title: "Pick a session to adopt", variant: "destructive" });
          setSaving(false);
          return;
        }
        await adoptSessionAsMatch(adoptId, shared);
        toast({ title: friendly ? "Session linked as a friendly" : "Session linked as a match" });
      } else {
        await createMatch({
          ...shared,
          date: form.date,
          duration_mins: form.duration_mins,
          // Matches carry no planned RPE — 0 is the app's "no plan" sentinel
          planned_rpe: 0,
        });
        toast({ title: friendly ? "Friendly created" : "Match created" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Failed to save match", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!match) return;
    const label = match.opponents ? `the match vs ${match.opponents.name}` : "this match";
    const ok = window.confirm(
      `Delete ${label}?\n\nIts player stats go with it, and so does the session behind it — ` +
      `so the attendance and RPE logged against this fixture are removed too.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteMatch(match.id, match.session_id);
      toast({ title: friendly ? "Friendly deleted" : "Match deleted" });
      onDeleted?.();
    } catch (err) {
      toast({ title: "Failed to delete match", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  const noun = friendly ? "Friendly" : "Match";
  // Editing never adopts, so date/duration are always the fields on show
  const showDateFields = editing || mode === "new";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {editing ? `Edit ${noun}` : `New ${noun}`}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        {/* Mode switch — creating only; there is nothing to adopt when editing */}
        {!editing && (
          <div className="px-5 pt-4 flex gap-2">
            {(["new", "adopt"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                  mode === m
                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                    : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                {m === "new" ? "Create new" : `Link existing (${adoptable.length})`}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {showDateFields ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className={inputCls}
                  data-testid="input-match-date"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Duration (min)</label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={form.duration_mins}
                  onChange={(e) => setForm({ ...form, duration_mins: parseInt(e.target.value) || 0 })}
                  className={inputCls}
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Existing match session</label>
              {adoptable.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No unlinked Match sessions found. Every existing match session is already linked to a match.
                </p>
              ) : (
                <>
                  <select value={adoptId} onChange={(e) => setAdoptId(e.target.value)} className={inputCls}>
                    <option value="">Select a session…</option>
                    {adoptable.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} · {s.day} · {s.duration_mins} min
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-start gap-1.5">
                    <Link2 size={11} className="mt-0.5 shrink-0" />
                    Keeps the session's existing attendance and RPE.
                  </p>
                </>
              )}
            </div>
          )}

          {/* A friendly is its own stage — there's no bracket to place it in */}
          {!friendly && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Stage</label>
              <select
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value as MatchStage })}
                className={inputCls}
                data-testid="select-match-stage"
              >
                {MATCH_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Opponent <span className="text-muted-foreground/50">(optional)</span></label>
            <select
              value={form.opponent_id}
              onChange={(e) => setForm({ ...form, opponent_id: e.target.value })}
              className={inputCls}
              data-testid="select-match-opponent"
            >
              <option value="">Opponent TBD</option>
              {opponents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value={NEW_OPPONENT}>＋ New opponent…</option>
            </select>
            {form.opponent_id === NEW_OPPONENT && (
              <input
                value={form.newOpponent}
                onChange={(e) => setForm({ ...form, newOpponent: e.target.value })}
                placeholder="e.g. Bandra United"
                className={cn(inputCls, "mt-2")}
                autoFocus
              />
            )}
          </div>

          {/* Squads belong to a tournament, so a friendly has none to pick from */}
          {!friendly && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Squad</label>
              <select value={form.squad_id} onChange={(e) => setForm({ ...form, squad_id: e.target.value })} className={inputCls}>
                <option value="">No squad</option>
                {squads.map((sq) => (
                  <option key={sq.id} value={sq.id}>
                    {sq.name} ({sq.squad_players.length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {editing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm rounded-xl text-muted-foreground hover:text-status-bad transition-colors disabled:opacity-40"
                data-testid="button-delete-match"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!editing && mode === "adopt" && !adoptId) || (showDateFields && form.duration_mins <= 0)}
              className="px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5"
              data-testid="button-save-match"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              {saving ? "Saving…" : editing ? "Save changes" : mode === "adopt" ? `Link ${noun}` : `Create ${noun}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
