import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { SectionLabel } from "@/components/StatTile";
import { AddButton } from "@/components/AddButton";
import {
  createTournamentLink, deleteTournamentLink, fetchTournamentLinks, updateTournamentLink,
} from "@/lib/queries";
import type { TournamentLink } from "@/lib/types";

/**
 * Bare domains ("drive.google.com/…") are what people paste, but an href
 * without a scheme resolves relative to the app and navigates nowhere useful.
 */
function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** "drive.google.com" — the host, as a quiet hint under the title. */
function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinksArchive({ tournamentId }: { tournamentId: string }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<TournamentLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", url: "" });

  const load = useCallback(async () => {
    try {
      setLinks(await fetchTournamentLinks(tournamentId));
    } catch (err) {
      toast({ title: "Failed to load links", description: String(err), variant: "destructive" });
    }
  }, [tournamentId, toast]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ title: "", url: "" });
    setAdding(true);
  };

  const openEdit = (link: TournamentLink) => {
    setEditingId(link.id);
    setForm({ title: link.title, url: link.url });
    setAdding(true);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ title: "", url: "" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.url.trim()) {
      toast({ title: "Title and URL are both required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const fields = { title: form.title.trim(), url: normalizeUrl(form.url) };
      if (editingId) {
        await updateTournamentLink(editingId, fields);
        toast({ title: "Link updated" });
      } else {
        await createTournamentLink({ tournament_id: tournamentId, ...fields });
        toast({ title: "Link added" });
      }
      cancel();
      load();
    } catch (err) {
      toast({ title: "Failed to save link", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (link: TournamentLink) => {
    if (!window.confirm(`Remove "${link.title}" from the archive?`)) return;
    try {
      await deleteTournamentLink(link.id);
      toast({ title: "Link removed" });
      load();
    } catch (err) {
      toast({ title: "Failed to remove link", description: String(err), variant: "destructive" });
    }
  };

  const inputCls =
    "w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionLabel>Links</SectionLabel>
        <span className="text-[10px] text-muted-foreground font-time">{links.length}</span>
        {!adding && <AddButton label="Add link" onClick={openAdd} data-testid="button-add-link" />}
      </div>

      {adding && (
        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Pictures"
                className={inputCls}
                data-testid="input-link-title"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">URL</label>
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="drive.google.com/…"
                className={inputCls}
                data-testid="input-link-url"
                required
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
              data-testid="button-save-link"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add link"}
            </button>
          </div>
        </form>
      )}

      {links.length === 0 && !adding ? (
        <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">No links yet</p>
          <button onClick={openAdd} className="mt-2 text-sm text-indigo-400 hover:text-indigo-300">
            Add a photo album, fixture list or results page
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3"
              data-testid={`row-link-${l.id}`}
            >
              <a
                href={normalizeUrl(l.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 group"
              >
                <div className="text-sm font-medium text-foreground group-hover:text-indigo-400 transition-colors truncate">
                  {l.title}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{hostOf(l.url)}</div>
              </a>
              <a
                href={normalizeUrl(l.url)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${l.title}`}
                title="Open in a new tab"
                className={cn("p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors")}
              >
                <ExternalLink size={13} />
              </a>
              <button
                onClick={() => openEdit(l)}
                aria-label={`Edit ${l.title}`}
                title="Edit link"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                data-testid={`button-edit-link-${l.id}`}
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => remove(l)}
                aria-label={`Remove ${l.title}`}
                title="Remove link"
                className="p-1 rounded text-muted-foreground hover:text-status-bad transition-colors"
                data-testid={`button-delete-link-${l.id}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
