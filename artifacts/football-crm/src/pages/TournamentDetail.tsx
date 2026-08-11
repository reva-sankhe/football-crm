import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ArrowRight, ChevronDown, Download, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  createSquad,
  fetchMatchesForTournament,
  fetchPlayers,
  fetchSquadsForTournament,
  fetchTournament,
} from "@/lib/queries";
import {
  RESULT_CFG, formatDateRange, matchOutcome, stageRank, tournamentFinish, tournamentRecord,
  type TournamentRecord,
} from "@/lib/tournaments";
import { formatShootout } from "@/lib/lineup";
import { openReport, tournamentReportUrl } from "@/lib/reportLinks";
import { formatDateShort } from "@/lib/attendance";
import { SquadCard } from "@/components/tournaments/SquadCard";
import { TournamentFormModal } from "@/components/tournaments/TournamentFormModal";
import { MatchFormModal } from "@/components/tournaments/MatchFormModal";
import { LinksArchive } from "@/components/tournaments/LinksArchive";
import { FinishBadge } from "@/components/Badges";
import { SectionLabel, StatTile } from "@/components/StatTile";
import { AddButton } from "@/components/AddButton";
import type {
  MatchStage, MatchWithSession, Player, SquadWithPlayers, Tournament,
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
  const [loading, setLoading] = useState(true);
  const [showNewMatch, setShowNewMatch] = useState(false);
  /** The match being edited, or null — the same modal that creates them. */
  const [editMatch, setEditMatch] = useState<MatchWithSession | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showNewSquad, setShowNewSquad] = useState(false);
  /** "all", or a squad id — a tournament can be entered with more than one squad. */
  const [squadFilter, setSquadFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, sq, ms, ps] = await Promise.all([
        fetchTournament(id!),
        fetchSquadsForTournament(id!),
        fetchMatchesForTournament(id!),
        fetchPlayers(),
      ]);
      setTournament(t);
      setSquads(sq);
      setMatches(ms);
      setPlayers(ps.filter((p) => p.is_active));
    } catch (err) {
      toast({ title: "Failed to load tournament", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const visibleMatches = useMemo(
    () => (squadFilter === "all" ? matches : matches.filter((m) => m.squad_id === squadFilter)),
    [matches, squadFilter],
  );
  const visibleSquads = useMemo(
    () => (squadFilter === "all" ? squads : squads.filter((s) => s.id === squadFilter)),
    [squads, squadFilter],
  );

  // Counted the way the bracket does — a knockout won on pens is a win, not a draw
  const record = useMemo(() => tournamentRecord(visibleMatches, matchOutcome), [visibleMatches]);

  /**
   * One group per stage in bracket order — group stage first, then the knockouts
   * — with each group's matches in date order. The finish is read from every
   * match, not just the visible ones, so a squad filter can't hide the final.
   */
  const stageGroups = useMemo(() => {
    const byStage = new Map<MatchStage, MatchWithSession[]>();
    for (const m of visibleMatches) {
      const list = byStage.get(m.stage);
      if (list) list.push(m);
      else byStage.set(m.stage, [m]);
    }
    return [...byStage.entries()]
      .sort(([a], [b]) => stageRank(a) - stageRank(b))
      .map(([stage, ms]) => ({
        stage,
        matches: [...ms].sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? "")),
        record: tournamentRecord(ms, matchOutcome),
      }));
  }, [visibleMatches]);

  const finish = useMemo(() => tournamentFinish(matches), [matches]);

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
    <div className="space-y-6">
      <button
        onClick={() => setLocation("/tournaments")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Tournaments
      </button>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        {/* Name, edit and the squad filter all share one line */}
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{tournament.name}</h1>
          <button
            onClick={() => setShowEdit(true)}
            aria-label="Edit tournament"
            title="Edit tournament"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            data-testid="button-edit-tournament"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => openReport(tournamentReportUrl(tournament.id))}
            aria-label="Download tournament report"
            title="Download report"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            data-testid="button-download-tournament-report"
          >
            <Download size={15} />
          </button>

          {/* Read off the bracket, so it can't disagree with the results below */}
          {finish && <FinishBadge finish={finish} className="text-2xl" />}

          {squads.length > 1 && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {[{ id: "all", name: "All" }, ...squads].map((sq) => (
                <button
                  key={sq.id}
                  onClick={() => setSquadFilter(sq.id)}
                  className={cn(
                    "px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors",
                    squadFilter === sq.id
                      ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                      : isDark ? "border-white/10 text-muted-foreground hover:bg-white/5" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                  )}
                  data-testid={`button-squad-filter-${sq.id}`}
                >
                  {sq.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm text-muted-foreground">
          {range && <span>{range}</span>}
          {tournament.location && <><span aria-hidden>·</span><span>{tournament.location}</span></>}
          {tournament.format && <><span aria-hidden>·</span><span>{tournament.format}</span></>}
          <span aria-hidden>·</span>
          <span>{tournament.default_match_mins} min default</span>
        </div>

        {/* Record strip */}
        <div className="grid grid-cols-3 gap-4 pt-4 mt-4 border-t border-border">
          <StatTile label="Played" value={record.played} />
          <StatTile label="W / D / L" value={`${record.won}/${record.drawn}/${record.lost}`} />
          <StatTile label="Goals" value={`${record.goalsFor}–${record.goalsAgainst}`} />
        </div>
      </div>

      {/* ── Squads ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <SectionLabel>Squads</SectionLabel>
          <span className="text-[10px] text-muted-foreground font-time">{squads.length}</span>
          <AddButton label="Add squad" onClick={() => setShowNewSquad(true)} data-testid="button-add-squad" />
        </div>

        {squads.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">No squads yet</p>
            <button onClick={() => setShowNewSquad(true)} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Add your first squad
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleSquads.map((sq) => (
              <SquadCard key={sq.id} squad={sq} players={players} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      {/* ── Matches ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <SectionLabel>Matches</SectionLabel>
          <span className="text-[10px] text-muted-foreground font-time">{visibleMatches.length}</span>
          <AddButton label="Add match" onClick={() => setShowNewMatch(true)} data-testid="button-new-match" />
        </div>

        {visibleMatches.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {matches.length === 0 ? "No matches yet" : "No matches for this squad yet"}
            </p>
            <button onClick={() => setShowNewMatch(true)} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
              Add a match
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {stageGroups.map((group) => (
              <StageGroup key={group.stage} group={group} onEdit={setEditMatch} />
            ))}
          </div>
        )}
      </div>

      {/* ── Links archive ──────────────────────────────────────────────────── */}
      <LinksArchive tournamentId={tournament.id} />

      {showNewMatch && (
        <MatchFormModal
          tournament={tournament}
          squads={squads}
          onClose={() => setShowNewMatch(false)}
          onSaved={() => { setShowNewMatch(false); load(); }}
        />
      )}

      {editMatch && (
        <MatchFormModal
          tournament={tournament}
          squads={squads}
          match={editMatch}
          onClose={() => setEditMatch(null)}
          onSaved={() => { setEditMatch(null); load(); }}
          onDeleted={() => { setEditMatch(null); load(); }}
        />
      )}

      {showEdit && (
        <TournamentFormModal
          tournament={tournament}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
          onDeleted={() => setLocation("/tournaments")}
        />
      )}

      {showNewSquad && (
        <NewSquadModal
          tournamentId={tournament.id}
          defaultName={`Squad ${String.fromCharCode(65 + squads.length)}`}
          onClose={() => setShowNewSquad(false)}
          onSaved={() => { setShowNewSquad(false); load(); }}
        />
      )}
    </div>
  );
}

// ── One stage's matches, foldable ─────────────────────────────────────────────
function StageGroup({
  group,
  onEdit,
}: {
  group: { stage: MatchStage; matches: MatchWithSession[]; record: TournamentRecord };
  onEdit: (m: MatchWithSession) => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  // Closed by default: the heading's record is enough to scan a tournament, and
  // eight fixtures open at once buried the rest of the page.
  const [open, setOpen] = useState(false);
  const { stage, matches, record } = group;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-1 py-1 text-left group"
        data-testid={`toggle-stage-${stage.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground transition-transform shrink-0",
            !open && "-rotate-90",
          )}
        />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {stage}
        </span>
        <span className="text-[11px] text-muted-foreground/70 font-time">
          {matches.length}
        </span>
        {record.played > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground font-time">
            {record.won}W {record.drawn}D {record.lost}L · {record.goalsFor}–{record.goalsAgainst}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2">
          {matches.map((m) => {
            const result = matchOutcome(m);
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 hover:border-indigo-500/40 transition-colors"
                data-testid={`row-match-${m.id}`}
              >
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {m.opponents ? `vs ${m.opponents.name}` : "Opponent TBD"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {m.sessions ? formatDateShort(m.sessions.date) : "—"}
                      {m.sessions && ` · ${m.sessions.duration_mins} min`}
                      {m.squads && ` · ${m.squads.name}`}
                      {/* Without this a 1–1 badged W looks like a mistake */}
                      {formatShootout(m) && ` · ${formatShootout(m)}`}
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
                  {/* Inside a Link, so the row's navigation has to be suppressed */}
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(m); }}
                    aria-label={`Edit match${m.opponents ? ` vs ${m.opponents.name}` : ""}`}
                    title="Edit match"
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    data-testid={`button-edit-match-${m.id}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <ArrowRight size={13} className="text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ── New squad modal ───────────────────────────────────────────────────────────
function NewSquadModal({
  tournamentId,
  defaultName,
  onClose,
  onSaved,
}: {
  tournamentId: string;
  /** Pre-filled so the old one-click behaviour is still one keystroke away. */
  defaultName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(defaultName);
  const [sizeLimit, setSizeLimit] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Squad name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createSquad({
        tournament_id: tournamentId,
        name: name.trim(),
        size_limit: sizeLimit === "" ? null : Math.max(1, parseInt(sizeLimit) || 1),
        notes: null,
      });
      toast({ title: "Squad added" });
      onSaved();
    } catch (err) {
      toast({ title: "Failed to add squad", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">New Squad</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Development Squad"
              className={inputCls}
              data-testid="input-squad-name"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Size limit <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <input
              type="number"
              min={1}
              value={sizeLimit}
              onChange={(e) => setSizeLimit(e.target.value)}
              placeholder="No limit"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-border rounded-xl text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm btn-primary text-white rounded-xl font-semibold disabled:opacity-60"
              data-testid="button-save-squad"
            >
              {saving ? "Saving…" : "Add Squad"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
