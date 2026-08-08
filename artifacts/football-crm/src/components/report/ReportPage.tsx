import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis,
} from "recharts";
import { formatBronco } from "@/lib/utils";
import { formatDateLong } from "@/lib/attendance";
import { formatDateRange } from "@/lib/tournaments";
import { ACWR_CONFIG, type PlayerReport } from "@/lib/report";

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");

/** Attendance threshold colours — the one scale carried into print. */
function pctFill(pct: number): string {
  if (pct >= 85) return "#059669";
  if (pct >= 75) return "#d97706";
  return "#dc2626";
}

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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-slate-400 italic py-1">{children}</p>;
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="text-xl font-bold leading-tight" style={{ color: color ?? "#0f172a" }}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500 leading-tight">{sub}</div>}
    </div>
  );
}

export function ReportPage({ report, generatedAt }: { report: PlayerReport; generatedAt: string }) {
  const { player, range, attendance, matches, fitness, load } = report;
  const rangeLabel = range ? formatDateRange(range.from, range.to) : "All time";
  const acwrCfg = ACWR_CONFIG[load.status];

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
            <h1 className="text-2xl font-bold leading-tight">{player.name}</h1>
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
      <div className="grid grid-cols-4 gap-4 mt-4 pb-3 border-b border-slate-200">
        <Stat
          label="Attendance"
          value={attendance.pct !== null ? `${attendance.pct}%` : "—"}
          sub={attendance.total > 0 ? `${attendance.attended}/${attendance.total} sessions` : "No sessions"}
          color={attendance.pct !== null ? pctFill(attendance.pct) : undefined}
        />
        <Stat label="Goals" value={matches.goals} sub={matches.assists > 0 ? `${matches.assists} assists` : undefined} />
        <Stat label="Appearances" value={matches.appearances} sub={matches.callUps > 0 ? `${matches.callUps} call-ups` : undefined} />
        <Stat label="Best Bronco" value={formatBronco(fitness.bestBronco)} sub={fitness.tier?.label} />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={75} stroke="#94a3b8" strokeDasharray="4 4" />
              <Bar dataKey="pct" radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                {attendance.monthly.map((m, i) => <Cell key={i} fill={pctFill(m.pct)} />)}
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
                      <td className="py-0.5 text-right font-bold w-10" style={{ color: pctFill(m.pct) }}>{m.pct}%</td>
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
                      <td className="py-0.5">{t.name}</td>
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
                  <td className="py-0.5 text-right font-semibold">{fitness.bestTen ? `${fitness.bestTen.toFixed(2)}s` : "—"}</td>
                  <td className="py-0.5 text-right text-slate-600">—</td>
                </tr>
                <tr>
                  <td className="py-0.5">20m sprint</td>
                  <td className="py-0.5 text-right font-semibold">{fitness.bestTwenty ? `${fitness.bestTwenty.toFixed(2)}s` : "—"}</td>
                  <td className="py-0.5 text-right text-slate-600">—</td>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 8 }} />
                  <YAxis tickFormatter={(v) => formatBronco(v)} domain={["auto", "auto"]} tick={{ fill: "#64748b", fontSize: 8 }} />
                  <Line type="monotone" dataKey="mins" stroke="#4f46e5" strokeWidth={2} dot={{ fill: "#4f46e5", r: 3 }} isAnimationActive={false} />
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
            <Stat label="Total load" value={`${load.totalAu} AU`} sub={`${load.sessionCount} sessions`} />
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
        <span>{player.name} · {rangeLabel}</span>
      </footer>
    </article>
  );
}
