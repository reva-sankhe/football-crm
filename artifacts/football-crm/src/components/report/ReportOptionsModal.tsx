import { useState } from "react";
import { FileText, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { DateRangePicker, type IsoRange } from "@/components/DateRangePicker";

interface ReportOptionsModalProps {
  /** Selected player ids, or null to report the whole roster. */
  playerIds: string[] | null;
  playerCount: number;
  /** Session dates, so the calendar can show where data exists. */
  highlightDates?: Date[];
  onClose: () => void;
}

export function ReportOptionsModal({
  playerIds,
  playerCount,
  highlightDates = [],
  onClose,
}: ReportOptionsModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [range, setRange] = useState<IsoRange | null>(null);

  const generate = () => {
    const qs = new URLSearchParams();
    qs.set("ids", playerIds && playerIds.length > 0 ? playerIds.join(",") : "all");
    if (range) {
      qs.set("from", range.from);
      qs.set("to", range.to);
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    // New tab so the Players page keeps its selection and filters
    window.open(`${base}/reports/players?${qs.toString()}`, "_blank", "noopener");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Download report</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2.5",
            isDark ? "border-white/[0.06] bg-white/[0.02]" : "border-slate-200 bg-slate-50",
          )}>
            <Users size={14} className="text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground">
              {playerIds && playerIds.length > 0
                ? `${playerCount} selected player${playerCount !== 1 ? "s" : ""}`
                : "All players"}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">one page each</span>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-2">
              Timeline for the stats
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setRange(null)}
                className={cn(
                  "px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
                  range === null
                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                    : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                All time
              </button>
              <DateRangePicker
                value={range}
                onChange={setRange}
                highlightDates={highlightDates}
                label="Custom range"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Scopes attendance, matches and fitness tests. ACWR is calculated as at the
              end of the range.
            </p>
          </div>

          <div className={cn(
            "rounded-xl border px-3 py-2.5 text-[11px] text-muted-foreground",
            isDark ? "border-white/[0.06]" : "border-slate-200",
          )}>
            Opens a print-ready page in a new tab. Choose <strong className="text-foreground">Save as PDF</strong> as
            the destination in your browser's print dialog.
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={generate}
              className="flex-1 px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold"
              data-testid="button-generate-report"
            >
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
