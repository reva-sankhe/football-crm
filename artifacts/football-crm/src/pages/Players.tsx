import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useTeam } from "@/context/TeamContext";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { fetchPlayers, createPlayer, updatePlayer, fetchTrainingSessions } from "@/lib/queries";
import { ReportOptionsModal } from "@/components/report/ReportOptionsModal";
import { AddButton } from "@/components/AddButton";
import { CountPill, IconButton, SearchInput, TOOLBAR_MENU, TOOLBAR_SELECT } from "@/components/Toolbar";
import { JERSEY_MAX, JERSEY_MIN, calcAgeRange, cn, parseJersey, playerLabel } from "@/lib/utils";
import { PosBadge } from "@/components/PosBadge";
import type { Player } from "@/lib/types";
import { Users, Check, FileText, X, Pencil, SlidersHorizontal } from "lucide-react";
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
    jersey_number: "",
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
    const jersey = parseJersey(form.jersey_number);
    if (jersey === "invalid") {
      toast({ title: `Jersey number must be between ${JERSEY_MIN} and ${JERSEY_MAX}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const yob = form.year_of_birth ? parseInt(form.year_of_birth) : null;
      await createPlayer({
        name: form.name.trim(),
        code: generateCode(form.name),
        jersey_number: jersey,
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
          <div className="grid grid-cols-3 gap-3">
            {field("Jersey #", (
              <input
                type="number"
                min={JERSEY_MIN}
                max={JERSEY_MAX}
                value={form.jersey_number}
                onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
                placeholder="e.g. 12"
                data-testid="input-jersey-number"
                className={inputCls}
              />
            ))}
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

/** The handful of fields worth changing without leaving the roster table. */
function QuickEditModal({
  player,
  onClose,
  onSaved,
}: {
  player: Player;
  onClose: () => void;
  onSaved: (updated: Player) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: player.name,
    jersey_number: player.jersey_number?.toString() ?? "",
    primary_position: player.primary_position,
    age_range: player.age_range ?? "",
    is_active: player.is_active,
  });

  const selectCls = "w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Player name is required", variant: "destructive" });
      return;
    }
    const jersey = parseJersey(form.jersey_number);
    if (jersey === "invalid") {
      toast({ title: `Jersey number must be between ${JERSEY_MIN} and ${JERSEY_MAX}`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlayer(player.id, {
        name: form.name.trim(),
        jersey_number: jersey,
        primary_position: form.primary_position,
        age_range: (form.age_range || null) as Player["age_range"],
        is_active: form.is_active,
      });
      toast({ title: "Player updated" });
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      toast({ title: "Failed to update", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" data-testid="quick-edit-modal">
      <div className="bg-card border border-border rounded-xl w-full max-w-sm shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Quick edit</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Name</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="quick-edit-name"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Jersey #</label>
              <input
                type="number"
                min={JERSEY_MIN}
                max={JERSEY_MAX}
                value={form.jersey_number}
                onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
                placeholder="—"
                className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="quick-edit-jersey"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Position</label>
              <select
                value={form.primary_position}
                onChange={(e) => setForm({ ...form, primary_position: e.target.value })}
                className={TOOLBAR_SELECT}
                data-testid="quick-edit-position"
              >
                {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Age group</label>
              <select
                value={form.age_range}
                onChange={(e) => setForm({ ...form, age_range: e.target.value })}
                className={TOOLBAR_SELECT}
                data-testid="quick-edit-age"
              >
                <option value="">— None —</option>
                {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <div className="flex gap-2">
              {[true, false].map((active) => (
                <button
                  key={String(active)}
                  type="button"
                  onClick={() => setForm({ ...form, is_active: active })}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors",
                    form.is_active === active
                      ? "border-indigo-500/50 bg-indigo-500/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`quick-edit-status-${active ? "active" : "inactive"}`}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                  {active ? "Active" : "Inactive"}
                </button>
              ))}
            </div>
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
              data-testid="button-save-quick-edit"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Players() {
  const { team } = useTeam();
  const [, navigate] = useLocation();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterAge, setFilterAge] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");
  const [showAdd, setShowAdd] = useState(false);
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(false);
  const [sessionDates, setSessionDates] = useState<Date[]>([]);
  const filterRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlayers(team);
      setPlayers(data);
    } finally {
      setLoading(false);
    }
  }, [team]);

  // Only used to underline days that have data in the report range picker
  useEffect(() => {
    fetchTrainingSessions()
      .then((ss) => setSessionDates(ss.map((s) => new Date(s.date + "T00:00:00"))))
      .catch(() => {/* the picker just shows no underlines */});
  }, []);

  useEffect(() => { load(); }, [load]);

  // Dismiss the filter popover on an outside click or Escape
  useEffect(() => {
    if (!showFilters) return;
    const onDown = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setShowFilters(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowFilters(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showFilters]);

  const filtered = players.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPos && p.primary_position !== filterPos && p.secondary_position !== filterPos) return false;
    if (filterAge && p.age_range !== filterAge) return false;
    if (filterActive === "active" && !p.is_active) return false;
    if (filterActive === "inactive" && p.is_active) return false;
    return true;
  });

  // Select-all operates on the *filtered* set, so search and filters compose
  // with selection rather than fighting it.
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((p) => next.delete(p.id));
      else filtered.forEach((p) => next.add(p.id));
      return next;
    });

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const activeFilterCount =
    (filterPos ? 1 : 0) + (filterAge ? 1 : 0) + (filterActive !== "active" ? 1 : 0);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name…"
          className="flex-1 max-w-sm"
          data-testid="input-search-players"
        />

        <div className="relative" ref={filterRef}>
          <IconButton
            label="Filters"
            onClick={() => setShowFilters((v) => !v)}
            active={showFilters || activeFilterCount > 0}
            badge={activeFilterCount}
            aria-expanded={showFilters}
            data-testid="button-filters"
          >
            <SlidersHorizontal size={15} />
          </IconButton>

          {showFilters && (
            <div className={cn(TOOLBAR_MENU, "w-56 space-y-3")} data-testid="filter-panel">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Position</label>
                <select
                  value={filterPos}
                  onChange={(e) => setFilterPos(e.target.value)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-position"
                >
                  <option value="">All positions</option>
                  {PRIMARY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Age group</label>
                <select
                  value={filterAge}
                  onChange={(e) => setFilterAge(e.target.value)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-age"
                >
                  <option value="">All ages</option>
                  {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status</label>
                <select
                  value={filterActive}
                  onChange={(e) => setFilterActive(e.target.value as typeof filterActive)}
                  className={TOOLBAR_SELECT}
                  data-testid="select-filter-active"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All</option>
                </select>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setFilterPos(""); setFilterAge(""); setFilterActive("active"); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        <IconButton
          label={selected.size > 0 ? `Download report (${selected.size} selected)` : "Download report"}
          onClick={() => setShowReport(true)}
          badge={selected.size}
          data-testid="button-download-report"
        >
          <FileText size={15} />
        </IconButton>

        <AddButton label="Add player" onClick={() => setShowAdd(true)} data-testid="button-add-player" />

        {/* Counts what the table is actually showing, so it tracks the filters */}
        <CountPill
          title={`${filtered.length} player${filtered.length !== 1 ? "s" : ""} shown`}
          data-testid="text-player-count"
        >
          {loading ? "—" : filtered.length}
        </CountPill>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/[0.07] px-4 py-2.5">
          <span className="text-sm text-foreground font-medium">
            {selected.size} player{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={11} /> Clear
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            <FileText size={12} /> Download report
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={4} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No players found" description="Try adjusting your filters or add a player" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="players-table">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="pl-4 pr-1 py-2.5 w-8">
                    <button
                      onClick={toggleAllFiltered}
                      aria-label={allFilteredSelected ? "Clear selection" : "Select all shown"}
                      title={allFilteredSelected ? "Clear selection" : "Select all shown"}
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        allFilteredSelected ? "bg-indigo-600 border-indigo-600 text-white" : "border-border hover:border-indigo-500",
                      )}
                      data-testid="checkbox-select-all"
                    >
                      {allFilteredSelected && <Check size={11} />}
                    </button>
                  </th>
                  <th className="px-2 py-2.5 text-left font-medium">Name</th>
                  <th className="px-2 py-2.5 text-left font-medium">Position</th>
                  <th className="px-2 py-2.5 text-left font-medium">Age Group</th>
                  <th className="px-2 py-2.5 text-left font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/players/${p.id}`)}
                    className={cn(
                      "border-b border-border/50 transition-colors cursor-pointer",
                      selected.has(p.id) ? "bg-indigo-500/[0.07]" : "hover:bg-muted/30",
                    )}
                    data-testid={`row-player-${p.id}`}
                  >
                    <td className="pl-4 pr-1 py-2.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleOne(p.id); }}
                        aria-label={`Select ${p.name}`}
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selected.has(p.id) ? "bg-indigo-600 border-indigo-600 text-white" : "border-border hover:border-indigo-500",
                        )}
                        data-testid={`checkbox-player-${p.id}`}
                      >
                        {selected.has(p.id) && <Check size={11} />}
                      </button>
                    </td>
                    <td className="px-2 py-2.5 font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          title={p.is_active ? "Active" : "Inactive"}
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            p.is_active ? "bg-emerald-500" : "bg-muted-foreground/50",
                          )}
                        />
                        {playerLabel(p)}
                        <span className="sr-only">{p.is_active ? "Active" : "Inactive"}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <PosBadge pos={p.primary_position} className="h-5 px-1" />
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="text-xs text-muted-foreground">{p.age_range ?? "—"}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditPlayer(p); }}
                        aria-label={`Quick edit ${p.name}`}
                        title="Quick edit"
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        data-testid={`button-edit-player-${p.id}`}
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddPlayerModal onClose={() => setShowAdd(false)} onSaved={load} />}

      {editPlayer && (
        <QuickEditModal
          player={editPlayer}
          onClose={() => setEditPlayer(null)}
          // Patch in place so the row updates without refetching the roster
          onSaved={(updated) => setPlayers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
        />
      )}

      {showReport && (
        <ReportOptionsModal
          playerIds={selected.size > 0 ? [...selected] : null}
          playerCount={selected.size}
          highlightDates={sessionDates}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
