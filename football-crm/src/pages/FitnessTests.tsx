import { useEffect, useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import { fetchSessions, createSession, fetchPlayers, bulkInsertResults, fetchResultsBySessionWithPlayers, updateResult, deleteResult, insertResult, createPlayer } from "@/lib/queries";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { formatBroncho } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { TestSession, Player, TestResult } from "@/lib/types";
import { Dumbbell, Plus, CheckCircle2, AlertCircle, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Step = "list" | "session-detail" | "create-session" | "enter-data" | "preview" | "done";

interface CsvRow {
  code: string;
  name: string;
  bronco_mins?: number;
  mas_ms?: number;
  ten_m_1?: number;
  ten_m_2?: number;
  twenty_m_1?: number;
  twenty_m_2?: number;
  forty_m_1?: number;
  forty_m_2?: number;
  notes?: string;
}

interface MatchedRow {
  row: CsvRow;
  player: Player | null;
}

type EnrichedResult = TestResult & { players: Player };

const POS_CFG: Record<string, { text: string; bg: string }> = {
  Forward:    { text: "text-red-400",    bg: "bg-red-400/15"    },
  Midfielder: { text: "text-blue-400",   bg: "bg-blue-400/15"   },
  Defender:   { text: "text-indigo-400", bg: "bg-indigo-400/15" },
  Goalkeeper: { text: "text-amber-400",  bg: "bg-amber-400/15"  },
};
function getPos(pos: string | null) {
  return POS_CFG[pos ?? ""] ?? { text: "text-slate-400", bg: "bg-slate-400/15" };
}

function parseNum(v: string | undefined | null): number | null {
  if (!v || String(v).trim() === "") return null;
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
}

function parseCsv(text: string): CsvRow[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return result.data.map((obj) => ({
    code: obj["code"] ?? "",
    name: obj["name"] ?? "",
    bronco_mins: parseNum(obj["bronco_mins"]) ?? undefined,
    mas_ms: parseNum(obj["mas_ms"]) ?? undefined,
    ten_m_1: parseNum(obj["ten_m_1"]) ?? undefined,
    ten_m_2: parseNum(obj["ten_m_2"]) ?? undefined,
    twenty_m_1: parseNum(obj["twenty_m_1"]) ?? undefined,
    twenty_m_2: parseNum(obj["twenty_m_2"]) ?? undefined,
    forty_m_1: parseNum(obj["forty_m_1"]) ?? undefined,
    forty_m_2: parseNum(obj["forty_m_2"]) ?? undefined,
    notes: obj["notes"] ?? undefined,
  }));
}

// ── Session detail view ────────────────────────────────────────────────────
interface EditForm {
  bronco_mins: string;
  mas_ms: string;
  ten_m_1: string;
  ten_m_2: string;
  twenty_m_1: string;
  twenty_m_2: string;
  forty_m_1: string;
  forty_m_2: string;
  notes: string;
}

const BLANK_FORM: EditForm = {
  bronco_mins: "", mas_ms: "", ten_m_1: "", ten_m_2: "",
  twenty_m_1: "", twenty_m_2: "", forty_m_1: "", forty_m_2: "", notes: "",
};

function resultToForm(r: TestResult): EditForm {
  return {
    bronco_mins: r.bronco_mins != null ? String(r.bronco_mins) : "",
    mas_ms: r.mas_ms != null ? String(r.mas_ms) : "",
    ten_m_1: r.ten_m_1 != null ? String(r.ten_m_1) : "",
    ten_m_2: r.ten_m_2 != null ? String(r.ten_m_2) : "",
    twenty_m_1: r.twenty_m_1 != null ? String(r.twenty_m_1) : "",
    twenty_m_2: r.twenty_m_2 != null ? String(r.twenty_m_2) : "",
    forty_m_1: r.forty_m_1 != null ? String(r.forty_m_1) : "",
    forty_m_2: r.forty_m_2 != null ? String(r.forty_m_2) : "",
    notes: r.notes ?? "",
  };
}

function formToUpdates(f: EditForm): Partial<TestResult> {
  const pn = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  return {
    bronco_mins: pn(f.bronco_mins),
    mas_ms: pn(f.mas_ms),
    ten_m_1: pn(f.ten_m_1),
    ten_m_2: pn(f.ten_m_2),
    twenty_m_1: pn(f.twenty_m_1),
    twenty_m_2: pn(f.twenty_m_2),
    forty_m_1: pn(f.forty_m_1),
    forty_m_2: pn(f.forty_m_2),
    notes: f.notes.trim() || null,
  };
}

function InlineEditForm({
  form,
  saving,
  onChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  form: EditForm;
  saving: boolean;
  onChange: (f: EditForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const inp = (label: string, key: keyof EditForm, placeholder?: string) => (
    <div>
      <label className="block text-[10px] text-muted-foreground mb-0.5">{label}</label>
      <input
        type="number"
        step="0.001"
        value={form[key]}
        onChange={(e) => onChange({ ...form, [key]: e.target.value })}
        placeholder={placeholder ?? "—"}
        className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground font-time placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/50 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {inp("Broncho (mins)", "bronco_mins", "e.g. 6.25")}
        {inp("MAS (m/s)", "mas_ms", "e.g. 14.5")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {inp("10m", "ten_m_1", "sec")}
        {inp("20m", "twenty_m_1", "sec")}
        {inp("40m", "forty_m_1", "sec")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {inp("10m ×2", "ten_m_2", "sec")}
        {inp("20m ×2", "twenty_m_2", "sec")}
        {inp("40m ×2", "forty_m_2", "sec")}
      </div>
      <div>
        <label className="block text-[10px] text-muted-foreground mb-0.5">Notes</label>
        <input
          type="text"
          value={form.notes}
          onChange={(e) => onChange({ ...form, notes: e.target.value })}
          placeholder="Optional notes"
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={onSave} disabled={saving} className="flex-1 px-3 py-1.5 text-xs rounded btn-primary text-white font-semibold disabled:opacity-60">
          {saving ? "Saving…" : (saveLabel ?? "Save")}
        </button>
      </div>
    </div>
  );
}

function SessionDetail({
  session,
  onBack,
}: {
  session: TestSession;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [results, setResults] = useState<EnrichedResult[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // result id or "add:{playerId}"
  const [editForm, setEditForm] = useState<EditForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  // ── Add-entry panel state ────────────────────────────────────────────────
  type AddStep = "search" | "result" | "new-player";
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>("search");
  const [addSearch, setAddSearch] = useState("");
  const [addSelectedPlayer, setAddSelectedPlayer] = useState<Player | null>(null);
  const [addResultForm, setAddResultForm] = useState<EditForm>(BLANK_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [newPlayerForm, setNewPlayerForm] = useState<{
    name: string;
    code: string;
    team: "Sharks" | "Wildcats";
    primary_position: string;
    age_range: "" | "U18" | "18-24" | "25+";
  }>({ name: "", code: "", team: "Sharks", primary_position: "", age_range: "" });
  const [newPlayerSaving, setNewPlayerSaving] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    return Promise.all([fetchResultsBySessionWithPlayers(session.id), fetchPlayers()])
      .then(([rs, ps]) => { setResults(rs); setAllPlayers(ps); })
      .finally(() => setLoading(false));
  }, [session.id]);

  useEffect(() => { reload(); }, [reload]);

  // Participants: all results sorted by bronco asc (nulls last)
  const participants = useMemo(() => {
    return [...results].sort((a, b) => {
      if (a.bronco_mins === null && b.bronco_mins === null) return 0;
      if (a.bronco_mins === null) return 1;
      if (b.bronco_mins === null) return -1;
      return a.bronco_mins - b.bronco_mins;
    });
  }, [results]);

  const participantIds = useMemo(() => new Set(results.map((r) => r.player_id)), [results]);

  const absentees = useMemo(() => {
    return allPlayers.filter((p) => p.is_active && !participantIds.has(p.id));
  }, [allPlayers, participantIds]);

  const testedParticipants = participants.filter((r) => r.bronco_mins !== null);
  const avg = testedParticipants.length
    ? testedParticipants.reduce((s, r) => s + r.bronco_mins!, 0) / testedParticipants.length
    : null;
  const best = testedParticipants[0] ?? null;
  const worst = testedParticipants[testedParticipants.length - 1] ?? null;
  const maxBronco = worst?.bronco_mins ?? 1;
  const minBronco = best?.bronco_mins ?? 0;
  const range = maxBronco - minBronco || 1;

  const handleStartEdit = (r: EnrichedResult) => {
    setEditingId(r.id);
    setEditForm(resultToForm(r));
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateResult(editingId, formToUpdates(editForm));
      await reload();
      setEditingId(null);
      toast({ title: "Result updated" });
    } catch (err: unknown) {
      toast({ title: "Failed to update", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await deleteResult(id);
      await reload();
      toast({ title: "Result deleted" });
    } catch (err: unknown) {
      toast({ title: "Failed to delete", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleStartAdd = (playerId: string) => {
    setEditingId(`add:${playerId}`);
    setEditForm(BLANK_FORM);
  };

  const handleSaveAdd = async (playerId: string) => {
    setSaving(true);
    try {
      const updates = formToUpdates(editForm);
      await insertResult({
        session_id: session.id,
        player_id: playerId,
        bronco_mins: updates.bronco_mins ?? null,
        mas_ms: updates.mas_ms ?? null,
        seconds: null,
        ten_m_1: updates.ten_m_1 ?? null,
        ten_m_2: updates.ten_m_2 ?? null,
        twenty_m_1: updates.twenty_m_1 ?? null,
        twenty_m_2: updates.twenty_m_2 ?? null,
        forty_m_1: updates.forty_m_1 ?? null,
        forty_m_2: updates.forty_m_2 ?? null,
        eighty_m_runs: null,
        sixty_m_runs: null,
        forty_m_runs: null,
        notes: updates.notes ?? null,
      });
      await reload();
      setEditingId(null);
      toast({ title: "Result added" });
    } catch (err: unknown) {
      toast({ title: "Failed to add result", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Add-entry panel helpers ──────────────────────────────────────────────
  const addCandidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return allPlayers
      .filter((p) => p.is_active && !participantIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPlayers, participantIds, addSearch]);

  const openAddPanel = () => {
    setEditingId(null);
    setAddPanelOpen(true);
    setAddStep("search");
    setAddSearch("");
    setAddSelectedPlayer(null);
    setAddResultForm(BLANK_FORM);
    setNewPlayerForm({ name: "", code: "", team: "Sharks", primary_position: "", age_range: "" });
  };

  const closeAddPanel = () => {
    setAddPanelOpen(false);
    setAddStep("search");
    setAddSearch("");
    setAddSelectedPlayer(null);
  };

  const selectAddPlayer = (p: Player) => {
    setAddSelectedPlayer(p);
    setAddResultForm(BLANK_FORM);
    setAddStep("result");
  };

  const handleSaveAddResult = async () => {
    if (!addSelectedPlayer) return;
    setAddSaving(true);
    try {
      const updates = formToUpdates(addResultForm);
      await insertResult({
        session_id: session.id,
        player_id: addSelectedPlayer.id,
        bronco_mins: updates.bronco_mins ?? null,
        mas_ms: updates.mas_ms ?? null,
        seconds: null,
        ten_m_1: updates.ten_m_1 ?? null,
        ten_m_2: updates.ten_m_2 ?? null,
        twenty_m_1: updates.twenty_m_1 ?? null,
        twenty_m_2: updates.twenty_m_2 ?? null,
        forty_m_1: updates.forty_m_1 ?? null,
        forty_m_2: updates.forty_m_2 ?? null,
        eighty_m_runs: null,
        sixty_m_runs: null,
        forty_m_runs: null,
        notes: updates.notes ?? null,
      });
      await reload();
      closeAddPanel();
      toast({ title: `Result added for ${addSelectedPlayer.name}` });
    } catch (err: unknown) {
      toast({ title: "Failed to add result", description: String(err), variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  };

  const handleSaveNewPlayer = async () => {
    if (!newPlayerForm.name.trim() || !newPlayerForm.code.trim()) return;
    setNewPlayerSaving(true);
    try {
      const created = await createPlayer({
        name: newPlayerForm.name.trim(),
        code: newPlayerForm.code.trim().toUpperCase(),
        team: newPlayerForm.team,
        primary_position: newPlayerForm.primary_position || "Forward",
        secondary_position: null,
        age: null,
        year_of_birth: null,
        age_range: (newPlayerForm.age_range || null) as Player["age_range"],
        is_active: true,
      });
      setAllPlayers((prev) => [...prev, created]);
      selectAddPlayer(created);
      toast({ title: `Player "${created.name}" created` });
    } catch (err: unknown) {
      toast({ title: "Failed to create player", description: String(err), variant: "destructive" });
    } finally {
      setNewPlayerSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">← Fitness Tests</button>
        <div className="h-48 bg-card border border-border rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">← Fitness Tests</button>

      {/* Session header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{session.test_name}</h1>
            {session.type && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {session.type}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{session.test_date}{session.notes ? ` · ${session.notes}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editMode && (
            <button
              onClick={addPanelOpen ? closeAddPanel : openAddPanel}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                addPanelOpen
                  ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  : "bg-indigo-500/10 text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/20"
              )}
            >
              + Add entry
            </button>
          )}
          <button
            onClick={() => { setEditMode((v) => !v); setEditingId(null); closeAddPanel(); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
              editMode
                ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Pencil size={13} />
            {editMode ? "Done editing" : "Edit results"}
          </button>
        </div>
      </div>

      {/* ── Add-entry panel ─────────────────────────────────────────────── */}
      {addPanelOpen && (
        <div className="bg-card border border-indigo-500/25 rounded-xl overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-indigo-500/5">
            <span className="text-sm font-semibold text-indigo-400">
              {addStep === "search" && "Add entry — select player"}
              {addStep === "result" && `Add result for ${addSelectedPlayer?.name}`}
              {addStep === "new-player" && "Create new player"}
            </span>
            <button onClick={closeAddPanel} className="text-xs text-muted-foreground hover:text-foreground">✕ Cancel</button>
          </div>

          {/* Step: search */}
          {addStep === "search" && (
            <div>
              <div className="px-4 pt-3 pb-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by name or code…"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-border/50">
                {addCandidates.map((p) => {
                  const pos = getPos(p.primary_position);
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectAddPlayer(p)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                    >
                      <span className={cn("text-[10px] font-bold font-time w-7 text-center", pos.text)}>
                        {p.primary_position?.slice(0, 3) || "?"}
                      </span>
                      <span className="text-sm text-foreground flex-1">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground font-time">{p.code}</span>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", p.team === "Sharks" ? "text-blue-400 bg-blue-500/10" : "text-amber-400 bg-amber-500/10")}>
                        {p.team}
                      </span>
                    </button>
                  );
                })}
                {addCandidates.length === 0 && (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    {addSearch ? `No players matching "${addSearch}"` : "All players are already in this session."}
                  </div>
                )}
              </div>
              {/* Create new player option */}
              <div className="border-t border-border/50 px-4 py-3">
                <button
                  onClick={() => {
                    setAddStep("new-player");
                    setNewPlayerForm((f) => ({
                      ...f,
                      name: addSearch.trim(),
                      code: "",
                      team: "Sharks",
                      primary_position: "Forward",
                      age_range: "",
                    }));
                  }}
                  className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                >
                  + Create new player{addSearch.trim() ? ` "${addSearch.trim()}"` : ""}
                </button>
              </div>
            </div>
          )}

          {/* Step: result entry */}
          {addStep === "result" && addSelectedPlayer && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className={cn("text-[10px] font-bold font-time", getPos(addSelectedPlayer.primary_position).text)}>
                  {addSelectedPlayer.primary_position?.slice(0, 3) || "?"}
                </span>
                <span className="text-sm font-semibold text-foreground">{addSelectedPlayer.name}</span>
                <span className="text-[11px] text-muted-foreground font-time">{addSelectedPlayer.code}</span>
                <button
                  onClick={() => setAddStep("search")}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                >
                  ← Change
                </button>
              </div>
              <InlineEditForm
                form={addResultForm}
                saving={addSaving}
                onChange={setAddResultForm}
                onSave={handleSaveAddResult}
                onCancel={closeAddPanel}
                saveLabel="Save result"
              />
            </div>
          )}

          {/* Step: new player form */}
          {addStep === "new-player" && (
            <div className="px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name *</label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Full name"
                    value={newPlayerForm.name}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Code *</label>
                  <input
                    type="text"
                    placeholder="e.g. JD01"
                    value={newPlayerForm.code}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, code: e.target.value }))}
                    className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm font-time text-foreground placeholder:text-muted-foreground outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Team</label>
                  <select
                    value={newPlayerForm.team}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, team: e.target.value as "Sharks" | "Wildcats" }))}
                    className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value="Sharks">Sharks</option>
                    <option value="Wildcats">Wildcats</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Position</label>
                  <select
                    value={newPlayerForm.primary_position}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, primary_position: e.target.value }))}
                    className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value="Forward">Forward</option>
                    <option value="Midfielder">Midfielder</option>
                    <option value="Defender">Defender</option>
                    <option value="Goalkeeper">Goalkeeper</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Age group</label>
                  <select
                    value={newPlayerForm.age_range}
                    onChange={(e) => setNewPlayerForm((f) => ({ ...f, age_range: e.target.value as typeof f.age_range }))}
                    className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value="">— select —</option>
                    <option value="U18">U18</option>
                    <option value="18-24">18–24</option>
                    <option value="25+">25+</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveNewPlayer}
                  disabled={!newPlayerForm.name.trim() || !newPlayerForm.code.trim() || newPlayerSaving}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 transition-colors"
                >
                  {newPlayerSaving ? "Creating…" : "Create player & continue"}
                </button>
                <button
                  onClick={() => setAddStep("search")}
                  className="px-3 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metric strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 border border-border rounded-2xl overflow-hidden divide-x divide-y sm:divide-y-0 divide-border bg-card">
        {[
          { label: "Tested",   value: testedParticipants.length,  sub: "with bronco score" },
          { label: "Absent",   value: absentees.length,            sub: "no result recorded" },
          { label: "Best",     value: formatBroncho(best?.bronco_mins ?? null),  sub: best?.players.name ?? "—" },
          { label: "Slowest",  value: formatBroncho(worst?.bronco_mins ?? null), sub: worst?.players.name ?? "—" },
          { label: "Avg",      value: formatBroncho(avg),          sub: "team average" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="py-4 px-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</div>
            <div className="text-2xl font-bold font-time leading-none text-foreground">{value}</div>
            <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>
          </div>
        ))}
      </div>

      {/* Participant cards */}
      {participants.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Participants — {participants.length} recorded
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {participants.map((r, idx) => {
              const testedIdx = testedParticipants.findIndex((t) => t.id === r.id);
              const isFirst = testedIdx === 0 && r.bronco_mins !== null;
              const isLast = testedIdx === testedParticipants.length - 1 && testedParticipants.length > 1 && r.bronco_mins !== null;
              const pos = getPos(r.players.primary_position);
              const barPct = r.bronco_mins !== null && maxBronco !== minBronco
                ? Math.round(100 - ((r.bronco_mins - minBronco) / range) * 80)
                : r.bronco_mins !== null ? 100 : 0;
              const isEditing = editingId === r.id;

              return (
                <div
                  key={r.id}
                  className={cn(
                    "bg-card border rounded-xl p-4 flex flex-col gap-2.5",
                    isFirst
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : isLast
                      ? "border-red-500/30 bg-red-500/5"
                      : "border-border"
                  )}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-time",
                        isFirst ? "bg-emerald-500/20 text-emerald-400"
                          : isLast ? "bg-red-500/15 text-red-400"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {testedIdx >= 0 ? testedIdx + 1 : idx + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-sm text-foreground leading-tight">{r.players.name}</div>
                        <div className="font-time text-[10px] text-muted-foreground">{r.players.code}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {editMode && (
                        <>
                          <button
                            onClick={() => isEditing ? setEditingId(null) : handleStartEdit(r)}
                            className="p-1 rounded text-muted-foreground hover:text-indigo-400 transition-colors"
                            title="Edit result"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={saving}
                            className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
                            title="Delete result"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[10px] font-bold font-time", pos.text, pos.bg)}>
                          {r.players.primary_position?.slice(0, 3) || "?"}
                        </span>
                        {r.players.age_range && (
                          <span className="text-[10px] text-muted-foreground font-time">{r.players.age_range}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Time + bar */}
                  {r.bronco_mins !== null ? (
                    <div>
                      <div className={cn(
                        "text-2xl font-bold font-time leading-none mb-1.5",
                        isFirst ? "text-emerald-400" : isLast ? "text-red-400" : "text-foreground"
                      )}>
                        {formatBroncho(r.bronco_mins)}
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500",
                            isFirst ? "bg-emerald-400" : isLast ? "bg-red-400" : "bg-indigo-400"
                          )}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">No broncho time</div>
                  )}

                  {/* Sprint times */}
                  {(r.ten_m_1 !== null || r.twenty_m_1 !== null || r.forty_m_1 !== null || r.mas_ms !== null) && (
                    <div className="flex flex-wrap gap-3 pt-0.5">
                      {r.mas_ms !== null && <span className="text-[11px] text-muted-foreground font-time">MAS: {r.mas_ms}m/s</span>}
                      {r.ten_m_1 !== null && <span className="text-[11px] text-muted-foreground font-time">10m: {r.ten_m_1.toFixed(2)}s</span>}
                      {r.twenty_m_1 !== null && <span className="text-[11px] text-muted-foreground font-time">20m: {r.twenty_m_1.toFixed(2)}s</span>}
                      {r.forty_m_1 !== null && <span className="text-[11px] text-muted-foreground font-time">40m: {r.forty_m_1.toFixed(2)}s</span>}
                    </div>
                  )}

                  {/* Label tag */}
                  {(isFirst || isLast) && (
                    <div className={cn(
                      "text-[10px] font-semibold uppercase tracking-widest",
                      isFirst ? "text-emerald-500" : "text-red-400/70"
                    )}>
                      {isFirst ? "Best time" : "Slowest"}
                    </div>
                  )}

                  {/* Inline edit form */}
                  {isEditing && (
                    <InlineEditForm
                      form={editForm}
                      saving={saving}
                      onChange={setEditForm}
                      onSave={handleSaveEdit}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Absent players */}
      {absentees.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Absent — {absentees.length} not tested
          </div>
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap gap-2">
              {absentees.map((p) => {
                const pos = getPos(p.primary_position);
                const addKey = `add:${p.id}`;
                const isAdding = editingId === addKey;
                return (
                  <div key={p.id} className={cn(
                    "rounded-lg border border-border/50 overflow-hidden",
                    isAdding ? "w-full" : "inline-block"
                  )}>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/60">
                      <span className={cn("text-[10px] font-bold font-time", pos.text)}>{p.primary_position?.slice(0, 3) || "?"}</span>
                      <span className="text-sm text-foreground">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground font-time">{p.code}</span>
                      {editMode && !isAdding && (
                        <button
                          onClick={() => handleStartAdd(p.id)}
                          className="ml-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    {isAdding && (
                      <div className="p-3 border-t border-border/50">
                        <InlineEditForm
                          form={editForm}
                          saving={saving}
                          onChange={setEditForm}
                          onSave={() => handleSaveAdd(p.id)}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {participants.length === 0 && results.length === 0 && (
        <EmptyState icon={Dumbbell} title="No results recorded" description="This session has no test results yet." />
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function FitnessTests() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<TestSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("list");

  // Session detail
  const [selectedSession, setSelectedSession] = useState<TestSession | null>(null);

  // New session details (not saved until confirm)
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");

  // Data entry state
  const [csvText, setCsvText] = useState("");
  const [manualRows, setManualRows] = useState<CsvRow[]>([{ code: "", name: "" }]);
  const [useManual, setUseManual] = useState(false);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSessions();
      setSessions(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleOpenSession = (s: TestSession) => {
    setSelectedSession(s);
    setStep("session-detail");
  };

  const handleGoToDataEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast({ title: "Session name is required", variant: "destructive" });
      return;
    }
    try {
      const players = await fetchPlayers();
      setAllPlayers(players);
      setStep("enter-data");
    } catch (err: unknown) {
      toast({ title: "Failed to load players", description: String(err), variant: "destructive" });
    }
  };

  const handlePreview = () => {
    const rows: CsvRow[] = useManual ? manualRows.filter((r) => r.code || r.name) : parseCsv(csvText);
    if (!rows.length) {
      toast({ title: "No data to preview", variant: "destructive" });
      return;
    }
    const matchedRows = rows.map((row) => {
      const player = allPlayers.find(
        (p) =>
          (row.code && p.code.toLowerCase() === row.code.toLowerCase()) ||
          (row.name && p.name.toLowerCase() === row.name.toLowerCase())
      ) ?? null;
      return { row, player };
    });
    setMatched(matchedRows);
    setStep("preview");
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const session = await createSession({ test_date: newDate, test_name: newName, type: newType.trim() || null, notes: null });
      const results: Omit<TestResult, "id" | "created_at">[] = matched
        .filter((m) => m.player !== null)
        .map((m) => ({
          session_id: session.id,
          player_id: m.player!.id,
          bronco_mins: m.row.bronco_mins ?? null,
          mas_ms: null,
          seconds: null,
          ten_m_1: m.row.ten_m_1 ?? null,
          ten_m_2: m.row.ten_m_2 ?? null,
          twenty_m_1: m.row.twenty_m_1 ?? null,
          twenty_m_2: m.row.twenty_m_2 ?? null,
          forty_m_1: m.row.forty_m_1 ?? null,
          forty_m_2: m.row.forty_m_2 ?? null,
          eighty_m_runs: null,
          sixty_m_runs: null,
          forty_m_runs: null,
          notes: m.row.notes ?? null,
        }));
      await bulkInsertResults(results);
      toast({ title: `Saved ${results.length} results` });
      await loadSessions();
      setStep("list");
      setNewName("");
      setNewDate(new Date().toISOString().split("T")[0]);
      setNewType("");
      setCsvText("");
      setManualRows([{ code: "", name: "" }]);
    } catch (err: unknown) {
      toast({ title: "Failed to save results", description: String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setStep("list");
    setNewName("");
    setNewDate(new Date().toISOString().split("T")[0]);
    setNewType("");
    setCsvText("");
    setManualRows([{ code: "", name: "" }]);
  };

  // ── Session detail ───────────────────────────────────────────────────────
  if (step === "session-detail" && selectedSession) {
    return <SessionDetail session={selectedSession} onBack={() => setStep("list")} />;
  }

  // ── Create session ───────────────────────────────────────────────────────
  if (step === "create-session") {
    return (
      <div className="space-y-5 max-w-lg">
        <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold text-foreground mb-4">New Test Session</h2>
          <form onSubmit={handleGoToDataEntry} className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Session Date</label>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground" data-testid="input-session-date" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Session Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Pre-season Test 1"
                className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground" data-testid="input-session-name" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Test Type <span className="text-muted-foreground/50">(optional)</span></label>
              <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Broncho, Sprint, Agility"
                className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground" data-testid="input-session-type" />
              <p className="text-[11px] text-muted-foreground mt-1">Sessions of the same type will be compared together in Analytics.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={handleCancel} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button>
              <button type="submit" className="flex-1 px-4 py-2 btn-primary text-white rounded-xl text-sm font-semibold" data-testid="button-create-session">Next →</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── Enter data ───────────────────────────────────────────────────────────
  if (step === "enter-data") {
    return (
      <div className="space-y-5 max-w-2xl">
        <button onClick={() => setStep("create-session")} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold text-foreground mb-1">Enter Results</h2>
          <p className="text-xs text-muted-foreground mb-4">Session: {newName} — {newDate}</p>

          <div className="flex gap-2 mb-4">
            <button onClick={() => setUseManual(false)} className={`text-sm px-3.5 py-1.5 rounded-lg font-medium transition-all ${!useManual ? "bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30" : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"}`} data-testid="button-tab-csv">CSV Upload</button>
            <button onClick={() => setUseManual(true)} className={`text-sm px-3.5 py-1.5 rounded-lg font-medium transition-all ${useManual ? "bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30" : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"}`} data-testid="button-tab-manual">Manual Entry</button>
          </div>

          {!useManual ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">CSV columns: code, name, bronco_mins, ten_m_1, ten_m_2, twenty_m_1, twenty_m_2, forty_m_1, forty_m_2, notes</p>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Upload CSV file</label>
                <input type="file" accept=".csv,text/csv" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setCsvText(ev.target?.result as string);
                  reader.readAsText(file);
                }} className="text-sm text-muted-foreground" data-testid="input-csv-file" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Or paste CSV text</label>
                <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={8}
                  placeholder={"code,name,bronco_mins,ten_m_1,...\nP001,Jane,6.25,1.82,..."}
                  className="w-full bg-muted border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid="textarea-csv" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {manualRows.map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <input value={row.code} onChange={(e) => { const rs = [...manualRows]; rs[i] = { ...rs[i], code: e.target.value }; setManualRows(rs); }} placeholder="Code" className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground" />
                  <input value={row.name} onChange={(e) => { const rs = [...manualRows]; rs[i] = { ...rs[i], name: e.target.value }; setManualRows(rs); }} placeholder="Name" className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground" />
                  <input value={row.bronco_mins ?? ""} onChange={(e) => { const rs = [...manualRows]; rs[i] = { ...rs[i], bronco_mins: parseFloat(e.target.value) || undefined }; setManualRows(rs); }} placeholder="Broncho (mins)" type="number" step="0.01" className="bg-muted border border-border rounded px-2 py-1.5 text-sm text-foreground" />
                </div>
              ))}
              <button onClick={() => setManualRows([...manualRows, { code: "", name: "" }])} className="text-xs text-primary hover:underline" data-testid="button-add-row">+ Add row</button>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="button" onClick={() => setStep("create-session")} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Back</button>
            <button onClick={handlePreview} className="flex-1 px-4 py-2 btn-primary text-white rounded-xl text-sm font-semibold" data-testid="button-preview">Preview →</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Preview ──────────────────────────────────────────────────────────────
  if (step === "preview") {
    const matchedCount = matched.filter((m) => m.player).length;
    const unmatchedCount = matched.filter((m) => !m.player).length;
    return (
      <div className="space-y-5">
        <button onClick={() => setStep("enter-data")} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold text-foreground mb-2">Preview Results</h2>
          <p className="text-xs text-muted-foreground mb-3">Session will be created when you confirm below.</p>
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={14} />{matchedCount} matched</span>
            {unmatchedCount > 0 && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={14} />{unmatchedCount} unmatched (skipped)</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="preview-table">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Matched Player</th>
                  <th className="px-3 py-2 text-right font-medium">Broncho</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((m, i) => (
                  <tr key={i} className={`border-b border-border/50 ${m.player ? "bg-emerald-950/20" : "bg-red-950/20"}`} data-testid={`row-preview-${i}`}>
                    <td className="px-3 py-2">{m.player ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertCircle size={14} className="text-red-400" />}</td>
                    <td className="px-3 py-2 font-time text-xs text-muted-foreground">{m.row.code}</td>
                    <td className="px-3 py-2 text-foreground">{m.row.name}</td>
                    <td className="px-3 py-2 text-foreground">{m.player?.name ?? <span className="text-red-400 text-xs">No match found</span>}</td>
                    <td className="px-3 py-2 text-right font-time">{formatBroncho(m.row.bronco_mins ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 pt-4">
            <button onClick={() => setStep("enter-data")} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Back</button>
            <button onClick={handleConfirm} disabled={submitting || matchedCount === 0} className="flex-1 px-4 py-2 btn-primary text-white rounded-xl text-sm font-semibold disabled:opacity-60" data-testid="button-confirm-save">
              {submitting ? "Saving…" : `Save ${matchedCount} Results`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Fitness <span className="text-indigo-500 dark:text-indigo-400">Tests</span></h1>
          <p className="text-sm text-muted-foreground mt-1">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setStep("create-session")}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-indigo-500/50 text-indigo-400 text-sm font-medium hover:bg-indigo-500/10 transition-colors"
          data-testid="button-new-session"
        >
          <Plus size={13} />
          New Session
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={4} /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No sessions yet" description="Create a new test session to get started" action={
            <button onClick={() => setStep("create-session")} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-indigo-500/50 text-indigo-400 text-sm font-medium hover:bg-indigo-500/10 transition-colors" data-testid="button-new-session-empty"><Plus size={13} />New Session</button>
          } />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sessions-table">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Session Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => handleOpenSession(s)}
                    className="border-b border-border/50 hover:bg-muted/40 cursor-pointer transition-colors"
                    data-testid={`row-session-${s.id}`}
                  >
                    <td className="px-4 py-3 font-time text-muted-foreground text-xs">{s.test_date}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{s.test_name}</td>
                    <td className="px-4 py-3">
                      {s.type ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          {s.type}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{s.notes ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground"><ChevronRight size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
