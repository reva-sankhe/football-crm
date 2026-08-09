import { cn } from "@/lib/utils";

/**
 * The platform's headline-number tile and section heading, as set by the player
 * profile. Every page that shows a stat strip uses these rather than its own
 * copy — that drift is what made the tournament page look like a different app.
 */
export function StatTile({ label, value, valueNote, sub, valueColor, className }: {
  label: string;
  value: string | number;
  /** Sits inline after the value, small — e.g. the month a test was taken. */
  valueNote?: string;
  sub?: string;
  valueColor?: string;
  /** Page-level padding only. Type scale is fixed. */
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-2xl font-bold font-time leading-none", valueColor ?? "text-foreground")}>{value}</span>
        {valueNote && <span className="text-[11px] text-muted-foreground">{valueNote}</span>}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
    </div>
  );
}

/** Small uppercase anchor above each section. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}
