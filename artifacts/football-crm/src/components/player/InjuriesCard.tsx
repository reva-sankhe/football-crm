import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { formatDateShort, todayISO } from "@/lib/attendance";
import {
  STAGE_CFG, buildEvidence, closingPrompts, describeSeverity, injuryLabel,
  type Availability, type ClosingPrompt,
} from "@/lib/injuries";
import { fetchPlayerActivitySince } from "@/lib/queries";
import { InjuryDialog } from "@/components/injuries/InjuryDialog";
import { ReportInjuryDialog } from "@/components/injuries/ReportInjuryDialog";
import { ClosingPrompts } from "@/components/injuries/ClosingPrompts";
import type { InjuryStage, InjuryWithStatus, Player, TrainingSession } from "@/lib/types";

/**
 * Why a player stopped training, on their own page: a box with the key facts
 * while they are not match fit, the question to answer about it if there is
 * one, and the injury history — collapsed until asked for. The page passes its
 * own injury fetch in, since the same data drives its closing prompts.
 */
export function InjuriesCard({
  player,
  injuries,
  stages,
  availability,
  sessions,
  onChanged,
}: {
  player: Player;
  /** This player's injuries, newest first. */
  injuries: InjuryWithStatus[];
  stages: InjuryStage[];
  availability: Availability;
  /** To link a reported injury to that day's session. */
  sessions: TrainingSession[];
  onChanged: () => void;
}) {
  const { isAdmin } = useAuth();
  const [opened, setOpened] = useState<InjuryWithStatus | null>(null);
  const [reporting, setReporting] = useState(false);
  const [prompts, setPrompts] = useState<ClosingPrompt[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const today = todayISO();
  const now = availability.on(player.id, today);
  const byId = useMemo(() => new Map(injuries.map((i) => [i.id, i])), [injuries]);

  // Evidence is fetched only as far back as the oldest open injury
  const openSince = useMemo(
    () => injuries.filter((i) => i.status === "open").map((i) => i.occurred_on).sort()[0] ?? null,
    [injuries],
  );
  useEffect(() => {
    if (!openSince) { setPrompts([]); return; }
    let cancelled = false;
    fetchPlayerActivitySince(player.id, openSince)
      .then(({ rated, played }) => {
        if (cancelled) return;
        setPrompts(closingPrompts(injuries, stages, buildEvidence(rated, played), today));
      })
      .catch(() => { if (!cancelled) setPrompts(closingPrompts(injuries, stages, () => ({ ratedDates: [], played: [] }), today)); });
    return () => { cancelled = true; };
  }, [player.id, openSince, injuries, stages, today]);

  if (injuries.length === 0 && !isAdmin) return null;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden" data-testid="card-injuries">
      {/* An alert, not a form: the stage, then why — the coach's note, or the
          injury itself when there's no note. The facts sit small underneath. */}
      {now && (
        <div
          className={cn(
            "px-5 py-3 border-b space-y-2.5",
            now.stage === "out" ? "border-status-bad bg-status-bad" : "border-status-warn bg-status-warn",
          )}
          role="status"
          data-testid="banner-availability"
        >
          {now.injuries.map((i) => {
            const stage = i.current_stage ?? now.stage;
            const since = now.since[i.id] ?? i.occurred_on;
            const why = i.notes?.trim() || injuryLabel(i);
            return (
              <div key={i.id} className="flex items-start gap-3 min-w-0">
                <Activity size={16} className={cn("mt-0.5 shrink-0", stage === "out" ? "text-status-bad" : "text-status-warn")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate" title={why}>
                    <span className="font-semibold">{STAGE_CFG[stage].label}</span>
                    <span className="text-foreground/80"> — {why}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      i.notes?.trim() ? injuryLabel(i) : null,
                      `since ${formatDateYear(since)}`,
                      i.expected_return_on ? `expected back ${formatDateYear(i.expected_return_on)}` : "no return date yet",
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ClosingPrompts prompts={prompts} players={[player]} onChanged={onChanged} showPlayer={false} />

      <div className={cn("px-5 py-3 flex items-center justify-between gap-2", prompts.length > 0 && "border-t border-border")}>
        {injuries.length === 0 ? (
          <h3 className="text-sm font-semibold text-foreground">
            Injury history <span className="font-normal text-muted-foreground">· none on record</span>
          </h3>
        ) : (
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            data-testid="button-injury-history"
          >
            <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", !historyOpen && "-rotate-90")} />
            Injury history <span className="font-normal text-muted-foreground">({injuries.length})</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setReporting(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-report-injury-player"
          >
            <Plus size={12} /> Report
          </button>
        )}
      </div>

      {historyOpen && injuries.length > 0 && (
        <ul className="pb-2">
          {injuries.map((i) => {
            const recurs = i.recurrence_of ? byId.get(i.recurrence_of) : null;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setOpened(i)}
                  className="w-full text-left px-5 py-2 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                >
                  <span className="font-time text-xs text-muted-foreground w-14 shrink-0">{formatDateShort(i.occurred_on)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm text-foreground">{injuryLabel(i)}</span>
                    {recurs && <span className="text-xs text-muted-foreground"> · recurrence of {formatDateShort(recurs.occurred_on)}</span>}
                    <span className="block text-xs text-muted-foreground truncate">{describeSeverity(i, stages.filter((st) => st.injury_id === i.id), today)}</span>
                  </span>
                  <span
                    className={cn(
                      "text-[11px] shrink-0",
                      i.status === "resolved" ? "text-muted-foreground"
                        : i.current_stage === "out" ? "text-status-bad" : "text-status-warn",
                    )}
                  >
                    {i.current_stage ? STAGE_CFG[i.current_stage].label : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {opened && (
        <InjuryDialog injury={opened} player={player} onClose={() => setOpened(null)} onChanged={onChanged} />
      )}
      {reporting && (
        <ReportInjuryDialog
          player={player}
          sessions={sessions}
          onClose={() => setReporting(false)}
          onRecorded={() => { setReporting(false); onChanged(); }}
        />
      )}
    </div>
  );
}

/** "6 Sep 2026" — the year matters here: an ACL's return is next year. */
function formatDateYear(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
