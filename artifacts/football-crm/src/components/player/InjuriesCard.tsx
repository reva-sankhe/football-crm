import { useEffect, useMemo, useState } from "react";
import { Activity, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { formatDateShort, todayISO } from "@/lib/attendance";
import {
  STAGE_CFG, availabilityLabel, buildEvidence, closingPrompts, describeSeverity, injuryLabel,
  type Availability, type ClosingPrompt,
} from "@/lib/injuries";
import { fetchPlayerActivitySince } from "@/lib/queries";
import { InjuryDialog } from "@/components/injuries/InjuryDialog";
import { ReportInjuryDialog } from "@/components/injuries/ReportInjuryDialog";
import { ClosingPrompts } from "@/components/injuries/ClosingPrompts";
import type { InjuryStage, InjuryWithStatus, Player, TrainingSession } from "@/lib/types";

/**
 * Why a player stopped training, on their own page: a banner while they are
 * not match fit, the question to answer about it if there is one, and every
 * injury on record. The page passes its own injury fetch in, since the same
 * data excuses the absences in its attendance figures.
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
      {now && (
        <div
          className={cn(
            "px-5 py-3 border-b flex items-start gap-3",
            now.stage === "out" ? "border-status-bad bg-status-bad" : "border-status-warn bg-status-warn",
          )}
          data-testid="banner-availability"
        >
          <Activity size={16} className={cn("mt-0.5 shrink-0", now.stage === "out" ? "text-status-bad" : "text-status-warn")} />
          <div className="min-w-0 text-sm text-foreground">
            <div className="font-semibold">
              {STAGE_CFG[now.stage].label} since {formatDateShort(now.injuries[0].occurred_on)} — {availabilityLabel(now).split(" · ").slice(1).join(" · ")}
            </div>
            <div className="text-xs text-muted-foreground">
              {[
                now.injuries[0].notes,
                describeSeverity(now.injuries[0], today),
                now.injuries[0].expected_return_on && `expected back ${formatDateShort(now.injuries[0].expected_return_on)}`,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      )}

      <ClosingPrompts prompts={prompts} players={[player]} onChanged={onChanged} showPlayer={false} />

      <div className={cn("px-5 py-3 flex items-center justify-between gap-2", prompts.length > 0 && "border-t border-border")}>
        <h3 className="text-sm font-semibold text-foreground">Injuries</h3>
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

      {injuries.length === 0 ? (
        <p className="px-5 pb-4 text-xs text-muted-foreground">None on record.</p>
      ) : (
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
                    <span className="block text-xs text-muted-foreground truncate">{describeSeverity(i, today)}</span>
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
