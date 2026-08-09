import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { countsAsAttended, formatDateLong } from "@/lib/attendance";
import type { AttendanceStatus, TrainingSession } from "@/lib/types";

interface LastSessionsCardProps {
  sessions: TrainingSession[];
  /** This player's attendance rows, keyed elsewhere by session_id. */
  attendance: { session_id: string; status: AttendanceStatus }[];
  count?: number;
}

export function LastSessionsCard({ sessions, attendance, count = 3 }: LastSessionsCardProps) {
  const rows = useMemo(() => {
    const statusBySession = new Map(attendance.map((a) => [a.session_id, a.status]));
    return [...sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, count)
      .map((s) => ({ session: s, status: statusBySession.get(s.id) ?? null }));
  }, [sessions, attendance, count]);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Last {count} Sessions</h3>
        <span className="text-[11px] text-muted-foreground">Most recent first</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">No sessions yet</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-2">
          {rows.map(({ session, status }) => {
            const attended = countsAsAttended(status);
            return (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground truncate">{formatDateLong(session.date)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {session.day} · {session.session_type}
                  </div>
                </div>

                {status === null ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-border text-muted-foreground shrink-0">
                    Not recorded
                  </span>
                ) : (
                  // Same green/red rule as attendance % — the specific status
                  // stays as the label so Late and Injured remain readable
                  // without introducing more hues.
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0",
                      attended ? "bg-status-good text-status-good" : "bg-status-bad text-status-bad",
                    )}
                  >
                    {status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
