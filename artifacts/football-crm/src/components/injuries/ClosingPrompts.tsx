import { useState } from "react";
import { Link } from "wouter";
import { Activity } from "lucide-react";
import { STAGE_CFG, injuryLabel, type ClosingPrompt } from "@/lib/injuries";
import { InjuryDialog } from "./InjuryDialog";
import type { Player } from "@/lib/types";

/**
 * Open injuries with something to ask — see `closingPrompt` for when. Each
 * row opens the injury with the suggested stage and date already filled in,
 * so answering is one tap when the suggestion is right.
 */
export function ClosingPrompts({
  prompts,
  players,
  onChanged,
  showPlayer = true,
}: {
  prompts: ClosingPrompt[];
  players: Player[];
  onChanged: () => void;
  /** Off on the player's own page, where the name is the heading. */
  showPlayer?: boolean;
}) {
  const [open, setOpen] = useState<ClosingPrompt | null>(null);
  const byId = new Map(players.map((p) => [p.id, p]));
  if (prompts.length === 0) return null;

  return (
    <>
      <ul className="divide-y divide-border/60" data-testid="closing-prompts">
        {prompts.map((p) => {
          const player = byId.get(p.injury.player_id);
          return (
            <li key={p.injury.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <Activity size={14} className={p.stage === "out" ? "text-status-bad shrink-0" : "text-status-warn shrink-0"} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">
                  {showPlayer && player && (
                    <Link href={`/players/${player.id}`} className="font-medium hover:text-indigo-400 transition-colors">{player.name}</Link>
                  )}
                  {showPlayer && player && " · "}
                  {injuryLabel(p.injury)}
                  <span className="text-muted-foreground"> · {STAGE_CFG[p.stage].label}</span>
                </div>
                <div className="text-xs text-muted-foreground">{p.message}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(p)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-foreground hover:bg-muted/40 transition-colors"
                data-testid={`button-answer-prompt-${p.injury.id}`}
              >
                Update
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <InjuryDialog
          injury={open.injury}
          player={byId.get(open.injury.player_id)}
          prompt={open}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
