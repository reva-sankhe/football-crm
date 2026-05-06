import { createContext, useContext, useState } from "react";
import type { Team } from "@/lib/types";

interface TeamContextValue {
  team: Team;
  setTeam: (team: Team) => void;
}

const TeamContext = createContext<TeamContextValue>({
  team: "Sharks",
  setTeam: () => {},
});

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const [team, setTeam] = useState<Team>("Sharks");
  return (
    <TeamContext.Provider value={{ team, setTeam }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
