import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { HIGHLIGHT, ink, series, type Mode } from "@/lib/viz";
import { formatDateShort } from "@/lib/attendance";
import { RESULT_CFG, matchOutcome } from "@/lib/tournaments";
import { fetchOpponentH2H, fetchOpponents, goalDifference } from "@/lib/opponents";
import {
  fetchAllMatchStats, fetchAllMatches, fetchAllPenaltyKicks, fetchPlayers,
  fetchTournamentFinishes, fetchTournaments,
  type MatchWithTournament, type PlayerMatchStat,
} from "@/lib/queries";
import {
  buildFormSummary, buildScopedReport, buildTournamentTrend,
  interpretGoalkeeping, interpretGoals, interpretOpponentHistory, interpretOpponents,
  interpretRotation, interpretTrend,
  type PlayerLine, type SquadReport,
} from "@/lib/tournamentAnalytics";
import {
  matchesInScope, ownSquadNames, scopeFromValue, scopeSubject, scopeToValue, squadsInScope,
  withoutOwnSquads, type OverviewScope,
} from "@/lib/scope";
import { openReport, reportUrl } from "@/lib/reportLinks";
import { MiniTable, OverviewCard, tooltipStyle } from "@/components/OverviewCard";
import { FinishBadge } from "@/components/Badges";
import type { MatchPenaltyKick, Opponent, OpponentH2H, Player, Tournament } from "@/lib/types";
import type { TournamentFinish } from "@/lib/tournaments";

/**
 * Tournaments → Overview: what the results actually say.
 *
 * Built as the same object as Players → Overview — a chart, and underneath it
 * the reading of what that chart shows. The interpretation is the point; a
 * table of figures you already have on the tournament page is not analytics.
 *
 * One parent fetch feeds every card, the way `Players()` feeds both of its tabs,
 * so no two blocks can describe different data. Everything is sliced from it by
 * one scope — a tournament, the friendlies, or an opponent — and then optionally
 * by squad, which appears only where the matches in scope were played by more
 * than one. See lib/scope.ts for why that's one selection rather than a stack of
 * combinable filters.
 *
 * The trend is all-time by design and says so. Head-to-head figures come from
 * the `v_opponent_h2h` SQL view and are never recomputed here — that view counts
 * goals only, so a knockout won on penalties is a draw in that card and a win
 * everywhere else. That divergence is deliberate and is called out on screen.
 */
/** What every card says when the selection holds no matches — friendlies, mostly. */
const NOTHING_IN_SCOPE = "Nothing played in this selection yet.";

/** The three ways a goal is scored, in fixed order — bar order and colour slot. */
const ROUTES = ["Open play", "Free kicks", "Penalties"] as const;
type Route = (typeof ROUTES)[number];

const ROUTE_KEY: Record<Route, "open" | "fk" | "pen"> = {
  "Open play": "open",
  "Free kicks": "fk",
  Penalties: "pen",
};

export function OverviewTab() {
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);
  const tip = tooltipStyle(INK);
  const { toast } = useToast();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matches, setMatches] = useState<MatchWithTournament[]>([]);
  const [stats, setStats] = useState<PlayerMatchStat[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [finishes, setFinishes] = useState<Map<string, TournamentFinish>>(new Map());
  const [h2h, setH2h] = useState<OpponentH2H[]>([]);
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [kicks, setKicks] = useState<MatchPenaltyKick[]>([]);
  const [loading, setLoading] = useState(true);

  /** null means the latest tournament played — resolved once the trend is in. */
  const [picked, setPicked] = useState<OverviewScope | null>(null);
  /** "all", or a squad id, when the matches in scope span more than one squad. */
  const [squadFilter, setSquadFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ts, ms, st, ps, fs, hh, os, ks] = await Promise.all([
        fetchTournaments(),
        fetchAllMatches(),
        fetchAllMatchStats(),
        fetchPlayers(),
        fetchTournamentFinishes(),
        fetchOpponentH2H(),
        fetchOpponents(),
        fetchAllPenaltyKicks(),
      ]);
      setTournaments(ts);
      setMatches(ms);
      setStats(st);
      setPlayers(ps);
      setFinishes(fs);
      setH2h(hh);
      setOpponents(os);
      setKicks(ks);
    } catch (err) {
      toast({ title: "Failed to load analytics", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const trend = useMemo(
    () => buildTournamentTrend(tournaments, matches, finishes),
    [tournaments, matches, finishes],
  );

  const tournamentsById = useMemo(
    () => new Map(tournaments.map((t) => [t.id, t] as const)),
    [tournaments],
  );

  /** What the cards report on: the picked scope, else the latest tournament played. */
  const scope: OverviewScope | null = useMemo(() => {
    if (picked) return picked;
    const latest = trend[trend.length - 1]?.tournamentId;
    return latest ? { kind: "tournament", id: latest } : null;
  }, [picked, trend]);

  const subject = useMemo(() => {
    if (!scope) return null;
    return scopeSubject(scope, {
      tournament: scope.kind === "tournament" ? tournamentsById.get(scope.id) ?? null : null,
      opponent: scope.kind === "opponent" ? opponents.find((o) => o.id === scope.id) ?? null : null,
    });
  }, [scope, tournamentsById, opponents]);

  const scoped = useMemo(
    () => (scope ? matchesInScope(scope, matches) : []),
    [scope, matches],
  );

  /** Squad pills only exist where the matches in scope were played by more than one. */
  const squads = useMemo(() => squadsInScope(scoped), [scoped]);

  // A squad belongs to one tournament, so a selection can't survive a scope change
  useEffect(() => { setSquadFilter("all"); }, [scope]);

  const report = useMemo(() => {
    if (!subject) return null;
    const ids = new Set(scoped.map((m) => m.id));
    return buildScopedReport(
      subject,
      scoped,
      stats.filter((s) => s.matches && ids.has(s.matches.id)),
      players,
      kicks,
      tournamentsById,
    );
  }, [subject, scoped, stats, players, kicks, tournamentsById]);

  /** The slice the scoped cards read — everything in scope, or the chosen squad. */
  const squad: SquadReport | null = useMemo(() => {
    if (!report) return null;
    if (squadFilter === "all") return report.overall;
    return report.bySquad.find((s) => s.squadId === squadFilter) ?? report.overall;
  }, [report, squadFilter]);

  /** Form follows the scope: against an opponent, that reads as the last meetings. */
  const form = useMemo(() => buildFormSummary(squad?.matches ?? []), [squad]);

  /** Who scored the goals on each bar, most first — what the hover reads. */
  const scorersByRoute = useMemo(() => {
    const of = (goalsOf: (l: PlayerLine) => number) =>
      (squad?.topScorers ?? [])
        .map((l) => ({ name: l.player.name, goals: goalsOf(l) }))
        .filter((s) => s.goals > 0)
        .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
    return {
      "Open play": of((l) => l.goalsOpen),
      "Free kicks": of((l) => l.goalsFk),
      Penalties: of((l) => l.goalsPen),
    } as Record<string, { name: string; goals: number }[]>;
  }, [squad]);

  /** Goals on a scoreline that nobody was credited with — the per-player split is short by these. */
  const unattributed = useMemo(() => {
    if (!squad) return 0;
    const { open, fk, pen } = squad.goalMethods;
    return Math.max(0, squad.record.goalsFor - (open + fk + pen));
  }, [squad]);

  /**
   * Head-to-head against other clubs. Our own squads are filed as opponents so
   * they can be drawn against each other, but that fixture is not a record
   * against anyone — see `ownSquadNames`.
   */
  const rivals = useMemo(
    () => withoutOwnSquads(h2h, ownSquadNames(matches)),
    [h2h, matches],
  );
  const ownSquadRows = h2h.length - rivals.length;

  /** Sorted once so the bars and their colour cells can't fall out of step. */
  const h2hBars = useMemo(
    () => rivals
      .filter((r) => r.played > 0)
      .map((r) => ({ name: r.opponent_name, gd: goalDifference(r), played: r.played }))
      .sort((a, b) => b.gd - a.gd),
    [rivals],
  );

  /** Only teams we've actually played are worth offering as a scope. */
  const playedOpponents = useMemo(
    () => rivals.filter((r) => r.played > 0).sort((a, b) => a.opponent_name.localeCompare(b.opponent_name)),
    [rivals],
  );

  /** The h2h row for the opponent in scope — what the card narrows to. */
  const scopedOpponent = useMemo(
    () => (scope?.kind === "opponent" ? h2h.find((r) => r.opponent_id === scope.id) ?? null : null),
    [scope, h2h],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl h-24 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-card border border-border rounded-2xl h-72 animate-pulse" />
          <div className="bg-card border border-border rounded-2xl h-72 animate-pulse lg:col-span-2" />
        </div>
        <div className="bg-card border border-border rounded-2xl h-72 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── What the cards are reporting on ────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Reporting on
          </div>
          <div className="flex items-center gap-2 mt-1">
            {!subject ? (
              <span className="text-base font-semibold text-muted-foreground">Nothing played yet</span>
            ) : subject.tournament ? (
              <Link
                href={`/tournaments/${subject.tournament.id}`}
                className="text-base font-semibold text-foreground hover:text-indigo-400 transition-colors"
              >
                {subject.title}
              </Link>
            ) : (
              // Friendlies and opponents have no page of their own to link to
              <span className="text-base font-semibold text-foreground">{subject.title}</span>
            )}
            {/* The bracket badge belongs to a tournament; an opponent scope has no placing */}
            {subject?.tournament && finishes.get(subject.tournament.id) && (
              <FinishBadge finish={finishes.get(subject.tournament.id)!} />
            )}
          </div>
          {subject && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {subject.subtitle}
              {` · ${squad?.record.played ?? 0} played`}
              {squadFilter !== "all" && squad && ` · ${squad.squadName}`}
            </div>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* One squad's tournament reads differently from the other's, which is
              why they're separable rather than averaged together. They appear
              only where the matches in scope were played by more than one. */}
          {squads.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "all", name: "All squads" }, ...squads].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSquadFilter(s.id)}
                  className={cn(
                    "px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
                    squadFilter === s.id
                      ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`button-overview-squad-${s.id}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {/* One selection, three kinds of thing to select — see lib/scope.ts */}
          <select
            value={scope ? scopeToValue(scope) : ""}
            onChange={(e) => setPicked(scopeFromValue(e.target.value))}
            // Sits in a toolbar row, so it takes the 36px control height rather
            // than TOOLBAR_SELECT's in-menu padding
            className="h-9 bg-muted border border-border rounded-lg px-2.5 text-sm text-foreground max-w-[15rem]"
            aria-label="What to report on"
            data-testid="select-overview-scope"
          >
            {!scope && <option value="">Nothing played yet</option>}
            <optgroup label="Tournaments">
              {tournaments.map((t) => (
                <option key={t.id} value={scopeToValue({ kind: "tournament", id: t.id })}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Friendlies">
              <option value="friendlies">Friendlies</option>
            </optgroup>
            <optgroup label="Opponents">
              {playedOpponents.map((o) => (
                <option key={o.opponent_id} value={scopeToValue({ kind: "opponent", id: o.opponent_id })}>
                  vs {o.opponent_name}
                </option>
              ))}
            </optgroup>
          </select>

          {scope && (
            <button
              onClick={() => openReport(reportUrl(scope, squadFilter === "all" ? null : squadFilter))}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Print or save a report of exactly what's selected"
              data-testid="button-download-latest-report"
            >
              <Download size={13} /> Report
            </button>
          )}
        </div>
      </div>

      {/* ── Form and goals ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <OverviewCard
          title={scope?.kind === "opponent" ? "Last 5 meetings" : "Last 5 games"}
          // Names the squad as well as the scope: with one squad playing the most
          // recent fixtures, its form and the combined form can be the same five
          // games, and a subtitle that didn't say so would look like a dead filter
          subtitle={
            subject
              ? `${subject.title}${squad && squad.squadId ? ` · ${squad.squadName}` : ""}, most recent first`
              : "Most recent first"
          }
          interpretation={form.headline}
        >
          <div className="flex flex-col justify-center h-full py-1">
            <div className="flex items-center gap-1.5" aria-label={`Form, oldest first: ${form.form.join(", ")}`}>
              {form.form.map((r, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold",
                    RESULT_CFG[r].bg, RESULT_CFG[r].text,
                  )}
                  title={RESULT_CFG[r].label}
                >
                  {r}
                </span>
              ))}
              {form.form.length === 0 && <span className="text-sm text-muted-foreground">No results yet</span>}
            </div>

            <div className="mt-4 space-y-1">
              {form.matches.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="flex items-center gap-2 text-[11px] hover:text-indigo-400 transition-colors"
                >
                  <span className="text-muted-foreground w-14 shrink-0 font-time">
                    {m.sessions ? formatDateShort(m.sessions.date) : "—"}
                  </span>
                  <span className="text-foreground truncate flex-1 min-w-0">
                    {m.opponents?.name ?? "TBD"}
                  </span>
                  <span className="font-time font-semibold text-foreground shrink-0">
                    {m.goals_for}–{m.goals_against}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </OverviewCard>

        <OverviewCard
          title="How the goals came"
          subtitle={subject ? `${subject.title} · ${squad?.squadName ?? ""}` : undefined}
          className="lg:col-span-2"
          interpretation={squad ? interpretGoals(squad) : NOTHING_IN_SCOPE}
          table={
            <MiniTable
              head={["Player", "Open", "FK", "Pen", "Goals"]}
              rows={[
                ...(squad?.topScorers ?? []).map((l) => [
                  l.player.name,
                  String(l.goalsOpen), String(l.goalsFk), String(l.goalsPen), String(l.goals),
                ]),
                // The scorelines can hold goals nobody was credited with, and a
                // table that quietly omits them wouldn't add up to the score
                ...(unattributed > 0
                  ? [["No scorer recorded", "—", "—", "—", String(unattributed)]]
                  : []),
              ]}
            />
          }
        >
          <div className="h-56">
            {!squad || squad.record.goalsFor === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No goals recorded</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ROUTES.map((route) => ({ route, goals: squad.goalMethods[ROUTE_KEY[route]] }))}
                  margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="route" tick={{ fill: INK.secondary, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  {/* The bar answers how many; the hover answers who — without it
                      the scorers are only reachable through the Table toggle. */}
                  <Tooltip
                    cursor={{ fill: INK.grid }}
                    content={({ active, label }) => {
                      if (!active || typeof label !== "string") return null;
                      const scorers = scorersByRoute[label] ?? [];
                      const total = squad.goalMethods[ROUTE_KEY[label as Route]] ?? 0;
                      return (
                        <div
                          className="rounded-lg px-2.5 py-2 text-xs"
                          style={{ background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}` }}
                        >
                          <div className="font-semibold" style={{ color: INK.primary }}>
                            {label} · {total} {total === 1 ? "goal" : "goals"}
                          </div>
                          {scorers.length === 0 ? (
                            <div className="mt-1" style={{ color: INK.muted }}>No scorer recorded</div>
                          ) : (
                            <ul className="mt-1 space-y-0.5">
                              {scorers.map((s) => (
                                <li key={s.name} style={{ color: INK.secondary }}>
                                  {s.name} <span className="font-time font-semibold">{s.goals}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {/* The split can't name who scored a goal nobody was credited with */}
                          {label === "Open play" && unattributed > 0 && (
                            <div className="mt-1" style={{ color: INK.muted }}>
                              {unattributed} more on the scorelines with no scorer recorded
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="goals" radius={[4, 4, 0, 0]} maxBarSize={54}>
                    {/* Fixed slot per route, never by rank */}
                    {ROUTES.map((_, i) => <Cell key={i} fill={series(mode, i)} />)}
                    <LabelList
                      dataKey="goals"
                      position="top"
                      offset={6}
                      style={{ fill: INK.secondary, fontSize: 11, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>
      </div>

      {/* ── Goalkeeping and rotation ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewCard
          title="Goalkeeping"
          subtitle={
            squad
              ? `${squad.cleanSheets} clean ${squad.cleanSheets === 1 ? "sheet" : "sheets"} · ${squad.record.goalsAgainst} conceded`
              : undefined
          }
          interpretation={squad ? interpretGoalkeeping(squad) : NOTHING_IN_SCOPE}
          table={
            <MiniTable
              head={["Goalkeeper", "Matches", "Mins", "Conceded", "Clean sheets"]}
              rows={(squad?.keepers ?? []).map((k) => [
                k.player.name,
                String(k.started), String(k.minutes), String(k.conceded), String(k.cleanSheets),
              ])}
            />
          }
        >
          <div className="h-56">
            {!squad || squad.keepers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No goalkeeper on the team sheet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={squad.keepers.map((k) => ({
                    name: k.player.name.split(" ")[0],
                    "Clean sheets": k.cleanSheets,
                    Conceded: k.conceded,
                  }))}
                  margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} cursor={{ fill: INK.grid }} />
                  <Bar dataKey="Clean sheets" fill={series(mode, 0)} radius={[4, 4, 0, 0]} maxBarSize={30}>
                    <LabelList dataKey="Clean sheets" position="top" offset={5} style={{ fill: INK.secondary, fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                  <Bar dataKey="Conceded" fill={series(mode, 1)} radius={[4, 4, 0, 0]} maxBarSize={30}>
                    <LabelList dataKey="Conceded" position="top" offset={5} style={{ fill: INK.secondary, fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>

        <OverviewCard
          title="Minutes & rotation"
          subtitle="Share of the minutes available to each player"
          interpretation={squad ? interpretRotation(squad) : NOTHING_IN_SCOPE}
          table={
            <MiniTable
              head={["Player", "Apps", "Mins", "Share", "Load"]}
              rows={(squad?.players ?? []).map((l) => [
                l.player.name,
                String(l.appearances),
                String(l.minutes),
                l.minutesShare == null ? "—" : `${Math.round(l.minutesShare * 100)}%`,
                `${l.loadAu.toLocaleString()} AU`,
              ])}
            />
          }
        >
          <div className="h-56 overflow-y-auto">
            {!squad || squad.players.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No squad call-ups recorded</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(224, squad.players.length * 20)}>
                <BarChart
                  layout="vertical"
                  data={squad.players.map((l) => ({
                    name: l.player.name,
                    share: l.minutesShare == null ? 0 : Math.round(l.minutesShare * 100),
                    minutes: l.minutes,
                  }))}
                  margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke={INK.grid} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={104}
                    tick={{ fill: INK.secondary, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tip}
                    cursor={{ fill: INK.grid }}
                    formatter={(v: number, _n, item) =>
                      [`${v}% · ${(item?.payload as { minutes: number })?.minutes}′`, "Minutes"]}
                  />
                  <ReferenceLine x={50} stroke={INK.axis} strokeDasharray="4 4" />
                  <Bar dataKey="share" fill={HIGHLIGHT} radius={[0, 3, 3, 0]} maxBarSize={12}>
                    <LabelList
                      dataKey="share"
                      position="right"
                      offset={4}
                      formatter={(v: number) => `${v}%`}
                      style={{ fill: INK.secondary, fontSize: 9 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>
      </div>

      {/* ── Injuries ───────────────────────────────────────────────────────── */}
      {squad && (
        <div className="bg-card border border-border rounded-2xl px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Injuries to monitor</h2>
            <span className="text-[11px] text-muted-foreground">{squad.injuries.length}</span>
          </div>
          {squad.injuries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody picked up a knock in{" "}
              {squad.squadName === "All squads" ? subject?.title ?? "this selection" : squad.squadName}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {squad.injuries.map((i, idx) => (
                <Link
                  key={`${i.player.id}-${idx}`}
                  href={`/players/${i.player.id}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-[11px] hover:border-indigo-500/40 transition-colors"
                >
                  <span className="text-foreground font-medium">{i.player.name}</span>
                  <span className="text-muted-foreground">
                    {i.note ?? "no note"}
                    {i.date && ` · ${formatDateShort(i.date)}`}
                    {i.opponent && ` vs ${i.opponent}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Against the opponent in scope ──────────────────────────────────── */}
      {/* Computed from the matches rather than the h2h view, because it has to
          split by competition — the view is one row per opponent, all time. */}
      {scopedOpponent && squad && report && (
        <OverviewCard
          title={`Against ${scopedOpponent.opponent_name}`}
          subtitle="Every meeting, oldest first · counted the way the bracket does"
          interpretation={interpretOpponentHistory(
            report.byTournament, squad.record, scopedOpponent.opponent_name, squad.shootouts.played,
          )}
          table={
            <MiniTable
              head={report.byTournament.length > 0 ? ["Competition", "Record · goals"] : ["Meeting", "Score"]}
              rows={
                report.byTournament.length > 0
                  ? report.byTournament.map((l) => [
                      l.name,
                      `${l.record.won}W ${l.record.drawn}D ${l.record.lost}L · ${l.record.goalsFor}–${l.record.goalsAgainst}`,
                    ])
                  : squad.matches.map((m) => [
                      m.sessions ? formatDateShort(m.sessions.date) : "Undated",
                      `${m.goals_for ?? "—"}–${m.goals_against ?? "—"} ${matchOutcome(m) ?? ""}`,
                    ])
              }
            />
          }
        >
          <div className="h-56">
            {squad.record.played === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No played meetings yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...squad.matches]
                    .filter((m) => m.goals_for != null && m.goals_against != null)
                    .sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""))
                    .map((m) => ({
                      name: m.sessions ? formatDateShort(m.sessions.date) : "—",
                      competition: m.tournament_id
                        ? tournamentsById.get(m.tournament_id)?.name ?? "Tournament"
                        : "Friendly",
                      Scored: m.goals_for ?? 0,
                      Conceded: m.goals_against ?? 0,
                    }))}
                  margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    {...tip}
                    cursor={{ fill: INK.grid }}
                    labelFormatter={(label, payload) =>
                      `${label} · ${(payload?.[0]?.payload as { competition: string })?.competition ?? ""}`}
                  />
                  <Bar dataKey="Scored" fill={series(mode, 0)} radius={[4, 4, 0, 0]} maxBarSize={30}>
                    <LabelList dataKey="Scored" position="top" offset={5} style={{ fill: INK.secondary, fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                  <Bar dataKey="Conceded" fill={series(mode, 1)} radius={[4, 4, 0, 0]} maxBarSize={30}>
                    <LabelList dataKey="Conceded" position="top" offset={5} style={{ fill: INK.secondary, fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </OverviewCard>
      )}

      {/* ── All-time: head to head and trend ───────────────────────────────── */}
      <OverviewCard
        title="Head to head"
        subtitle={
          "All time · goals only, so a tie won on penalties counts as a draw here"
          + (ownSquadRows > 0 ? " · our own squads left out" : "")
        }
        interpretation={interpretOpponents(rivals)}
        table={
          <MiniTable
            head={["Opponent", "P", "W", "D", "L", "Goals"]}
            rows={rivals.filter((r) => r.played > 0).map((r) => [
              r.opponent_name,
              String(r.played), String(r.won), String(r.drawn), String(r.lost),
              `${r.goals_for}–${r.goals_against}`,
            ])}
          />
        }
      >
        <div className="h-64">
          {h2hBars.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No opponents played yet</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={h2hBars}
                margin={{ top: 16, right: 8, left: -18, bottom: 44 }}
              >
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: INK.secondary, fontSize: 10 }}
                  axisLine={{ stroke: INK.axis }}
                  tickLine={false}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                <ReferenceLine y={0} stroke={INK.axis} />
                <Tooltip
                  {...tip}
                  cursor={{ fill: INK.grid }}
                  formatter={(v: number, _n, item) =>
                    [`${v > 0 ? "+" : ""}${v} in ${(item?.payload as { played: number })?.played}`, "Goal difference"]}
                />
                {/* Two categorical hues, not red/green — positive and negative are
                    the same measure, and the status palette is reserved. */}
                <Bar dataKey="gd" radius={[3, 3, 0, 0]} maxBarSize={34}>
                  {/* Cells paint in row order, so they read the same sorted array
                      the bars do — mapping the unsorted rows here handed bars the
                      colour of whatever opponent happened to sit at that index. */}
                  {h2hBars.map((r) => (
                    <Cell key={r.name} fill={series(mode, r.gd >= 0 ? 0 : 1)} />
                  ))}
                  <LabelList
                    dataKey="gd"
                    position="top"
                    offset={5}
                    formatter={(v: number) => (v > 0 ? `+${v}` : `${v}`)}
                    style={{ fill: INK.secondary, fontSize: 10, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>

      <OverviewCard
        title="Trend across tournaments"
        subtitle="Points per game, oldest to newest — comparable however long the run"
        interpretation={interpretTrend(trend)}
        table={
          <MiniTable
            head={["Tournament", "Played", "PPG", "Goals", "GD"]}
            rows={trend.map((p) => [
              p.name,
              String(p.played),
              (p.ppg ?? 0).toFixed(2),
              `${p.goalsFor}–${p.goalsAgainst}`,
              `${p.goalDiff > 0 ? "+" : ""}${p.goalDiff}`,
            ])}
          />
        }
      >
        <div className="h-64">
          {trend.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">No completed tournaments yet</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trend.map((p) => ({
                  name: p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name,
                  full: p.name,
                  ppg: Number((p.ppg ?? 0).toFixed(2)),
                  gd: p.goalDiff,
                }))}
                margin={{ top: 16, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: INK.secondary, fontSize: 10 }} axisLine={{ stroke: INK.axis }} tickLine={false} interval={0} />
                <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                {/* 1.5 is the line between a winning run and a losing one */}
                <ReferenceLine y={1.5} stroke={INK.axis} strokeDasharray="4 4" />
                <Tooltip
                  {...tip}
                  cursor={{ fill: INK.grid }}
                  labelFormatter={(_, payload) => (payload?.[0]?.payload as { full: string })?.full ?? ""}
                  formatter={(v: number) => [`${v}`, "Points per game"]}
                />
                <Bar dataKey="ppg" fill={HIGHLIGHT} radius={[4, 4, 0, 0]} maxBarSize={48}>
                  <LabelList
                    dataKey="ppg"
                    position="top"
                    offset={6}
                    formatter={(v: number) => v.toFixed(2)}
                    style={{ fill: INK.secondary, fontSize: 11, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </OverviewCard>

      <p className="text-[11px] text-muted-foreground">
        Records here count a knockout tie won on penalties as a win, the way the bracket does.
        The head-to-head card is the exception and says so — it reads a database view that counts
        goals only, so every screen reports the same figures.
      </p>
    </div>
  );
}
