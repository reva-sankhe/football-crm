import { formatDateShort } from "@/lib/attendance";
import { formatShootout } from "@/lib/lineup";
import { cn, playerLabel } from "@/lib/utils";
import { ink } from "@/lib/viz";
import { FINISH_CFG, STAGE_CFG, formatDateRange, matchOutcome } from "@/lib/tournaments";
import { MATCH_RPE } from "@/lib/report";
import {
  buildSquadComparison,
  interpretGoalkeeping, interpretGoals, interpretOpponentHistory, interpretPlacings,
  interpretRotation, interpretSquadComparison, interpretSquadReport,
  type ScopedReport, type SquadReport,
} from "@/lib/tournamentAnalytics";

/**
 * The printed report — one A4 page per squad, of whatever was in scope.
 *
 * Built as the paper edition of Tournaments → Overview: the same blocks in the
 * same order, each one a compact set of figures with the reading of those
 * figures underneath, from the same `interpret*` functions the screen uses. It
 * deliberately prints less than the screen holds — a report is read once, so
 * every table here is the shortest one that still supports its sentence.
 *
 * Blocks that belong to a bracket appear only for a tournament scope: the
 * friendlies have no podium and no placing, and printing three "Not recorded"
 * slots for them would be noise. An opponent scope gains the block a tournament
 * can't have — where we met them, competition by competition.
 *
 * Monochrome by design: no medal glyphs (placings are spelled out), no themed
 * colour, and it always prints on white, so it pins the light ink set.
 */
const RINK = ink("light");

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");

/**
 * The paper equivalent of `OverviewCard` — a block of figures, and underneath it
 * what they mean. `section` matters: the print stylesheet keeps sections whole
 * across a page break.
 */
function Card({ title, subtitle, reading, className, children }: {
  title: string;
  subtitle?: string;
  reading?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("border border-slate-300 rounded-lg px-3 py-2.5 flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <h2 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">{title}</h2>
        {subtitle && <span className="text-[8px] text-slate-400 truncate">{subtitle}</span>}
      </div>
      <div className="flex-1">{children}</div>
      {reading && (
        <div className="mt-2 pt-1.5 border-t border-slate-200">
          <div className="text-[7px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-0.5">
            Interpretation
          </div>
          <p className="text-[9px] text-slate-600 leading-snug">{reading}</p>
        </div>
      )}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[9px] text-slate-400 italic py-1">{children}</p>;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="text-xl font-bold leading-tight" style={{ color: RINK.primary }}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500 leading-tight">{sub}</div>}
    </div>
  );
}

/** Two columns, no chrome — the paper `MiniTable`. */
function Mini({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <table className="w-full text-[9px]">
      <thead>
        <tr className="text-slate-500 border-b border-slate-200">
          <th className="text-left font-semibold pb-0.5">{head[0]}</th>
          <th className="text-right font-semibold pb-0.5">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-100 last:border-0">
            <td className="py-0.5">{k}</td>
            <td className="py-0.5 text-right font-semibold">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const one = (n: number) => n.toFixed(1);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

/**
 * The dates a scope actually covers, for a scope with no dates of its own. A
 * tournament states its own range; the friendlies and an opponent are whatever
 * span the fixtures turned out to be.
 */
function matchRange(matches: { sessions: { date: string } | null }[]): string {
  const dates = matches.map((m) => m.sessions?.date).filter((d): d is string => !!d).sort();
  if (dates.length === 0) return "Undated";
  return formatDateRange(dates[0], dates[dates.length - 1]) ?? "Undated";
}

/** Which competition a fixture belongs to, named from the report's own grouping. */
function competitionOf(match: { tournament_id: string | null }, report: ScopedReport): string {
  return report.byTournament.find((l) => l.tournamentId === match.tournament_id)?.name ?? "—";
}

export function TournamentReportPage({
  report,
  squad,
  generatedAt,
}: {
  report: ScopedReport;
  /** Which slice of the scope this page prints. */
  squad: SquadReport;
  generatedAt: string;
}) {
  const { subject } = report;
  const tournament = subject.tournament;
  // The slice's own bracket, so a squad page can't show the other squad's final
  const { finish, placings } = squad;
  const range = tournament
    ? formatDateRange(tournament.start_date, tournament.end_date) ?? "Undated"
    : matchRange(squad.matches);
  const r = squad.record;
  const played = squad.matches.filter((m) => m.goals_for != null && m.goals_against != null);
  const keptMatches = squad.keepers.reduce((s, k) => s + k.started, 0);

  // Scorers and creators on one line each rather than two tables of the same people
  const contributors = [...squad.players]
    .filter((l) => l.goals > 0 || l.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.player.name.localeCompare(b.player.name))
    .slice(0, 8);

  const booked = squad.players.filter((l) => l.yellow > 0 || l.red > 0);

  // Only the combined page compares the squads — a squad's own page is about it
  const comparison = squad.squadId === null && report.bySquad.length > 1
    ? buildSquadComparison(report.bySquad)
    : [];

  // A bracket belongs to a tournament; the friendlies and an opponent have none
  const showPodium = subject.kind === "tournament";
  // `byTournament` is empty unless the scope spans more than one competition, so
  // this is also the test for whether the fixtures need naming their competition
  const showCompetition = report.byTournament.length > 0;

  return (
    <article className="report-page bg-white text-slate-900 mx-auto p-8 mb-6 shadow-sm print:shadow-none print:mb-0 print:p-0 w-[210mm] min-h-[297mm] print:w-auto print:min-h-0">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <img src={logoSrc} alt="" className="w-11 h-11 object-contain shrink-0" />
          <div className="min-w-0">
            <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Bombay Gymkhana · Women's Football
            </div>
            <h1 className="text-2xl font-bold leading-tight">{subject.title}</h1>
            <div className="text-[10px] text-slate-600">
              {squad.squadName}
              {tournament?.location && ` · ${tournament.location}`}
              {tournament?.format && ` · ${tournament.format}`}
              {!tournament && subject.subtitle && ` · ${subject.subtitle}`}
              {/* Spelled out, never a medal glyph — this page is monochrome */}
              {showPodium && finish && ` · ${FINISH_CFG[finish].label}`}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Dates</div>
          <div className="text-[11px] font-semibold">{range}</div>
          <div className="text-[9px] text-slate-500 mt-1">Generated {generatedAt}</div>
        </div>
      </header>

      {/* ── Snapshot ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4 mt-4 pb-3 border-b border-slate-200">
        <Stat label="Played" value={r.played} sub={`${squad.matches.length} scheduled`} />
        <Stat label="W / D / L" value={`${r.won}/${r.drawn}/${r.lost}`} />
        <Stat
          label="Goals"
          value={`${r.goalsFor}–${r.goalsAgainst}`}
          sub={
            squad.scoredPerGame != null && squad.concededPerGame != null
              ? `${one(squad.scoredPerGame)} / ${one(squad.concededPerGame)} per game`
              : undefined
          }
        />
        <Stat
          label="Clean sheets"
          value={squad.cleanSheets}
          sub={squad.cleanSheetPct == null ? undefined : `${Math.round(squad.cleanSheetPct)}% of games`}
        />
        <Stat
          label="Top scorer"
          value={squad.topScorers[0]?.goals ?? 0}
          sub={squad.topScorers[0]?.player.name ?? "None"}
        />
      </div>

      {/* ── Podium ────────────────────────────────────────────────────────── */}
      {/* Who actually won it, by name — the placing badge only ever says where
          we came, which leaves the tournament itself unreported. */}
      {showPodium && (
        <div className="flex flex-wrap gap-x-8 gap-y-1 mt-3">
          {([["Winners", placings.first], ["Runners-up", placings.second], ["Third", placings.third]] as const)
            .map(([label, team]) => (
              <div key={label}>
                <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
                <div className="text-[11px] font-semibold text-slate-900">{team ?? "Not recorded"}</div>
              </div>
            ))}
        </div>
      )}

      <p className="text-[10px] text-slate-600 leading-snug mt-2">
        {showPodium && `${interpretPlacings(placings, finish)} `}
        {interpretSquadReport(squad)}
      </p>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <Card title="Results" subtitle={`${squad.matches.length} fixtures`}>
          {squad.matches.length === 0 ? (
            <Empty>No matches recorded for this squad.</Empty>
          ) : (
            <table className="w-full text-[9px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left font-semibold py-0.5">Date</th>
                  {/* Only carried when the fixtures come from more than one competition */}
                  {showCompetition && <th className="text-left font-semibold">Competition</th>}
                  <th className="text-left font-semibold">Stage</th>
                  <th className="text-left font-semibold">Opponent</th>
                  <th className="text-right font-semibold">Score</th>
                  <th className="text-center font-semibold w-8">Res</th>
                </tr>
              </thead>
              <tbody>
                {[...squad.matches]
                  .sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""))
                  .map((m) => {
                    const shootout = formatShootout(m);
                    return (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-0.5">{m.sessions ? formatDateShort(m.sessions.date) : "—"}</td>
                        {showCompetition && (
                          <td className="py-0.5 text-slate-500">{competitionOf(m, report)}</td>
                        )}
                        <td className="py-0.5">{STAGE_CFG[m.stage]?.label ?? m.stage}</td>
                        <td className="py-0.5">{m.opponents?.name ?? "TBD"}</td>
                        {/* The shootout rides with the score rather than taking a
                            column of its own — it only qualifies that scoreline */}
                        <td className="py-0.5 text-right font-semibold whitespace-nowrap">
                          {m.goals_for != null && m.goals_against != null
                            ? `${m.goals_for}–${m.goals_against}`
                            : "—"}
                          {shootout && <span className="font-normal text-slate-500"> ({shootout})</span>}
                        </td>
                        <td className="py-0.5 text-center font-bold">{matchOutcome(m) ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ── Goals and goalkeeping ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Card
          title="How the goals came"
          subtitle={`${r.goalsFor} scored`}
          reading={interpretGoals(squad)}
        >
          <Mini
            head={["Route", "Goals"]}
            rows={[
              ["Open play", String(squad.goalMethods.open)],
              ["Free kicks", String(squad.goalMethods.fk)],
              ["Penalties", String(squad.goalMethods.pen)],
            ]}
          />
          <table className="w-full text-[9px] mt-2">
            <thead>
              {/* Split by route, the same columns the screen's table carries —
                  a scorer's tally means something different if it's all penalties */}
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left font-semibold py-0.5">Scorers & creators</th>
                <th className="text-right font-semibold">Open</th>
                <th className="text-right font-semibold">FK</th>
                <th className="text-right font-semibold">Pen</th>
                <th className="text-right font-semibold">G</th>
                <th className="text-right font-semibold">A</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((l) => (
                <tr key={l.player.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-0.5">{l.player.name}</td>
                  <td className="py-0.5 text-right text-slate-500">{l.goalsOpen || "—"}</td>
                  <td className="py-0.5 text-right text-slate-500">{l.goalsFk || "—"}</td>
                  <td className="py-0.5 text-right text-slate-500">{l.goalsPen || "—"}</td>
                  <td className="py-0.5 text-right font-semibold">{l.goals || "—"}</td>
                  <td className="py-0.5 text-right">{l.assists || "—"}</td>
                </tr>
              ))}
              {contributors.length === 0 && (
                <tr><td className="py-0.5 text-slate-400 italic" colSpan={6}>No goals or assists logged.</td></tr>
              )}
            </tbody>
          </table>
          {squad.shootouts.played > 0 && (
            <p className="text-[8px] text-slate-400 mt-1">
              {squad.shootouts.played} {squad.shootouts.played === 1 ? "tie" : "ties"} went to penalties
              ({squad.shootouts.won} won, {squad.shootouts.lost} lost); shootout kicks are never counted
              as goals.
            </p>
          )}
        </Card>

        <Card
          title="Goalkeeping"
          subtitle={`${squad.cleanSheets} clean ${squad.cleanSheets === 1 ? "sheet" : "sheets"} · ${r.goalsAgainst} conceded`}
          reading={played.length === 0 ? undefined : interpretGoalkeeping(squad)}
        >
          {squad.keepers.length === 0 ? (
            <Empty>No goalkeeper on the team sheet.</Empty>
          ) : (
            <>
              <table className="w-full text-[9px]">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="text-left font-semibold py-0.5">Goalkeeper</th>
                    <th className="text-right font-semibold">Mtch</th>
                    <th className="text-right font-semibold">Mins</th>
                    <th className="text-right font-semibold">GA</th>
                    <th className="text-right font-semibold">CS</th>
                  </tr>
                </thead>
                <tbody>
                  {squad.keepers.map((k) => (
                    <tr key={k.player.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-0.5">{playerLabel(k.player)}</td>
                      <td className="py-0.5 text-right">{k.started}</td>
                      <td className="py-0.5 text-right">{k.minutes}</td>
                      <td className="py-0.5 text-right">{k.conceded}</td>
                      <td className="py-0.5 text-right font-semibold">{k.cleanSheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[8px] text-slate-400 mt-1">
                A match is credited to whichever goalkeeper played the most of it.
                {keptMatches < played.length && (
                  <> {played.length - keptMatches} of {played.length} played matches had no keeper on
                    the sheet, so GA above is short of the {r.goalsAgainst} conceded.</>
                )}
              </p>
            </>
          )}
        </Card>
      </div>

      {/* ── Minutes ───────────────────────────────────────────────────────── */}
      <Card
        title="Minutes & rotation"
        subtitle="Share of the minutes available to each player"
        reading={squad.players.length === 0 ? undefined : interpretRotation(squad)}
        className="mt-3"
      >
        {squad.players.length === 0 ? (
          <Empty>No squad call-ups recorded.</Empty>
        ) : (
          <>
            <table className="w-full text-[9px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left font-semibold py-0.5">Player</th>
                  <th className="text-right font-semibold">Apps</th>
                  <th className="text-right font-semibold">Mins</th>
                  <th className="text-right font-semibold">Share</th>
                  <th className="text-right font-semibold">G</th>
                  <th className="text-right font-semibold">A</th>
                  <th className="text-right font-semibold">Load</th>
                </tr>
              </thead>
              <tbody>
                {squad.players.map((l) => (
                  <tr key={l.player.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-0.5">{playerLabel(l.player)}</td>
                    <td className="py-0.5 text-right">
                      {l.appearances}
                      {l.callUps > l.appearances && <span className="text-slate-400">/{l.callUps}</span>}
                    </td>
                    <td className="py-0.5 text-right">{l.minutes}</td>
                    <td className="py-0.5 text-right text-slate-500">
                      {l.minutesShare == null ? "—" : `${Math.round(l.minutesShare * 100)}%`}
                    </td>
                    <td className="py-0.5 text-right font-semibold">{l.goals || "—"}</td>
                    <td className="py-0.5 text-right">{l.assists || "—"}</td>
                    <td className="py-0.5 text-right text-slate-500">{l.loadAu.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[8px] text-slate-400 mt-1">
              Share is minutes played as a portion of the minutes available in the fixtures that player
              was named in. Load is minutes × RPE {MATCH_RPE}, the unit the training load charts use.
              {/* Cards lost their column when this table was cut back, but a
                  suspension is the kind of thing a report has to carry */}
              {booked.length > 0 && (
                <> Bookings: {booked
                  .map((l) => `${l.player.name} (${[l.yellow && `${l.yellow}Y`, l.red && `${l.red}R`]
                    .filter(Boolean).join(", ")})`)
                  .join("; ")}.</>
              )}
            </p>
          </>
        )}
      </Card>

      {/* ── Injuries ──────────────────────────────────────────────────────── */}
      <Card title="Injuries to monitor" subtitle={`${squad.injuries.length} logged`} className="mt-3">
        {squad.injuries.length === 0 ? (
          <Empty>Nobody picked up a knock during this tournament.</Empty>
        ) : (
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left font-semibold py-0.5">Player</th>
                <th className="text-left font-semibold">Date</th>
                <th className="text-left font-semibold">Match</th>
                <th className="text-left font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {squad.injuries.map((i, idx) => (
                <tr key={`${i.player.id}-${idx}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-0.5">{playerLabel(i.player)}</td>
                  <td className="py-0.5">{i.date ? formatDateShort(i.date) : "—"}</td>
                  <td className="py-0.5">{i.opponent ? `vs ${i.opponent}` : "—"}</td>
                  <td className="py-0.5 text-slate-600">{i.note ?? "No note recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Where we met them ─────────────────────────────────────────────── */}
      {subject.kind === "opponent" && showCompetition && (
        <Card
          title="Where we met them"
          subtitle="Counted the way the bracket does"
          reading={interpretOpponentHistory(
            report.byTournament, r, subject.opponent?.name ?? "them", squad.shootouts.played,
          )}
          className="mt-3"
        >
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left font-semibold py-0.5">Competition</th>
                <th className="text-right font-semibold">P</th>
                <th className="text-right font-semibold">W</th>
                <th className="text-right font-semibold">D</th>
                <th className="text-right font-semibold">L</th>
                <th className="text-right font-semibold">GF</th>
                <th className="text-right font-semibold">GA</th>
              </tr>
            </thead>
            <tbody>
              {report.byTournament.map((l) => (
                <tr key={l.tournamentId ?? "friendlies"} className="border-b border-slate-100 last:border-0">
                  <td className="py-0.5">{l.name}</td>
                  <td className="py-0.5 text-right">{l.record.played}</td>
                  <td className="py-0.5 text-right">{l.record.won}</td>
                  <td className="py-0.5 text-right">{l.record.drawn}</td>
                  <td className="py-0.5 text-right">{l.record.lost}</td>
                  <td className="py-0.5 text-right">{l.record.goalsFor}</td>
                  <td className="py-0.5 text-right">{l.record.goalsAgainst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Squad against squad ───────────────────────────────────────────── */}
      {comparison.length > 1 && (
        <Card
          title="Squad against squad"
          subtitle="Rates, so an uneven number of games stays comparable"
          reading={interpretSquadComparison(report.bySquad)}
          className="mt-3"
        >
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left font-semibold py-0.5">Measure</th>
                {comparison.map((c) => (
                  <th key={c.squadId ?? c.squadName} className="text-right font-semibold">{c.squadName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["Played", (c) => String(c.record.played)],
                ["W / D / L", (c) => `${c.record.won}/${c.record.drawn}/${c.record.lost}`],
                ["Points per game", (c) => (c.ppg == null ? "—" : one(c.ppg))],
                ["Goals", (c) => `${c.record.goalsFor}–${c.record.goalsAgainst}`],
                ["Scored per game", (c) => (c.goalsForPerGame == null ? "—" : one(c.goalsForPerGame))],
                ["Conceded per game", (c) => (c.goalsAgainstPerGame == null ? "—" : one(c.goalsAgainstPerGame))],
                ["Clean sheets", (c) => pct(c.cleanSheetPct)],
                ["Players used", (c) => `${c.playersUsed} of ${c.squadSize}`],
                ["Load per player", (c) => (c.loadPerPlayer == null ? "—" : `${Math.round(c.loadPerPlayer).toLocaleString()} AU`)],
                ["Top scorer", (c) => (c.topScorer ? `${c.topScorer.player.name} (${c.topScorer.goals})` : "None")],
              ] as [string, (c: (typeof comparison)[number]) => string][]).map(([label, value]) => (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="py-0.5 text-slate-500">{label}</td>
                  {comparison.map((c) => (
                    <td key={c.squadId ?? c.squadName} className="py-0.5 text-right font-semibold">
                      {value(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <footer className="mt-4 pt-3 text-[8px] text-slate-400 border-t border-slate-200 flex justify-between">
        <span>Bombay Gymkhana Women's Football · Match report</span>
        <span>{subject.title} · {squad.squadName} · {range}</span>
      </footer>
    </article>
  );
}
