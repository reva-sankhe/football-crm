import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a bronco value (decimal minutes) into M:SS display.
 * e.g. 6.25 → "6:15"
 */
export function formatBronco(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "—";
  const totalSeconds = Math.round(mins * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Format a bronco difference in seconds (signed).
 */
export function formatBroncoDiff(diffSeconds: number): string {
  const abs = Math.abs(diffSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const formatted = m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  return diffSeconds < 0 ? `-${formatted}` : `+${formatted}`;
}

/**
 * How a player is named everywhere they're listed: "Aanya Vora (#12)", or just
 * the name when they have no squad number yet. One definition so the roster,
 * the profile and the printed report all read the same.
 */
export function playerLabel(
  player: { name: string; jersey_number?: number | null },
): string {
  return player.jersey_number == null ? player.name : `${player.name} (#${player.jersey_number})`;
}

/** Mirrors the `players_jersey_number_check` constraint — keep the two in step. */
export const JERSEY_MIN = 1;
export const JERSEY_MAX = 99;

/** null is valid — it means the player has no squad number yet. */
export function isValidJersey(n: number | null): boolean {
  return n === null || (Number.isInteger(n) && n >= JERSEY_MIN && n <= JERSEY_MAX);
}

/**
 * Parses a jersey text field: blank means "unassigned", anything outside 1–99
 * or non-integer is rejected here so the form can say so rather than the insert
 * failing on the CHECK constraint.
 */
export function parseJersey(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return isValidJersey(n) ? n : "invalid";
}

export function calcAgeRange(yearOfBirth: number | null): "U18" | "18-24" | "25+" | null {
  if (!yearOfBirth) return null;
  const age = new Date().getFullYear() - yearOfBirth;
  if (age < 18) return "U18";
  if (age <= 24) return "18-24";
  return "25+";
}

