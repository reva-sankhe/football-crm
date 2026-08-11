import { scopeToParams, type OverviewScope } from "./scope";

/**
 * Where the printable reports live, and how they're opened.
 *
 * They always open in a new tab: the report route forces light mode and fires
 * the print dialog on mount, so navigating the current tab there would throw the
 * user out of whatever they were doing. `BASE_URL` handling matters because the
 * app is served under a base path in the preview pane.
 *
 * The query string is built by `scopeToParams` rather than assembled here, so
 * the Download button and the report route are reading one definition of what a
 * scope looks like in a URL.
 */
function base(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

/** The print-ready report for whatever is currently in scope. */
export function reportUrl(scope: OverviewScope, squadId: string | null = null): string {
  return `${base()}/reports/tournament?${scopeToParams(scope, squadId)}`;
}

/** One whole tournament — what the tournament list and a tournament page link to. */
export function tournamentReportUrl(tournamentId: string): string {
  return reportUrl({ kind: "tournament", id: tournamentId });
}

export function openReport(url: string): void {
  window.open(url, "_blank", "noopener");
}
