/**
 * Single source of truth for every colour that carries meaning.
 *
 * Rules this module exists to enforce (see the dataviz guidance):
 *  - Text wears ink tokens, never a series colour. A coloured mark beside the
 *    text carries identity.
 *  - Categorical hues are assigned in FIXED order by entity, never cycled and
 *    never re-assigned when a filter changes the series count.
 *  - Status colours are reserved and always ship with an icon or label.
 *  - Light and dark are separately chosen steps validated against their own
 *    surface, not one value flipped between modes.
 *
 * The categorical slots below pass all six checks of
 * `dataviz/scripts/validate_palette.js` on this app's real surfaces
 * (dark #12161f, light #ffffff). Do not hand-edit them without re-running it —
 * the palette they replaced failed, with Defender/Midfielder only ΔE 6.9 apart
 * on normal vision and 3.9 under deuteranopia.
 */

export type Mode = "light" | "dark";

// ── Categorical ───────────────────────────────────────────────────────────────
// blue · orange · aqua · yellow · magenta
const CATEGORICAL: Record<Mode, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
};

/** The fixed slot order. A 6th series is never a generated hue — facet instead. */
export function categorical(mode: Mode): string[] {
  return CATEGORICAL[mode];
}

/** Slot `i`, clamped. Callers should pass a stable per-entity index. */
export function series(mode: Mode, i: number): string {
  const slots = CATEGORICAL[mode];
  return slots[Math.min(Math.max(i, 0), slots.length - 1)];
}

// Stable entity→slot maps. Colour follows the entity, never its rank, so
// deselecting one player in a comparison never repaints the others.
export const POSITION_ORDER = ["Forward", "Midfielder", "Defender", "Goalkeeper"] as const;
export const AGE_ORDER = ["U18", "18-24", "25+"] as const;

export function posSlot(position: string | null | undefined): number {
  const i = POSITION_ORDER.indexOf((position ?? "") as (typeof POSITION_ORDER)[number]);
  return i === -1 ? CATEGORICAL.light.length - 1 : i;
}

export function ageSlot(range: string | null | undefined): number {
  const i = AGE_ORDER.indexOf((range ?? "") as (typeof AGE_ORDER)[number]);
  return i === -1 ? CATEGORICAL.light.length - 1 : i;
}

export function posColor(mode: Mode, position: string | null | undefined): string {
  return series(mode, posSlot(position));
}

export function ageColor(mode: Mode, range: string | null | undefined): string {
  return series(mode, ageSlot(range));
}

// ── Status ────────────────────────────────────────────────────────────────────
// Fixed, never themed. Always paired with an icon or label — never colour alone.
export const STATUS = {
  good:     "#0ca30c",
  warning:  "#fab219",
  serious:  "#ec835a",
  critical: "#d03b3b",
} as const;

export type StatusRole = keyof typeof STATUS;

/** Tailwind text classes for the same roles, for non-chart chrome. */
export const STATUS_TEXT: Record<StatusRole, string> = {
  good:     "text-[#0ca30c]",
  warning:  "text-[#b07d00]",   // stepped down so it stays legible on white
  serious:  "text-[#c25a2f]",
  critical: "text-[#d03b3b]",
};

// ── Sequential ────────────────────────────────────────────────────────────────
// One hue, light→dark, for continuous magnitude and ordinal tier ramps.
export const SEQUENTIAL_BLUE = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
  "#184f95", "#104281", "#0d366b",
] as const;

/**
 * Step an ordinal ramp of `count` items. `--ordinal` requires the step nearest
 * the surface to clear 2:1, so we start at index 3 on light and stop before the
 * darkest steps on dark.
 */
export function ordinal(mode: Mode, count: number, i: number): string {
  const lo = mode === "light" ? 3 : 0;
  const hi = mode === "light" ? SEQUENTIAL_BLUE.length - 1 : 10;
  if (count <= 1) return SEQUENTIAL_BLUE[Math.round((lo + hi) / 2)];
  const t = Math.min(Math.max(i, 0), count - 1) / (count - 1);
  return SEQUENTIAL_BLUE[Math.round(lo + t * (hi - lo))];
}

// ── Ink ───────────────────────────────────────────────────────────────────────
// Replaces the `isDark ? … : …` chart-chrome block that was copy-pasted into
// Analytics, PlayerDetail and AttendanceCard.
export interface Ink {
  primary: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  surface: string;
}

const INK_BY_MODE: Record<Mode, Ink> = {
  light: {
    primary: "#0f172a",
    secondary: "#475569",
    muted: "#94a3b8",
    grid: "rgba(0,0,0,0.07)",
    axis: "#9ca3af",
    tooltipBg: "#ffffff",
    tooltipBorder: "#e2e8f0",
    surface: "#ffffff",
  },
  dark: {
    primary: "#f1f5f9",
    secondary: "#cbd5e1",
    muted: "#64748b",
    grid: "rgba(255,255,255,0.05)",
    axis: "#6b7280",
    tooltipBg: "#0f172a",
    tooltipBorder: "#1e293b",
    surface: "#12161f",
  },
};

export function ink(mode: Mode): Ink {
  return INK_BY_MODE[mode];
}

/** The one highlight hue — links, buttons, active states, single-series lines. */
export const HIGHLIGHT = "#6366f1";
