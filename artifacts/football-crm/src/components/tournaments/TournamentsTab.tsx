import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarRange, MapPin, Plus, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchMatchCountsByTournament, fetchTournaments } from "@/lib/queries";
import { formatDateRange } from "@/lib/tournaments";
import { TournamentFormModal } from "@/components/tournaments/TournamentFormModal";
import type { Tournament } from "@/lib/types";

export function TournamentsTab() {
  const { toast } = useToast();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, counts] = await Promise.all([fetchTournaments(), fetchMatchCountsByTournament()]);
      setTournaments(list);
      setMatchCounts(counts);
    } catch (err) {
      toast({ title: "Failed to load tournaments", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Competitions, squads and match results
        </p>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold shrink-0"
          data-testid="button-new-tournament"
        >
          <Plus size={15} />
          New Tournament
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl h-32 animate-pulse" />
          ))}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Trophy size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">No tournaments yet</p>
          <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
            Create your first tournament →
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((t) => {
            const range = formatDateRange(t.start_date, t.end_date);
            const count = matchCounts[t.id] ?? 0;
            return (
              <Link
                key={t.id}
                href={`/tournaments/${t.id}`}
                className="block bg-card border border-border rounded-2xl p-4 hover:border-indigo-500/40 transition-colors"
                data-testid={`card-tournament-${t.id}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{t.name}</div>
                  {range && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <CalendarRange size={10} /> {range}
                    </div>
                  )}
                  {t.location && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                      <MapPin size={10} className="shrink-0" /> {t.location}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
                  <span className="font-time">{count} match{count !== 1 ? "es" : ""}</span>
                  <span className="font-time">{t.default_match_mins} min default</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showNew && (
        <TournamentFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
