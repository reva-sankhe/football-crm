import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Check, Download, SlidersHorizontal, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AddButton } from "@/components/AddButton";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { FinishBadge } from "@/components/Badges";
import { CountPill, IconButton, SearchInput, TOOLBAR_MENU, TOOLBAR_SELECT } from "@/components/Toolbar";
import {
  fetchMatchCountsByTournament, fetchTournamentFinishes, fetchTournaments,
} from "@/lib/queries";
import { MATCH_FORMATS, formatDateRange, type TournamentFinish } from "@/lib/tournaments";
import { openReport, tournamentReportUrl } from "@/lib/reportLinks";
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
  const [, setLocation] = useLocation();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [finishes, setFinishes] = useState<Map<string, TournamentFinish>>(new Map());
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
      const [list, counts, placings] = await Promise.all([
        fetchTournaments(),
        fetchMatchCountsByTournament(),
        fetchTournamentFinishes(),
      ]);
      setTournaments(list);
      setMatchCounts(counts);
      setFinishes(placings);
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

      {/* Same table shell as the Players roster — one type scale across both. */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={5} /></div>
        ) : visible.length === 0 ? (
          tournaments.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No tournaments yet"
              description="Create your first tournament to start logging matches"
            />
          ) : (
            <div className="p-12 text-center">
              <Trophy size={32} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No tournaments match your search</p>
              <button
                onClick={() => { setSearch(""); setFilterFormat(""); setFilterYear(""); }}
                className="mt-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                Clear search and filters
              </button>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="tournaments-table">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pl-4 pr-2 py-2.5 text-left font-medium">Name</th>
                  <th className="px-2 py-2.5 text-left font-medium">Dates</th>
                  <th className="px-2 py-2.5 text-left font-medium">Location</th>
                  <th className="px-2 py-2.5 text-left font-medium">Format</th>
                  <th className="px-2 py-2.5 text-right font-medium">Matches</th>
                  <th className="px-2 py-2.5 text-left font-medium">Finish</th>
                  <th className="px-2 py-2.5 w-8"></th>
                  <th className="pr-4 pl-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const range = formatDateRange(t.start_date, t.end_date);
                  const finish = finishes.get(t.id);
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setLocation(`/tournaments/${t.id}`)}
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      data-testid={`row-tournament-${t.id}`}
                    >
                      <td className="pl-4 pr-2 py-2.5 font-medium text-foreground">{t.name}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{range ?? "—"}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{t.location ?? "—"}</td>
                      <td className="px-2 py-2.5 text-muted-foreground">{t.format ?? "—"}</td>
                      <td className="px-2 py-2.5 text-right text-muted-foreground font-time">
                        {matchCounts[t.id] ?? 0}
                      </td>
                      <td className="px-2 py-2.5">
                        {finish ? <FinishBadge finish={finish} /> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {/* Inside a clickable row, so the navigation has to be suppressed */}
                        <button
                          onClick={(e) => { e.stopPropagation(); openReport(tournamentReportUrl(t.id)); }}
                          aria-label={`Download report for ${t.name}`}
                          title="Download report"
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          data-testid={`button-download-report-${t.id}`}
                        >
                          <Download size={13} />
                        </button>
                      </td>
                      <td className="pr-4 pl-2 py-2.5 text-right">
                        <ArrowRight size={13} className="text-muted-foreground inline" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <TournamentFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
