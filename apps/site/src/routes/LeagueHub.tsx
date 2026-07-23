import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth as useSiteAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";
import {
  AdvanceHome,
  CommissionerChatHome,
  DeleteLeagueHome,
  FirstTimeSetupHome,
  HubHome,
  InjectedAuthProvider,
  LeagueMgmtHome,
  LeagueThemeProvider,
  LinkTeamForm,
  ManageLeagueHome,
  MatchupDetailPage,
  NotificationsHome,
  PlayerStatsReview,
  PublishingHome,
  RecruitingHome,
  RolesHome,
  SettingsHome,
  TeamOwnershipTable,
  TeamScheduleForm,
} from "@rec/hub-ui";

import "../../../web/src/styles/tokens.css";
import "../../../web/src/styles/themes/cfb27.css";
import "../../../web/src/styles/themes/madden27.css";
import "../../../web/src/styles/typography.css";
import "../../../web/src/styles/surfaces.css";
import "../../../web/src/styles/buttons.css";
import "../../../web/src/styles/icons.css";
import "../../../web/src/styles/football-components.css";
import "../../../web/src/styles/hub.css";
import "../../../web/src/styles/league-management.css";
import "../../../web/src/styles/responsive.css";

type HubView = "buzz" | "matchups" | "team" | "store" | "mgmt";

function viewFromPath(pathname: string): HubView {
  if (pathname.includes("/matchups")) return "matchups";
  if (pathname.includes("/team")) return "team";
  if (pathname.includes("/store")) return "store";
  if (pathname.includes("/mgmt")) return "mgmt";
  return "buzz";
}

function entryForView(view: HubView): string {
  switch (view) {
    case "matchups":
      return "/?section=league&subTab=matchups";
    case "team":
      return "/?section=team";
    case "store":
      return "/?section=store";
    case "mgmt":
      return "/league-mgmt";
    case "buzz":
    default:
      return "/?section=league&subTab=buzz";
  }
}

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
      const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
      if (lines.length) parts.push(lines.join(" | "));
    }
  }
  if (info?.componentStack) {
    const lines = info.componentStack.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
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
  return parts.join(" — ") || "League hub failed to render.";
}

class HubErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: formatCaughtError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("League hub crashed", error, info);
    this.setState({ error: formatCaughtError(error, info) });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="site-page site-auth-page">
          <div className="site-auth-card">
            <h1>League hub error</h1>
            <p className="site-auth-error" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {this.state.error}
            </p>
            <p className="site-muted">Try refreshing, or open Leagues from the sidebar.</p>
            <div className="site-league-demo-links">
              <a className="site-btn site-btn-primary" href="/leagues">
                Leagues
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

function HubRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HubHome />} />
      <Route path="/home" element={<HubHome />} />
      <Route path="/leagues" element={<HubHome />} />
      <Route path="/matchups/:gameId" element={<MatchupDetailPage />} />
      <Route path="/league-mgmt/first-time-setup" element={<FirstTimeSetupHome />} />
      <Route path="/league-mgmt" element={<LeagueMgmtHome />} />
      <Route path="/league-mgmt/notifications" element={<NotificationsHome />} />
      <Route path="/league-mgmt/manage-league" element={<ManageLeagueHome />} />
      <Route path="/league-mgmt/manage-league/roles" element={<RolesHome />} />
      <Route path="/league-mgmt/manage-league/player-stats" element={<PlayerStatsReview />} />
      <Route path="/league-mgmt/manage-league/teams" element={<TeamOwnershipTable />} />
      <Route path="/league-mgmt/manage-league/teams/link" element={<LinkTeamForm />} />
      <Route path="/league-mgmt/manage-league/:teamId" element={<TeamScheduleForm />} />
      <Route path="/league-mgmt/delete-league" element={<DeleteLeagueHome />} />
      <Route path="/league-mgmt/settings" element={<SettingsHome />} />
      <Route path="/league-mgmt/advance" element={<AdvanceHome />} />
      <Route path="/league-mgmt/commissioner-chat" element={<CommissionerChatHome />} />
      <Route path="/league-mgmt/publishing" element={<PublishingHome />} />
      <Route path="/league-mgmt/recruiting" element={<RecruitingHome />} />
      <Route path="*" element={<HubHome />} />
    </Routes>
  );
}

/**
 * Renders the Discord hub panels inside the site shell (no iframe).
 * Auth is the site Supabase session; guild context comes from open-hub.
 */
export function LeagueHubPage() {
  const { leagueId = "" } = useParams();
  const location = useLocation();
  const view = useMemo(() => viewFromPath(location.pathname), [location.pathname]);
  const siteAuth = useSiteAuth();
  const hub = useHub();
  const [context, setContext] = useState<{
    guildId: string;
    discordId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const gameTheme = hub.selectedLeague?.game ?? null;

  useEffect(() => {
    if (!leagueId) return;
    hub.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) {
      setLoading(false);
      setError("Missing league id.");
      return;
    }
    if (siteAuth.status !== "signed-in") {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    siteApi
      .openLeagueHub({ leagueId, view: "buzz" })
      .then((result) => {
        if (cancelled) return;
        const guildId = String(result.guildId ?? "").trim();
        const discordId = String(result.discordId ?? "").trim();
        if (!guildId || !discordId) {
          setContext(null);
          setError(
            result.hubUrl
              ? "This app build is outdated — hard refresh (or clear site data) and try again."
              : "Open hub returned incomplete Discord context.",
          );
          return;
        }
        setContext({ guildId, discordId });
      })
      .catch((err) => {
        if (cancelled) return;
        setContext(null);
        setError(err instanceof Error ? err.message : "Could not open league hub.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, siteAuth.status]);

  const accessToken =
    siteAuth.status === "signed-in" ? siteAuth.session.access_token : null;

  if (loading || siteAuth.status === "loading") {
    return <div className="site-page site-loading">Loading league hub…</div>;
  }

  if (error || !context || !accessToken) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Could not open league</h1>
          <p className="site-auth-error">{error ?? "Could not load league hub context."}</p>
          <p className="site-muted">
            Finish Discord linking and username on Account, then hard-refresh this page. You can also
            open the hub from Discord with <strong>/app</strong>.
          </p>
          <div className="site-league-demo-links">
            <Link className="site-btn site-btn-primary" to="/account">
              Account
            </Link>
            <Link className="site-btn site-btn-ghost" to="/leagues">
              Leagues
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="site-hub-embed site-hub-inprocess">
      <div className="site-hub-inprocess-content">
        <InjectedAuthProvider
          discordId={context.discordId}
          guildId={context.guildId}
          accessToken={accessToken}
        >
          <LeagueThemeProvider game={gameTheme}>
            <MemoryRouter key={`${leagueId}:${view}`} initialEntries={[entryForView(view)]}>
              <HubErrorBoundary>
                <HubRoutes />
              </HubErrorBoundary>
            </MemoryRouter>
          </LeagueThemeProvider>
        </InjectedAuthProvider>
      </div>
    </div>
  );
}