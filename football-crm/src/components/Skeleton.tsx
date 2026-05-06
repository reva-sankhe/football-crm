import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("animate-pulse rounded bg-muted", className)} style={style} />
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
