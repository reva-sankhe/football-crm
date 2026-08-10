import { Check, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { kicksScored } from "@/lib/lineup";
import type { MatchPenaltyKickInput, Player } from "@/lib/types";

/**
 * Penalty shootout for a knockout that finished level.
 *
 * Shootout kicks are never goals: the scoreline and head-to-head record still
 * show the match as a draw, and this panel only ever writes the shootout fields.
 */
export function ShootoutPanel({
  wentToPenalties, pensFor, pensAgainst, kicks, roster,
  onToggle, onScoreChange, onKicksChange,
}: {
  wentToPenalties: boolean;
  pensFor: string;
  pensAgainst: string;
  kicks: MatchPenaltyKickInput[];
  roster: Player[];
  onToggle: (on: boolean) => void;
  onScoreChange: (side: "for" | "against", value: string) => void;
  onKicksChange: (next: MatchPenaltyKickInput[]) => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const update = (i: number, changes: Partial<MatchPenaltyKickInput>) =>
    onKicksChange(kicks.map((k, idx) => (idx === i ? { ...k, ...changes } : k)));

  // kick_order is assigned from position on save, so it isn't edited here.
  const add = () =>
    onKicksChange([...kicks, { kick_order: kicks.length + 1, player_id: "", scored: true }]);

  const remove = (i: number) => onKicksChange(kicks.filter((_, idx) => idx !== i));

  const scoredCount = kicksScored(kicks);
  const entered = pensFor === "" ? null : parseInt(pensFor);
  // Only a hint: kicks may be logged for our takers only, or not at all.
  const mismatch = entered != null && kicks.length > 0 && scoredCount !== entered;

  const numCls =
    "w-14 bg-muted border border-border rounded-lg px-1.5 py-1.5 text-sm text-center font-time text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={wentToPenalties}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-indigo-600 w-3.5 h-3.5"
        />
        <span className="text-xs text-muted-foreground">Went to penalties</span>
      </label>

      {wentToPenalties && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Pens for</span>
              <input
                type="number" min={0} value={pensFor}
                onChange={(e) => onScoreChange("for", e.target.value)}
                className={numCls} placeholder="–"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">against</span>
              <input
                type="number" min={0} value={pensAgainst}
                onChange={(e) => onScoreChange("against", e.target.value)}
                className={numCls} placeholder="–"
              />
            </label>
          </div>

          {mismatch && (
            <p className="text-[11px] text-status-warn">
              {scoredCount} of the kicks below scored, but the shootout score says {entered}.
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Takers, in order
              </span>
              <button
                type="button"
                onClick={add}
                className={cn(
                  "ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                  isDark ? "border-white/10 text-slate-300 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                <Plus size={11} /> Add kick
              </button>
            </div>

            {kicks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-2">
                No takers logged yet.
              </p>
            ) : (
              kicks.map((k, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-[11px] font-time text-muted-foreground text-right">{i + 1}</span>

                  <select
                    value={k.player_id}
                    aria-label={`Taker ${i + 1}`}
                    onChange={(e) => update(i, { player_id: e.target.value })}
                    className="flex-1 min-w-0 bg-muted border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">— pick a player —</option>
                    {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>

                  <button
                    type="button"
                    onClick={() => update(i, { scored: !k.scored })}
                    aria-label={k.scored ? "Scored" : "Missed"}
                    className={cn(
                      "w-7 h-7 rounded-lg border flex items-center justify-center transition-colors shrink-0",
                      k.scored
                        ? "bg-[#0ca30c]/15 border-[#0ca30c]/40 text-status-good"
                        : "bg-[#d03b3b]/15 border-[#d03b3b]/40 text-status-critical",
                    )}
                  >
                    {k.scored ? <Check size={13} /> : <X size={13} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove kick"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-status-critical transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
