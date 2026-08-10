import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Activity, ArrowLeft, Pencil, RefreshCw, TriangleAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  bulkUpsertMatchStats,
  fetchMatch,
  fetchMatchPlayerStats,
  fetchPenaltyKicks,
  fetchPlayers,
  fetchSquadsForTournament,
  fetchTournament,
  replacePenaltyKicks,
  updateMatch,
} from "@/lib/queries";
import { RESULT_CFG, matchOutcome } from "@/lib/tournaments";
import {
  SUB_POLICIES, applyGoal, formatShootout, goalCountsByMethod, playerMinutes, resolveSubPolicy,
  spellInvalid, subsExceeded, subsUsed, type GoalMethod,
} from "@/lib/lineup";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateLong } from "@/lib/attendance";
import { PosBadge } from "@/components/PosBadge";
import { StageBadge } from "@/components/Badges";
import { ShootoutPanel } from "@/components/tournaments/ShootoutPanel";
import { MatchFormModal } from "@/components/tournaments/MatchFormModal";
import type {
  MatchPenaltyKickInput, MatchStatInput, MatchWithSession, Player,
  SquadWithPlayers, SubPolicy, Tournament,
} from "@/lib/types";

type Draft = Record<string, MatchStatInput>;

// Written out in full rather than built from a template: Tailwind only scans for
// literal class strings, so `sm:${COLS}` would compile fine and silently produce
// no CSS. Limited subs carries Start/On/Off; rolling collapses to just Mins.
//
// Every stat column is the same width on purpose — the fields inside are
// `sm:w-full`, so any variation in the track shows up as inputs of different
// sizes down the grid. The player column takes whatever is left.
const COLS_LIMITED    = "grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_64px_64px_64px_64px_64px]";
const COLS_LIMITED_SM = "sm:grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_64px_64px_64px_64px_64px]";
const COLS_ROLLING    = "grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_64px_64px]";
const COLS_ROLLING_SM = "sm:grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_64px_64px]";

function emptyStat(playerId: string): MatchStatInput {
  return {
    player_id: playerId,
    minutes_played: 0,
    minutes_overridden: false,
    started: false,
    on_minute: null,
    off_minute: null,
    goals: 0,
    goals_free_kick: 0,
    goals_penalty: 0,
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
      && x.minutes_overridden === y.minutes_overridden
      && x.started === y.started
      && x.on_minute === y.on_minute
      && x.off_minute === y.off_minute
      && x.goals === y.goals
      && x.goals_free_kick === y.goals_free_kick
      && x.goals_penalty === y.goals_penalty
      && x.assists === y.assists
      && x.yellow_cards === y.yellow_cards
      && x.red_cards === y.red_cards
      && x.injured === y.injured
      && (x.injury_note ?? "") === (y.injury_note ?? "");
  });
}

function sameKicks(a: MatchPenaltyKickInput[], b: MatchPenaltyKickInput[]): boolean {
  return a.length === b.length && a.every((x, i) =>
    x.player_id === b[i].player_id && x.scored === b[i].scored);
}

export default function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [match, setMatch] = useState<MatchWithSession | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  /** Kept so the edit modal can offer them; a friendly has none. */
  const [squads, setSquads] = useState<SquadWithPlayers[]>([]);
  const [roster, setRoster] = useState<Player[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<Draft>({});
  const [kicks, setKicks] = useState<MatchPenaltyKickInput[]>([]);
  const [savedKicks, setSavedKicks] = useState<MatchPenaltyKickInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // Score is edited inline on the header
  const [goalsFor, setGoalsFor] = useState<string>("");
  const [goalsAgainst, setGoalsAgainst] = useState<string>("");

  // Shootout lives on the match row rather than the stats draft, but saves with
  // everything else through the one bar at the bottom.
  const [wentToPens, setWentToPens] = useState(false);
  const [pensFor, setPensFor] = useState<string>("");
  const [pensAgainst, setPensAgainst] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await fetchMatch(id!);
      setMatch(m);
      setGoalsFor(m.goals_for?.toString() ?? "");
      setGoalsAgainst(m.goals_against?.toString() ?? "");
      setWentToPens(m.went_to_penalties);
      setPensFor(m.pens_for?.toString() ?? "");
      setPensAgainst(m.pens_against?.toString() ?? "");

      // The squad defines who can appear; with no squad, fall back to the roster.
      // A standalone match belongs to no tournament, so it has no squads to load.
      // The tournament is still needed for the sub policy it may supply.
      const [squadRows, allPlayers, stats, kickRows, tourn] = await Promise.all([
        m.tournament_id ? fetchSquadsForTournament(m.tournament_id) : Promise.resolve([]),
        fetchPlayers(),
        fetchMatchPlayerStats(m.id),
        fetchPenaltyKicks(m.id),
        m.tournament_id ? fetchTournament(m.tournament_id) : Promise.resolve(null),
      ]);
      setTournament(tourn);
      setSquads(squadRows);

      const kickInputs: MatchPenaltyKickInput[] = kickRows.map((k) => ({
        kick_order: k.kick_order, player_id: k.player_id, scored: k.scored,
      }));
      setKicks(kickInputs);
      setSavedKicks(kickInputs);

      const active = allPlayers.filter((p) => p.is_active);
      const squad = m.squad_id ? squadRows.find((s) => s.id === m.squad_id) : undefined;
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
          minutes_overridden: s.minutes_overridden,
          started: s.started,
          on_minute: s.on_minute,
          off_minute: s.off_minute,
          goals: s.goals,
          goals_free_kick: s.goals_free_kick,
          goals_penalty: s.goals_penalty,
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

  // Three independent sets of edits, one save button — so "unsaved changes" has
  // to mean any of them, and the save has to persist all of them.
  const statsDirty = useMemo(
    () => !sameDraft(draft, saved) || !sameKicks(kicks, savedKicks),
    [draft, saved, kicks, savedKicks],
  );

  const scoreDirty = useMemo(
    () => match != null
      && ((match.goals_for?.toString() ?? "") !== goalsFor
        || (match.goals_against?.toString() ?? "") !== goalsAgainst),
    [match, goalsFor, goalsAgainst],
  );

  const shootoutDirty = useMemo(
    () => match != null
      && (match.went_to_penalties !== wentToPens
        || (match.pens_for?.toString() ?? "") !== pensFor
        || (match.pens_against?.toString() ?? "") !== pensAgainst),
    [match, wentToPens, pensFor, pensAgainst],
  );

  const dirty = !loading && (statsDirty || scoreDirty || shootoutDirty);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const durationMins = match?.sessions?.duration_mins ?? 90;
  const subPolicy = useMemo(() => resolveSubPolicy(match, tournament), [match, tournament]);
  /** Rolling subs make on/off meaningless, so those matches just take typed minutes. */
  const rolling = subPolicy.policy === "rolling";

  // Under a limited policy, minutes follow from each row's own start/on/off. Anyone
  // who hand-edited theirs keeps it. The `changed ? next : d` bail-out matters: this
  // effect writes the same state it reads, so returning a fresh object every time
  // would re-render forever.
  useEffect(() => {
    if (loading || rolling) return;
    setDraft((d) => {
      let changed = false;
      const next: Draft = {};
      for (const [pid, row] of Object.entries(d)) {
        const want = playerMinutes(row, durationMins);
        if (!row.minutes_overridden && row.minutes_played !== want) {
          next[pid] = { ...row, minutes_played: want };
          changed = true;
        } else {
          next[pid] = row;
        }
      }
      return changed ? next : d;
    });
  }, [draft, durationMins, rolling, loading]);

  const patch = (playerId: string, changes: Partial<MatchStatInput>) =>
    setDraft((d) => ({ ...d, [playerId]: { ...d[playerId], ...changes } }));

  /** Editing minutes by hand pins the value; resetting hands it back to the calculation. */
  const setMinutes = (playerId: string, mins: number) =>
    patch(playerId, { minutes_played: mins, minutes_overridden: true });

  const resetMinutes = (playerId: string) =>
    setDraft((d) => {
      const row = d[playerId];
      return { ...d, [playerId]: { ...row, minutes_played: playerMinutes(row, durationMins), minutes_overridden: false } };
    });

  /**
   * Ticking Start clears any on-minute — a starter is on from kickoff by
   * definition, so leaving a stale value behind would silently skew the minutes.
   */
  const setStarted = (playerId: string, started: boolean) =>
    patch(playerId, started ? { started: true, on_minute: null } : { started: false });

  const setSpellMinute = (playerId: string, field: "on_minute" | "off_minute", raw: string) => {
    const n = parseInt(raw);
    patch(playerId, { [field]: raw === "" || Number.isNaN(n) ? null : Math.max(0, Math.min(durationMins, n)) });
  };

  /** Logs one goal by method; see applyGoal for why the invariant can't break. */
  const addGoal = (playerId: string, method: GoalMethod, delta: number) =>
    setDraft((d) => ({ ...d, [playerId]: { ...d[playerId], ...applyGoal(d[playerId], method, delta) } }));

  /** Only what still has a use: the save toast, and the over-cap warning. */
  const totals = useMemo(() => {
    const rows = Object.values(draft);
    return {
      goals: rows.reduce((s, r) => s + r.goals, 0),
      played: rows.filter((r) => r.minutes_played > 0).length,
      subsUsed: subsUsed(rows),
      overCap: subsExceeded(rows, subPolicy),
    };
  }, [draft, subPolicy]);

  /**
   * The one save on this page. Score and shootout live on the `matches` row,
   * kicks and player stats in their own tables — but they are all one edit as
   * far as anyone filling this in is concerned, so they go together.
   */
  const handleSave = async () => {
    if (!match) return;
    setSaving(true);
    const snapshot = draft;
    const kickSnapshot = kicks;
    try {
      if (scoreDirty || shootoutDirty) {
        const updated = await updateMatch(match.id, {
          goals_for: goalsFor === "" ? null : Math.max(0, parseInt(goalsFor) || 0),
          goals_against: goalsAgainst === "" ? null : Math.max(0, parseInt(goalsAgainst) || 0),
          went_to_penalties: wentToPens,
          pens_for: pensFor === "" ? null : Math.max(0, parseInt(pensFor) || 0),
          pens_against: pensAgainst === "" ? null : Math.max(0, parseInt(pensAgainst) || 0),
        });
        // Spread over the existing row so the joined session/squad/opponent survive
        setMatch((m) => (m ? { ...m, ...updated } : m));
      }
      await replacePenaltyKicks(match.id, kickSnapshot);
      await bulkUpsertMatchStats(match.id, Object.values(snapshot));
      setSaved(snapshot);
      setSavedKicks(kickSnapshot);
      toast({ title: "Match saved", description: `${totals.played} players, ${totals.goals} goals` });
    } catch (err) {
      toast({ title: "Failed to save match", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** Overrides the sub policy for this match alone, switching which grid renders. */
  const handleSavePolicy = async (policy: SubPolicy) => {
    if (!match) return;
    try {
      const updated = await updateMatch(match.id, {
        sub_policy: policy,
        max_subs: policy === "rolling" ? null : subPolicy.maxSubs,
      });
      setMatch({ ...match, ...updated });
    } catch (err) {
      toast({ title: "Failed to change sub rules", description: String(err), variant: "destructive" });
    }
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

  // Reads the unsaved edits, so the badge follows the score and shootout as they
  // are typed — and a knockout level on goals resolves to W or L on the pens.
  const result = matchOutcome({
    stage: match.stage,
    goals_for: goalsFor === "" ? null : parseInt(goalsFor),
    goals_against: goalsAgainst === "" ? null : parseInt(goalsAgainst),
    went_to_penalties: wentToPens,
    pens_for: pensFor === "" ? null : parseInt(pensFor),
    pens_against: pensAgainst === "" ? null : parseInt(pensAgainst),
  });

  /** Where the back button and a delete both lead. */
  const backHref = match.tournament_id
    ? `/tournaments/${match.tournament_id}`
    : "/tournaments?tab=friendlies";

  const numCls =
    "w-full bg-muted border border-border rounded-lg px-2 py-1.5 text-sm text-center font-time text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  const shootoutLine = formatShootout({
    went_to_penalties: wentToPens,
    pens_for: pensFor === "" ? null : parseInt(pensFor),
    pens_against: pensAgainst === "" ? null : parseInt(pensAgainst),
  });

  return (
    <div className="space-y-5">
      {/* A standalone match has no tournament to go back to — it came from the
          friendlies list instead. */}
      <button
        onClick={() => setLocation(backHref)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> {match.tournament_id ? "Tournament" : "Friendlies"}
      </button>

      {/* ── Match header ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {/* Stage is read-only here; it's changed in the edit modal */}
              <StageBadge stage={match.stage} />
              {result && (
                <span className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold", RESULT_CFG[result].bg, RESULT_CFG[result].text)}>
                  {result}
                </span>
              )}
              {/* A shootout never changes the result badge — the match stays a draw */}
              {shootoutLine && (
                <span className="text-[11px] text-muted-foreground">{shootoutLine}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-foreground truncate">
              {match.opponents ? `vs ${match.opponents.name}` : "Opponent TBD"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {match.sessions && <span>{formatDateLong(match.sessions.date)}</span>}
              {match.sessions && <span className="font-time">{match.sessions.duration_mins} min</span>}
              {match.squads && <span className="flex items-center gap-1"><Users size={10} /> {match.squads.name}</span>}
            </div>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
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

            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-2 mb-0.5 text-sm border border-border rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="button-edit-match"
            >
              <Pencil size={13} /> Edit
            </button>
          </div>
        </div>

        <ShootoutPanel
          wentToPenalties={wentToPens}
          pensFor={pensFor}
          pensAgainst={pensAgainst}
          kicks={kicks}
          roster={roster}
          onToggle={setWentToPens}
          onScoreChange={(side, v) => (side === "for" ? setPensFor(v) : setPensAgainst(v))}
          onKicksChange={setKicks}
        />
      </div>

      {/* ── Player stats ───────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground">Player stats</h2>

          {/* Which grid you get. A standalone match has no tournament to inherit
              from, so this is the only place its mode can be set. */}
          <label className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Subs</span>
            <select
              value={subPolicy.policy}
              onChange={(e) => handleSavePolicy(e.target.value as SubPolicy)}
              className="bg-muted border border-border rounded-lg px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SUB_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {subPolicy.source !== "match" && (
              <span className="text-[10px] text-muted-foreground/70">
                {subPolicy.source === "tournament" ? "from tournament" : "default"}
              </span>
            )}
          </label>
        </div>

        {totals.overCap && (
          <div className="px-4 py-2 flex items-center gap-2 text-[11px] text-status-warn border-b border-border">
            <TriangleAlert size={12} className="shrink-0" />
            {totals.subsUsed} subs used, more than this format allows. Saved anyway — check the rules.
          </div>
        )}

        {roster.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No players in this squad — pick players on the tournament page.
          </div>
        ) : (
          <>
            {/* Column headings (desktop) */}
            <div className={cn("hidden sm:grid", rolling ? COLS_ROLLING : COLS_LIMITED, "gap-2 px-4 py-2 border-b border-border text-[10px] font-semibold uppercase tracking-widest text-muted-foreground")}>
              <span>Player</span>
              {!rolling && <span className="text-center" title="In the starting XI">Start</span>}
              {!rolling && <span className="text-center" title="Minute they came on — blank for a starter">On</span>}
              {!rolling && <span className="text-center" title="Minute they came off — blank if they finished the match">Off</span>}
              <span className="text-center">Mins</span>
              <span className="text-center" title="Click to log a goal and pick how it was scored">Goals</span>
              <span className="text-center">Assists</span>
              <span className="text-center" title="Yellow cards">YC</span>
              <span className="text-center" title="Red cards">RC</span>
              <span className="text-center">Injury</span>
            </div>

            <div className="divide-y divide-border/40">
              {roster.map((p) => {
                const row = draft[p.id] ?? emptyStat(p.id);
                return (
                  <div key={p.id} className={cn("px-4 py-2.5 sm:grid", rolling ? COLS_ROLLING_SM : COLS_LIMITED_SM, "sm:gap-2 sm:items-center flex flex-wrap gap-2")}>
                    <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                      <PosBadge pos={p.primary_position} />
                      <span className="text-sm text-foreground truncate">{p.name}</span>
                    </div>

                    {!rolling && (
                      <label className="flex items-center gap-1.5 sm:justify-center">
                        <span className="sm:hidden text-[11px] text-muted-foreground w-14">Start</span>
                        <input
                          type="checkbox"
                          checked={row.started}
                          aria-label={`${p.name} in the starting XI`}
                          onChange={(e) => setStarted(p.id, e.target.checked)}
                          className="accent-indigo-600 w-4 h-4"
                        />
                      </label>
                    )}

                    {!rolling && (
                      <SpellField
                        label="On"
                        value={row.on_minute}
                        // A starter is on from kickoff, so there's nothing to enter
                        disabled={row.started}
                        placeholder={row.started ? "0" : "–"}
                        max={durationMins}
                        onChange={(v) => setSpellMinute(p.id, "on_minute", v)}
                      />
                    )}

                    {!rolling && (
                      <SpellField
                        label="Off"
                        value={row.off_minute}
                        disabled={!row.started && row.on_minute == null}
                        placeholder="–"
                        invalid={spellInvalid(row)}
                        max={durationMins}
                        onChange={(v) => setSpellMinute(p.id, "off_minute", v)}
                      />
                    )}

                    <MinutesField
                      value={row.minutes_played}
                      overridden={row.minutes_overridden}
                      // Rolling minutes are always typed in, so the reset dot would be a lie
                      showReset={!rolling}
                      onChange={(v) => setMinutes(p.id, v)}
                      onReset={() => resetMinutes(p.id)}
                    />
                    <GoalsField row={row} playerName={p.name} isDark={isDark} onAdd={(m, d) => addGoal(p.id, m, d)} />
                    <NumField label="Assists" value={row.assists} min={0} max={99} onChange={(v) => patch(p.id, { assists: v })} />
                    <NumField label="YC" value={row.yellow_cards} min={0} max={2} onChange={(v) => patch(p.id, { yellow_cards: v })} />
                    <NumField label="RC" value={row.red_cards} min={0} max={1} onChange={(v) => patch(p.id, { red_cards: v })} />

                    <div className="flex items-center gap-1.5 sm:justify-center">
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
                        className={cn(
                          "w-full mt-1 bg-muted border border-status-warn rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-orange-500/40",
                          // Spans the whole row, so it tracks the column count
                          rolling ? "sm:col-span-7" : "sm:col-span-10",
                        )}
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
      {/* Not gated on the roster: the score and shootout are editable even when
          the squad is empty, and this is the only thing that saves them. */}
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
            onClick={handleSave}
            disabled={!dirty || saving}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            data-testid="button-save-match-stats"
          >
            {saving && <RefreshCw size={13} className="animate-spin" />}
            {saving ? "Saving…" : "Save match"}
          </button>
        </div>
      </div>

      {showEdit && (
        <MatchFormModal
          tournament={tournament}
          squads={squads}
          match={match}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
          onDeleted={() => setLocation(backHref)}
        />
      )}
    </div>
  );
}

// ── Goals ─────────────────────────────────────────────────────────────────────
const GOAL_METHODS: { key: GoalMethod; label: string; short: string }[] = [
  { key: "open", label: "Open play",  short: ""   },
  { key: "fk",   label: "Free kick",  short: "FK" },
  { key: "pen",  label: "Penalty",    short: "P"  },
];

/**
 * One control for goals. The cell shows the total with a hint of the breakdown;
 * clicking it opens a picker to log a goal by how it was scored. Open-play goals
 * carry no label — only free kicks and penalties are worth calling out.
 */
function GoalsField({
  row, playerName, isDark, onAdd,
}: {
  row: MatchStatInput;
  playerName: string;
  isDark: boolean;
  onAdd: (method: GoalMethod, delta: number) => void;
}) {
  const counts = goalCountsByMethod(row);
  const flags = GOAL_METHODS.filter((m) => m.short && counts[m.key] > 0);

  return (
    <div className="flex items-center gap-1.5 sm:block">
      <span className="sm:hidden text-[11px] text-muted-foreground w-14">Goals</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Goals for ${playerName}: ${row.goals}`}
            title="Log a goal"
            className={cn(
              "w-16 sm:w-full rounded-lg border px-1.5 py-1 transition-colors",
              "flex flex-col items-center justify-center leading-tight",
              row.goals > 0
                ? "border-[#0ca30c]/40 bg-[#0ca30c]/10"
                : isDark ? "border-white/10 hover:bg-white/5" : "border-slate-200 hover:bg-slate-50",
            )}
          >
            <span className={cn("text-sm font-time", row.goals > 0 ? "text-status-good" : "text-muted-foreground")}>
              {row.goals}
            </span>
            {flags.length > 0 && (
              <span className="text-[9px] text-muted-foreground">
                {flags.map((m) => `${counts[m.key]}${m.short}`).join(" ")}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent align="center" className="w-52 p-2">
          <p className="px-1 pb-1.5 text-[11px] font-semibold text-foreground">{playerName}</p>
          <div className="space-y-0.5">
            {GOAL_METHODS.map((m) => (
              <div key={m.key} className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-muted">
                <span className="flex-1 text-xs text-foreground">{m.label}</span>
                <button
                  type="button"
                  aria-label={`Remove a ${m.label} goal`}
                  disabled={counts[m.key] === 0}
                  onClick={() => onAdd(m.key, -1)}
                  className="w-6 h-6 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <span className="w-4 text-center text-xs font-time text-foreground">{counts[m.key]}</span>
                <button
                  type="button"
                  aria-label={`Add a ${m.label} goal`}
                  onClick={() => onAdd(m.key, 1)}
                  className="w-6 h-6 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                >
                  +
                </button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── On / Off minute field ─────────────────────────────────────────────────────
/**
 * One end of a player's spell. Blank is meaningful, not missing: blank On means
 * "from kickoff", blank Off means "to the final whistle" — hence null rather
 * than 0 when the field is cleared.
 */
function SpellField({
  label, value, disabled, placeholder, max, invalid, onChange,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  placeholder: string;
  max: number;
  invalid?: boolean;
  onChange: (raw: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 sm:block">
      <span className="sm:hidden text-[11px] text-muted-foreground w-14">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-14 sm:w-full bg-muted border rounded-lg px-1 py-1.5 text-sm text-center font-time focus:outline-none focus:ring-1 focus:ring-primary",
          "placeholder:text-muted-foreground/40 disabled:opacity-40 disabled:cursor-not-allowed",
          invalid ? "border-status-critical text-status-critical" : "border-border text-foreground",
        )}
      />
    </label>
  );
}

// ── Minutes field ─────────────────────────────────────────────────────────────
/**
 * Shows derived minutes muted; typing pins the value and marks it overridden,
 * with a click target to hand it back to the derivation.
 */
function MinutesField({
  value, overridden, showReset = true, onChange, onReset,
}: {
  value: number;
  overridden: boolean;
  showReset?: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5 sm:block relative">
      <span className="sm:hidden text-[11px] text-muted-foreground w-14">Mins</span>
      <input
        type="number"
        min={0}
        max={300}
        value={value}
        aria-label="Minutes played"
        title={overridden ? "Set by hand — click the dot to go back to the calculated value" : "Calculated from start, on and off"}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          onChange(Number.isNaN(n) ? 0 : Math.max(0, Math.min(300, n)));
        }}
        className={cn(
          "w-16 sm:w-full bg-muted border rounded-lg px-1.5 py-1.5 text-sm text-center font-time focus:outline-none focus:ring-1 focus:ring-primary",
          overridden ? "border-indigo-500/50 text-foreground" : "border-border text-muted-foreground",
        )}
      />
      {overridden && showReset && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to calculated minutes"
          aria-label="Reset to calculated minutes"
          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-indigo-500 text-white text-[8px] leading-none flex items-center justify-center hover:bg-indigo-400 transition-colors"
        >
          ×
        </button>
      )}
    </label>
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
