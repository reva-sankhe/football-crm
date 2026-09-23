import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { cn, getErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatDateShort, todayISO } from "@/lib/attendance";
import {
  CONTEXTS, MECHANISMS, ONSETS, STAGE_CFG, STAGE_ORDER, describeSeverity, draftFromInjury, injuryEditProblems,
  injuryLabel, injuryRowFromDraft, stageInsertProblem, undoProblem, type ClosingPrompt, type InjuryDraft,
} from "@/lib/injuries";
import { InjuryFields } from "./InjuryFields";
import {
  addInjuryStage, countRecurrencesOf, deleteInjury, fetchInjuriesByIds, fetchInjuriesForPlayer, fetchInjuryStages,
  undoLastInjuryStage, updateInjury,
} from "@/lib/queries";
import type { InjuryStage, InjuryStageName, InjuryWithStatus, Player } from "@/lib/types";

/**
 * One injury, and everything a coach does with it after entry: correct any of
 * its details, move it to the next stage, answer "still out", set when they're
 * expected back, undo the latest stage, or delete it. Opened from a closing prompt (which pre-fills
 * the stage and date it suggests), the player page, and Mark Attendance.
 *
 * Stages are append-only. The only correction is undoing the latest one —
 * that is also how a match fit entered by mistake is reopened.
 */
export function InjuryDialog({
  injury: initial,
  player,
  prompt,
  onClose,
  onChanged,
}: {
  injury: InjuryWithStatus;
  player?: Player;
  /** The prompt this was opened from, if any: its suggestion pre-fills the form. */
  prompt?: Pick<ClosingPrompt, "suggestStage" | "suggestDate" | "message">;
  onClose: () => void;
  /** After any write, so the caller can refetch. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [injury, setInjury] = useState(initial);
  const [stages, setStages] = useState<InjuryStage[]>([]);
  const [recurrences, setRecurrences] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { isAdmin } = useAuth();

  // ── Editing the details ──
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<InjuryDraft>(() => draftFromInjury(initial));
  const [occurredDraft, setOccurredDraft] = useState(initial.occurred_on);
  /** The player's other injuries — for the recurrence picker and setback warning, never this one. */
  const [others, setOthers] = useState<InjuryWithStatus[]>([]);
  const startEditing = () => {
    setDraft(draftFromInjury(injury));
    setOccurredDraft(injury.occurred_on);
    setEditing(true);
    fetchInjuriesForPlayer(injury.player_id)
      .then((rows) => setOthers(rows.filter((r) => r.id !== injury.id)))
      .catch(() => setOthers([]));
  };
  const editProblems = injuryEditProblems(draft, occurredDraft, stages, todayISO());
  const saveDetails = () => run(
    `${injuryLabel({ ...injury, ...draft, body_area: draft.body_area || null, side: draft.side || null })}: details saved`,
    async () => {
      // A new date no longer matches the session or match it was linked to
      const moved = occurredDraft !== injury.occurred_on;
      const { player_id: _, ...updates } = injuryRowFromDraft(draft, {
        player_id: injury.player_id,
        occurred_on: occurredDraft,
        session_id: moved ? null : injury.session_id,
        match_id: moved ? null : injury.match_id,
      });
      await updateInjury(injury.id, updates);
      setEditing(false);
    },
  );

  const [nextStage, setNextStage] = useState<InjuryStageName | "">(prompt?.suggestStage ?? "");
  const [nextDate, setNextDate] = useState(prompt?.suggestDate ?? todayISO());
  const [expected, setExpected] = useState(initial.expected_return_on ?? "");

  const reload = useCallback(async () => {
    const [st, rec, fresh] = await Promise.all([
      fetchInjuryStages(injury.id), countRecurrencesOf(injury.id), fetchInjuriesByIds([injury.id]),
    ]);
    setStages(st);
    setRecurrences(rec);
    if (fresh[0]) { setInjury(fresh[0]); setExpected(fresh[0].expected_return_on ?? ""); }
    setLoaded(true);
  }, [injury.id]);

  useEffect(() => {
    reload().catch((err) => toast({ title: "Couldn't load injury", description: getErrorMessage(err), variant: "destructive" }));
  }, [reload, toast]);

  const current = stages.length ? stages[stages.length - 1].stage : injury.current_stage;
  const insertProblem = nextStage ? stageInsertProblem(injury.occurred_on, stages, nextDate) : null;
  const undoBlocked = undoProblem(stages, recurrences > 0);

  const run = async (label: string, fn: () => Promise<void>, close = false) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: label });
      onChanged();
      if (close) onClose();
      else await reload();
    } catch (err) {
      // The database refuses what the rules forbid; its message says why
      toast({ title: "Couldn't save", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveStage = () => nextStage && run(
    `${injuryLabel(injury)}: ${STAGE_CFG[nextStage].label} from ${formatDateShort(nextDate)}`,
    async () => {
      await addInjuryStage(injury.id, nextStage, nextDate);
      // A new stage is an answer too — and a stale expected date goes with it
      if (expected !== (injury.expected_return_on ?? "")) {
        await updateInjury(injury.id, { expected_return_on: expected || null });
      }
    },
    true,
  );

  const stillOut = () => run(
    `${injuryLabel(injury)}: still ${STAGE_CFG[current ?? "out"].label.toLowerCase()}`,
    () => updateInjury(injury.id, { reviewed_on: todayISO(), expected_return_on: expected || null }),
    true,
  );

  const summary = [
    injury.context && CONTEXTS.find((c) => c.value === injury.context)?.label,
    injury.mechanism && MECHANISMS.find((m) => m.value === injury.mechanism)?.label.toLowerCase(),
    injury.onset && ONSETS.find((o) => o.value === injury.onset)?.label.toLowerCase(),
  ].filter(Boolean).join(" · ");

  const inputCls = "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  // Portalled: these open from inside cards whose styling would otherwise
  // become the containing block for `fixed` and clip the dialog to the card.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {player ? `${player.name} · ` : ""}{injuryLabel(injury)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {formatDateShort(injury.occurred_on)}{summary && ` · ${summary}`}
            </p>
            {loaded && <p className="text-xs text-muted-foreground">{describeSeverity(injury, stages, todayISO())}</p>}
            {injury.notes && <p className="text-xs text-foreground mt-1">{injury.notes}</p>}
            {isAdmin && !editing && (
              <button
                type="button"
                onClick={startEditing}
                disabled={!loaded}
                className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-edit-injury"
              >
                <Pencil size={11} /> Edit details
              </button>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {prompt && (
            <p className="text-xs rounded-lg border border-status-warn bg-status-warn px-3 py-2 text-foreground">{prompt.message}</p>
          )}

          {/* ── Details — every field but the stages, which are a dated history below ── */}
          {editing && (
            <div className="space-y-4 rounded-xl border border-border p-4" data-testid="form-edit-injury">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Occurred</label>
                <input
                  type="date"
                  value={occurredDraft}
                  max={todayISO()}
                  onChange={(e) => setOccurredDraft(e.target.value)}
                  className={cn(inputCls, editProblems.occurred_on && "border-status-bad")}
                  data-testid="input-edit-occurred"
                />
                {editProblems.occurred_on ? (
                  <p className="text-[11px] text-status-bad mt-1">{editProblems.occurred_on}</p>
                ) : occurredDraft !== injury.occurred_on && (injury.session_id || injury.match_id) ? (
                  <p className="text-[11px] text-muted-foreground mt-1">A new date unlinks it from the {formatDateShort(injury.occurred_on)} session.</p>
                ) : null}
              </div>
              <InjuryFields
                draft={draft}
                onChange={setDraft}
                occurredOn={occurredDraft}
                problems={editProblems}
                history={others}
                editing
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDetails}
                  disabled={busy || Object.keys(editProblems).length > 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-save-injury-details"
                >
                  {busy && <RefreshCw size={13} className="animate-spin" />}
                  Save details
                </button>
              </div>
            </div>
          )}

          {/* ── History ─────────────────────────────────────────────────── */}
          <div>
            <div className="text-xs text-muted-foreground mb-1.5">Stages</div>
            {!loaded ? (
              <div className="h-10 bg-muted/40 rounded-lg animate-pulse" />
            ) : (
              <ol className="space-y-1" data-testid="injury-stage-history">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="font-time text-muted-foreground w-16 shrink-0">{formatDateShort(s.effective_on)}</span>
                    <span className={cn("text-foreground", i === stages.length - 1 && "font-semibold")}>{STAGE_CFG[s.stage].label}</span>
                    {i === stages.length - 1 && stages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => run(`Undid ${STAGE_CFG[s.stage].label}`, () => undoLastInjuryStage(injury.id))}
                        disabled={busy || !!undoBlocked}
                        title={undoBlocked ?? "Entered by mistake? Remove this stage — the one before it applies again"}
                        className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid="button-undo-stage"
                      >
                        <Undo2 size={11} /> Undo
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {loaded && undoBlocked && stages.length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-1">{undoBlocked}</p>
            )}
          </div>

          {/* ── Next stage — nothing to add once match fit ──────────────── */}
          {current !== "match_fit" && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Move to</div>
                <div className="flex gap-1.5 flex-wrap">
                  {STAGE_ORDER.filter((s) => s !== current).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={nextStage === s}
                      onClick={() => setNextStage(s)}
                      title={STAGE_CFG[s].description}
                      className={cn(
                        "flex-1 min-w-[5.5rem] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        nextStage === s
                          ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      )}
                    >
                      {STAGE_CFG[s].label}
                    </button>
                  ))}
                </div>
                {nextStage && STAGE_ORDER.indexOf(nextStage) < STAGE_ORDER.indexOf(current ?? "out") && (
                  <p className="text-[11px] text-muted-foreground mt-1">A setback — recorded on this injury, not as a new one.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">From</label>
                  <input type="date" value={nextDate} min={injury.occurred_on} max={todayISO()} onChange={(e) => setNextDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Expected back <span className="text-muted-foreground/50">(optional)</span></label>
                  <input type="date" value={expected} min={injury.occurred_on} onChange={(e) => setExpected(e.target.value)} className={inputCls} data-testid="input-expected-return" />
                </div>
              </div>
              {nextStage && insertProblem && <p className="text-[11px] text-status-bad">{insertProblem}</p>}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={stillOut}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                  data-testid="button-still-out"
                >
                  No change — still {STAGE_CFG[current ?? "out"].label.toLowerCase()}
                </button>
                <button
                  type="button"
                  onClick={saveStage}
                  disabled={busy || !nextStage || !!insertProblem}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-save-stage"
                >
                  {busy && <RefreshCw size={13} className="animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          )}

          {/* ── Delete — for an injury that shouldn't exist at all ───────── */}
          <div className="pt-3 border-t border-border flex items-center gap-2">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-status-bad transition-colors"
              >
                <Trash2 size={12} /> Delete injury
              </button>
            ) : (
              <>
                <span className="text-xs text-foreground flex-1">
                  Delete this injury and its stages?{recurrences > 0 && " Injuries recorded as its recurrence lose that link."}
                </span>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                <button
                  type="button"
                  onClick={() => run(`Deleted ${injuryLabel(injury)}`, () => deleteInjury(injury.id), true)}
                  disabled={busy}
                  className="text-xs font-semibold text-status-bad"
                  data-testid="button-confirm-delete-injury"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
