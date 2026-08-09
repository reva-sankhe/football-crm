import { CheckCircle2, XCircle, Clock, Activity } from "lucide-react";
import type { AttendanceStatus, SessionType } from "./types";
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
}

export const ATTENDANCE_CFG: Record<AttendanceStatus, AttendanceCfg> = {
  Present: { label: "Present", short: "P", icon: CheckCircle2, activeColor: "text-emerald-400", activeBg: "bg-emerald-500/20 border-emerald-500/40" },
  Absent:  { label: "Absent",  short: "A", icon: XCircle,      activeColor: "text-red-400",     activeBg: "bg-red-500/20 border-red-500/40"         },
  Late:    { label: "Late",    short: "L", icon: Clock,        activeColor: "text-amber-400",   activeBg: "bg-amber-500/20 border-amber-500/40"     },
  Injured: { label: "Injured", short: "I", icon: Activity,     activeColor: "text-orange-400",  activeBg: "bg-orange-500/20 border-orange-500/40"   },
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
