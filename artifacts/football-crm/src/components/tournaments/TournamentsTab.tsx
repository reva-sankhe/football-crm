import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CalendarRange, Check, MapPin, SlidersHorizontal, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AddButton } from "@/components/AddButton";
import { CountPill, IconButton, SearchInput, TOOLBAR_MENU, TOOLBAR_SELECT } from "@/components/Toolbar";
import { fetchMatchCountsByTournament, fetchTournaments } from "@/lib/queries";
import { MATCH_FORMATS, formatDateRange } from "@/lib/tournaments";
import { TournamentFormModal } from "@/components/tournaments/TournamentFormModal";
import type { Tournament } from "@/lib/types";

type SortKey = "latest" | "name" | "format";

const SORT_LABELS: Record<SortKey, string> = {
  latest: "Latest",
  name: "Name",
  format: "Format",
};

/** Unset formats sort last rather than jumping to the top as an empty string. */
function formatRank(format: string | null): number {
  const i = MATCH_FORMATS.indexOf(format as (typeof MATCH_FORMATS)[number]);
  return i === -1 ? MATCH_FORMATS.length : i;
}

export function TournamentsTab() {
  const { toast } = useToast();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("latest");
  const [filterFormat, setFilterFormat] = useState("");
  const [filterYear, setFilterYear] = useState("");
  /** Only one popover is open at a time, so one piece of state drives both. */
  const [openMenu, setOpenMenu] = useState<"filters" | "sort" | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

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

  // Dismiss whichever popover is open on an outside click or Escape
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Only offer years that actually have a tournament, newest first
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const t of tournaments) if (t.start_date) set.add(t.start_date.slice(0, 4));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [tournaments]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = tournaments.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (filterFormat && t.format !== filterFormat) return false;
      if (filterYear && t.start_date?.slice(0, 4) !== filterYear) return false;
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "format") return formatRank(a.format) - formatRank(b.format) || a.name.localeCompare(b.name);
      // Latest — undated tournaments sort last, then newest start first
      if (!a.start_date && !b.start_date) return b.created_at.localeCompare(a.created_at);
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return b.start_date.localeCompare(a.start_date);
    });
  }, [tournaments, search, filterFormat, filterYear, sort]);

  const activeFilterCount = (filterFormat ? 1 : 0) + (filterYear ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2" ref={barRef}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search tournaments…"
          className="flex-1 max-w-sm"
          data-testid="input-search-tournaments"
        />

        <div className="relative">
          <IconButton
            label="Sort and filter"
            onClick={() => setOpenMenu((m) => (m === "filters" ? null : "filters"))}
            active={openMenu === "filters" || activeFilterCount > 0 || sort !== "latest"}
            badge={activeFilterCount}
            aria-expanded={openMenu === "filters"}
            data-testid="button-tournament-filters"
          >
            <SlidersHorizontal size={15} />
          </IconButton>

          {openMenu === "filters" && (
            <div className={cn(TOOLBAR_MENU, "space-y-3")} data-testid="tournament-filter-panel">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Sort by</div>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setSort(key)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                      sort === key ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                    data-testid={`button-sort-${key}`}
                  >
                    <Check size={13} className={cn(sort === key ? "text-indigo-400" : "opacity-0")} />
                    {SORT_LABELS[key]}
                  </button>
                ))}
              </div>

              <div className="pt-1 border-t border-border">
                <label className="block text-xs text-muted-foreground mb-1">Format</label>
                <select
                  value={filterFormat}
                  onChange={(e) => setFilterFormat(e.target.value)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-format"
                >
                  <option value="">All formats</option>
                  {MATCH_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Year</label>
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-year"
                >
                  <option value="">All years</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setFilterFormat(""); setFilterYear(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        <AddButton label="Add tournament" onClick={() => setShowNew(true)} data-testid="button-new-tournament" />

        <CountPill
          title={`${visible.length} tournament${visible.length !== 1 ? "s" : ""} shown`}
          data-testid="text-tournament-count"
        >
          {loading ? "—" : visible.length}
        </CountPill>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl h-32 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Trophy size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          {tournaments.length === 0 ? (
            <>
              <p className="text-muted-foreground text-sm">No tournaments yet</p>
              <button onClick={() => setShowNew(true)} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
                Create your first tournament
              </button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">No tournaments match your search</p>
              <button
                onClick={() => { setSearch(""); setFilterFormat(""); setFilterYear(""); }}
                className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Clear search and filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t) => {
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
                  {t.format && <span className="font-time">{t.format}</span>}
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
