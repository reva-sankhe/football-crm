import { useTeam } from "@/context/TeamContext";
import { cn } from "@/lib/utils";
import type { Team } from "@/lib/types";

const TEAMS: { id: Team; label: string }[] = [
  { id: "Sharks", label: "Sharks" },
  { id: "Wildcats", label: "Wildcats" },
];

export function TeamSwitcher() {
  const { team, setTeam } = useTeam();

  return (
    <div
      className="inline-flex p-0.5 rounded-lg bg-muted border border-border"
      data-testid="team-switcher"
    >
      {TEAMS.map(({ id, label }) => (
        <button
          key={id}
          data-testid={`team-switch-${id.toLowerCase()}`}
          onClick={() => setTeam(id)}
          className={cn(
            "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-150",
            team === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
