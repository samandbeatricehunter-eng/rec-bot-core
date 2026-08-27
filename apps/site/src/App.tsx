import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from "react";
import { AccentTier } from "./components/AccentTier.js";
import { SiteShell } from "./components/SiteShell.js";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { HubProvider, useHub } from "./lib/hub-context.js";
import { SiteActivityProvider } from "./lib/site-activity-context.js";
import { SiteThemeProvider } from "./lib/site-theme-context.js";
const Account = lazy(() => import("./routes/Account.js").then((m) => ({ default: m.Account })));
const Friends = lazy(() => import("./routes/Friends.js").then((m) => ({ default: m.Friends })));
const Inbox = lazy(() => import("./routes/Inbox.js").then((m) => ({ default: m.Inbox })));
const Landing = lazy(() => import("./routes/Landing.js").then((m) => ({ default: m.Landing })));
const LogIn = lazy(() => import("./routes/LogIn.js").then((m) => ({ default: m.LogIn })));
const TournamentsPage = lazy(() => import("./routes/Tournaments.js").then((m) => ({ default: m.TournamentsPage })));
const TournamentDetailPage = lazy(() => import("./routes/TournamentDetail.js").then((m) => ({ default: m.TournamentDetailPage })));
const HomePage = lazy(() => import("./routes/Home.js").then((m) => ({ default: m.HomePage })));
const LeaguesPage = lazy(() => import("./routes/Leagues.js").then((m) => ({ default: m.LeaguesPage })));
const LeagueHubPage = lazy(() => import("./routes/LeagueHub.js").then((m) => ({ default: m.LeagueHubPage })));
const Pricing = lazy(() => import("./routes/Pricing.js").then((m) => ({ default: m.Pricing })));
const SignUp = lazy(() => import("./routes/SignUp.js").then((m) => ({ default: m.SignUp })));
const SignUpComplete = lazy(() => import("./routes/SignUpComplete.js").then((m) => ({ default: m.SignUpComplete })));
const Help = lazy(() => import("./routes/Help.js").then((m) => ({ default: m.Help })));
const Privacy = lazy(() => import("./routes/Privacy.js").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./routes/Terms.js").then((m) => ({ default: m.Terms })));
const DevBypass = lazy(() => import("./routes/DevBypass.js").then((m) => ({ default: m.DevBypass })));
const DiscordGuildPicker = lazy(() => import("./routes/DiscordGuildPicker.js").then((m) => ({ default: m.DiscordGuildPicker })));
const DiscordGuildTokenPopup = lazy(() => import("./routes/DiscordGuildTokenPopup.js").then((m) => ({ default: m.DiscordGuildTokenPopup })));
function LegacyCommissionerInboxRedirect() {
  const { leagueId = "" } = useParams();
  return <Navigate replace to={`/l/${leagueId}/mgmt/notifications`} />;
}
function LegacyMatchupRedirect() {
  const { leagueId = "" } = useParams();
  return <Navigate replace to={`/l/${leagueId}/buzz`} />;
}
function LegacyMyTeamRedirect() {
  const { leagueId = "" } = useParams();
  return <Navigate replace to={`/l/${leagueId}/stats`} />;
}
function LegacyWagersRedirect() {
  const { leagueId = "" } = useParams();
  return <Navigate replace to={`/l/${leagueId}/buzz`} />;
}
const AuthCallback = lazy(() => import("./routes/AuthCallback.js").then((m) => ({ default: m.AuthCallback })));
const OnboardingPromo = lazy(() => import("./routes/OnboardingPromo.js").then((m) => ({ default: m.OnboardingPromo })));
const OpenApp = lazy(() => import("./routes/OpenApp.js").then((m) => ({ default: m.OpenApp })));
const AdminPage = lazy(() => import("./routes/Admin.js").then((m) => ({ default: m.AdminPage })));
const PublicLeague = lazy(() => import("./routes/PublicLeague.js").then((m) => ({ default: m.PublicLeague })));
const Demo = lazy(() => import("./routes/Demo.js").then((m) => ({ default: m.Demo })));
const RenderMatchup = lazy(() => import("./routes/render/RenderMatchup.js").then((m) => ({ default: m.RenderMatchup })));
const RenderPlayerOfWeek = lazy(() => import("./routes/render/RenderPlayerOfWeek.js").then((m) => ({ default: m.RenderPlayerOfWeek })));
const RenderNflPlayoffBracket = lazy(() => import("./routes/render/RenderNflPlayoffBracket.js").then((m) => ({ default: m.RenderNflPlayoffBracket })));
import { SiteUpdateNotice } from "./components/SiteUpdateNotice.js";

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
        <SiteActivityProvider>
          <SiteShell>
            <OutletErrorBoundary>
              <Outlet />
            </OutletErrorBoundary>
          </SiteShell>
        </SiteActivityProvider>
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
    <Suspense fallback={<div className="site-page site-loading">Loading…</div>}>
    <Routes>
      <Route path="/" element={<RootEntry />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/signup/complete" element={<SignUpComplete />} />
      <Route path="/login" element={<LogIn />} />
      <Route path="/open-app" element={<OpenApp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/onboarding/promo" element={<OnboardingPromo />} />
      <Route path="/discord-guild-token" element={<DiscordGuildTokenPopup />} />
      {/* import.meta.env.DEV is statically replaced at build time — this branch (and the
          DevBypass import above) is dead code in any production build, not just hidden. */}
      {import.meta.env.DEV && <Route path="/dev-bypass" element={<DevBypass />} />}

      <Route path="/pricing" element={<Pricing />} />
      <Route path="/help" element={<Help />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/league/:slug" element={<PublicLeague />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/render/matchup/:gameId" element={<RenderMatchup />} />
      <Route path="/render/player-of-week/:storyId" element={<RenderPlayerOfWeek />} />
      <Route path="/render/nfl-playoff-bracket/:leagueId" element={<RenderNflPlayoffBracket />} />

      <Route element={<AuthedLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/leagues" element={<LeaguesPage />} />
        <Route path="/discord-guild-picker" element={<DiscordGuildPicker />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
        <Route path="/comp" element={<Navigate replace to="/tournaments" />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/l/:leagueId/buzz" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/news" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/matchups" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/matchups/:gameId" element={<LegacyMatchupRedirect />} />
        <Route path="/l/:leagueId/team" element={<LegacyMyTeamRedirect />} />
        <Route path="/l/:leagueId/store" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/wagers" element={<LegacyWagersRedirect />} />
        <Route path="/l/:leagueId/trades" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/roster" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/rules" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/standings" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/playoff-bracket" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/stats" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/career-stats" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/history" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/records" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/draft-board" element={<LeagueHubPage />} />
        <Route path="/l/:leagueId/mgmt/inbox" element={<LegacyCommissionerInboxRedirect />} />
        <Route path="/l/:leagueId/mgmt/*" element={<LeagueHubPage />} />
        <Route path="/league-mgmt/*" element={<LegacyLeagueMgmtRedirect />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RootErrorBoundary>
        <AuthProvider>
          <SiteThemeProvider>
            <AccentTier />
            <Routed />
            <SiteUpdateNotice />
          </SiteThemeProvider>
        </AuthProvider>
      </RootErrorBoundary>
    </BrowserRouter>
  );
}
