import { getMasTier } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MasBadge({ mas, className }: { mas: number | null | undefined; className?: string }) {
  if (mas === null || mas === undefined) {
    return <span className="text-slate-600 text-xs">—</span>;
  }
  const tier = getMasTier(mas);
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide border",
        className
      )}
      style={{
        backgroundColor: tier.color + "18",
        color: tier.color,
        borderColor: tier.color + "30",
      }}
    >
      {tier.label}
    </span>
  );
}
