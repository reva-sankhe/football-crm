import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The platform's one "add" control — an icon-only plus, sized to match the
 * other 36px controls on the Players toolbar. Every list that can be appended
 * to uses this rather than a bespoke labelled button.
 */
export function AddButton({ label, onClick, className, "data-testid": testId }: {
  /** Names the action for screen readers and the tooltip, e.g. "Add player". */
  label: string;
  onClick: () => void;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "h-9 w-9 flex items-center justify-center rounded-lg border border-indigo-500/50",
        "text-indigo-400 hover:bg-indigo-500/10 transition-colors shrink-0",
        className,
      )}
      data-testid={testId}
    >
      <Plus size={16} />
    </button>
  );
}
