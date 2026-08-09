// @refresh reset
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { posColor } from "@/lib/viz";

export const POS_LABEL: Record<string, string> = {
  Forward: "FW",
  Midfielder: "MF",
  Defender: "DF",
  Goalkeeper: "GK",
};

export function posLabel(position: string | null | undefined): string {
  return POS_LABEL[position ?? ""] ?? (position ? position.slice(0, 2).toUpperCase() : "?");
}

/**
 * Neutral badge — the text wears ink tokens; identity is carried by the dot.
 * Position colour lives in `lib/viz` so chart marks and this badge can never
 * disagree.
 */
export function PosBadge({
  pos,
  className,
  showDot = true,
}: {
  pos: string | null;
  className?: string;
  showDot?: boolean;
}) {
  const { theme } = useTheme();
  const mode = theme === "dark" ? "dark" : "light";

  return (
    <span
      title={pos ?? undefined}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-7 rounded-md bg-muted text-foreground text-[10px] font-bold font-time shrink-0",
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: posColor(mode, pos) }}
        />
      )}
      {posLabel(pos)}
    </span>
  );
}
