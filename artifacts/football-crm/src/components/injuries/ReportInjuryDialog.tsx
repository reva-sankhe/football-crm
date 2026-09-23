import { useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { cn, getErrorMessage, playerLabel } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDateShort, todayISO } from "@/lib/attendance";
import {
  STAGE_CFG, emptyInjuryDraft, injuryDraftProblems, injuryLabel, injuryRowFromDraft, type InjuryDraft,
} from "@/lib/injuries";
import { createInjury, fetchInjuriesForPlayer, fetchMatchIdForSession } from "@/lib/queries";
import { InjuryFields } from "./InjuryFields";
import type { Injury, InjuryContext, InjuryWithStatus, Player, TrainingSession } from "@/lib/types";

export type ReportInjuryResult =
  | { kind: "created"; injury: Injury }
  /** The player is still out with an injury already on record — nothing new was written. */
  | { kind: "existing"; injury: InjuryWithStatus };

/**
 * The quick "report injury" form. Opened from two places, which fix different
 * things:
 *
 * - **Mark Attendance** passes the `player` and the `session`: the date is the
 *   session's, the injury links to it, and a player already out can be marked
 *   as still out with that injury instead of opening a new one.
 * - **Dashboard** passes `players` and `sessions`: pick who and when, and the
 *   injury links to that day's session if there is exactly one of the kind
 *   picked under Where.
 *
 * The match grid doesn't use this — its injuries save with the match — but it
 * renders the same `InjuryFields`.
 */
export function ReportInjuryDialog({
  player: fixedPlayer,
  players = [],
  session,
  matchesOnDay,
  sessions = [],
  offerStillOut = false,
  onClose,
  onRecorded,
}: {
  player?: Player;
  players?: Player[];
  /** Fixes the date and the link. */
  session?: TrainingSession;
  /** Matches that day, when `session` is a collapsed match day. */
  matchesOnDay?: number;
  /** Candidate sessions to link by date, when no `session` is fixed. */
  sessions?: TrainingSession[];
  /**
   * Offer "still out with …" for each open injury. Only where picking it means
   * something — marking attendance. Elsewhere the fields' setback warning
   * covers an open injury in the same area.
   */
  offerStillOut?: boolean;
  onClose: () => void;
  onRecorded: (result: ReportInjuryResult) => void;
}) {
  const { toast } = useToast();

  const [playerId, setPlayerId] = useState(fixedPlayer?.id ?? "");
  const [date, setDate] = useState(session?.date ?? todayISO());
  const defaultContext: InjuryContext | "" = session ? (session.session_type === "Match" ? "match" : "training") : "";
  const [draft, setDraft] = useState<InjuryDraft>(() => emptyInjuryDraft(defaultContext));
  const [history, setHistory] = useState<InjuryWithStatus[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /** "new", or the id of an open injury the player is still out with. */
  const [choice, setChoice] = useState<string>("new");
  const [choiceTouched, setChoiceTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const player = fixedPlayer ?? players.find((p) => p.id === playerId);

  useEffect(() => {
    if (!playerId) { setHistory([]); setHistoryLoaded(false); return; }
    let cancelled = false;
    setHistoryLoaded(false);
    fetchInjuriesForPlayer(playerId)
      .then((rows) => { if (!cancelled) { setHistory(rows); setHistoryLoaded(true); } })
      .catch((err) => {
        if (cancelled) return;
        toast({ title: "Couldn't load injury history", description: getErrorMessage(err), variant: "destructive" });
        setHistoryLoaded(true);
      });
    return () => { cancelled = true; };
  }, [playerId, toast]);

  const open = useMemo(
    () => (offerStillOut ? history.filter((i) => i.status === "open") : []),
    [history, offerStillOut],
  );

  // A player already out who misses a session is almost always still out with
  // that injury, so it starts selected; "Something new" is the deliberate pick.
  useEffect(() => {
    if (choice !== "new" && !open.some((i) => i.id === choice)) setChoice("new");
    else if (choice === "new" && !choiceTouched && open.length > 0) setChoice(open[0].id);
  }, [open, choice, choiceTouched]);

  /** Which session this links to when none was passed in: the only one of that kind that day. */
  const link = useMemo((): { session: TrainingSession | null; note: string | null } => {
    if (session) return { session, note: null };
    const kind = draft.context === "training" ? "Training" : draft.context === "match" ? "Match" : null;
    if (!kind) return { session: null, note: null };
    const onDay = sessions.filter((s) => s.date === date && s.session_type === kind);
    if (onDay.length === 1) return { session: onDay[0], note: `Linked to the ${kind.toLowerCase()} on ${formatDateShort(date)}` };
    if (onDay.length === 0) return { session: null, note: `No ${kind.toLowerCase()} logged on ${formatDateShort(date)} — saved without a link` };
    return {
      session: null,
      note: `${onDay.length} ${kind === "Match" ? "matches" : "sessions"} that day — saved without a link. To tie it to one fixture, report it from that match's grid.`,
    };
  }, [session, sessions, draft.context, date]);

  const problems = choice === "new" ? injuryDraftProblems(draft, date) : {};
  const formProblems: Record<string, string> = { ...problems };
  if (!player) formProblems.player = "Pick a player";
  if (!date) formProblems.date = "Pick a date";
  if (date > todayISO()) formProblems.date = "An injury can't be in the future";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.keys(formProblems).length > 0 || !player) return;

    if (choice !== "new") {
      const existing = open.find((i) => i.id === choice)!;
      onRecorded({ kind: "existing", injury: existing });
      return;
    }

    setSaving(true);
    try {
      const linked = link.session;
      // A collapsed match day holds several fixtures; which one it happened in
      // isn't known from here, so only a single-match day links a match.
      const matchId = linked?.session_type === "Match" && (matchesOnDay ?? 1) <= 1
        ? await fetchMatchIdForSession(linked.id)
        : null;
      const injury = await createInjury(
        injuryRowFromDraft(draft, {
          player_id: player.id,
          occurred_on: date,
          session_id: linked?.id ?? null,
          match_id: matchId,
        }),
        draft.stage,
      );
      toast({ title: "Injury recorded", description: `${player.name} · ${injuryLabel(injury)}` });
      onRecorded({ kind: "created", injury });
    } catch (err) {
      toast({ title: "Failed to record injury", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-muted border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Report injury or illness</h2>
            {fixedPlayer && (
              <p className="text-xs text-muted-foreground truncate">
                {playerLabel(fixedPlayer)}{session && ` · ${formatDateShort(session.date)}`}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {!fixedPlayer && (
            <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Player</label>
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  className={cn(inputCls, attempted && formProblems.player ? "border-status-bad" : "border-border")}
                  data-testid="select-injury-player"
                >
                  <option value="">Select…</option>
                  {players.map((p) => <option key={p.id} value={p.id}>{playerLabel(p)}</option>)}
                </select>
                {attempted && formProblems.player && <p className="text-[11px] text-status-bad mt-1">{formProblems.player}</p>}
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  max={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                  className={cn(inputCls, attempted && formProblems.date ? "border-status-bad" : "border-border")}
                  data-testid="input-injury-date"
                />
                {attempted && formProblems.date && <p className="text-[11px] text-status-bad mt-1">{formProblems.date}</p>}
              </div>
            </div>
          )}

          {/* A player already out: most of the time that's why they missed this session */}
          {open.length > 0 && (
            <div className="space-y-1.5">
              {open.map((i) => (
                <ChoiceRow key={i.id} selected={choice === i.id} onSelect={() => { setChoice(i.id); setChoiceTouched(true); }}>
                  Still out with <span className="font-medium text-foreground">{injuryLabel(i)}</span>
                  <span className="text-muted-foreground"> · since {formatDateShort(i.occurred_on)}
                    {i.current_stage && ` · ${STAGE_CFG[i.current_stage].label}`}</span>
                </ChoiceRow>
              ))}
              <ChoiceRow selected={choice === "new"} onSelect={() => { setChoice("new"); setChoiceTouched(true); }}>
                Something new
              </ChoiceRow>
            </div>
          )}

          {choice === "new" && (player || !fixedPlayer) && (
            <InjuryFields
              draft={draft}
              onChange={setDraft}
              occurredOn={date}
              problems={attempted ? problems : {}}
              history={history}
            />
          )}

          {choice === "new" && link.note && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Link2 size={11} className="mt-0.5 shrink-0" /> {link.note}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!!playerId && !historyLoaded)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-save-injury"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              {choice === "new" ? (saving ? "Saving…" : "Record") : "Mark injured"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChoiceRow({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center gap-2",
        selected ? "border-indigo-500/40 bg-indigo-500/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40",
      )}
    >
      <span className={cn("w-3 h-3 rounded-full border shrink-0", selected ? "border-indigo-400 bg-indigo-400" : "border-muted-foreground/40")} />
      <span className="min-w-0">{children}</span>
    </button>
  );
}
