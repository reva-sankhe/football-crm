export interface Player {
  id: string;
  code: string;
  name: string;
  primary_position: string;
  secondary_position: string | null;
  age: number | null;
  year_of_birth: number | null;
  age_range: "U18" | "18-24" | "25+" | null;
  team: "Sharks" | "Wildcats";
  is_active: boolean;
  created_at: string;
}

export interface TestSession {
  id: string;
  test_date: string;
  test_name: string;
  type: string | null;
  notes: string | null;
  created_at: string;
}

export interface TestResult {
  id: string;
  session_id: string;
  player_id: string;
  bronco_mins: number | null;
  mas_ms: number | null;
  seconds: number | null;
  ten_m_1: number | null;
  ten_m_2: number | null;
  twenty_m_1: number | null;
  twenty_m_2: number | null;
  forty_m_1: number | null;
  forty_m_2: number | null;
  eighty_m_runs: number | null;
  sixty_m_runs: number | null;
  forty_m_runs: number | null;
  notes: string | null;
  created_at: string;
}

export type Team = "Sharks" | "Wildcats";

export interface MasTier {
  label: string;
  color: string;
  bgColor: string;
  min: number;
  max: number;
}

export const MAS_TIERS: MasTier[] = [
  { label: "World Record", color: "#f59e0b", bgColor: "bg-amber-500", min: 4.5, max: Infinity },
  { label: "Elite Pro",    color: "#8b5cf6", bgColor: "bg-violet-500", min: 4.3, max: 4.5 },
  { label: "Outstanding",  color: "#3b82f6", bgColor: "bg-blue-500",   min: 4.1, max: 4.3 },
  { label: "Very Good",    color: "#10b981", bgColor: "bg-emerald-500", min: 3.9, max: 4.1 },
  { label: "Good",         color: "#22c55e", bgColor: "bg-green-500",  min: 3.7, max: 3.9 },
  { label: "Average",      color: "#f97316", bgColor: "bg-orange-500", min: 3.5, max: 3.7 },
  { label: "Below Average",color: "#ef4444", bgColor: "bg-red-500",    min: 0,   max: 3.5 },
];

export function getMasTier(mas: number): MasTier {
  return MAS_TIERS.find((t) => mas >= t.min && mas < t.max) ?? MAS_TIERS[MAS_TIERS.length - 1];
}

// ── Broncho time tiers (female athletes) ─────────────────────────────────
// Based on official benchmarks. Lower bronco_mins = better/faster.
// minMins = fastest (inclusive lower bound), maxMins = slowest (exclusive upper bound)
export interface BronchoTier {
  label: string;
  color: string;
  bgColor: string;
  minMins: number;
  maxMins: number;
  displayRange: string;
  description: string;
}

const M = (mins: number, secs: number) => mins + secs / 60;

export const BRONCHO_TIERS: BronchoTier[] = [
  { label: "World Record",       color: "#f59e0b", bgColor: "bg-amber-500",   minMins: 0,          maxMins: M(4,26), displayRange: "Under 4:26", description: "Top 1% of professional athletes" },
  { label: "Elite Professional", color: "#8b5cf6", bgColor: "bg-violet-500",  minMins: M(4,26),    maxMins: M(4,36), displayRange: "4:26–4:36",  description: "International and top-tier professional players" },
  { label: "Outstanding",        color: "#3b82f6", bgColor: "bg-blue-500",    minMins: M(4,36),    maxMins: M(4,46), displayRange: "4:36–4:46",  description: "High-level competitive athletes" },
  { label: "Very Good",          color: "#10b981", bgColor: "bg-emerald-500", minMins: M(4,46),    maxMins: M(4,56), displayRange: "4:46–4:56",  description: "Competitive club/college level" },
  { label: "Good",               color: "#22c55e", bgColor: "bg-green-500",   minMins: M(4,56),    maxMins: M(5, 6), displayRange: "4:56–5:06",  description: "Above average, suitable for competition" },
  { label: "Average",            color: "#f97316", bgColor: "bg-orange-500",  minMins: M(5, 6),    maxMins: M(5,26), displayRange: "5:06–5:26",  description: "Average fitness for team sports" },
  { label: "Below Average",      color: "#ef4444", bgColor: "bg-red-500",     minMins: M(5,26),    maxMins: Infinity, displayRange: "Above 5:26", description: "Needs improvement" },
];

export function getBronchoTier(broncoMins: number): BronchoTier {
  return BRONCHO_TIERS.find((t) => broncoMins >= t.minMins && broncoMins < t.maxMins) ?? BRONCHO_TIERS[BRONCHO_TIERS.length - 1];
}

// ── Attendance types ──────────────────────────────────────────────────────────
export type AttendanceStatus = "Present" | "Absent" | "Late" | "Injured";

export interface SessionAttendance {
  id: string;
  session_id: string;
  player_id: string;
  status: AttendanceStatus;
  notes: string | null;
  created_at: string;
}

// ── Session & RPE types ───────────────────────────────────────────────────────
export type SessionType = "Training" | "Match" | "Gym" | "Recovery";

export interface TrainingSession {
  id: string;
  date: string;           // ISO date string "2026-04-10"
  day: string;            // "Monday"
  session_type: SessionType;
  duration_mins: number;
  planned_rpe: number;
  planned_load_au: number;
  notes: string | null;
  created_at: string;
}

export interface SessionRPE {
  id: string;
  session_id: string;
  player_id: string;
  rpe: number;
  minutes_played: number | null;  // individual time on pitch; used for load_au = rpe × minutes_played
  load_au: number;
  notes: string | null;
  created_at: string;
}
