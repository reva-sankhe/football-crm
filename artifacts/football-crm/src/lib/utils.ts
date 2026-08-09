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

export function calcAgeRange(yearOfBirth: number | null): "U18" | "18-24" | "25+" | null {
  if (!yearOfBirth) return null;
  const age = new Date().getFullYear() - yearOfBirth;
  if (age < 18) return "U18";
  if (age <= 24) return "18-24";
  return "25+";
}

