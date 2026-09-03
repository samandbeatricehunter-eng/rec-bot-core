import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useSiteAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import { persistCachedHubOpen, readCachedHubOpen, siteApi } from "../lib/site-api.js";
import { DiscordServerSettings } from "../components/DiscordServerSettings.js";
import { IconBack } from "../components/icons.js";
import {
  CfpPostseasonManager,
  FantasyDraftBoardPage,
  DeleteLeagueHome,
  HubChromeProvider,
  HubHome,
  InjectedAuthProvider,
  LeagueMgmtHome,
  LeagueThemeProvider,
  LinkTeamForm,
  ManageLeagueHome,
  NflPlayoffBracket,
  NotificationsHome,
  PlayerStatsReview,
  PublishingHome,
  RecruitingHome,
  LeagueHistoryHome,
  LeagueRecordsHome,
  LeagueStandingsHome,
  CfpStandingsDrawer,
  LeagueSosHome,
  LeagueCareerStatsHome,
  LeagueStatsHome,
  RolesHome,
  RulesHome,
  SettingsHome,
  TeamOwnershipTable,
  TeamRosterForm,
  TeamScheduleForm,
  ImportStatusDrawer,
  ImportStatusProvider,
  HighlightUploadDrawer,
  HighlightUploadProvider,
} from "@rec/hub-ui";

// Consolidated from 11 separately-imported files into 3 purpose-named bundles (Phase 4 CSS
// centralization) -- see hub-tokens.css/hub-layout.css/hub-features.css for what each groups
// and why. responsive.css stays its own final import; it must load after every other
// stylesheet regardless of bundle grouping (see hub-features.css's comment).
import "../../../web/src/styles/hub-tokens.css";
import "../../../web/src/styles/hub-layout.css";
import "../../../web/src/styles/hub-features.css";
import "../../../web/src/styles/responsive.css";

type HubView = "buzz" | "news" | "matchups" | "team" | "store" | "wagers" | "roster" | "trades" | "rules" | "stats" | "standings" | "sos" | "career-stats" | "history" | "records" | "mgmt" | "playoff-bracket";

function viewFromPath(pathname: string): HubView {
  // Check /mgmt first — mgmt sub-routes like manage-league/teams or
  // manage-league/teams/link otherwise match the "/team" substring below and get
  // misrouted to the My Team view instead of League Mgmt.
  if (pathname.includes("/mgmt")) return "mgmt";
  if (pathname.includes("/playoff-bracket")) return "playoff-bracket";
  if (pathname.includes("/sos")) return "sos";
  if (pathname.includes("/matchups")) return "matchups";
  if (pathname.includes("/news")) return "news";
  if (pathname.includes("/team")) return "team";
  if (pathname.includes("/store")) return "store";
  if (pathname.includes("/wagers")) return "wagers";
  if (pathname.includes("/roster")) return "roster";
  if (pathname.includes("/trades")) return "trades";
  if (pathname.includes("/standings")) return "standings";
  if (pathname.includes("/career-stats")) return "career-stats";
  if (pathname.includes("/stats")) return "stats";
  if (pathname.includes("/records")) return "records";
  if (pathname.includes("/history")) return "history";
  if (pathname.includes("/rules")) return "rules";
  return "buzz";
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

const VIEW_PATH_SEGMENT: Record<Exclude<HubView, "mgmt" | "rules" | "stats" | "standings" | "sos" | "career-stats" | "history" | "records" | "playoff-bracket">, string> = {
  buzz: "buzz", news: "news", matchups: "matchups", team: "team", store: "store", wagers: "wagers", roster: "roster", trades: "trades",
};

function viewFromQuery(section: string | null, subTab: string | null): Exclude<HubView, "mgmt" | "rules" | "stats" | "standings" | "sos" | "career-stats" | "history" | "records" | "playoff-bracket"> | null {
  if (section === "matchups" || (section === "league" && subTab === "matchups")) return "matchups";
  if (section === "league" && subTab === "news") return "news";
  if (section === "team") return "team";
  if (section === "store") return "store";
  if (section === "wagers") return "wagers";
  if (section === "roster") return "roster";
  if (section === "trades") return "trades";
  if (section === "league") return "buzz";
  return null;
}

/** Sync /l/:id/{buzz|matchups|team|store} into HubHome search params (parent BrowserRouter).
 * Bidirectional: a quick-action button inside HubHome that only changes `?section=` (never
 * touches the path) used to get instantly reverted back to whatever the current path implied —
 * navigate to the matching path instead of stomping the query string when that happens. */
function HubHomeBridge({ view, leagueId }: { view: Exclude<HubView, "mgmt">; leagueId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const desired = useMemo(() => {
    if (view === "matchups") return { section: "league", subTab: "matchups" };
    if (view === "news") return { section: "league", subTab: "news" };
    if (view === "team") return { section: "team", subTab: null as string | null };
    if (view === "store") return { section: "store", subTab: null as string | null };
    if (view === "wagers") return { section: "wagers", subTab: null as string | null };
    if (view === "roster") return { section: "roster", subTab: null as string | null };
    if (view === "trades") return { section: "trades", subTab: null as string | null };
    return { section: "league", subTab: "buzz" };
  }, [view]);

  useEffect(() => {
    const section = searchParams.get("section");
    const subTab = searchParams.get("subTab");
    const sectionOk = section === desired.section;
    const subOk =
      desired.subTab == null
        ? subTab == null || subTab === ""
        : subTab === desired.subTab;
    if (sectionOk && subOk) return;

    const impliedView = viewFromQuery(section, subTab);
    if (impliedView && impliedView !== view) {
      navigate(`/l/${leagueId}/${VIEW_PATH_SEGMENT[impliedView]}`, { replace: true });
      return;
    }
    const next = new URLSearchParams();
    next.set("section", desired.section);
    if (desired.subTab) next.set("subTab", desired.subTab);
    setSearchParams(next, { replace: true });
  }, [desired, searchParams, setSearchParams, navigate, leagueId, view]);

  return <HubHome />;
}

/** League Mgmt sub-pages have no chrome of their own on the site (unlike apps/web's
 * AppShell, which always renders a Back button) — so give them one here. */
function MgmtSubPage({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="site-mgmt-subpage">
      <button
        type="button"
        className="site-btn site-btn-ghost site-mgmt-back"
        onClick={() => navigate(-1)}
      >
        <IconBack /> Back
      </button>
      {children}
    </div>
  );
}

function HubMgmtRoutes() {
  return (
    <Routes>
      <Route index element={<LeagueMgmtHome />} />
      <Route path="notifications" element={<MgmtSubPage><NotificationsHome /></MgmtSubPage>} />
      <Route path="commissioner-chat" element={<Navigate replace to="../notifications" />} />
      <Route path="manage-league" element={<MgmtSubPage><ManageLeagueHome /></MgmtSubPage>} />
      <Route path="manage-league/roles" element={<MgmtSubPage><RolesHome /></MgmtSubPage>} />
      <Route path="manage-league/player-stats" element={<MgmtSubPage><PlayerStatsReview /></MgmtSubPage>} />
      <Route path="manage-league/postseason" element={<MgmtSubPage><CfpPostseasonManager /></MgmtSubPage>} />
      <Route path="manage-league/playoff-bracket" element={<MgmtSubPage><NflPlayoffBracket /></MgmtSubPage>} />
      <Route path="manage-league/teams" element={<MgmtSubPage><TeamOwnershipTable /></MgmtSubPage>} />
      <Route path="manage-league/teams/link" element={<MgmtSubPage><LinkTeamForm /></MgmtSubPage>} />
      <Route path="manage-league/rosters" element={<MgmtSubPage><ManageLeagueHome mode="roster" /></MgmtSubPage>} />
      <Route path="manage-league/rosters/:teamId" element={<MgmtSubPage><TeamRosterForm /></MgmtSubPage>} />
      <Route path="manage-league/:teamId" element={<MgmtSubPage><TeamScheduleForm /></MgmtSubPage>} />
      <Route path="delete-league" element={<MgmtSubPage><DeleteLeagueHome /></MgmtSubPage>} />
      <Route
        path="settings"
        element={
          <MgmtSubPage>
            <LeagueSettingsSection />
          </MgmtSubPage>
        }
      />
      <Route path="publishing" element={<MgmtSubPage><PublishingHome /></MgmtSubPage>} />
      <Route path="recruiting" element={<MgmtSubPage><RecruitingHome /></MgmtSubPage>} />
      <Route path="*" element={<LeagueMgmtHome />} />
    </Routes>
  );
}

function LeagueSettingsSection() {
  const { leagueId = "" } = useParams();
  return (
    <>
      <DiscordServerSettings leagueId={leagueId} />
      <SettingsHome />
    </>
  );
}

async function composeHubContextFromLists(leagueId: string): Promise<{ guildId: string; discordId: string } | null> {
  const [profile, mine] = await Promise.all([
    siteApi.getLinkProfile().catch(() => null),
    siteApi.listMyLeagues().catch(() => null),
  ]);
  const discordId = String(profile?.discordId ?? "").trim();
  const username = String(profile?.username ?? "").trim();
  const guildId = String(mine?.leagues.find((league) => league.id === leagueId)?.guildId ?? "").trim();
  if (!username || !discordId || !guildId) return null;
  return { guildId, discordId };
}

/**
 * Renders the Discord hub panels inside the site shell (no iframe).
 * Uses the site BrowserRouter only — never nest MemoryRouter.
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
  } | null>(() => (leagueId ? readCachedHubOpen(leagueId) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(leagueId && readCachedHubOpen(leagueId)));
  const gameTheme = hub.leagues.find((league) => league.id === leagueId)?.game ?? hub.selectedLeague?.game ?? null;
  const routeLeague = hub.leagues.find((league) => league.id === leagueId) ?? (hub.selectedLeague?.id === leagueId ? hub.selectedLeague : null);
  const isRise = routeLeague?.rosterType === "rise_to_immortality";
  const riseHubUnlocked = routeLeague?.riseHubUnlocked === true;
  const rtiOriginsComplete = routeLeague?.rtiOriginsComplete === true;

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
    setError(null);

    async function resolveHubContext() {
      const cached = readCachedHubOpen(leagueId);
      setContext(cached);
      let painted = Boolean(cached);
      if (cached) {
        setLoading(false);
      } else {
        setLoading(true);
        const composed = await composeHubContextFromLists(leagueId);
        if (cancelled) return;
        if (composed) {
          painted = true;
          persistCachedHubOpen(leagueId, composed);
          setContext(composed);
          setLoading(false);
        }
      }

      try {
        const result = await siteApi.openLeagueHub({ leagueId, view: "buzz" });
        if (cancelled) return;
        const guildId = String(result.guildId ?? "").trim();
        const discordId = String(result.discordId ?? "").trim();
        if (!guildId || !discordId) {
          if (painted) return;
          setContext(null);
          setError(
            result.hubUrl
              ? "This app build is outdated — hard refresh (or clear site data) and try again."
              : "Open hub returned incomplete Discord context.",
          );
          return;
        }
        const next = { guildId, discordId };
        persistCachedHubOpen(leagueId, next);
        setContext(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (painted) return;
        setContext(null);
        setError(err instanceof Error ? err.message : "Could not open league hub.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void resolveHubContext();
    return () => {
      cancelled = true;
    };
  }, [leagueId, siteAuth.status]);


  const accessToken =
    siteAuth.status === "signed-in" ? siteAuth.session.access_token : null;

  if (loading || siteAuth.status === "loading") {
    return <div className="site-page site-loading">Loading league hub…</div>;
  }

  if (isRise && (!riseHubUnlocked || !rtiOriginsComplete) && view !== "mgmt") {
    return <Navigate replace to={`/l/${leagueId}/rise`} />;
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
          key={leagueId}
          discordId={context.discordId}
          guildId={context.guildId}
          accessToken={accessToken}
        >
          <HubChromeProvider embedded>
            <ImportStatusProvider>
            <HighlightUploadProvider>
              <LeagueThemeProvider game={gameTheme}>
                <HubErrorBoundary>
                  {location.pathname.endsWith("/draft-board") ? (
                    <FantasyDraftBoardPage />
                  ) : view === "mgmt" ? (
                    <HubMgmtRoutes />
                  ) : view === "playoff-bracket" ? (
                    gameTheme?.startsWith("madden") ? <NflPlayoffBracket /> : <CfpStandingsDrawer guildId={context.guildId} />
                  ) : view === "sos" ? (
                    <LeagueSosHome />
                  ) : view === "rules" ? (
                    <RulesHome />
                  ) : view === "history" ? (
                    <LeagueHistoryHome />
                  ) : view === "records" ? (
                    <LeagueRecordsHome />
                  ) : view === "stats" ? (
                    <LeagueStatsHome />
                  ) : view === "standings" ? (
                    <LeagueStandingsHome />
                  ) : view === "career-stats" ? (
                    <LeagueCareerStatsHome />
                  ) : (
                    <HubHomeBridge key={leagueId} view={view} leagueId={leagueId} />
                  )}
                </HubErrorBoundary>
                <ImportStatusDrawer />
                <HighlightUploadDrawer />
              </LeagueThemeProvider>
            </HighlightUploadProvider>
            </ImportStatusProvider>
          </HubChromeProvider>
        </InjectedAuthProvider>
      </div>
    </div>
  );
}
