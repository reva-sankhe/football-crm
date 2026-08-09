import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  Activity, ArrowLeft, ArrowRight, ClipboardCheck, RefreshCw, Trophy, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  bulkUpsertMatchStats,
  fetchMatch,
  fetchMatchPlayerStats,
  fetchPlayers,
  fetchSquadsForTournament,
  updateMatch,
} from "@/lib/queries";
import { MATCH_STAGES, RESULT_CFG, STAGE_CFG, matchResult } from "@/lib/tournaments";
import { formatDateLong } from "@/lib/attendance";
import { PosBadge } from "@/components/PosBadge";
import { StageBadge } from "@/components/Badges";
import type {
  MatchStage, MatchStatInput, MatchWithSession, Player,
} from "@/lib/types";

type Draft = Record<string, MatchStatInput>;

function emptyStat(playerId: string): MatchStatInput {
  return {
    player_id: playerId,
    minutes_played: 0,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    injured: false,
    injury_note: null,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k], y = b[k];
    return y != null
      && x.minutes_played === y.minutes_played
      && x.goals === y.goals
      && x.assists === y.assists
      && x.yellow_cards === y.yellow_cards
      && x.red_cards === y.red_cards
      && x.injured === y.injured
      && (x.injury_note ?? "") === (y.injury_note ?? "");
  });
}

export default function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [match, setMatch] = useState<MatchWithSession | null>(null);
  const [roster, setRoster] = useState<Player[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingScore, setSavingScore] = useState(false);

  // Score + stage are edited inline on the header
  const [goalsFor, setGoalsFor] = useState<string>("");
  const [goalsAgainst, setGoalsAgainst] = useState<string>("");
  const [stage, setStage] = useState<MatchStage>("Group Stage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await fetchMatch(id!);
      setMatch(m);
      setGoalsFor(m.goals_for?.toString() ?? "");
      setGoalsAgainst(m.goals_against?.toString() ?? "");
      setStage(m.stage);

      // The squad defines who can appear; with no squad, fall back to the roster
      const [squads, allPlayers, stats] = await Promise.all([
        fetchSquadsForTournament(m.tournament_id),
        fetchPlayers(),
        fetchMatchPlayerStats(m.id),
      ]);

      const active = allPlayers.filter((p) => p.is_active);
      const squad = m.squad_id ? squads.find((s) => s.id === m.squad_id) : undefined;
      const squadPlayers = squad
        ? (squad.squad_players.map((sp) => sp.players).filter(Boolean) as Player[])
        : active;
      squadPlayers.sort((a, b) => a.name.localeCompare(b.name));
      setRoster(squadPlayers);

      const next: Draft = {};
      for (const p of squadPlayers) next[p.id] = emptyStat(p.id);
      for (const s of stats) {
        next[s.player_id] = {
          player_id: s.player_id,
          minutes_played: s.minutes_played,
          goals: s.goals,
          assists: s.assists,
          yellow_cards: s.yellow_cards,
          red_cards: s.red_cards,
          injured: s.injured,
          injury_note: s.injury_note,
        };
      }
      setDraft(next);
      setSaved(next);
    } catch (err) {
      toast({ title: "Failed to load match", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => !loading && !sameDraft(draft, saved), [draft, saved, loading]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const patch = (playerId: string, changes: Partial<MatchStatInput>) =>
    setDraft((d) => ({ ...d, [playerId]: { ...d[playerId], ...changes } }));

  const totals = useMemo(() => {
    const rows = Object.values(draft);
    return {
      goals: rows.reduce((s, r) => s + r.goals, 0),
      assists: rows.reduce((s, r) => s + r.assists, 0),
      minutes: rows.reduce((s, r) => s + r.minutes_played, 0),
      played: rows.filter((r) => r.minutes_played > 0).length,
      injured: rows.filter((r) => r.injured).length,
    };
  }, [draft]);

  const handleSaveStats = async () => {
    if (!match) return;
    setSaving(true);
    const snapshot = draft;
    try {
      await bulkUpsertMatchStats(match.id, Object.values(snapshot));
      setSaved(snapshot);
      toast({ title: "Match stats saved", description: `${totals.played} players, ${totals.goals} goals` });
    } catch (err) {
      toast({ title: "Failed to save stats", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveScore = async () => {
    if (!match) return;
    setSavingScore(true);
    try {
      const updated = await updateMatch(match.id, {
        goals_for: goalsFor === "" ? null : Math.max(0, parseInt(goalsFor) || 0),
        goals_against: goalsAgainst === "" ? null : Math.max(0, parseInt(goalsAgainst) || 0),
        stage,
      });
      setMatch({ ...match, ...updated });
      toast({ title: "Match updated" });
    } catch (err) {
      toast({ title: "Failed to update match", description: String(err), variant: "destructive" });
    } finally {
      setSavingScore(false);
    }
  };

  const fillFullMatch = () => {
    const mins = match?.sessions?.duration_mins ?? 90;
    setDraft((d) => {
      const next: Draft = {};
      for (const [pid, row] of Object.entries(d)) next[pid] = { ...row, minutes_played: mins };
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-32 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-64 animate-pulse" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Match not found</p>
        <button onClick={() => setLocation("/sessions")} className="mt-2 text-sm text-indigo-400">Back to Sessions</button>
      </div>
    );
  }

  const cfg = STAGE_CFG[match.stage] ?? STAGE_CFG["Group Stage"];
  const result = matchResult({
    goals_for: goalsFor === "" ? null : parseInt(goalsFor),
    goals_against: goalsAgainst === "" ? null : parseInt(goalsAgainst),
  });
  const scoreDirty =
    (match.goals_for?.toString() ?? "") !== goalsFor ||
    (match.goals_against?.toString() ?? "") !== goalsAgainst ||
    match.stage !== stage;

  const numCls =
    "w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-center font-time text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-5">
      <button
        onClick={() => setLocation(`/tournaments/${match.tournament_id}`)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Tournament
      </button>

      {/* ── Match header ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <StageBadge stage={match.stage} />
              {result && (
                <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold", RESULT_CFG[result].bg, RESULT_CFG[result].text)}>
                  {result}
                </span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {match.opponent ? `vs ${match.opponent}` : "Opponent TBD"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {match.sessions && <span>{formatDateLong(match.sessions.date)}</span>}
              {match.sessions && <span className="font-time">{match.sessions.duration_mins} min</span>}
              {match.squads && <span className="flex items-center gap-1"><Trophy size={10} /> {match.squads.name}</span>}
            </div>
          </div>

          {/* Score entry */}
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">For</label>
              <input type="number" min={0} value={goalsFor} onChange={(e) => setGoalsFor(e.target.value)} className={cn(numCls, "w-16 text-lg font-bold")} placeholder="–" />
            </div>
            <span className="text-muted-foreground pb-2">–</span>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Against</label>
              <input type="number" min={0} value={goalsAgainst} onChange={(e) => setGoalsAgainst(e.target.value)} className={cn(numCls, "w-16 text-lg font-bold")} placeholder="–" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border">
          <label className="text-xs text-muted-foreground">Stage</label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as MatchStage)}
            className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {MATCH_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <button
            onClick={handleSaveScore}
            disabled={!scoreDirty || savingScore}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {savingScore ? "Saving…" : scoreDirty ? "Save result" : "Saved"}
          </button>

          <div className="ml-auto flex items-center gap-3 text-xs">
            {match.sessions && (
              <>
                <button onClick={() => setLocation("/attendance")} className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors">
                  <ClipboardCheck size={12} /> Attendance
                </button>
                <button onClick={() => setLocation(`/sessions/${match.session_id}/rpe`)} className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors">
                  <Zap size={12} /> Log RPE
                </button>
                <button onClick={() => setLocation(`/sessions/${match.session_id}`)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                  Session <ArrowRight size={11} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Player stats ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground">Player stats</h2>
          <span className="text-xs text-muted-foreground">
            {match.squads ? `${match.squads.name} · ` : ""}{roster.length} players
          </span>
          <button
            onClick={fillFullMatch}
            className={cn(
              "ml-auto px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              isDark ? "border-white/10 text-slate-300 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            All played full match
          </button>
        </div>

        {/* Totals */}
        <div className={cn("px-4 py-2 flex flex-wrap gap-3 text-[11px] border-b", isDark ? "border-white/[0.06]" : "border-slate-100")}>
          <span className="text-muted-foreground">Played <span className="font-time text-foreground">{totals.played}</span></span>
          <span className="text-muted-foreground">Goals <span className="font-time text-status-good">{totals.goals}</span></span>
          <span className="text-muted-foreground">Assists <span className="font-time text-foreground">{totals.assists}</span></span>
          <span className="text-muted-foreground">Minutes <span className="font-time text-foreground">{totals.minutes}</span></span>
          {totals.injured > 0 && (
            <span className="text-status-warn flex items-center gap-1"><Activity size={10} />{totals.injured} injured</span>
          )}
        </div>

        {roster.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No players in this squad — pick players on the tournament page.
          </div>
        ) : (
          <>
            {/* Column headings (desktop) */}
            <div className="hidden sm:grid grid-cols-[1fr_64px_52px_52px_44px_44px_80px] gap-2 px-4 py-2 border-b border-border text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Player</span>
              <span className="text-center">Mins</span>
              <span className="text-center">Goals</span>
              <span className="text-center">Assists</span>
              <span className="text-center" title="Yellow cards">YC</span>
              <span className="text-center" title="Red cards">RC</span>
              <span className="text-center">Injury</span>
            </div>

            <div className="divide-y divide-border/40">
              {roster.map((p) => {
                const row = draft[p.id] ?? emptyStat(p.id);
                return (
                  <div key={p.id} className="px-4 py-2.5 sm:grid sm:grid-cols-[1fr_64px_52px_52px_44px_44px_80px] sm:gap-2 sm:items-center flex flex-wrap gap-2">
                    <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                      <PosBadge pos={p.primary_position} />
                      <span className="text-sm text-foreground truncate">{p.name}</span>
                    </div>

                    <NumField
                      label="Mins"
                      value={row.minutes_played}
                      min={0}
                      max={300}
                      onChange={(v) => patch(p.id, { minutes_played: v })}
                    />
                    <NumField label="Goals" value={row.goals} min={0} max={99} onChange={(v) => patch(p.id, { goals: v })} />
                    <NumField label="Assists" value={row.assists} min={0} max={99} onChange={(v) => patch(p.id, { assists: v })} />
                    <NumField label="YC" value={row.yellow_cards} min={0} max={2} onChange={(v) => patch(p.id, { yellow_cards: v })} />
                    <NumField label="RC" value={row.red_cards} min={0} max={1} onChange={(v) => patch(p.id, { red_cards: v })} />

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => patch(p.id, { injured: !row.injured, injury_note: row.injured ? null : row.injury_note })}
                        title={row.injured ? "Mark as not injured" : "Mark as injured"}
                        className={cn(
                          "w-7 h-7 rounded-lg border flex items-center justify-center transition-colors shrink-0",
                          row.injured
                            ? "bg-status-warn border-status-warn text-status-warn"
                            : isDark ? "border-white/10 text-slate-600 hover:text-slate-400" : "border-slate-200 text-slate-400 hover:text-slate-600",
                        )}
                      >
                        <Activity size={13} />
                      </button>
                      <span className="sm:hidden text-[11px] text-muted-foreground">Injured</span>
                    </div>

                    {row.injured && (
                      <input
                        value={row.injury_note ?? ""}
                        onChange={(e) => patch(p.id, { injury_note: e.target.value || null })}
                        placeholder="Injury note — e.g. hamstring, 62'"
                        className="w-full sm:col-span-7 mt-1 bg-muted border border-status-warn rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Sticky save bar ────────────────────────────────────────────────── */}
      {roster.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur",
              isDark ? "bg-slate-900/90 border-white/10" : "bg-white/95 border-slate-200",
            )}
          >
            <span className="flex-1 text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              onClick={handleSaveStats}
              disabled={!dirty || saving}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-save-match-stats"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              {saving ? "Saving…" : "Save stats"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compact number field ──────────────────────────────────────────────────────
function NumField({
  label, value, min, max, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 sm:block">
      <span className="sm:hidden text-[11px] text-muted-foreground w-14">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          onChange(Number.isNaN(n) ? 0 : Math.max(min, Math.min(max, n)));
        }}
        className="w-16 sm:w-full bg-muted border border-border rounded-lg px-1.5 py-1.5 text-sm text-center font-time text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </label>
  );
}
