import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft, ArrowRight, CalendarRange, Link2, MapPin, Plus, RefreshCw, Trophy, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  adoptSessionAsMatch,
  createMatch,
  createSquad,
  fetchAdoptableSessions,
  fetchMatchesForTournament,
  fetchPlayers,
  fetchSquadsForTournament,
  fetchTournament,
  fetchTournamentLeaders,
  type TournamentLeader,
} from "@/lib/queries";
import {
  MATCH_STAGES, RESULT_CFG, STAGE_CFG, formatDateRange, matchResult, tournamentRecord,
} from "@/lib/tournaments";
import { formatDateShort, todayISO } from "@/lib/attendance";
import { SquadCard } from "@/components/tournaments/SquadCard";
import { StageBadge } from "@/components/Badges";
import type {
  MatchStage, MatchWithSession, Player, SquadWithPlayers, Tournament, TrainingSession,
} from "@/lib/types";

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [squads, setSquads] = useState<SquadWithPlayers[]>([]);
  const [matches, setMatches] = useState<MatchWithSession[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaders, setLeaders] = useState<TournamentLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewMatch, setShowNewMatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, sq, ms, ps, ld] = await Promise.all([
        fetchTournament(id!),
        fetchSquadsForTournament(id!),
        fetchMatchesForTournament(id!),
        fetchPlayers(),
        fetchTournamentLeaders(id!),
      ]);
      setTournament(t);
      setSquads(sq);
      setMatches(ms);
      setPlayers(ps.filter((p) => p.is_active));
      setLeaders(ld);
    } catch (err) {
      toast({ title: "Failed to load tournament", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const record = useMemo(() => tournamentRecord(matches), [matches]);
  const topScorer = leaders.find((l) => l.goals > 0) ?? null;
  const mostMinutes = useMemo(
    () => [...leaders].sort((a, b) => b.minutes - a.minutes)[0] ?? null,
    [leaders],
  );

  const handleAddSquad = async () => {
    if (!tournament) return;
    try {
      await createSquad({
        tournament_id: tournament.id,
        name: `Squad ${String.fromCharCode(65 + squads.length)}`,
        size_limit: null,
        notes: null,
      });
      load();
    } catch (err) {
      toast({ title: "Failed to add squad", description: String(err), variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-28 animate-pulse" />
        <div className="bg-card border border-border rounded-2xl h-40 animate-pulse" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Tournament not found</p>
        <button onClick={() => setLocation("/sessions")} className="mt-2 text-sm text-indigo-400">Back to Sessions</button>
      </div>
    );
  }

  const range = formatDateRange(tournament.start_date, tournament.end_date);

  return (
    <div className="space-y-5">
      <button
        onClick={() => setLocation("/sessions")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Sessions
      </button>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-status-warn flex items-center justify-center shrink-0">
            <Trophy size={20} className="text-status-warn" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{tournament.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {range && <span className="flex items-center gap-1"><CalendarRange size={11} /> {range}</span>}
              {tournament.location && <span className="flex items-center gap-1"><MapPin size={11} /> {tournament.location}</span>}
              <span className="font-time">{tournament.default_match_mins} min default</span>
            </div>
          </div>
        </div>

        {/* Record strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-px mt-4 pt-4 border-t border-border">
          <Metric label="Played"  value={record.played} />
          <Metric label="W / D / L" value={`${record.won}/${record.drawn}/${record.lost}`} valueColor="text-foreground" />
          <Metric label="Goals For" value={record.goalsFor} valueColor="text-status-good" />
          <Metric label="Against"  value={record.goalsAgainst} valueColor="text-status-bad" />
          <Metric
            label="Top Scorer"
            value={topScorer ? topScorer.goals : "—"}
            sub={topScorer?.player.name}
          />
          <Metric
            label="Most Minutes"
            value={mostMinutes && mostMinutes.minutes > 0 ? mostMinutes.minutes : "—"}
            sub={mostMinutes && mostMinutes.minutes > 0 ? mostMinutes.player.name : undefined}
          />
        </div>
      </div>

      {/* ── Squads ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Squads</h2>
            <span className="text-xs text-muted-foreground">{squads.length}</span>
          </div>
          <button
            onClick={handleAddSquad}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              isDark ? "border-white/10 text-slate-300 hover:bg-white/5" : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            <Plus size={12} /> Add squad
          </button>
        </div>

        {squads.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">No squads yet</p>
            <button onClick={handleAddSquad} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Add your first squad →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {squads.map((sq) => (
              <SquadCard key={sq.id} squad={sq} players={players} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      {/* ── Matches ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy size={15} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Matches</h2>
            <span className="text-xs text-muted-foreground">{matches.length}</span>
          </div>
          <button
            onClick={() => setShowNewMatch(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm btn-primary text-white rounded-xl font-semibold"
            data-testid="button-new-match"
          >
            <Plus size={14} /> New Match
          </button>
        </div>

        {matches.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">No matches yet</p>
            <button onClick={() => setShowNewMatch(true)} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Add your first match →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {matches.map((m) => {
              const cfg = STAGE_CFG[m.stage] ?? STAGE_CFG["Group Stage"];
              const result = matchResult(m);
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-indigo-500/40 transition-colors"
                  data-testid={`row-match-${m.id}`}
                >
                  <StageBadge stage={m.stage} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {m.opponent ? `vs ${m.opponent}` : "Opponent TBD"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {m.sessions ? formatDateShort(m.sessions.date) : "—"}
                      {m.sessions && ` · ${m.sessions.duration_mins} min`}
                      {m.squads && ` · ${m.squads.name}`}
                    </div>
                  </div>
                  {result ? (
                    <>
                      <span className="font-time font-bold text-foreground text-sm">
                        {m.goals_for}–{m.goals_against}
                      </span>
                      <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0", RESULT_CFG[result].bg, RESULT_CFG[result].text)}>
                        {result}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground shrink-0">Not played</span>
                  )}
                  <ArrowRight size={13} className="text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {showNewMatch && (
        <NewMatchModal
          tournament={tournament}
          squads={squads}
          onClose={() => setShowNewMatch(false)}
          onSaved={() => { setShowNewMatch(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Metric tile ───────────────────────────────────────────────────────────────
function Metric({ label, value, sub, valueColor }: { label: string; value: string | number; sub?: string; valueColor?: string }) {
  return (
    <div className="py-1">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-xl font-bold font-time leading-none", valueColor ?? "text-foreground")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
    </div>
  );
}

// ── New match modal ───────────────────────────────────────────────────────────
function NewMatchModal({
  tournament,
  squads,
  onClose,
  onSaved,
}: {
  tournament: Tournament;
  squads: SquadWithPlayers[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"new" | "adopt">("new");
  const [adoptable, setAdoptable] = useState<TrainingSession[]>([]);
  const [adoptId, setAdoptId] = useState<string>("");

  const [form, setForm] = useState({
    date: todayISO(),
    stage: "Group Stage" as MatchStage,
    opponent: "",
    squad_id: squads[0]?.id ?? "",
    duration_mins: tournament.default_match_mins,
  });

  // Existing Match-type sessions with no match row — lets old fixtures be
  // pulled in with their attendance and RPE intact instead of duplicated.
  useEffect(() => {
    fetchAdoptableSessions()
      .then(setAdoptable)
      .catch(() => {/* the adopt tab just stays empty */});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const shared = {
        tournament_id: tournament.id,
        squad_id: form.squad_id || null,
        stage: form.stage,
        opponent: form.opponent.trim() || null,
      };

      if (mode === "adopt") {
        if (!adoptId) {
          toast({ title: "Pick a session to adopt", variant: "destructive" });
          setSaving(false);
          return;
        }
        await adoptSessionAsMatch(adoptId, shared);
        toast({ title: "Session linked as a match" });
      } else {
        await createMatch({
          ...shared,
          date: form.date,
          duration_mins: form.duration_mins,
          planned_rpe: tournament.default_planned_rpe,
        });
        toast({ title: "Match created" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Failed to save match", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Match</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>

        {/* Mode switch */}
        <div className="px-5 pt-4 flex gap-2">
          {(["new", "adopt"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                mode === m
                  ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                  : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              )}
            >
              {m === "new" ? "Create new" : `Link existing (${adoptable.length})`}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {mode === "new" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Duration (min)</label>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={form.duration_mins}
                  onChange={(e) => setForm({ ...form, duration_mins: parseInt(e.target.value) || 0 })}
                  className={inputCls}
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Existing match session</label>
              {adoptable.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No unlinked Match sessions found. Every existing match session already belongs to a tournament.
                </p>
              ) : (
                <>
                  <select value={adoptId} onChange={(e) => setAdoptId(e.target.value)} className={inputCls}>
                    <option value="">Select a session…</option>
                    {adoptable.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} · {s.day} · {s.duration_mins} min
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-start gap-1.5">
                    <Link2 size={11} className="mt-0.5 shrink-0" />
                    Keeps the session's existing attendance and RPE.
                  </p>
                </>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Stage</label>
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value as MatchStage })}
              className={inputCls}
            >
              {MATCH_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Opponent <span className="text-muted-foreground/50">(optional)</span></label>
            <input value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value })} placeholder="e.g. Bandra United" className={inputCls} />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Squad</label>
            <select value={form.squad_id} onChange={(e) => setForm({ ...form, squad_id: e.target.value })} className={inputCls}>
              <option value="">No squad</option>
              {squads.map((sq) => (
                <option key={sq.id} value={sq.id}>
                  {sq.name} ({sq.squad_players.length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (mode === "adopt" && !adoptId) || (mode === "new" && form.duration_mins <= 0)}
              className="flex-1 px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              {saving && <RefreshCw size={13} className="animate-spin" />}
              {saving ? "Saving…" : mode === "adopt" ? "Link Match" : "Create Match"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
