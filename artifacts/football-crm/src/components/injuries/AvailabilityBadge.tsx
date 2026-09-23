import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/attendance";
import { STAGE_CFG, availabilityLabel, type PlayerAvailability } from "@/lib/injuries";

/**
 * "Out · Knee (left)" beside a player's name wherever a lineup or squad is
 * picked. A warning, never a block — the coach can still select them, the way
 * exceeding the sub cap warns but saves.
 */
export function AvailabilityBadge({ availability, className }: { availability: PlayerAvailability; className?: string }) {
  const lead = availability.injuries[0];
  const title = [
    `${STAGE_CFG[availability.stage].label} — ${STAGE_CFG[availability.stage].description.toLowerCase()}`,
    `Since ${formatDateShort(availability.since[lead.id] ?? lead.occurred_on)}`,
    lead.expected_return_on ? `expected back ${formatDateShort(lead.expected_return_on)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium whitespace-nowrap shrink-0",
        // Out is the one that should stop a coach; the later stages are a caution
        availability.stage === "out"
          ? "border-status-bad text-status-bad"
          : "border-status-warn text-status-warn",
        className,
      )}
      data-testid="badge-availability"
    >
      <Activity size={9} aria-hidden />
      {availabilityLabel(availability)}
    </span>
  );
}
