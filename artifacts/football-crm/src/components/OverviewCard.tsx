import { useState } from "react";
import { cn } from "@/lib/utils";
import { ink } from "@/lib/viz";

/**
 * A block on an Overview tab: a figure or chart, and underneath it the reading
 * of what that figure shows.
 *
 * Set by Players → Overview and shared with Tournaments → Overview so the two
 * are the same object rather than two things that resemble each other. The
 * interpretation is the point of the card — a chart nobody can read tells you
 * nothing, so every block here says what its numbers mean.
 *
 * `table` is not optional decoration — a chart whose values are only reachable
 * by hovering fails accessibility, so every plot here ships its numbers as a
 * table too.
 */
export function OverviewCard({
  title, subtitle, interpretation, table, className, action, children,
}: {
  title: string;
  subtitle?: string;
  interpretation: string;
  table?: React.ReactNode;
  className?: string;
  /** Sits beside the Table toggle — a download button, a filter. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={cn("bg-card border border-border rounded-2xl p-5 flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {action}
          {table && (
            <button
              onClick={() => setShowTable((v) => !v)}
              className="text-[11px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
              aria-pressed={showTable}
              data-testid={`toggle-table-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {showTable ? "Chart" : "Table"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1">{showTable && table ? table : children}</div>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
          Interpretation
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{interpretation}</p>
      </div>
    </div>
  );
}

/** Shared tooltip chrome, matching the charts on Analytics and the player profile. */
export function tooltipStyle(INK: ReturnType<typeof ink>) {
  return {
    contentStyle: {
      background: INK.tooltipBg,
      border: `1px solid ${INK.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
    },
    labelStyle: { color: INK.secondary },
  };
}

/**
 * The table view a chart card falls back to. No chrome, any number of columns:
 * the first names the thing and the rest are its figures, so they're right
 * aligned and set in the tabular figure face. One column per measure rather than
 * measures crammed into a single cell — "3 · 9 in 7" is a puzzle, not a table.
 */
export function MiniTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={cn("font-semibold pb-2", i === 0 ? "text-left" : "text-right pl-2")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-border/50">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "py-1.5",
                    i === 0 ? "text-foreground" : "text-right pl-2 font-time text-muted-foreground",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
