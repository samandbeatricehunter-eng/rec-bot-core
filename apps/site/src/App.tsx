import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { SiteShell } from "./components/SiteShell.js";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { HubProvider } from "./lib/hub-context.js";
import { SiteThemeProvider } from "./lib/site-theme-context.js";
import { Account } from "./routes/Account.js";
import { Friends } from "./routes/Friends.js";
import { Inbox } from "./routes/Inbox.js";
import { Landing } from "./routes/Landing.js";
import { LogIn } from "./routes/LogIn.js";
import {
  CompPage,
  HeadlinesPage,
  HomePage,
  LeagueBuzzPage,
  LeagueMatchupsPage,
  LeagueMgmtInboxPage,
  LeagueMgmtPage,
  LeagueStorePage,
  LeagueTeamPage,
  LeaguesPage,
} from "./routes/placeholders.js";
import { Pricing } from "./routes/Pricing.js";
import { SignUp } from "./routes/SignUp.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { OpenApp } from "./routes/OpenApp.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <div className="site-page site-loading">Loading…</div>;
  }
  if (auth.status === "signed-out") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthedLayout() {
  return (
    <RequireAuth>
      <HubProvider>
        <SiteShell>
          <Outlet />
        </SiteShell>
      </HubProvider>
    </RequireAuth>
  );
}

function RootEntry() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <div className="site-page site-loading">Loading…</div>;
  }
  if (auth.status === "signed-in") return <Navigate to="/home" replace />;
  return <Landing />;
}

function Routed() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <div className="site-page site-loading">Loading…</div>;
  }
  return (
    <Routes>
      <Route path="/" element={<RootEntry />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<LogIn />} />
      <Route path="/open-app" element={<OpenApp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route path="/pricing" element={<Pricing />} />

      <Route element={<AuthedLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/leagues" element={<LeaguesPage />} />
        <Route path="/headlines" element={<HeadlinesPage />} />
        <Route path="/comp" element={<CompPage />} />
        <Route path="/account" element={<Account />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/l/:leagueId/buzz" element={<LeagueBuzzPage />} />
        <Route path="/l/:leagueId/matchups" element={<LeagueMatchupsPage />} />
        <Route path="/l/:leagueId/team" element={<LeagueTeamPage />} />
        <Route path="/l/:leagueId/store" element={<LeagueStorePage />} />
        <Route path="/l/:leagueId/mgmt" element={<LeagueMgmtPage />} />
        <Route path="/l/:leagueId/mgmt/inbox" element={<LeagueMgmtInboxPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SiteThemeProvider>
          <Routed />
        </SiteThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
