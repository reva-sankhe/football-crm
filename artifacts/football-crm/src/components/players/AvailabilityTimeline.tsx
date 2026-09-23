import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useTheme } from "@/context/ThemeContext";
import { HIGHLIGHT, STATUS, ink, type Mode } from "@/lib/viz";
import { todayISO } from "@/lib/attendance";
import { STAGE_CFG, daysBetween, daysLost, withdrewOn } from "@/lib/injuries";
import { fetchInjuryHistory } from "@/lib/queries";
import { MiniTable, OverviewCard } from "@/components/OverviewCard";
import type { InjuryStage, InjuryStageName, InjuryWithStatus, Player } from "@/lib/types";

interface Row {
  player: Player;
  injury: InjuryWithStatus;
  /** Never match fit: an available player isn't on this chart. */
  stage: InjuryStageName;
  start: string;
  /** When it stopped them. After `start` if they played through it first. */
  out: string;
  /** Where the bar ends: the expected return, the return itself, or today when neither is known. */
  end: string;
  daysOut: number;
}

/**
 * Who is out and until when: one bar per injured player, from the injury to
 * the expected return, on a date axis with today marked. The part up to today
 * is solid — days already lost — and the part still to come is faded. A
 * stretch played through before the injury stopped them is a hairline: the
 * injury existed, but no days were lost to it.
 *
 * Only players not yet match fit: once an injury is resolved the player is
 * available, and they drop off.
 *
 * Stage is carried by colour *and* by the word beside each name: amber sits
 * under 3:1 on the light surface, so the label and the table view are what
 * make it readable, not the hue.
 */
export function AvailabilityTimeline({ players }: { players: Player[] }) {
  const { theme } = useTheme();
  const mode: Mode = theme === "dark" ? "dark" : "light";
  const INK = ink(mode);
  const today = todayISO();

  const [injuries, setInjuries] = useState<InjuryWithStatus[] | null>(null);
  const [stages, setStages] = useState<InjuryStage[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchInjuryHistory()
      .then((h) => { if (!cancelled) { setStages(h.stages); setInjuries(h.injuries); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => buildRows(injuries ?? [], stages, players, today), [injuries, stages, players, today]);

  // Axis: a few days either side of the bars and today, ticks on the 1st of each month
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(600);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPlotWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length]);

  const axis = useMemo(() => {
    if (rows.length === 0) return null;
    const lo = addDays([...rows.map((r) => r.start), today].sort()[0], -4);
    const hi = addDays([...rows.map((r) => r.end), today].sort().pop()!, 4);
    const span = Math.max(1, daysBetween(lo, hi));
    const x = (d: string) => (daysBetween(lo, d) / span) * 100;
    const months: string[] = [];
    for (let m = new Date(lo.slice(0, 7) + "-01T00:00:00"); ; m.setMonth(m.getMonth() + 1)) {
      const iso = isoOf(m);
      if (iso > hi) break;
      if (iso >= lo) months.push(iso);
    }
    // Keep month labels at least ~44px apart
    const step = Math.max(1, Math.ceil((months.length * 44) / Math.max(plotWidth, 1)));
    return { x, ticks: months.filter((_, i) => i % step === 0) };
  }, [rows, today, plotWidth]);

  const [hover, setHover] = useState<{ row: Row; top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const showTip = (row: Row, e: React.MouseEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ row, top: e.clientY - box.top + 14, left: Math.min(e.clientX - box.left + 12, box.width - 220) });
  };

  const open = rows.filter((r) => r.stage);
  const next = open.find((r) => r.injury.expected_return_on && r.injury.expected_return_on >= today);
  const interpretation = injuries === null
    ? "Loading injuries…"
    : open.length === 0
      ? "Nobody is injured right now."
      : `${open.length} player${open.length === 1 ? "" : "s"} not match fit.${
          next ? ` Next expected back: ${next.player.name.split(" ")[0]}, ${shortDate(next.injury.expected_return_on!)}.` : ""}`;

  const colorFor = (r: Row) => r.stage === "out" ? STATUS.critical : STATUS.warning;

  return (
    <OverviewCard
      title="Availability"
      subtitle="Players not yet match fit, from the injury to the expected return"
      interpretation={interpretation}
      table={
        <MiniTable
          head={["Player", "Injury", "Stage", "Out since", "Expected back", "Days out"]}
          rows={rows.map((r) => [
            r.player.name,
            areaLabel(r.injury),
            STAGE_CFG[r.stage].label,
            shortDate(r.out),
            r.injury.expected_return_on ? shortDate(r.injury.expected_return_on) : "—",
            String(r.daysOut),
          ])}
        />
      }
    >
      {failed ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Couldn't load injuries</p>
      ) : injuries === null ? (
        <div className="h-32 bg-muted/30 rounded-xl animate-pulse" />
      ) : rows.length === 0 || !axis ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Everyone is available</p>
      ) : (
        <div ref={wrapRef} className="relative" data-testid="chart-availability-timeline">
          {/* Legend: every state in use, named — the colour is never on its own */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground mb-3">
            {rows.some((r) => r.stage === "out") && <Swatch color={STATUS.critical}>Out</Swatch>}
            {rows.some((r) => r.stage && r.stage !== "out") && <Swatch color={STATUS.warning}>Modified / full training</Swatch>}
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-px h-3" style={{ background: HIGHLIGHT }} /> Today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-2 rounded-[4px]" style={{ background: INK.muted, opacity: 0.35 }} /> Still to come
            </span>
            {rows.some((r) => r.out > r.start) && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-5 h-px" style={{ background: INK.secondary }} /> Played through
              </span>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3">
            {/* Plot area spans every row, so gridlines and today run the full height */}
            <div className="col-start-2 row-start-1 relative" style={{ gridRow: `1 / span ${rows.length}` }} ref={plotRef}>
              {axis.ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 w-px" style={{ left: `${axis.x(t)}%`, background: INK.grid }} />
              ))}
              <div className="absolute top-0 bottom-0 w-px" style={{ left: `${axis.x(today)}%`, background: HIGHLIGHT }} />
            </div>

            {rows.map((r, i) => {
              const color = colorFor(r);
              const s0 = axis.x(r.start);
              const s = axis.x(r.out);
              const t = axis.x(today < r.end ? today : r.end);
              const e = axis.x(r.end);
              return (
                <div key={r.injury.id} className="contents">
                  <div className="py-1.5 min-w-0" style={{ gridRow: i + 1, gridColumn: 1 }}>
                    <Link href={`/players/${r.player.id}`} className="block text-xs text-foreground truncate hover:underline">
                      {r.player.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {STAGE_CFG[r.stage].label} · {areaLabel(r.injury)}
                    </div>
                  </div>
                  <div
                    className="relative cursor-default"
                    style={{ gridRow: i + 1, gridColumn: 2 }}
                    onMouseMove={(ev) => showTip(r, ev)}
                    onMouseLeave={() => setHover(null)}
                    onClick={(ev) => showTip(r, ev)}
                    data-testid={`timeline-row-${r.player.id}`}
                  >
                    {/* Played through: a hairline. Days already out: solid. Still to come: faded. */}
                    {s > s0 && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-px"
                        style={{ left: `${s0}%`, width: `${s - s0}%`, background: color }}
                      />
                    )}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-[4px]"
                      style={{ left: `${s}%`, width: `max(${t - s}%, 4px)`, background: color }}
                    />
                    {e > t && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-[4px]"
                        style={{ left: `calc(${t}% + 2px)`, width: `calc(${e - t}% - 2px)`, background: color, opacity: 0.35 }}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Date axis */}
            <div className="relative h-5 mt-1" style={{ gridRow: rows.length + 1, gridColumn: 2 }}>
              {axis.ticks.map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 text-[10px] font-time whitespace-nowrap"
                  style={{ left: `${axis.x(t)}%`, color: INK.secondary }}
                >
                  {monthLabel(t)}
                </span>
              ))}
            </div>
          </div>

          {hover && (
            <div
              className="absolute z-10 pointer-events-none w-52 rounded-lg px-3 py-2 text-xs shadow-md"
              style={{ top: hover.top, left: Math.max(0, hover.left), background: INK.tooltipBg, border: `1px solid ${INK.tooltipBorder}` }}
              role="tooltip"
            >
              <div className="font-semibold text-foreground mb-1">{hover.row.player.name}</div>
              <TipLine label="Injury">{areaLabel(hover.row.injury)}</TipLine>
              <TipLine label="Side">{sideLabel(hover.row.injury)}</TipLine>
              <TipLine label="Days out so far">{hover.row.daysOut}</TipLine>
              <TipLine label="Expected back">
                {hover.row.injury.expected_return_on ? longDate(hover.row.injury.expected_return_on) : "Not set"}
              </TipLine>
            </div>
          )}
        </div>
      )}
    </OverviewCard>
  );
}

/**
 * One row per player not yet match fit. With several open injuries, the worst
 * stage (then the latest return) — the one that decides when they're back.
 * Sorted by expected return, soonest first; none set goes last.
 */
function buildRows(injuries: InjuryWithStatus[], stages: InjuryStage[], players: Player[], today: string): Row[] {
  const stagesOf = new Map<string, InjuryStage[]>();
  for (const st of stages) stagesOf.set(st.injury_id, [...(stagesOf.get(st.injury_id) ?? []), st]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const rank: Record<InjuryStageName, number> = { out: 3, modified: 2, full_training: 1, match_fit: 0 };
  const best = new Map<string, InjuryWithStatus>();
  for (const i of injuries) {
    if (i.status !== "open" || !i.current_stage) continue;
    const keep = best.get(i.player_id);
    const better = !keep
      || rank[i.current_stage] > rank[keep.current_stage!]
      || (rank[i.current_stage] === rank[keep.current_stage!] && (i.expected_return_on ?? "") > (keep.expected_return_on ?? ""));
    if (better) best.set(i.player_id, i);
  }

  const rows: Row[] = [];
  for (const i of best.values()) {
    const player = byId.get(i.player_id);
    if (!player) continue;
    rows.push({
      player, injury: i,
      stage: i.current_stage!,
      start: i.occurred_on,
      out: withdrewOn(stagesOf.get(i.id) ?? []) ?? i.occurred_on,
      // An expected return already passed, or none set: the bar stops at today
      end: i.expected_return_on && i.expected_return_on > today ? i.expected_return_on : today,
      daysOut: daysLost(i, stagesOf.get(i.id) ?? [], today),
    });
  }
  return rows.sort((a, b) => {
    const ea = a.injury.expected_return_on, eb = b.injury.expected_return_on;
    if (!ea || !eb) return ea ? -1 : eb ? 1 : a.player.name.localeCompare(b.player.name);
    return ea.localeCompare(eb) || a.player.name.localeCompare(b.player.name);
  });
}

function Swatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-5 h-2 rounded-[4px]" style={{ background: color }} /> {children}
    </span>
  );
}

function TipLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-time text-right">{children}</span>
    </div>
  );
}

function areaLabel(i: InjuryWithStatus): string {
  return i.category === "illness" ? "Illness" : i.body_area ?? "Unspecified";
}
function sideLabel(i: InjuryWithStatus): string {
  return i.side && i.side !== "n/a" ? i.side.charAt(0).toUpperCase() + i.side.slice(1) : "—";
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function longDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
/** "Sep", with the year on January so a span across New Year reads right. */
function monthLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.getMonth() === 0
    ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("en-GB", { month: "short" });
}
