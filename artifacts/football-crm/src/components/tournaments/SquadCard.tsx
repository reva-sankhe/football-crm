import { useMemo, useState } from "react";
import { Check, ChevronDown, Pencil, Search, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { deleteSquad, setSquadPlayers, updateSquad } from "@/lib/queries";
import { PosBadge } from "@/components/PosBadge";
import type { TournamentRecord } from "@/lib/tournaments";
import type { Player, SquadWithPlayers } from "@/lib/types";

interface SquadCardProps {
  squad: SquadWithPlayers;
  players: Player[];       // active roster
  /** This squad's own match record, shown beside the name. */
  record?: TournamentRecord;
  onChanged: () => void;   // refetch after a write
}

export function SquadCard({ squad, players, record, onChanged }: SquadCardProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [name, setName] = useState(squad.name);
  const [sizeLimit, setSizeLimit] = useState<string>(squad.size_limit?.toString() ?? "");

  // Draft of selected player ids, seeded from the saved roster
  const savedIds = useMemo(
    () => new Set(squad.squad_players.map((sp) => sp.player_id)),
    [squad.squad_players],
  );
  // Parent renders with key={squad.id}, so this seeds once per squad
  const [selected, setSelected] = useState<Set<string>>(savedIds);

  const dirty =
    selected.size !== savedIds.size || [...selected].some((id) => !savedIds.has(id));

  const overLimit = squad.size_limit != null && selected.size > squad.size_limit;

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, search]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSaveRoster = async () => {
    setSaving(true);
    try {
      await setSquadPlayers(squad.id, [...selected]);
      toast({ title: `${squad.name} updated`, description: `${selected.size} players selected` });
      onChanged();
    } catch (err) {
      toast({ title: "Failed to save squad", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMeta = async () => {
    if (!name.trim()) {
      toast({ title: "Squad name is required", variant: "destructive" });
      return;
    }
    try {
      await updateSquad(squad.id, {
        name: name.trim(),
        size_limit: sizeLimit === "" ? null : Math.max(1, parseInt(sizeLimit) || 1),
      });
      setEditingMeta(false);
      onChanged();
    } catch (err) {
      toast({ title: "Failed to update squad", description: String(err), variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete squad "${squad.name}"? Matches using it will keep their results but lose the squad link.`)) return;
    try {
      await deleteSquad(squad.id);
      toast({ title: "Squad deleted" });
      onChanged();
    } catch (err) {
      toast({ title: "Failed to delete squad", description: String(err), variant: "destructive" });
    }
  };

  const inputCls =
    "bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <Users size={15} className="text-muted-foreground shrink-0" />

        {editingMeta ? (
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <input value={name} onChange={(e) => setName(e.target.value)} className={cn(inputCls, "w-40")} placeholder="Squad name" />
            <input
              type="number"
              min={1}
              value={sizeLimit}
              onChange={(e) => setSizeLimit(e.target.value)}
              className={cn(inputCls, "w-24")}
              placeholder="No limit"
              title="Squad size limit"
            />
            <button onClick={handleSaveMeta} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500">Save</button>
            <button
              onClick={() => { setEditingMeta(false); setName(squad.name); setSizeLimit(squad.size_limit?.toString() ?? ""); }}
              className="px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button onClick={() => setEditingMeta(true)} className="text-sm font-semibold text-foreground hover:text-indigo-400 transition-colors">
              {squad.name}
            </button>
            <button
              onClick={() => setEditingMeta(true)}
              aria-label={`Rename ${squad.name}`}
              title="Rename squad"
              className="p-1 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              data-testid={`button-rename-squad-${squad.id}`}
            >
              <Pencil size={12} />
            </button>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-medium font-time",
                overLimit
                  ? "bg-muted text-muted-foreground"
                  : isDark ? "bg-white/8 text-muted-foreground" : "bg-slate-100 text-slate-500",
              )}
            >
              {selected.size}{squad.size_limit != null ? `/${squad.size_limit}` : ""} players
            </span>
            {overLimit && (
              <span className="text-[11px] text-status-warn">over the {squad.size_limit}-player limit</span>
            )}
            {record && record.played > 0 && (
              <span className="text-[11px] text-muted-foreground font-time">
                {record.played} played · {record.won}/{record.drawn}/{record.lost} · {record.goalsFor}–{record.goalsAgainst}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handleDelete}
                title="Delete squad"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-status-bad transition-colors"
              >
                <Trash2 size={13} />
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {expanded ? "Done" : "Pick players"}
                <ChevronDown size={12} className={cn("transition-transform", expanded && "rotate-180")} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Selected players preview */}
      {!expanded && selected.size > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {players
            .filter((p) => selected.has(p.id))
            .map((p) => (
              <span
                key={p.id}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs",
                  isDark ? "bg-white/[0.04] text-foreground" : "bg-slate-50 text-slate-700",
                )}
              >
                <PosBadge pos={p.primary_position} className="w-5 h-5 text-[9px]" />
                {p.name}
              </span>
            ))}
        </div>
      )}

      {/* Player picker */}
      {expanded && (
        <div className="border-t border-border">
          <div className="px-4 py-2.5 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${players.length} players…`}
                className="w-full pl-8 pr-7 py-1.5 rounded-lg text-sm bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              onClick={handleSaveRoster}
              disabled={!dirty || saving}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : dirty ? "Save squad" : "Saved"}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
            {visiblePlayers.map((p) => {
              const isIn = selected.has(p.id);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(p.id); }
                  }}
                  className={cn(
                    "px-4 py-2 flex items-center gap-3 cursor-pointer select-none transition-colors",
                    isIn ? "bg-indigo-500/[0.07]" : isDark ? "hover:bg-white/[0.03]" : "hover:bg-slate-50",
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-all",
                      isIn ? "bg-indigo-600 border-indigo-600 text-white" : isDark ? "border-white/20" : "border-slate-300",
                    )}
                  >
                    {isIn && <Check size={12} />}
                  </div>
                  <PosBadge pos={p.primary_position} />
                  <span className="text-sm text-foreground truncate">{p.name}</span>
                </div>
              );
            })}
            {visiblePlayers.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">No players match “{search}”</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
