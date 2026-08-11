import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import {
  fetchAllMatchStats, fetchAllMatches, fetchAllPenaltyKicks, fetchPlayers,
  fetchTournamentFinishes, fetchTournaments,
} from "@/lib/queries";
import { fetchOpponents } from "@/lib/opponents";
import { formatDateLong } from "@/lib/attendance";
import {
  matchesInScope, scopeFromParams, scopeSubject, type OverviewScope,
} from "@/lib/scope";
import { buildScopedReport, buildTournamentTrend, type ScopedReport } from "@/lib/tournamentAnalytics";
import { TournamentReportPage } from "@/components/report/TournamentReportPage";

/**
 * The print-ready report, at `/reports/tournament?…`.
 *
 * Prints whatever the Overview tab was showing: `scopeFromParams` is the single
 * definition of that query string, so a report can only ever cover a selection
 * the tab could make. With no params at all, the most recently played tournament
 * is reported — what a bare `/reports/tournament` has always meant.
 *
 * Mechanism follows the player report exactly: rendered outside the app chrome,
 * the document title seeds the browser's "Save as PDF" filename, dark mode is
 * forced off while this route is mounted, and the print dialog opens once the
 * pages have actually painted.
 */
export default function TournamentReport() {
  const [params] = useSearchParams();
  const { scope: requested, squadId } = useMemo(() => scopeFromParams(params), [params]);

  const [report, setReport] = useState<ScopedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printedRef = useRef(false);

  // A dark report would waste ink and read badly on paper, so force light while
  // this route is mounted and restore the user's choice on the way out.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  // Browsers seed the "Save as PDF" filename from the document title
  useEffect(() => {
    const previous = document.title;
    document.title = report ? `${report.subject.title} — report` : "Report";
    return () => { document.title = previous; };
  }, [report]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Every scope needs matches from more than one competition to resolve —
        // an opponent spans all of them — so this reads the same parent set the
        // Overview does rather than three near-identical targeted queries.
        const [tournaments, matches, stats, players, opponents, kicks, finishes] = await Promise.all([
          fetchTournaments(),
          fetchAllMatches(),
          fetchAllMatchStats(),
          fetchPlayers(),
          fetchOpponents(),
          fetchAllPenaltyKicks(),
          fetchTournamentFinishes(),
        ]);
        if (cancelled) return;

        const scope: OverviewScope | null = requested ?? latestPlayed(tournaments, matches, finishes);
        if (!scope) {
          setError("Nothing has been played yet, so there's nothing to report on.");
          return;
        }

        const tournamentsById = new Map(tournaments.map((t) => [t.id, t] as const));
        const subject = scopeSubject(scope, {
          tournament: scope.kind === "tournament" ? tournamentsById.get(scope.id) ?? null : null,
          opponent: scope.kind === "opponent" ? opponents.find((o) => o.id === scope.id) ?? null : null,
        });
        if (scope.kind === "tournament" && !subject.tournament) {
          setError("That tournament no longer exists.");
          return;
        }
        if (scope.kind === "opponent" && !subject.opponent) {
          setError("That opponent no longer exists.");
          return;
        }

        const scoped = matchesInScope(scope, matches);
        const ids = new Set(scoped.map((m) => m.id));
        setReport(
          buildScopedReport(
            subject,
            scoped,
            stats.filter((s) => s.matches && ids.has(s.matches.id)),
            players,
            kicks,
            tournamentsById,
          ),
        );
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [requested]);

  /**
   * The combined roll-up first, then one page per squad — unless a squad was
   * asked for, in which case that page is the whole report.
   */
  const pages = useMemo(() => {
    if (!report) return [];
    if (squadId) {
      const only = report.bySquad.find((s) => s.squadId === squadId);
      if (only) return [only];
    }
    return [report.overall, ...report.bySquad];
  }, [report, squadId]);

  // Open the print dialog once, after the pages have actually painted
  useEffect(() => {
    if (loading || error || pages.length === 0 || printedRef.current) return;
    printedRef.current = true;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(id);
  }, [loading, error, pages.length]);

  const generatedAt = formatDateLong(new Date().toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* Toolbar — never reaches paper */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 flex-wrap">
        <a
          href={`${import.meta.env.BASE_URL}tournaments`.replace(/\/\//g, "/")}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Tournaments
        </a>
        <div className="text-sm text-slate-600">
          {loading ? "Loading…" : report?.subject.title ?? "Nothing to report on"}
          {pages.length > 1 && <span className="text-slate-400"> · {pages.length} pages</span>}
        </div>
        <button
          onClick={() => window.print()}
          disabled={loading || pages.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          data-testid="button-print-tournament-report"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="py-6 print:py-0">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <RefreshCw size={20} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="text-center py-24 text-sm text-status-bad">Failed to load the report: {error}</p>
        ) : (
          report && pages.map((squad) => (
            <TournamentReportPage
              key={squad.squadId ?? "all"}
              report={report}
              squad={squad}
              generatedAt={generatedAt}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * The most recently played tournament — the same one the Overview features, and
 * chosen the same way: `buildTournamentTrend` drops entries with no result, so
 * its last point is the latest tournament actually played. A scheduled entry with
 * no scores can't win it.
 */
function latestPlayed(
  ...args: Parameters<typeof buildTournamentTrend>
): OverviewScope | null {
  const trend = buildTournamentTrend(...args);
  const latestId = trend[trend.length - 1]?.tournamentId;
  return latestId ? { kind: "tournament", id: latestId } : null;
}
