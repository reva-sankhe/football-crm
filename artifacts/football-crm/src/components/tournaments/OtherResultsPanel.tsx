import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { SectionLabel } from "@/components/StatTile";
import { AddButton } from "@/components/AddButton";
import {
  createLeagueOtherMatch, deleteLeagueOtherMatch, fetchLeagueOtherMatches, updateLeagueOtherMatch,
} from "@/lib/queries";
import { fetchOpponents, findOrCreateOpponent } from "@/lib/opponents";
import { formatDateShort } from "@/lib/attendance";
import type { LeagueOtherMatchWithOpponents, Opponent } from "@/lib/types";

/** Sentinel select value meaning "I'll type a name" — never a real opponent id. */
const NEW_OPPONENT = "__new__";

interface FormState {
  match_date: string;
  home_opponent_id: string;
  new_home: string;
  away_opponent_id: string;
  new_away: string;
  home_goals: string;
  away_goals: string;
}

const EMPTY_FORM: FormState = {
  match_date: "", home_opponent_id: "", new_home: "", away_opponent_id: "", new_away: "",
  home_goals: "", away_goals: "",
};

/**
 * Results between two other clubs, logged only so the tournament's standings
 * table can show the whole division, not just the fixtures this club played.
 * Modeled on LinksArchive — a self-contained scoped list with an inline
 * add/edit form; `onChanged` lets the standings table above pick up the result.
 */
export function OtherResultsPanel({
  tournamentId,
  onChanged,
}: {
  tournamentId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<LeagueOtherMatchWithOpponents[]>([]);
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      const [rs, ops] = await Promise.all([fetchLeagueOtherMatches(tournamentId), fetchOpponents()]);
      setRows(rs);
      setOpponents(ops);
    } catch (err) {
      toast({ title: "Failed to load other results", description: String(err), variant: "destructive" });
    }
  }, [tournamentId, toast]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setAdding(true);
  };

  const openEdit = (row: LeagueOtherMatchWithOpponents) => {
    setEditingId(row.id);
    setForm({
      match_date: row.match_date ?? "",
      home_opponent_id: row.home_opponent_id,
      new_home: "",
      away_opponent_id: row.away_opponent_id,
      new_away: "",
      home_goals: String(row.home_goals),
      away_goals: String(row.away_goals),
    });
    setAdding(true);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  // A typed-in name resolves to a real opponent row, same as the match form —
  // so the same club entered twice with different casing lands on one row.
  const resolveOpponent = async (id: string, typed: string): Promise<string | null> => {
    if (id === NEW_OPPONENT) {
      if (!typed.trim()) return null;
      const created = await findOrCreateOpponent(typed);
      return created.id;
    }
    return id || null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const homeGoals = parseInt(form.home_goals, 10);
    const awayGoals = parseInt(form.away_goals, 10);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals) || homeGoals < 0 || awayGoals < 0) {
      toast({ title: "Enter both scores", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const homeId = await resolveOpponent(form.home_opponent_id, form.new_home);
      const awayId = await resolveOpponent(form.away_opponent_id, form.new_away);
      if (!homeId || !awayId) {
        toast({ title: "Pick or add both teams", variant: "destructive" });
        setSaving(false);
        return;
      }
      if (homeId === awayId) {
        toast({ title: "Home and away can't be the same team", variant: "destructive" });
        setSaving(false);
        return;
      }
      const fields = {
        match_date: form.match_date || null,
        home_opponent_id: homeId,
        away_opponent_id: awayId,
        home_goals: homeGoals,
        away_goals: awayGoals,
        notes: null,
      };
      if (editingId) {
        await updateLeagueOtherMatch(editingId, fields);
        toast({ title: "Result updated" });
      } else {
        await createLeagueOtherMatch({ tournament_id: tournamentId, ...fields });
        toast({ title: "Result added" });
      }
      cancel();
      load();
      onChanged();
    } catch (err) {
      toast({ title: "Failed to save result", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: LeagueOtherMatchWithOpponents) => {
    if (!window.confirm(`Remove ${row.home.name} ${row.home_goals}–${row.away_goals} ${row.away.name}?`)) return;
    try {
      await deleteLeagueOtherMatch(row.id);
      toast({ title: "Result removed" });
      cancel();
      load();
      onChanged();
    } catch (err) {
      toast({ title: "Failed to remove result", description: String(err), variant: "destructive" });
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  const teamSelect = (
    label: string,
    idValue: string,
    newValue: string,
    setId: (v: string) => void,
    setNew: (v: string) => void,
  ) => (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <select value={idValue} onChange={(e) => setId(e.target.value)} className={inputCls}>
        <option value="">Select…</option>
        {opponents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        <option value={NEW_OPPONENT}>＋ New team…</option>
      </select>
      {idValue === NEW_OPPONENT && (
        <input
          value={newValue}
          onChange={(e) => setNew(e.target.value)}
          placeholder="e.g. Bandra United"
          className={`${inputCls} mt-2`}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionLabel>Other Results</SectionLabel>
        <span className="text-[10px] text-muted-foreground font-time">{rows.length}</span>
        {!adding && <AddButton label="Add result" onClick={openAdd} data-testid="button-add-other-result" />}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Log results between other clubs in this league so the standings above include the whole table.
      </p>

      {adding && (
        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {teamSelect(
              "Home team", form.home_opponent_id, form.new_home,
              (v) => setForm({ ...form, home_opponent_id: v }), (v) => setForm({ ...form, new_home: v }),
            )}
            {teamSelect(
              "Away team", form.away_opponent_id, form.new_away,
              (v) => setForm({ ...form, away_opponent_id: v }), (v) => setForm({ ...form, new_away: v }),
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Home goals</label>
              <input type="number" min={0} value={form.home_goals} onChange={(e) => setForm({ ...form, home_goals: e.target.value })} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Away goals</label>
              <input type="number" min={0} value={form.away_goals} onChange={(e) => setForm({ ...form, away_goals: e.target.value })} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Date <span className="text-muted-foreground/50">(optional)</span></label>
              <input type="date" value={form.match_date} onChange={(e) => setForm({ ...form, match_date: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  const row = rows.find((r) => r.id === editingId);
                  if (row) remove(row);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-status-bad transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
            <button type="button" onClick={cancel} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add result"}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 && !adding ? (
        <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">No other results logged yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">
                  {r.home.name} <span className="font-time font-bold">{r.home_goals}–{r.away_goals}</span> {r.away.name}
                </div>
                {r.match_date && <div className="text-[11px] text-muted-foreground">{formatDateShort(r.match_date)}</div>}
              </div>
              {isAdmin && (
                <button
                  onClick={() => openEdit(r)}
                  aria-label={`Edit ${r.home.name} vs ${r.away.name}`}
                  title="Edit result"
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
