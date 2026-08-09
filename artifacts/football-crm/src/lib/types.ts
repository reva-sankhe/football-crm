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
  min: number;
  max: number;
}

export const MAS_TIERS: MasTier[] = [
  { label: "World Record", color: "#0d366b", min: 4.5, max: Infinity },
  { label: "Elite Pro",    color: "#184f95", min: 4.3, max: 4.5 },
  { label: "Outstanding",  color: "#256abf", min: 4.1, max: 4.3 },
  { label: "Very Good",    color: "#3987e5", min: 3.9, max: 4.1 },
  { label: "Good",         color: "#5598e7", min: 3.7, max: 3.9 },
  { label: "Average",      color: "#86b6ef", min: 3.5, max: 3.7 },
  { label: "Below Average",color: "#b7d3f6", min: 0,   max: 3.5 },
];

export function getMasTier(mas: number): MasTier {
  return MAS_TIERS.find((t) => mas >= t.min && mas < t.max) ?? MAS_TIERS[MAS_TIERS.length - 1];
}

// ── Bronco time tiers (female athletes) ─────────────────────────────────
// Based on official benchmarks. Lower bronco_mins = better/faster.
// minMins = fastest (inclusive lower bound), maxMins = slowest (exclusive upper bound)
export interface BroncoTier {
  label: string;
  color: string;
  minMins: number;
  maxMins: number;
  displayRange: string;
  description: string;
}

const M = (mins: number, secs: number) => mins + secs / 60;

export const BRONCO_TIERS: BroncoTier[] = [
  { label: "World Record",       color: "#0d366b", minMins: 0,          maxMins: M(4,26), displayRange: "Under 4:26", description: "Top 1% of professional athletes" },
  { label: "Elite Professional", color: "#184f95", minMins: M(4,26),    maxMins: M(4,36), displayRange: "4:26–4:36",  description: "International and top-tier professional players" },
  { label: "Outstanding",        color: "#256abf", minMins: M(4,36),    maxMins: M(4,46), displayRange: "4:36–4:46",  description: "High-level competitive athletes" },
  { label: "Very Good",          color: "#3987e5", minMins: M(4,46),    maxMins: M(4,56), displayRange: "4:46–4:56",  description: "Competitive club/college level" },
  { label: "Good",               color: "#5598e7", minMins: M(4,56),    maxMins: M(5, 6), displayRange: "4:56–5:06",  description: "Above average, suitable for competition" },
  { label: "Average",            color: "#86b6ef", minMins: M(5, 6),    maxMins: M(5,26), displayRange: "5:06–5:26",  description: "Average fitness for team sports" },
  { label: "Below Average",      color: "#b7d3f6", minMins: M(5,26),    maxMins: Infinity, displayRange: "Above 5:26", description: "Needs improvement" },
];

export function getBroncoTier(broncoMins: number): BroncoTier {
  return BRONCO_TIERS.find((t) => broncoMins >= t.minMins && broncoMins < t.maxMins) ?? BRONCO_TIERS[BRONCO_TIERS.length - 1];
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
export type SessionType = "Training" | "Match" | "Lecture";

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

// ── Tournaments, squads & matches ─────────────────────────────────────────────
// A match is a `sessions` row (session_type = "Match") extended 1:1 by a
// `matches` row, so attendance, RPE and training load work for matches too.
export type MatchStage =
  | "Group Stage"
  | "Round of 16"
  | "Quarter Final"
  | "Semi Final"
  | "Third Place"
  | "Final"
  | "Friendly";

export interface Tournament {
  id: string;
  name: string;
  team: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  /** "7-a-side" etc. — null until set. See MATCH_FORMATS in lib/tournaments. */
  format: string | null;
  default_match_mins: number;
  default_planned_rpe: number;
  notes: string | null;
  created_at: string;
}

/** One titled link filed against a tournament — a Drive folder, a results page. */
export interface TournamentLink {
  id: string;
  tournament_id: string;
  title: string;
  url: string;
  created_at: string;
}

export interface Squad {
  id: string;
  tournament_id: string;
  name: string;
  size_limit: number | null;
  notes: string | null;
  created_at: string;
}

export interface SquadPlayer {
  id: string;
  squad_id: string;
  player_id: string;
  shirt_number: number | null;
  created_at: string;
}

/** A squad with its players joined in — what `fetchSquadsForTournament` returns. */
export interface SquadWithPlayers extends Squad {
  squad_players: (SquadPlayer & { players: Player | null })[];
}

export interface Match {
  id: string;
  tournament_id: string;
  session_id: string;
  squad_id: string | null;
  stage: MatchStage;
  opponent: string | null;
  goals_for: number | null;
  goals_against: number | null;
  notes: string | null;
  created_at: string;
}

/** A match with its backing session (date/duration live there) and squad name. */
export interface MatchWithSession extends Match {
  sessions: TrainingSession | null;
  squads: Pick<Squad, "id" | "name"> | null;
}

export interface MatchPlayerStat {
  id: string;
  match_id: string;
  player_id: string;
  minutes_played: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  injured: boolean;
  injury_note: string | null;
  notes: string | null;
  created_at: string;
}

/** The editable subset of a stat row — what the match grid drafts and saves. */
export type MatchStatInput = Pick<
  MatchPlayerStat,
  "player_id" | "minutes_played" | "goals" | "assists" | "yellow_cards" | "red_cards" | "injured" | "injury_note"
>;
