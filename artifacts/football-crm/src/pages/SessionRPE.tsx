import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Zap, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTeam } from "@/context/TeamContext";
import {
  fetchTrainingSession,
  fetchTrainingSessions,
  fetchPlayers,
  fetchLoggedPlayerIds,
  insertSessionRPE,
} from "@/lib/queries";
import type { TrainingSession, Player, SessionType } from "@/lib/types";

// ── Session type config ────────────────────────────────────────────────────────
const SESSION_TYPE_CFG: Record<SessionType, { text: string; bg: string }> = {
  Training: { text: "text-indigo-400", bg: "bg-indigo-500/15" },
  Match:    { text: "text-amber-400",  bg: "bg-amber-500/15"  },
  Gym:      { text: "text-emerald-400",bg: "bg-emerald-500/15"},
  Recovery: { text: "text-slate-400",  bg: "bg-slate-500/15"  },
};

function SessionTypeBadge({ type }: { type: SessionType }) {
  const cfg = SESSION_TYPE_CFG[type] ?? SESSION_TYPE_CFG.Training;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.bg, cfg.text)}>
      {type}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const RPE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const RPE_LABELS: Record<number, string> = {
  1:  "Nothing",
  2:  "Very Easy",
  3:  "Easy",
  4:  "Comfortable",
  5:  "Smwht Hard",
  6:  "Difficult",
  7:  "Hard",
  8:  "Very Hard",
  9:  "Extr. Hard",
  10: "Max",
};

// Green → Yellow → Red across 1–10
const RPE_COLORS: Record<number, string> = {
  1:  "hsl(142,76%,45%)",
  2:  "hsl(116,60%,43%)",
  3:  "hsl(90,60%,40%)",
  4:  "hsl(60,80%,42%)",
  5:  "hsl(45,90%,48%)",
  6:  "hsl(30,90%,50%)",
  7:  "hsl(18,92%,50%)",
  8:  "hsl(8,92%,50%)",
  9:  "hsl(4,90%,45%)",
  10: "hsl(0,88%,38%)",
};

export default function SessionRPE() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { team } = useTeam();

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [allSessions, setAllSessions] = useState<TrainingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(id ?? "");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loggedIds, setLoggedIds] = useState<string[]>([]);
  const [totalActive, setTotalActive] = useState(0);

  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedRPE, setSelectedRPE] = useState<number | null>(null);
  const [minutesPlayed, setMinutesPlayed] = useState<number | "">(90);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshLoggedIds = useCallback(async (sessId: string) => {
    const ids = await fetchLoggedPlayerIds(sessId);
    setLoggedIds(ids);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sess, allSess, allPlayers] = await Promise.all([
        fetchTrainingSession(id!),
        fetchTrainingSessions(),
        fetchPlayers(team),
      ]);
      setSession(sess);
      setAllSessions(allSess.slice(0, 20));
      setSelectedSessionId(id!);
      setMinutesPlayed(sess.duration_mins); // default to full session duration

      const active = allPlayers.filter((p) => p.is_active);
      setPlayers(active);
      setTotalActive(active.length);

      await refreshLoggedIds(id!);
    } finally {
      setLoading(false);
    }
  }, [id, team, refreshLoggedIds]);

  useEffect(() => { load(); }, [load]);

  // When session selector changes, reload session + logged IDs
  const handleSessionChange = useCallback(async (newId: string) => {
    setSelectedSessionId(newId);
    setSelectedPlayerId("");
    setSelectedRPE(null);
    try {
      const [sess, ids] = await Promise.all([
        fetchTrainingSession(newId),
        fetchLoggedPlayerIds(newId),
      ]);
      setSession(sess);
      setLoggedIds(ids);
      setMinutesPlayed(sess.duration_mins); // default to full session duration
    } catch {
      // ignore
    }
  }, []);

  const unloggedPlayers = players.filter((p) => !loggedIds.includes(p.id));
  const minsValue = typeof minutesPlayed === "number" ? minutesPlayed : 0;
  const loadAU = selectedRPE != null && minsValue > 0 ? Math.round(selectedRPE * minsValue) : null;
  const allLogged = unloggedPlayers.length === 0 && totalActive > 0;

  const handleSave = async () => {
    if (!selectedPlayerId || selectedRPE === null || !selectedSessionId) return;
    const minsToSave = typeof minutesPlayed === "number" && minutesPlayed > 0 ? minutesPlayed : null;
    setSaving(true);
    try {
      await insertSessionRPE({
        session_id: selectedSessionId,
        player_id: selectedPlayerId,
        rpe: selectedRPE,
        minutes_played: minsToSave,
        load_au: minsToSave != null ? Math.round(selectedRPE * minsToSave) : 0,
        notes: notes || null,
      });
      // Refresh logged IDs — player disappears from dropdown
      await refreshLoggedIds(selectedSessionId);
      // Reset for next entry
      setSelectedPlayerId("");
      setSelectedRPE(null);
      setNotes("");
      toast({ title: "Entry saved" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      toast({ title: "Failed to save", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 pb-32">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-28 animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-20 animate-pulse" />
        <div className="bg-card border border-border rounded-xl h-48 animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Session not found</p>
        <button onClick={() => setLocation("/sessions")} className="mt-2 text-sm text-indigo-400">Back to Sessions</button>
      </div>
    );
  }

  const loggedCount = loggedIds.length;
  const progressPct = totalActive > 0 ? Math.round((loggedCount / totalActive) * 100) : 0;

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Back nav */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setLocation(`/sessions/${selectedSessionId}`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Session Detail
        </button>
      </div>

      {/* Session summary card */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-xs text-muted-foreground">Date</div>
            <div className="text-sm font-semibold text-foreground">{session.day}</div>
            <div className="text-xs text-muted-foreground">{formatDate(session.date)}</div>
          </div>
          <div className="text-right">
            <SessionTypeBadge type={session.session_type} />
            <div className="text-xs text-muted-foreground mt-1">{session.duration_mins} min</div>
          </div>
        </div>
        <div className="flex items-center justify-between bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Zap size={13} className="text-amber-400" />
            <span className="text-xs text-amber-400/80">Planned Load (AU)</span>
          </div>
          <span className="text-xl font-bold text-amber-400 font-time">{Math.round(session.planned_load_au)}</span>
        </div>
      </div>

      {/* Progress counter */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Users size={16} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Players Logged</span>
        </div>
        <div className="text-5xl font-bold text-foreground font-time leading-none mb-1">
          {loggedCount}
          <span className="text-2xl text-muted-foreground"> / {totalActive}</span>
        </div>
        <div className="mt-3 h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {allLogged && (
          <p className="text-xs text-emerald-400 mt-2 font-medium">All players logged for this session</p>
        )}
      </div>

      {/* Entry form */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4 mb-4">
        {/* Session selector */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Session</label>
          <select
            value={selectedSessionId}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ minHeight: 48 }}
          >
            {allSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.day}, {formatDate(s.date)} — {s.session_type}
              </option>
            ))}
          </select>
        </div>

        {/* Player selector */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">Player</label>
          {allLogged ? (
            <div className="w-full bg-muted/50 border border-border rounded-lg px-3 py-3 text-sm text-muted-foreground" style={{ minHeight: 48 }}>
              All players logged for this session
            </div>
          ) : (
            <select
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ minHeight: 48 }}
            >
              <option value="">— Select player —</option>
              {unloggedPlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Minutes played */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-muted-foreground">Minutes Played</label>
            <span className="text-[11px] text-muted-foreground/60">
              Session total: {session.duration_mins} min
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMinutesPlayed((v) => Math.max(1, (typeof v === "number" ? v : 0) - 5))}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-muted border border-border text-foreground text-lg font-bold hover:bg-muted/80 transition-colors select-none"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={300}
              value={minutesPlayed}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") { setMinutesPlayed(""); return; }
                const n = parseInt(val, 10);
                if (!isNaN(n)) setMinutesPlayed(Math.min(300, Math.max(1, n)));
              }}
              className="flex-1 text-center bg-muted border border-border rounded-lg px-3 py-2.5 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setMinutesPlayed((v) => Math.min(300, (typeof v === "number" ? v : 0) + 5))}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-muted border border-border text-foreground text-lg font-bold hover:bg-muted/80 transition-colors select-none"
            >
              +
            </button>
          </div>
        </div>

        {/* RPE Number pad */}
        <div>
          <label className="block text-xs text-muted-foreground mb-2">RPE (Rate of Perceived Exertion)</label>
          <div className="grid grid-cols-5 gap-2">
            {RPE_NUMBERS.map((n) => {
              const color = RPE_COLORS[n];
              const isSelected = selectedRPE === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSelectedRPE(isSelected ? null : n)}
                  className={cn(
                    "rounded-xl font-bold transition-all duration-100 border select-none flex flex-col items-center justify-center gap-0.5",
                    "active:scale-95",
                    isSelected
                      ? "shadow-lg border-2"
                      : "bg-card border-border text-foreground hover:bg-white/5"
                  )}
                  style={{
                    height: 80,
                    minWidth: 0,
                    borderColor: isSelected ? color : undefined,
                    backgroundColor: isSelected ? `${color}22` : undefined,
                  }}
                >
                  <span
                    className="text-2xl font-bold leading-none"
                    style={{ color: isSelected ? color : color }}
                  >
                    {n}
                  </span>
                  <span
                    className="text-center leading-none font-normal"
                    style={{ fontSize: 8, color, opacity: isSelected ? 1 : 0.75 }}
                  >
                    {RPE_LABELS[n]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Load AU display */}
        <div className="text-center py-2">
          <div className="text-xs text-muted-foreground mb-1">Load (AU)</div>
          <div className={cn(
            "text-4xl font-bold font-time transition-all duration-200",
            loadAU != null ? "text-amber-400" : "text-muted-foreground/30"
          )}>
            {loadAU != null ? loadAU : "—"}
          </div>
          {selectedRPE && minsValue > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              RPE {selectedRPE.toFixed(1)} × {minsValue} min played
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1.5">
            Notes <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes for this player…"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
      </div>

      {/* Fixed save button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border z-30">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleSave}
            disabled={saving || !selectedPlayerId || selectedRPE === null || allLogged}
            className={cn(
              "w-full py-4 rounded-xl text-base font-bold transition-all duration-150",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              saving || !selectedPlayerId || selectedRPE === null || allLogged
                ? "bg-muted text-muted-foreground"
                : "btn-primary text-white shadow-lg"
            )}
          >
            {saving ? "Saving…" : allLogged ? "All players logged" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
