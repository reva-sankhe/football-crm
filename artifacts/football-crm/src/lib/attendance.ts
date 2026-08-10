import { CheckCircle2, XCircle, Clock, Activity } from "lucide-react";
import type { AttendanceStatus, SessionType, TrainingSession } from "./types";
import { STATUS, STATUS_TEXT } from "./viz";

// ── Session type styling ──────────────────────────────────────────────────────
export const SESSION_TYPE_CFG: Record<SessionType, { dot: string }> = {
  Training: { dot: "bg-slate-400" },
  Match:    { dot: "bg-indigo-500" },
  Lecture:  { dot: "bg-slate-300 dark:bg-slate-600" },
};

export const SESSION_TYPES: SessionType[] = ["Training", "Match", "Lecture"];

// ── Attendance status styling ─────────────────────────────────────────────────
export interface AttendanceCfg {
  label: string;
  short: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  activeColor: string;
  activeBg: string;
  /** Border alone, for surfaces that carry state without a fill. */
  activeBorder: string;
}

export const ATTENDANCE_CFG: Record<AttendanceStatus, AttendanceCfg> = {
  Present: { label: "Present", short: "P", icon: CheckCircle2, activeColor: "text-emerald-400", activeBg: "bg-emerald-500/20 border-emerald-500/40", activeBorder: "border-emerald-500/40" },
  Absent:  { label: "Absent",  short: "A", icon: XCircle,      activeColor: "text-red-400",     activeBg: "bg-red-500/20 border-red-500/40",         activeBorder: "border-red-500/40"     },
  Late:    { label: "Late",    short: "L", icon: Clock,        activeColor: "text-amber-400",   activeBg: "bg-amber-500/20 border-amber-500/40",     activeBorder: "border-amber-500/40"   },
  Injured: { label: "Injured", short: "I", icon: Activity,     activeColor: "text-orange-400",  activeBg: "bg-orange-500/20 border-orange-500/40",   activeBorder: "border-orange-500/40"  },
};

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["Present", "Absent", "Late", "Injured"];

/** Statuses that count towards a player's attendance percentage. */
export const ATTENDED: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>(["Present", "Late"]);

export function countsAsAttended(status: AttendanceStatus | null | undefined): boolean {
  return status != null && ATTENDED.has(status);
}

/** Percentage bands, matching the 75% threshold the Dashboard alerts on. */
export function attendancePctColor(pct: number): string {
  if (pct >= 85) return STATUS_TEXT.good;
  if (pct >= 75) return STATUS_TEXT.warning;
  return STATUS_TEXT.critical;
}

/** Same bands as a raw hex, for chart marks. */
export function attendancePctFill(pct: number): string {
  if (pct >= 85) return STATUS.good;
  if (pct >= 75) return STATUS.warning;
  return STATUS.critical;
}

// ── Attendance units ──────────────────────────────────────────────────────────
export interface CollapsedSessions {
  /** What to show: every training session, but only one entry per match day. */
  sessions: TrainingSession[];
  /** Canonical session id → how many matches that day. Absent for non-match days. */
  matchesOnDay: Record<string, number>;
}

/**
 * Collapses a day's matches into a single attendance entry.
 *
 * Attendance is about who turned up, which is a property of the day, not of each
 * fixture — a tournament day with four matches is one attendance check, not four.
 * Training sessions are untouched and stay one entry each.
 *
 * The surviving "canonical" session is the one attendance rows are written to. A
 * day that already has attendance keeps that session, so collapsing can never
 * orphan rows that were recorded before; failing that, the earliest-created match
 * session wins, which is stable across reloads.
 */
export function collapseMatchDays(
  sessions: TrainingSession[],
  hasAttendance: (sessionId: string) => boolean = () => false,
): CollapsedSessions {
  const matchDays = new Map<string, TrainingSession[]>();
  const out: TrainingSession[] = [];
  const matchesOnDay: Record<string, number> = {};

  for (const s of sessions) {
    if (s.session_type !== "Match") {
      out.push(s);
      continue;
    }
    const group = matchDays.get(s.date);
    if (group) group.push(s);
    else matchDays.set(s.date, [s]);
  }

  for (const group of matchDays.values()) {
    const canonical =
      group.find((s) => hasAttendance(s.id)) ??
      [...group].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))[0];
    matchesOnDay[canonical.id] = group.length;
    out.push(canonical);
  }

  // Newest first, matching what the strip and matrix expect. created_at breaks
  // ties so a training session and a match on the same date keep a stable order.
  out.sort(
    (a, b) => b.date.localeCompare(a.date) || (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  return { sessions: out, matchesOnDay };
}

/**
 * Match-day attendance, counted the way `collapseMatchDays` displays it: per
 * day, not per fixture.
 *
 * Turning up to a tournament day covers every fixture played that day — one
 * turnout check, not four — so the **percentage is day-wise**. The tally stays
 * in fixtures ("7/7"), because that is the number a coach is actually asking
 * about. The two therefore measure different things on purpose: `attended` and
 * `total` count matches, `pct` counts days.
 */
export interface MatchDayAttendance {
  /** Fixtures in scope, and those played on days the player turned up to. */
  total: number;
  attended: number;
  /** Day-wise turnout, 0–100. Deliberately not `attended / total`. */
  pct: number | null;
  /** The days the percentage is computed from. */
  days: number;
  daysAttended: number;
}

export function matchDayAttendance(
  sessions: TrainingSession[],
  attended: (sessionId: string) => boolean,
): MatchDayAttendance {
  const byDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    if (s.session_type !== "Match") continue;
    const group = byDay.get(s.date);
    if (group) group.push(s);
    else byDay.set(s.date, [s]);
  }

  let daysAttended = 0;
  let total = 0;
  let attendedMatches = 0;
  for (const group of byDay.values()) {
    total += group.length;
    // A day's attendance lives on one of its sessions, so any hit means they
    // came — which session holds the row doesn't matter here.
    if (group.some((s) => attended(s.id))) {
      daysAttended += 1;
      attendedMatches += group.length;
    }
  }

  const days = byDay.size;
  return {
    total,
    attended: attendedMatches,
    pct: days > 0 ? Math.round((daysAttended / days) * 100) : null,
    days,
    daysAttended,
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────
export function formatDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayFromISO(iso: string): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
}

/** "2026-07" → "July 2026" */
export function formatMonthLabel(month: string): string {
  return new Date(month + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
