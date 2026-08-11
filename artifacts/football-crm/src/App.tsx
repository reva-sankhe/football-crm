import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamProvider } from "@/context/TeamContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Players from "@/pages/Players";
import PlayerDetail from "@/pages/PlayerDetail";
import Analytics from "@/pages/Analytics";
import Sessions from "@/pages/Sessions";
import SessionRPE from "@/pages/SessionRPE";
import SessionDetail from "@/pages/SessionDetail";
import Attendance from "@/pages/Attendance";
import Tournaments from "@/pages/Tournaments";
import TournamentDetail from "@/pages/TournamentDetail";
import MatchDetail from "@/pages/MatchDetail";
import PlayerReports from "@/pages/PlayerReports";
import TournamentReport from "@/pages/TournamentReport";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Print reports render outside the app chrome — no sidebar, no nav */}
      <Route path="/reports/players" component={PlayerReports} />
      <Route path="/reports/tournament" component={TournamentReport} />
      <Route>
        <AppShell />
      </Route>
    </Switch>
  );
}

function AppShell() {
  return (
    <Layout>
      <Switch>
        {/* Analytics is the landing page; Dashboard is hidden from the nav but
            still reachable at its own path */}
        <Route path="/"><Redirect to="/analytics" /></Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/players" component={Players} />
        <Route path="/players/:id" component={PlayerDetail} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/sessions/:id/rpe" component={SessionRPE} />
        <Route path="/sessions/:id" component={SessionDetail} />
        <Route path="/tournaments" component={Tournaments} />
        <Route path="/tournaments/:id" component={TournamentDetail} />
        <Route path="/matches/:id" component={MatchDetail} />
        <Route path="/attendance" component={Attendance} />
        {/* Legacy links — the calendar became Attendance, Fitness Tests became a
            tab on Sessions */}
        <Route path="/calendar"><Redirect to="/attendance" /></Route>
        <Route path="/fitness"><Redirect to="/sessions" /></Route>
        <Route path="/analytics" component={Analytics} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <TeamProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </TeamProvider>
          <Toaster />
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
