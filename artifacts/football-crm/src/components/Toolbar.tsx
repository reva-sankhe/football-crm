import { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The list-toolbar primitives, as set by the Players page: one height (36px),
 * one radius, one active treatment. Every list that filters, sorts or counts
 * uses these rather than restating the classes, which is how the tournament
 * and attendance toolbars drifted in the first place.
 */

/** Search field. Wrap in a sized container — it fills its parent. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  "data-testid": testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        data-testid={testId}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Square icon control. `active` lights it indigo; `badge` adds a count dot.
 * Forwards its ref and extra props so it can be a Radix `asChild` trigger.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    active?: boolean;
    badge?: number;
    children: React.ReactNode;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton({ label, active = false, badge, children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "relative h-9 w-9 flex items-center justify-center rounded-lg border transition-colors shrink-0",
        active
          ? "border-indigo-500/50 text-indigo-400 bg-indigo-500/10"
          : "border-border text-muted-foreground hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-600 text-white text-[9px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
});

/** Read-only figure at the end of a toolbar — a count, or a percentage. */
export function CountPill({
  children,
  title,
  className,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "h-9 px-3 flex items-center rounded-lg border border-border bg-muted/40 text-sm font-time font-medium text-muted-foreground shrink-0",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** Dropdown panel anchored under a toolbar icon. */
export const TOOLBAR_MENU =
  "absolute right-0 top-11 z-20 w-52 bg-card border border-border rounded-xl shadow-xl p-3";

/** Select inside a toolbar menu. */
export const TOOLBAR_SELECT =
  "w-full bg-muted border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground";
