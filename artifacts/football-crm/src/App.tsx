import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Players from "@/pages/Players";
import PlayerDetail from "@/pages/PlayerDetail";
import Training from "@/pages/Training";
import Fitness from "@/pages/Fitness";
import SessionRPE from "@/pages/SessionRPE";
import SessionDetail from "@/pages/SessionDetail";
import Attendance from "@/pages/Attendance";
import Calendar from "@/pages/Calendar";
import Tournaments from "@/pages/Tournaments";
import TournamentDetail from "@/pages/TournamentDetail";
import MatchDetail from "@/pages/MatchDetail";
import PlayerReports from "@/pages/PlayerReports";
import TournamentReport from "@/pages/TournamentReport";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  const { role } = useAuth();

  if (!role) {
    return <Login />;
  }

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
        {/* Players is the landing page; Dashboard is hidden from the nav but
            still reachable at its own path */}
        <Route path="/"><Redirect to="/players" /></Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/players" component={Players} />
        <Route path="/players/:id" component={PlayerDetail} />
        <Route path="/training" component={Training} />
        <Route path="/training/:id/rpe" component={SessionRPE} />
        <Route path="/training/:id" component={SessionDetail} />
        <Route path="/fitness" component={Fitness} />
        <Route path="/tournaments" component={Tournaments} />
        <Route path="/tournaments/:id" component={TournamentDetail} />
        <Route path="/matches/:id" component={MatchDetail} />
        <Route path="/attendance" component={Attendance} />
        <Route path="/calendar" component={Calendar} />
        {/* Legacy links. Sessions split into Training and Fitness, each carrying
            the analytics that used to sit on the Analytics page — six of its
            seven tabs were fitness tests. */}
        <Route path="/sessions/:id/rpe">{(p) => <Redirect to={`/training/${p.id}/rpe`} />}</Route>
        <Route path="/sessions/:id">{(p) => <Redirect to={`/training/${p.id}`} />}</Route>
        <Route path="/sessions"><Redirect to="/training" /></Route>
        <Route path="/analytics"><Redirect to="/fitness?tab=overview" /></Route>
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
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
