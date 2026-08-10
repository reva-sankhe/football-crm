import { cn } from "@/lib/utils";
import { SESSION_TYPE_CFG } from "@/lib/attendance";
import { FINISH_CFG, STAGE_CFG, type TournamentFinish } from "@/lib/tournaments";
import type { MatchStage, SessionType } from "@/lib/types";

/**
 * Neutral badges. Text wears ink tokens; where a category needs to be scannable
 * in a dense list, a small dot carries the identity instead of tinting the words.
 */

export function SessionTypeBadge({ type, className }: { type: SessionType; className?: string }) {
  const cfg = SESSION_TYPE_CFG[type] ?? SESSION_TYPE_CFG.Training;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
      {type}
    </span>
  );
}

export function StageBadge({
  stage,
  short = false,
  className,
}: {
  stage: MatchStage;
  short?: boolean;
  className?: string;
}) {
  const cfg = STAGE_CFG[stage] ?? STAGE_CFG["Group Stage"];
  return (
    <span
      title={cfg.label}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border border-border text-muted-foreground shrink-0",
        className,
      )}
    >
      {short ? cfg.short : cfg.label}
    </span>
  );
}

/**
 * Where the team finished, as a medal. The word rides along for screen readers
 * and on hover, so nothing depends on the glyph rendering.
 */
export function FinishBadge({
  finish,
  className,
}: {
  finish: TournamentFinish;
  className?: string;
}) {
  const cfg = FINISH_CFG[finish];
  return (
    <span
      title={cfg.label}
      className={cn("inline-flex items-center leading-none shrink-0 text-base", className)}
      data-testid={`badge-finish-${finish.toLowerCase()}`}
    >
      <span aria-hidden>{cfg.medal}</span>
      <span className="sr-only">{cfg.label}</span>
    </span>
  );
}
