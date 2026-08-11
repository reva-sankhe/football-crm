import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TournamentsTab } from "@/components/tournaments/TournamentsTab";
import { FriendliesTab } from "@/components/tournaments/FriendliesTab";
import { OverviewTab } from "@/components/tournaments/OverviewTab";

type Tab = "tournaments" | "friendlies" | "overview";

const TABS: Tab[] = ["tournaments", "friendlies", "overview"];

/**
 * Everything played against an opponent: tournaments, the friendlies that belong
 * to none, and what the results across both add up to.
 *
 * The tab lives in the query string rather than in component state so every list
 * is linkable — which is what lets a friendly's match page send you back to the
 * one you came from. `?tab=friendlies` and `?tab=overview` select those;
 * anything else, the bare path included, selects Tournaments.
 */
export default function Tournaments() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "tournaments";

  // Replace rather than push — flipping tabs shouldn't fill up the back button
  const setTab = (v: string) =>
    setLocation(v === "tournaments" ? "/tournaments" : `/tournaments?tab=${v}`, { replace: true });

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="justify-end">
          <TabsTrigger value="tournaments" data-testid="tab-tournaments">Tournaments</TabsTrigger>
          <TabsTrigger value="friendlies" data-testid="tab-friendlies">Friendlies</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="tournaments" className="mt-0">
          <TournamentsTab />
        </TabsContent>

        <TabsContent value="friendlies" className="mt-0">
          <FriendliesTab />
        </TabsContent>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
