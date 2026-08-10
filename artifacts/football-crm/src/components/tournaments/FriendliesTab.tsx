import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Handshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AddButton } from "@/components/AddButton";
import { CountPill, SearchInput } from "@/components/Toolbar";
import { fetchStandaloneMatches } from "@/lib/queries";
import { RESULT_CFG, matchResult, tournamentRecord } from "@/lib/tournaments";
import { formatShootout } from "@/lib/lineup";
import { formatRecord, goalDifference } from "@/lib/opponents";
import { formatDateShort } from "@/lib/attendance";
import { MatchFormModal } from "@/components/tournaments/MatchFormModal";
import type { MatchWithSession } from "@/lib/types";

/**
 * Standalone matches — the ones with no tournament. Deliberately plainer than
 * the tournament grid: a friendly has no bracket, no squad and no format, so the
 * list is a chronological archive rather than a set of cards.
 */
export function FriendliesTab() {
  const { toast } = useToast();
  const [matches, setMatches] = useState<MatchWithSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMatches(await fetchStandaloneMatches());
    } catch (err) {
      toast({ title: "Failed to load friendlies", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) => (m.opponents?.name ?? "").toLowerCase().includes(q));
  }, [matches, search]);

  // Played fixtures only — tournamentRecord skips anything without a score
  const record = useMemo(() => tournamentRecord(visible), [visible]);
  const gd = goalDifference({ goals_for: record.goalsFor, goals_against: record.goalsAgainst });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by opponent…"
          className="flex-1 max-w-sm"
          data-testid="input-search-friendlies"
        />

        <AddButton label="Add friendly" onClick={() => setShowNew(true)} data-testid="button-new-friendly" />

        <CountPill
          title={`${visible.length} friendl${visible.length !== 1 ? "ies" : "y"} shown`}
          data-testid="text-friendly-count"
        >
          {loading ? "—" : visible.length}
        </CountPill>
      </div>

      {/* Record across the friendlies in view */}
      {!loading && record.played > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground px-1" data-testid="text-friendly-record">
          <span className="font-time text-foreground font-semibold">{formatRecord(record)}</span>
          <span className="font-time">
            {record.goalsFor}–{record.goalsAgainst}
            <span className="ml-1 text-muted-foreground/70">
              ({gd > 0 ? "+" : ""}{gd})
            </span>
          </span>
          <span>from {record.played} played</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Handshake size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          {matches.length === 0 ? (
            <>
              <p className="text-muted-foreground text-sm">No friendlies yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                A friendly is a match that belongs to no tournament.
              </p>
              <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
                Log your first friendly
              </button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">No friendlies match your search</p>
              <button
                onClick={() => setSearch("")}
                className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Clear search
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => {
            const result = matchResult(m);
            const shootout = formatShootout(m);
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-indigo-500/40 transition-colors"
                data-testid={`row-friendly-${m.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">
                    {m.opponents ? `vs ${m.opponents.name}` : "Opponent TBD"}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {m.sessions ? formatDateShort(m.sessions.date) : "—"}
                    {m.sessions && ` · ${m.sessions.duration_mins} min`}
                    {/* A shootout never moves the score, so it reads alongside it */}
                    {shootout && ` · ${shootout}`}
                  </div>
                </div>
                {result ? (
                  <>
                    <span className="font-time font-bold text-foreground text-sm">
                      {m.goals_for}–{m.goals_against}
                    </span>
                    <span className={cn(
                      "w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0",
                      RESULT_CFG[result].bg, RESULT_CFG[result].text,
                    )}>
                      {result}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground shrink-0">Not played</span>
                )}
                <ArrowRight size={13} className="text-muted-foreground shrink-0" />
              </Link>
            );
          })}
        </div>
      )}

      {showNew && (
        <MatchFormModal
          tournament={null}
          squads={[]}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
