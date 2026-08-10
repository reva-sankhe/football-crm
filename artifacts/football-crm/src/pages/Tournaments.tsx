import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TournamentsTab } from "@/components/tournaments/TournamentsTab";
import { FriendliesTab } from "@/components/tournaments/FriendliesTab";

type Tab = "tournaments" | "friendlies";

/**
 * Everything played against an opponent: tournaments and the friendlies that
 * belong to none.
 *
 * The tab lives in the query string rather than in component state so both lists
 * are linkable — which is what lets a friendly's match page send you back to the
 * list you came from. `?tab=friendlies` selects Friendlies; anything else, the
 * bare path included, selects Tournaments.
 */
export default function Tournaments() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const tab: Tab = new URLSearchParams(search).get("tab") === "friendlies" ? "friendlies" : "tournaments";

  // Replace rather than push — flipping tabs shouldn't fill up the back button
  const setTab = (v: string) =>
    setLocation(v === "friendlies" ? "/tournaments?tab=friendlies" : "/tournaments", { replace: true });

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="justify-end">
          <TabsTrigger value="tournaments" data-testid="tab-tournaments">Tournaments</TabsTrigger>
          <TabsTrigger value="friendlies" data-testid="tab-friendlies">Friendlies</TabsTrigger>
        </TabsList>

        <TabsContent value="tournaments" className="mt-0">
          <TournamentsTab />
        </TabsContent>

        <TabsContent value="friendlies" className="mt-0">
          <FriendliesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
