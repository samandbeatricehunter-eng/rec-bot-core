import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { SiteShell } from "./components/SiteShell.js";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { HubProvider, useHub } from "./lib/hub-context.js";
import { SiteThemeProvider } from "./lib/site-theme-context.js";
import { Account } from "./routes/Account.js";
import { Friends } from "./routes/Friends.js";
import { Inbox } from "./routes/Inbox.js";
import { Landing } from "./routes/Landing.js";
import { LogIn } from "./routes/LogIn.js";
import {
  CompPage,
  HeadlinesPage,
  LeagueMgmtInboxPage,
} from "./routes/placeholders.js";
import { HomePage } from "./routes/Home.js";
import { LeaguesPage } from "./routes/Leagues.js";
import { LeagueHubPage } from "./routes/LeagueHub.js";
import { Pricing } from "./routes/Pricing.js";
import { SignUp } from "./routes/SignUp.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { OpenApp } from "./routes/OpenApp.js";

function formatCaughtError(error: unknown, info?: ErrorInfo): string {
  const parts: string[] = [];
  if (typeof error === "string" && error.trim()) {
    parts.push(error.trim());
  } else if (error && typeof error === "object") {
    const name = "name" in error ? String((error as { name?: unknown }).name ?? "").trim() : "";
    const msg = "message" in error ? String((error as { message?: unknown }).message ?? "").trim() : "";
    if (name && msg) parts.push(`${name}: ${msg}`);
    else if (msg) parts.push(msg);
    else if (name) parts.push(`${name} (empty message)`);
    const stack = "stack" in error ? String((error as { stack?: unknown }).stack ?? "") : "";
    if (stack) {
      const lines = stack.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4);
      if (lines.length) parts.push(lines.join(" | "));
    }
  }
  if (info?.componentStack) {
    const lines = info.componentStack.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4);
    if (lines.length) parts.push(`at ${lines.join(" < ")}`);
  }
  if (!parts.length) {
    try {
      const asString = String(error);
      if (asString && asString !== "[object Object]") parts.push(asString);
    } catch {
      /* ignore */
    }
  }
  return parts.join(" — ") || "Something went wrong.";
}

function resetDocumentThemeToApp() {
  const root = document.documentElement;
  root.setAttribute("data-site-theme", "app");
  root.removeAttribute("data-game-theme");
}

/** Keeps auth/shell mounted; only the route outlet is replaced on failure. */
class OutletErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: formatCaughtError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Route outlet crash", error, info);
    resetDocumentThemeToApp();
    this.setState({ error: formatCaughtError(error, info) });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="site-page site-auth-page">
          <div className="site-auth-card">
            <h1>Page error</h1>
            <p className="site-auth-error" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {this.state.error}
            </p>
            <p className="site-muted">
              Try another page from the sidebar, or refresh. If this is a league hub crash, the
              message above is the underlying error.
            </p>
            <div className="site-league-demo-links">
              <a className="site-btn site-btn-primary" href="/leagues">
                Open Leagues
              </a>
              <a className="site-btn site-btn-ghost" href="/home">
                Home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: formatCaughtError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Site root crash", error, info);
    resetDocumentThemeToApp();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="site-page site-auth-page" data-site-theme="app">
          <div className="site-auth-card">
            <h1>Page error</h1>
            <p className="site-auth-error">{this.state.error}</p>
            <p className="site-muted">
              Refresh this page. If it keeps happening, open Leagues from the home screen.
            </p>
            <a className="site-btn site-btn-primary" href="/leagues">
              Open Leagues
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
          <OutletErrorBoundary>
            <Outlet />
          </OutletErrorBoundary>
        </SiteShell>
      </HubProvider>
    </RequireAuth>
  );
}

/** Hub screens still link to /league-mgmt/* — map onto /l/:leagueId/mgmt/*. */
function LegacyLeagueMgmtRedirect() {
  const hub = useHub();
  const location = useLocation();
  const leagueId =
    hub.scope.kind === "league"
      ? hub.scope.leagueId
      : hub.selectedLeague?.id ?? hub.leagues[0]?.id ?? null;
  if (!leagueId) return <Navigate to="/leagues" replace />;
  const suffix = location.pathname.startsWith("/league-mgmt")
    ? location.pathname.slice("/league-mgmt".length)
    : "";
  return <Navigate to={`/l/${leagueId}/mgmt${suffix}${location.search}${location.hash}`} replace />;
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
        <Route path="/l/:leagueId/buzz" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/matchups" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/matchups/:gameId" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/team" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/store" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/mgmt/inbox" element={<LeagueMgmtInboxPage />} />
        <Route path="/l/:leagueId/mgmt/*" element={<LeagueHubPage />} />
        <Route path="/league-mgmt/*" element={<LegacyLeagueMgmtRedirect />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RootErrorBoundary>
        <AuthProvider>
          <SiteThemeProvider>
            <Routed />
          </SiteThemeProvider>
        </AuthProvider>
      </RootErrorBoundary>
    </BrowserRouter>
  );
}
