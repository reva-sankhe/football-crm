import { formatDateRange } from "./tournaments";
import type { Match, Opponent, Tournament } from "./types";

/**
 * What a set of results is being read as — the one selection the Tournaments →
 * Overview tab and the printed report both work from.
 *
 * Deliberately one thing at a time rather than a stack of combinable filters: a
 * competition and an opponent answer different questions ("how did we do there"
 * against "how do we stand against them"), and a screen that quietly ANDs the
 * two shows a slice nobody asked for. The squad is the exception — it narrows
 * whichever scope is selected, and only exists where the matches in scope were
 * actually played by more than one squad.
 *
 * Serialising lives here too, so the tab's Download button and the report route
 * can never disagree about what `?opponent=…` means.
 */
export type OverviewScope =
  | { kind: "tournament"; id: string }
  | { kind: "friendlies" }
  | { kind: "opponent"; id: string };

/** The subset of a match any scope test needs. */
type ScopableMatch = Pick<Match, "tournament_id" | "opponent_id" | "squad_id">;

export function matchesInScope<T extends ScopableMatch>(
  scope: OverviewScope,
  matches: T[],
  squadId: string | null = null,
): T[] {
  const inScope = matches.filter((m) => {
    switch (scope.kind) {
      case "tournament": return m.tournament_id === scope.id;
      // A friendly is defined by belonging to no competition
      case "friendlies": return m.tournament_id === null;
      case "opponent": return m.opponent_id === scope.id;
    }
  });
  return squadId ? inScope.filter((m) => m.squad_id === squadId) : inScope;
}

/** The squads that actually played the matches in view, in the order they appear. */
export function squadsInScope<T extends Pick<Match, "squad_id"> & { squads: { id: string; name: string } | null }>(
  matches: T[],
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const m of matches) {
    if (m.squad_id && !seen.has(m.squad_id)) seen.set(m.squad_id, m.squads?.name ?? "Unnamed squad");
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ── Us, filed as an opponent ──────────────────────────────────────────────────
/**
 * The squad names on record, lowercased.
 *
 * Entering two squads in one tournament means they can be drawn against each
 * other, and that fixture needs an opponent row — so our own squads end up in
 * the `opponents` table and in `v_opponent_h2h` alongside real clubs. Nothing on
 * the row says so; the name is what identifies it, matched against the squads
 * that actually played.
 */
export function ownSquadNames(matches: { squads: { name: string } | null }[]): Set<string> {
  const names = new Set<string>();
  for (const m of matches) {
    if (m.squads?.name) names.add(m.squads.name.trim().toLowerCase());
  }
  return names;
}

/**
 * Head-to-head rows for other clubs only. Beating ourselves is not a record
 * against anyone, and in the chart it would look like one.
 */
export function withoutOwnSquads<T extends { opponent_name: string }>(
  rows: T[],
  own: Set<string>,
): T[] {
  return rows.filter((r) => !own.has(r.opponent_name.trim().toLowerCase()));
}

// ── What the scope is called ──────────────────────────────────────────────────
/**
 * The scope as a heading — what the tab shows above the cards and what the
 * report prints on its first line.
 */
export interface ScopeSubject {
  kind: OverviewScope["kind"];
  /** "RSC International Soccer 7s 2026", "Friendlies", "vs Galaxi Girls". */
  title: string;
  /** Dates and format, or what the scope spans. Null when there's nothing to add. */
  subtitle: string | null;
  /** Set on a tournament scope only — the podium and the finish badge need it. */
  tournament: Tournament | null;
  opponent: Opponent | null;
}

export function scopeSubject(
  scope: OverviewScope,
  { tournament, opponent }: { tournament?: Tournament | null; opponent?: Opponent | null } = {},
): ScopeSubject {
  switch (scope.kind) {
    case "tournament":
      return {
        kind: "tournament",
        title: tournament?.name ?? "Unknown tournament",
        subtitle: tournament
          ? [formatDateRange(tournament.start_date, tournament.end_date) ?? "Undated", tournament.format]
              .filter(Boolean).join(" · ")
          : null,
        tournament: tournament ?? null,
        opponent: null,
      };
    case "friendlies":
      return {
        kind: "friendlies",
        title: "Friendlies",
        subtitle: "Matches that belong to no tournament",
        tournament: null,
        opponent: null,
      };
    case "opponent":
      return {
        kind: "opponent",
        title: opponent ? `vs ${opponent.name}` : "vs unknown opponent",
        subtitle: "Every competition",
        tournament: null,
        opponent: opponent ?? null,
      };
  }
}

// ── The query string ──────────────────────────────────────────────────────────
/**
 * A scope as report URL params, and back.
 *
 * `id` stays the tournament's parameter so report links saved before friendlies
 * and opponents existed still open the tournament they named.
 */
export function scopeToParams(scope: OverviewScope, squadId: string | null = null): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.kind === "tournament") params.set("id", scope.id);
  else if (scope.kind === "friendlies") params.set("scope", "friendlies");
  else params.set("opponent", scope.id);
  if (squadId) params.set("squad", squadId);
  return params;
}

/**
 * null when nothing was asked for — the report route reads that as "the latest
 * tournament played", which is what a bare /reports/tournament used to mean.
 */
export function scopeFromParams(params: URLSearchParams): { scope: OverviewScope | null; squadId: string | null } {
  const squadId = params.get("squad");
  const id = params.get("id");
  const opponent = params.get("opponent");

  if (id) return { scope: { kind: "tournament", id }, squadId };
  if (opponent) return { scope: { kind: "opponent", id: opponent }, squadId };
  if (params.get("scope") === "friendlies") return { scope: { kind: "friendlies" }, squadId };
  return { scope: null, squadId };
}

/** The scope as a select value, and back — `<option value>` holds a string. */
export function scopeToValue(scope: OverviewScope): string {
  return scope.kind === "friendlies" ? "friendlies" : `${scope.kind}:${scope.id}`;
}

export function scopeFromValue(value: string): OverviewScope | null {
  if (value === "friendlies") return { kind: "friendlies" };
  const [kind, id] = value.split(":");
  if (!id) return null;
  if (kind === "tournament") return { kind: "tournament", id };
  if (kind === "opponent") return { kind: "opponent", id };
  return null;
}
