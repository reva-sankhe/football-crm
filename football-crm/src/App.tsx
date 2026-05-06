import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TeamProvider } from "@/context/TeamContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Players from "@/pages/Players";
import PlayerDetail from "@/pages/PlayerDetail";
import FitnessTests from "@/pages/FitnessTests";
import Analytics from "@/pages/Analytics";
import Sessions from "@/pages/Sessions";
import SessionRPE from "@/pages/SessionRPE";
import SessionDetail from "@/pages/SessionDetail";
import CalendarPage from "@/pages/CalendarPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/players" component={Players} />
        <Route path="/players/:id" component={PlayerDetail} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/sessions/:id/rpe" component={SessionRPE} />
        <Route path="/sessions/:id" component={SessionDetail} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/fitness" component={FitnessTests} />
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
