import { useMemo, useState } from "react";
import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { deleteSquad, setSquadPlayers, updateSquad } from "@/lib/queries";
import { PosBadge } from "@/components/PosBadge";
import { posSlot } from "@/lib/viz";
import type { Player, SquadWithPlayers } from "@/lib/types";

interface SquadCardProps {
  squad: SquadWithPlayers;
  players: Player[];       // active roster
  onChanged: () => void;   // refetch after a write
}

export function SquadCard({ squad, players, onChanged }: SquadCardProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { toast } = useToast();

  // One flag, one control: name, size limit, roster and delete all live in here.
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(squad.name);
  const [sizeLimit, setSizeLimit] = useState<string>(squad.size_limit?.toString() ?? "");

  // Draft of selected player ids, seeded from the saved roster
  const savedIds = useMemo(
    () => new Set(squad.squad_players.map((sp) => sp.player_id)),
    [squad.squad_players],
  );
  // Parent renders with key={squad.id}, so this seeds once per squad
  const [selected, setSelected] = useState<Set<string>>(savedIds);

  const rosterDirty =
    selected.size !== savedIds.size || [...selected].some((id) => !savedIds.has(id));
  const metaDirty =
    name.trim() !== squad.name || (sizeLimit === "" ? null : parseInt(sizeLimit)) !== squad.size_limit;

  const overLimit = squad.size_limit != null && selected.size > squad.size_limit;

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, search]);

  // Goalkeepers first, so the collapsed chips read as a squad shape
  const selectedPlayers = useMemo(
    () => players.filter((p) => selected.has(p.id)).sort((a, b) => posSlot(b.primary_position) - posSlot(a.primary_position)),
    [players, selected],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cancel = () => {
    setEditing(false);
    setSearch("");
    setName(squad.name);
    setSizeLimit(squad.size_limit?.toString() ?? "");
    setSelected(savedIds);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Squad name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (metaDirty) {
        await updateSquad(squad.id, {
          name: name.trim(),
          size_limit: sizeLimit === "" ? null : Math.max(1, parseInt(sizeLimit) || 1),
        });
      }
      if (rosterDirty) await setSquadPlayers(squad.id, [...selected]);
      toast({ title: `${name.trim()} saved`, description: `${selected.size} players selected` });
      setEditing(false);
      setSearch("");
      onChanged();
    } catch (err) {
      toast({ title: "Failed to save squad", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
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
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground">{squad.name}</span>
        <span className="text-[11px] text-muted-foreground font-time">
          {selected.size}{squad.size_limit != null ? `/${squad.size_limit}` : ""} players
        </span>
        {overLimit && (
          <span className="text-[11px] text-status-warn">over the {squad.size_limit}-player limit</span>
        )}

        {!editing && (
          <button
            onClick={() => setEditing(true)}
            aria-label={`Edit ${squad.name}`}
            title="Edit squad"
            className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            data-testid={`button-edit-squad-${squad.id}`}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* Selected players preview */}
      {!editing && selectedPlayers.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {selectedPlayers.map((p) => (
            <span
              key={p.id}
              className={cn(
                "flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg text-xs",
                isDark ? "bg-white/[0.04] text-foreground" : "bg-slate-50 text-slate-700",
              )}
            >
              {/* Transparent so the badge doesn't nest a pill inside this one */}
              <PosBadge pos={p.primary_position} className="bg-transparent px-0 h-auto text-muted-foreground" />
              {p.name}
            </span>
          ))}
        </div>
      )}

      {/* Edit panel — name, size, roster and delete in one place */}
      {editing && (
        <div className="border-t border-border">
          <div className="px-4 py-3 flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(inputCls, "w-44")}
                placeholder="Squad name"
                data-testid={`input-squad-name-${squad.id}`}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Size limit</label>
              <input
                type="number"
                min={1}
                value={sizeLimit}
                onChange={(e) => setSizeLimit(e.target.value)}
                className={cn(inputCls, "w-24")}
                placeholder="No limit"
              />
            </div>
          </div>

          <div className="px-4 pb-2.5">
            <div className="relative">
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
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-border/40 border-y border-border">
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

          <div className="px-4 py-3 flex items-center gap-2">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-status-bad transition-colors"
              data-testid={`button-delete-squad-${squad.id}`}
            >
              <Trash2 size={12} /> Delete squad
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={cancel} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                data-testid={`button-save-squad-${squad.id}`}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
