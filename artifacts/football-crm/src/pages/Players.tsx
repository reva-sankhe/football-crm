import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useTeam } from "@/context/TeamContext";
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { fetchPlayers, createPlayer } from "@/lib/queries";
import { calcAgeRange, positionColor, ageRangeColor, cn } from "@/lib/utils";
import type { Player } from "@/lib/types";
import { Users, Plus, Search, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PRIMARY_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SECONDARY_POSITIONS: Record<string, string[]> = {
  Goalkeeper: [],
  Defender:   ["Wing Back", "Center Back"],
  Midfielder: ["Right Wing", "Left Wing", "CDM", "CM"],
  Forward:    ["Striker", "CAM"],
};
const AGE_RANGES = ["U18", "18-24", "25+"];

function generateCode(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "_");
}

function AddPlayerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { team: currentTeam } = useTeam();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    primary_position: "Goalkeeper",
    secondary_position: "",
    year_of_birth: "",
    team: currentTeam as "Sharks" | "Wildcats",
    is_active: true,
  });

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setForm((prev) => ({ ...prev, name, code: generateCode(name) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Player name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const yob = form.year_of_birth ? parseInt(form.year_of_birth) : null;
      await createPlayer({
        name: form.name.trim(),
        code: generateCode(form.name),
        primary_position: form.primary_position,
        secondary_position: form.secondary_position || null,
        year_of_birth: yob,
        age: yob ? new Date().getFullYear() - yob : null,
        age_range: calcAgeRange(yob),
        team: form.team,
        is_active: form.is_active,
      });
      toast({ title: "Player added" });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      toast({ title: "Failed to add player", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, children: React.ReactNode) => (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );

  const inputCls = "w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" data-testid="add-player-modal">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Add Player</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field("Name *", (
              <input
                value={form.name}
                onChange={handleNameChange}
                placeholder="Full name"
                data-testid="input-player-name"
                className={inputCls}
              />
            ))}
            {field("Code (auto-generated)", (
              <input
                value={form.code}
                readOnly
                data-testid="input-player-code"
                className={`${inputCls} opacity-60 cursor-not-allowed select-all`}
                tabIndex={-1}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("Primary Position", (
              <select
                value={form.primary_position}
                onChange={(e) => setForm({ ...form, primary_position: e.target.value, secondary_position: "" })}
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
                data-testid="select-primary-position"
              >
                {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ))}
            {field("Secondary Position", (
              <select
                value={form.secondary_position}
                onChange={(e) => setForm({ ...form, secondary_position: e.target.value })}
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
              >
                <option value="">— None —</option>
                {(SECONDARY_POSITIONS[form.primary_position] ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("Year of Birth", (
              <input
                type="number"
                value={form.year_of_birth}
                onChange={(e) => setForm({ ...form, year_of_birth: e.target.value })}
                placeholder="e.g. 2003"
                data-testid="input-year-of-birth"
                className={inputCls}
              />
            ))}
            {field("Team", (
              <select
                value={form.team}
                onChange={(e) => setForm({ ...form, team: e.target.value as "Sharks" | "Wildcats" })}
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
                data-testid="select-team"
              >
                <option value="Sharks">Sharks</option>
                <option value="Wildcats">Wildcats</option>
              </select>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="rounded border-border"
            />
            <label htmlFor="is_active" className="text-sm text-muted-foreground">Active player</label>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm rounded-xl btn-primary text-white font-semibold disabled:opacity-60"
              data-testid="button-submit-player"
            >
              {saving ? "Saving…" : "Add Player"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Players() {
  const { team } = useTeam();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterAge, setFilterAge] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlayers(team);
      setPlayers(data);
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => { load(); }, [load]);

  const filtered = players.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.code.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPos && p.primary_position !== filterPos && p.secondary_position !== filterPos) return false;
    if (filterAge && p.age_range !== filterAge) return false;
    if (filterActive === "active" && !p.is_active) return false;
    if (filterActive === "inactive" && p.is_active) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{team} <span className="text-indigo-500 dark:text-indigo-400">— Players</span></h1>
          <p className="text-sm text-muted-foreground mt-1">{players.filter((p) => p.is_active).length} active players</p>
        </div>
        <div className="flex items-center gap-2">
          <TeamSwitcher />
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-indigo-500/50 text-indigo-400 dark:text-indigo-400 text-sm font-medium hover:bg-indigo-500/10 transition-colors"
            data-testid="button-add-player"
          >
            <Plus size={13} />
            Add Player
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-muted border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
            data-testid="input-search-players"
          />
        </div>
        <select
          value={filterPos}
          onChange={(e) => setFilterPos(e.target.value)}
          className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
          data-testid="select-filter-position"
        >
          <option value="">All positions</option>
          {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={filterAge}
          onChange={(e) => setFilterAge(e.target.value)}
          className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
          data-testid="select-filter-age"
        >
          <option value="">All ages</option>
          {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as typeof filterActive)}
          className="bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground"
          data-testid="select-filter-active"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={5} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No players found" description="Try adjusting your filters or add a player" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="players-table">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Code</th>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Position</th>
                  <th className="px-4 py-2.5 text-left font-medium">Age Group</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-player-${p.id}`}>
                    <td className="px-4 py-2.5 font-time text-muted-foreground text-xs">{p.code}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("font-semibold text-xs", positionColor(p.primary_position))}>{p.primary_position}</span>
                      {p.secondary_position && (
                        <span className="text-xs text-muted-foreground ml-1">/ {p.secondary_position}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-xs font-medium", ageRangeColor(p.age_range))}>{p.age_range ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "inline-flex px-2 py-0.5 rounded text-xs font-medium",
                        p.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
                      )}>
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/players/${p.id}`}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        data-testid={`link-player-${p.id}`}
                      >
                        <ChevronRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddPlayerModal onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  );
}
