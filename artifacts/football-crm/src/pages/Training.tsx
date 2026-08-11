import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionsTab } from "@/components/training/SessionsTab";
import { OverviewTab } from "@/components/training/OverviewTab";

type Tab = "sessions" | "overview";

const TABS: Tab[] = ["sessions", "overview"];

/**
 * Training: the session archive, and what the load across those sessions says.
 *
 * Analytics sit beside the data they describe rather than on a page of their
 * own — the same shape as Tournaments and Players. The tab lives in the query
 * string so every view is linkable; `?tab=overview` selects the Overview and
 * anything else, the bare path included, selects Sessions.
 */
export default function Training() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "sessions";

  // Replace rather than push — flipping tabs shouldn't fill up the back button
  const setTab = (v: string) =>
    setLocation(v === "sessions" ? "/training" : `/training?tab=${v}`, { replace: true });

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="justify-end">
          <TabsTrigger value="sessions" data-testid="tab-sessions">Sessions</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-training-overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-0">
          <SessionsTab />
        </TabsContent>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
