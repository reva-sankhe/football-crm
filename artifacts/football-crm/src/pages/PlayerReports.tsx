import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import {
  fetchAllAttendanceStats, fetchAllMatchStats, fetchAllResults,
  fetchAllRPEWithSessions, fetchPlayers, fetchTrainingSessions,
} from "@/lib/queries";
import { buildPlayerReport, type ReportData, type ReportRange } from "@/lib/report";
import { formatDateLong } from "@/lib/attendance";
import { formatDateRange } from "@/lib/tournaments";
import { ReportPage } from "@/components/report/ReportPage";
import type { Player } from "@/lib/types";

export default function PlayerReports() {
  const [params] = useSearchParams();
  const idsParam = params.get("ids") ?? "all";
  const from = params.get("from");
  const to = params.get("to");

  const range: ReportRange | null = from && to ? { from, to } : null;

  const [players, setPlayers] = useState<Player[]>([]);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printedRef = useRef(false);

  // Browsers seed the "Save as PDF" filename from the document title, so this
  // is what names the downloaded file.
  useEffect(() => {
    const previous = document.title;
    document.title = "Player report";
    return () => { document.title = previous; };
  }, []);

  // A dark report would waste ink and read badly on paper, so force light
  // while this route is mounted and restore the user's choice on the way out.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  // Six batch queries regardless of how many players were selected — the
  // per-player profile queries would be ~7 requests each.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchPlayers(),
      fetchTrainingSessions(),
      fetchAllAttendanceStats(),
      fetchAllResults(),
      fetchAllRPEWithSessions(),
      fetchAllMatchStats(),
    ])
      .then(([ps, sessions, attendance, results, rpe, matchStats]) => {
        if (cancelled) return;
        setPlayers(ps);
        setData({
          sessions,
          attendance: attendance as ReportData["attendance"],
          results: results as ReportData["results"],
          rpe: rpe as ReportData["rpe"],
          matchStats,
        });
      })
      .catch((err) => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const reports = useMemo(() => {
    if (!data) return [];
    const wanted = idsParam === "all" ? null : new Set(idsParam.split(",").filter(Boolean));
    // "Report all" means the active squad. An explicit selection is honoured
    // as-is, so an inactive player can still be reported on deliberately.
    const selected = wanted
      ? players.filter((p) => wanted.has(p.id))
      : players.filter((p) => p.is_active);
    return [...selected]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => buildPlayerReport(p, data, range));
  }, [players, data, idsParam, range]);

  // Open the print dialog once, after the reports have actually painted
  useEffect(() => {
    if (loading || error || reports.length === 0 || printedRef.current) return;
    printedRef.current = true;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(id);
  }, [loading, error, reports.length]);

  const generatedAt = formatDateLong(new Date().toISOString().slice(0, 10));
  const rangeLabel = range ? formatDateRange(range.from, range.to) : "All time";

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* Toolbar — never reaches paper */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 flex-wrap">
        <a href={`${import.meta.env.BASE_URL}players`.replace(/\/\//g, "/")} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors">
          <ArrowLeft size={14} /> Players
        </a>
        <div className="text-sm text-slate-600">
          {loading ? "Loading…" : `${reports.length} player${reports.length !== 1 ? "s" : ""}`}
          <span className="text-slate-400"> · {rangeLabel}</span>
        </div>
        <button
          onClick={() => window.print()}
          disabled={loading || reports.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          data-testid="button-print-report"
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
          <p className="text-center py-24 text-sm text-status-bad">Failed to load report data: {error}</p>
        ) : reports.length === 0 ? (
          <p className="text-center py-24 text-sm text-slate-500">
            No players matched this report. Go back and select at least one.
          </p>
        ) : (
          reports.map((r) => <ReportPage key={r.player.id} report={r} generatedAt={generatedAt} />)
        )}
      </div>
    </div>
  );
}
