import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { attendancePctColor } from "@/lib/attendance";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface MonthlyAttendance {
  month: string;   // "2026-07"
  total: number;
  attended: number;
  pct: number;
}

/** Bar fill mirrors attendancePctColor's thresholds — the one scale on this card. */
function pctFill(pct: number): string {
  if (pct >= 85) return "#34d399";
  if (pct >= 75) return "#fbbf24";
  return "#f87171";
}

export function AttendanceCard({ monthly }: { monthly: MonthlyAttendance[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const chartGrid = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
  const chartAxis = isDark ? "#6b7280" : "#9ca3af";
  const chartTooltipBg = isDark ? "#0f172a" : "#ffffff";
  const chartTooltipBorder = isDark ? "#1e293b" : "#e2e8f0";

  const currentMonth = new Date().toISOString().slice(0, 7);

  const chartData = monthly.map(({ month, pct, attended, total }) => ({
    label: new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    pct,
    attended,
    total,
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Monthly Attendance</h3>
        <span className="text-[11px] text-muted-foreground">75% minimum</span>
      </div>

      {monthly.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">No attendance recorded yet</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chartAxis, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: chartAxis, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                formatter={(_v: unknown, _n: unknown, props: { payload?: { pct: number; attended: number; total: number } }) => [
                  `${props.payload?.attended ?? 0}/${props.payload?.total ?? 0} sessions (${props.payload?.pct ?? 0}%)`,
                  "Attendance",
                ]}
              />
              <ReferenceLine y={75} stroke={chartAxis} strokeDasharray="4 4" strokeWidth={1} />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]} maxBarSize={20}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={pctFill(entry.pct)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Month chips */}
          <div className="flex gap-1.5 mt-4 flex-wrap">
            {monthly.map(({ month, pct, attended, total }) => (
              <div
                key={month}
                className={cn(
                  "flex flex-col items-center px-2.5 py-1.5 rounded-lg text-center min-w-[54px] border border-border",
                  month === currentMonth && "ring-1 ring-indigo-500",
                )}
              >
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })}
                </span>
                <span className={cn("text-sm font-bold font-time leading-tight mt-0.5", attendancePctColor(pct))}>
                  {pct}%
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">{attended}/{total}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
