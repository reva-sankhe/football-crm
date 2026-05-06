import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a broncho value (decimal minutes) into M:SS display.
 * e.g. 6.25 → "6:15"
 */
export function formatBroncho(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "—";
  const totalSeconds = Math.round(mins * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Format a broncho difference in seconds (signed).
 */
export function formatBronchoDiff(diffSeconds: number): string {
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

export function positionColor(position: string | null | undefined): string {
  if (!position) return "text-gray-400";
  const p = position.toLowerCase();
  if (p === "goalkeeper") return "text-amber-400";
  if (p === "defender") return "text-indigo-400";
  if (p === "midfielder") return "text-blue-400";
  if (p === "forward") return "text-red-400";
  return "text-gray-400";
}

export function ageRangeColor(range: string | null): string {
  if (range === "U18") return "text-violet-400";
  if (range === "18-24") return "text-sky-400";
  if (range === "25+") return "text-orange-400";
  return "text-gray-400";
}
