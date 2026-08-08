// @refresh reset
import { cn } from "@/lib/utils";

export const POS_CFG: Record<string, { label: string; color: string; tailwindText: string; tailwindBg: string }> = {
  Forward:    { label: "FW", color: "#f87171", tailwindText: "text-red-400",    tailwindBg: "bg-red-400/15"    },
  Midfielder: { label: "MF", color: "#60a5fa", tailwindText: "text-blue-400",   tailwindBg: "bg-blue-400/15"   },
  Defender:   { label: "DF", color: "#818cf8", tailwindText: "text-indigo-400", tailwindBg: "bg-indigo-400/15" },
  Goalkeeper: { label: "GK", color: "#fbbf24", tailwindText: "text-amber-400",  tailwindBg: "bg-amber-400/15"  },
};

export function getPos(pos: string | null) {
  return (
    POS_CFG[pos ?? ""] ?? {
      label: pos ?? "?",
      color: "#9ca3af",
      tailwindText: "text-slate-400",
      tailwindBg: "bg-slate-400/15",
    }
  );
}

export function PosBadge({ pos, className }: { pos: string | null; className?: string }) {
  const cfg = getPos(pos);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold font-time shrink-0",
        cfg.tailwindText,
        cfg.tailwindBg,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
