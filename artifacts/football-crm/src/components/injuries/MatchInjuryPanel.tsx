import { formatDateShort } from "@/lib/attendance";
import { STAGE_CFG, injuryLabel, type InjuryDraft } from "@/lib/injuries";
import { cn } from "@/lib/utils";
import { InjuryFields } from "./InjuryFields";
import type { InjuryWithStatus } from "@/lib/types";

/**
 * What the match grid shows under a row whose Injury toggle is on. Nothing in
 * here saves — the choice lands in the page's draft and goes out with "Save
 * match", like every other cell in the grid.
 *
 * Three states:
 * - **linked**: the row points at an injury on record, new or old;
 * - **choosing**: the player is already out with something, so the coach says
 *   whether this is that injury again or a new one — the "Back injury", "Back
 *   pull", "back" problem, answered at entry instead of afterwards;
 * - **new**: the injury fields, with Where fixed to the match.
 */
export function MatchInjuryPanel({
  linked,
  openInjuries,
  newDraft,
  history,
  occurredOn,
  problems,
  className,
  onLink,
  onStartNew,
  onDraftChange,
}: {
  /** The injury the saved or drafted row points at, if any. */
  linked: InjuryWithStatus | null;
  /** The player's open injuries, other than one this row already links. */
  openInjuries: InjuryWithStatus[];
  /** Present while entering a new injury. */
  newDraft: InjuryDraft | undefined;
  history: InjuryWithStatus[];
  occurredOn: string;
  problems: Record<string, string>;
  className?: string;
  onLink: (injuryId: string) => void;
  onStartNew: () => void;
  onDraftChange: (d: InjuryDraft) => void;
}) {
  if (linked && !newDraft) {
    return (
      <div className={cn("w-full mt-1 rounded-lg border border-status-warn px-3 py-2 text-xs flex items-center gap-2 flex-wrap", className)}>
        <span className="font-medium text-foreground">{injuryLabel(linked)}</span>
        <span className="text-muted-foreground">
          since {formatDateShort(linked.occurred_on)}
          {linked.current_stage && ` · ${STAGE_CFG[linked.current_stage].label}`}
        </span>
        {linked.notes && <span className="text-muted-foreground truncate">· {linked.notes}</span>}
      </div>
    );
  }

  return (
    <div className={cn("w-full mt-1 rounded-lg border border-status-warn p-3 space-y-3", className)}>
      {openInjuries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {openInjuries.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onLink(i.id)}
              className="px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              Same as <span className="font-medium text-foreground">{injuryLabel(i)}</span> since {formatDateShort(i.occurred_on)}
            </button>
          ))}
          <button
            type="button"
            onClick={onStartNew}
            aria-pressed={!!newDraft}
            className={cn(
              "px-2.5 py-1.5 rounded-lg border text-xs transition-colors",
              newDraft ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            New injury
          </button>
        </div>
      )}

      {newDraft && (
        <InjuryFields
          draft={newDraft}
          onChange={onDraftChange}
          occurredOn={occurredOn}
          problems={problems}
          history={history}
          showContext={false}
          compact
        />
      )}
    </div>
  );
}
