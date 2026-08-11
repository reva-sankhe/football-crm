import { useLocation, useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FitnessTests from "@/pages/FitnessTests";
import { OverviewTab } from "@/components/fitness/OverviewTab";

type Tab = "tests" | "overview";

const TABS: Tab[] = ["tests", "overview"];

/**
 * Fitness: the test records, and what those results say.
 *
 * Analytics sit beside the data they describe rather than on a page of their
 * own — the same shape as Tournaments and Players. The tab lives in the query
 * string so every view is linkable; `?tab=overview` selects the Overview and
 * anything else, the bare path included, selects Tests.
 */
export default function Fitness() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "tests";

  // Replace rather than push — flipping tabs shouldn't fill up the back button
  const setTab = (v: string) =>
    setLocation(v === "tests" ? "/fitness" : `/fitness?tab=${v}`, { replace: true });

  return (
    <div className="space-y-5">
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="justify-end">
          <TabsTrigger value="tests" data-testid="tab-tests">Tests</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-fitness-overview">Overview</TabsTrigger>
        </TabsList>

        {/* Self-contained: its own step machine, no routing of its own */}
        <TabsContent value="tests" className="mt-0">
          <FitnessTests />
        </TabsContent>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
