// @refresh reset
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { formatDateRange } from "@/lib/tournaments";
import { Calendar } from "@/components/ui/calendar";
import { IconButton } from "@/components/Toolbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Inclusive ISO date range. */
export interface IsoRange {
  from: string;
  to: string;
}

/** Local-time YYYY-MM-DD — toISOString() would shift across the date line. */
export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

interface DateRangePickerProps {
  value: IsoRange | null;
  onChange: (range: IsoRange | null) => void;
  /** Days to mark as having data — rendered underlined in the calendar. */
  highlightDates?: Date[];
  /** Trigger label when no range is set. */
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
  /** Render as a square calendar icon, matching the other toolbar controls. */
  iconOnly?: boolean;
}

export function DateRangePicker({
  value,
  onChange,
  highlightDates = [],
  label = "Date range",
  align = "start",
  className,
  iconOnly = false,
}: DateRangePickerProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(
    value ? { from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") } : undefined,
  );

  const apply = (from: Date, to: Date) => {
    onChange({ from: isoOf(from), to: isoOf(to) });
    setOpen(false);
  };

  const applyPreset = (days: number) => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    setDraft({ from, to });
    apply(from, to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {iconOnly ? (
          <IconButton
            label={value ? (formatDateRange(value.from, value.to) ?? label) : label}
            active={!!value}
            className={className}
            data-testid="button-date-range"
          >
            <CalendarIcon size={15} />
          </IconButton>
        ) : (
          <button
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
              value
                ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              className,
            )}
            data-testid="button-date-range"
          >
            <CalendarDays size={12} />
            {value ? formatDateRange(value.from, value.to) : label}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent align={align} className="w-auto p-0">
        <div className="flex flex-wrap gap-1.5 p-3 border-b border-border">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              className={cn(
                "px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Selection only drafts — DayPicker fills both ends on the first click,
            so auto-applying on a "complete" range makes multi-day ranges
            impossible to pick. The Apply button below is deliberate. */}
        <Calendar
          mode="range"
          numberOfMonths={1}
          selected={draft}
          onSelect={setDraft}
          defaultMonth={
            value ? new Date(value.from + "T00:00:00") : highlightDates[0] ?? new Date()
          }
          modifiers={{ hasData: highlightDates }}
          modifiersClassNames={{
            hasData: "font-bold underline decoration-indigo-500 decoration-2 underline-offset-4",
          }}
        />

        <div className="flex items-center justify-between gap-2 p-3 border-t border-border">
          <span className="text-[11px] text-muted-foreground">
            {draft?.from
              ? formatDateRange(isoOf(draft.from), isoOf(draft.to ?? draft.from))
              : highlightDates.length > 0
                ? "Underlined days have data"
                : "Pick a start and end date"}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {value && (
              <button
                onClick={() => {
                  setDraft(undefined);
                  onChange(null);
                  setOpen(false);
                }}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={11} /> Clear
              </button>
            )}
            <button
              onClick={() => {
                if (draft?.from) apply(draft.from, draft.to ?? draft.from);
              }}
              disabled={!draft?.from}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-apply-range"
            >
              Apply
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
