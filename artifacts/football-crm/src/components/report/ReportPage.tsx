import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis,
} from "recharts";
import { formatBronco, playerLabel } from "@/lib/utils";
import { attendancePctFill, formatDateLong } from "@/lib/attendance";
import { HIGHLIGHT, ink } from "@/lib/viz";
import { FINISH_CFG, formatDateRange } from "@/lib/tournaments";
import { ACWR_CONFIG, type PlayerReport } from "@/lib/report";

// Reports always print on white, so they pin the light ink set.
const RINK = ink("light");

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");



function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 border-b border-slate-300 pb-1 mb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Sprint times print to 2dp, or an em dash when never recorded. */
function secs(v: number | null): string {
  return v !== null ? `${v.toFixed(2)}s` : "—";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-slate-400 italic py-1">{children}</p>;
}

function Stat({ label, value, valueNote, sub, color }: {
  label: string;
  value: string | number;
  /** Sits inline after the value, small — e.g. the month a test was taken. */
  valueNote?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div>
      <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold leading-tight" style={{ color: color ?? RINK.primary }}>{value}</span>
        {valueNote && <span className="text-[9px] text-slate-500">{valueNote}</span>}
      </div>
      {sub && <div className="text-[9px] text-slate-500 leading-tight">{sub}</div>}
    </div>
  );
}

/** Match-day availability, sitting under the training-attendance headline. */
function matchSub(m: { attended: number; total: number; pct: number | null }): string {
  return m.pct !== null ? `${m.pct}% matches (${m.attended}/${m.total})` : "No matches";
}

/** "Mar 26" — the month a test was taken. */
function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function ReportPage({ report, generatedAt }: { report: PlayerReport; generatedAt: string }) {
  const { player, range, attendance, matches, fitness, load } = report;
  const rangeLabel = range ? formatDateRange(range.from, range.to) : "All time";
  const acwrCfg = ACWR_CONFIG[load.status];
  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "short" });

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
            <h1 className="text-2xl font-bold leading-tight">{playerLabel(player)}</h1>
            <div className="text-[10px] text-slate-600">
              {player.primary_position}
              {player.secondary_position && ` / ${player.secondary_position}`}
              {" · "}{player.age_range ?? "—"}
              {" · "}{player.is_active ? "Active" : "Inactive"}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Reporting period</div>
          <div className="text-[11px] font-semibold">{rangeLabel}</div>
          <div className="text-[9px] text-slate-500 mt-1">Generated {generatedAt}</div>
        </div>
      </header>

      {/* ── Snapshot ──────────────────────────────────────────────────────── */}
      {/* With no range the tiles mirror the player profile — current month and
          this year. A chosen period overrides that and reports on the period. */}
      <div className="grid grid-cols-4 gap-4 mt-4 pb-3 border-b border-slate-200">
        {range ? (
          <>
            <Stat
              label="Attendance"
              value={attendance.training.pct !== null ? `${attendance.training.pct}%` : "—"}
              sub={matchSub(attendance.match)}
              color={attendance.training.pct !== null ? attendancePctFill(attendance.training.pct) : undefined}
            />
            <Stat label="Goals" value={matches.goals} sub="This period" />
            <Stat label="Appearances" value={matches.appearances} sub="This period" />
          </>
        ) : (
          <>
            <Stat
              label={`${monthLabel} Attendance`}
              value={attendance.currentMonthTraining.pct !== null ? `${attendance.currentMonthTraining.pct}%` : "—"}
              sub={matchSub(attendance.currentMonthMatch)}
              color={attendance.currentMonthTraining.pct !== null ? attendancePctFill(attendance.currentMonthTraining.pct) : undefined}
            />
            <Stat label="Goals" value={matches.thisYear.goals} sub="This year" />
            <Stat label="Appearances" value={matches.thisYear.appearances} sub="This year" />
          </>
        )}
        <Stat
          label="Latest Bronco"
          value={formatBronco(fitness.latestBronco)}
          valueNote={monthYear(fitness.latestBroncoDate) ?? undefined}
          sub={fitness.teamBand?.label}
        />
      </div>

      {/* ── Attendance ────────────────────────────────────────────────────── */}
      <Section title="Attendance">
        {attendance.monthly.length === 0 ? (
          <Empty>No sessions in this period.</Empty>
        ) : (
          <div className="flex items-start gap-5">
            {/* Fixed size — ResponsiveContainer measures via ResizeObserver and
                can render zero-height during print layout. */}
            <BarChart
              width={330}
              height={110}
              data={attendance.monthly.map((m) => ({
                label: new Date(m.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" }),
                ...m,
              }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -22 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={RINK.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: RINK.axis, fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: RINK.axis, fontSize: 9 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={75} stroke={RINK.muted} strokeDasharray="4 4" />
              <Bar dataKey="pct" radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                {attendance.monthly.map((m, i) => <Cell key={i} fill={attendancePctFill(m.pct)} />)}
              </Bar>
            </BarChart>

            <div className="flex-1 pt-1">
              <table className="w-full text-[10px]">
                <tbody>
                  {attendance.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-slate-100 last:border-0">
                      <td className="py-0.5 text-slate-600">
                        {new Date(m.month + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                      </td>
                      <td className="py-0.5 text-right text-slate-500">{m.attended}/{m.total}</td>
                      <td className="py-0.5 text-right font-bold w-10" style={{ color: attendancePctFill(m.pct) }}>{m.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[9px] text-slate-400 mt-1">Dashed line marks the 75% minimum.</p>
            </div>
          </div>
        )}
      </Section>

      {/* ── Match record ──────────────────────────────────────────────────── */}
      <Section title="Match Record">
        {matches.callUps === 0 ? (
          <Empty>No matches in this period.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-6 gap-3">
              <Stat label="Apps" value={matches.appearances} />
              <Stat label="Minutes" value={matches.minutes > 0 ? matches.minutes : "—"} />
              <Stat label="Goals" value={matches.goals} />
              <Stat label="Assists" value={matches.assists} />
              <Stat label="Cards" value={matches.yellow + matches.red} sub={`${matches.yellow}Y ${matches.red}R`} />
              <Stat label="Injuries" value={matches.injuries} />
            </div>
            {matches.byTournament.length > 0 && (
              <table className="w-full text-[10px] mt-2">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="text-left font-semibold py-1">Competition</th>
                    <th className="text-right font-semibold">Apps</th>
                    <th className="text-right font-semibold">Mins</th>
                    <th className="text-right font-semibold">Goals</th>
                    <th className="text-right font-semibold">Assists</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.byTournament.map((t) => (
                    <tr key={t.name} className="border-b border-slate-100 last:border-0">
                      <td className="py-0.5">
                        {t.name}
                        {/* Printed in ink, not colour — the page is monochrome-safe */}
                        {t.finish && (
                          <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                            {FINISH_CFG[t.finish].label}
                          </span>
                        )}
                      </td>
                      <td className="py-0.5 text-right">{t.totals.appearances}</td>
                      <td className="py-0.5 text-right">{t.totals.minutes > 0 ? t.totals.minutes : "—"}</td>
                      <td className="py-0.5 text-right font-semibold">{t.totals.goals}</td>
                      <td className="py-0.5 text-right">{t.totals.assists}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Section>

      {/* ── Fitness ───────────────────────────────────────────────────────── */}
      <Section title="Fitness Testing">
        {fitness.tested === 0 ? (
          <Empty>No fitness tests in this period.</Empty>
        ) : (
          <div className="flex items-start gap-5">
            <table className="text-[10px] w-[210px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left font-semibold py-1">Metric</th>
                  <th className="text-right font-semibold">Best</th>
                  <th className="text-right font-semibold">Latest</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="py-0.5">Bronco</td>
                  <td className="py-0.5 text-right font-semibold">{formatBronco(fitness.bestBronco)}</td>
                  <td className="py-0.5 text-right text-slate-600">{formatBronco(fitness.latestBronco)}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-0.5">MAS (m/s)</td>
                  <td className="py-0.5 text-right font-semibold">{fitness.bestMas?.toFixed(2) ?? "—"}</td>
                  <td className="py-0.5 text-right text-slate-600">{fitness.latestMas?.toFixed(2) ?? "—"}</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-0.5">10m sprint</td>
                  <td className="py-0.5 text-right font-semibold">{secs(fitness.bestTen)}</td>
                  <td className="py-0.5 text-right text-slate-600">{secs(fitness.latestTen)}</td>
                </tr>
                <tr>
                  <td className="py-0.5">20m sprint</td>
                  <td className="py-0.5 text-right font-semibold">{secs(fitness.bestTwenty)}</td>
                  <td className="py-0.5 text-right text-slate-600">{secs(fitness.latestTwenty)}</td>
                </tr>
              </tbody>
            </table>

            <div>
              {fitness.tier && (
                <div className="text-[10px] mb-1">
                  Benchmark tier:{" "}
                  <span className="font-bold" style={{ color: fitness.tier.color }}>{fitness.tier.label}</span>
                  <span className="text-slate-500"> ({fitness.tier.displayRange})</span>
                </div>
              )}
              {fitness.series.length > 1 ? (
                <LineChart
                  width={300}
                  height={100}
                  data={fitness.series}
                  margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={RINK.grid} />
                  <XAxis dataKey="label" tick={{ fill: RINK.axis, fontSize: 8 }} />
                  <YAxis tickFormatter={(v) => formatBronco(v)} domain={["auto", "auto"]} tick={{ fill: RINK.axis, fontSize: 8 }} />
                  <Line type="monotone" dataKey="mins" stroke={HIGHLIGHT} strokeWidth={2} dot={{ fill: HIGHLIGHT, r: 3 }} isAnimationActive={false} />
                </LineChart>
              ) : (
                <p className="text-[9px] text-slate-400 italic">Not enough tests to chart a trend.</p>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ── Training load ─────────────────────────────────────────────────── */}
      <Section title="Training Load">
        {load.sessionCount === 0 && load.acwr === null ? (
          <Empty>No training load logged in this period.</Empty>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            <Stat
              label="Total load"
              value={`${load.totalAu} AU`}
              sub={load.plannedAu > 0
                ? `${load.sessionCount} sessions · ${load.plannedAu} AU set`
                : `${load.sessionCount} sessions`}
            />
            <Stat
              label="ACWR"
              value={load.acwr !== null ? load.acwr.toFixed(2) : "—"}
              sub={acwrCfg.label}
              color={acwrCfg.color}
            />
            <Stat label="Acute (7d)" value={`${Math.round(load.acute)} AU`} />
            <Stat label="Chronic /wk" value={`${Math.round(load.chronicWeeklyAvg)} AU`} />
          </div>
        )}
        {load.acwr !== null && (
          <p className="text-[9px] text-slate-400 mt-1">
            ACWR as at {formatDateLong(load.asAt)} · rolling 7-day load ÷ 28-day weekly average.
          </p>
        )}
      </Section>

      <footer className="mt-auto pt-4 text-[8px] text-slate-400 border-t border-slate-200 flex justify-between">
        <span>Bombay Gymkhana Women's Football · Player report</span>
        <span>{playerLabel(player)} · {rangeLabel}</span>
      </footer>
    </article>
  );
}
