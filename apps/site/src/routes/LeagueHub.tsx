import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth as useSiteAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import { persistCachedHubOpen, readCachedHubOpen, siteApi } from "../lib/site-api.js";
import { DiscordServerSettings } from "../components/DiscordServerSettings.js";
import { IconBack } from "../components/icons.js";
import {
  AdvanceStatusDrawer,
  AdvanceStatusProvider,
  HubChromeProvider,
  InjectedAuthProvider,
  LeagueThemeProvider,
  ImportStatusDrawer,
  ImportStatusProvider,
  HighlightUploadDrawer,
  HighlightUploadProvider,
} from "@rec/hub-ui";
import { LeagueChassis, LeagueChassisLoading } from "../features/league/chassis/index.js";
import { GameDayPage, GameDayRouteRail } from "../features/league/gameday/index.js";
import { LeagueHomePage } from "../features/league/home/index.js";
import {
  AdvanceHome,
  DeleteLeagueHome,
  ImportGamesPage,
  LinkTeamForm,
  ManageLeagueHome,
  ManageLeaguePage,
  ManageMediaPlaceholderPage,
  ManageTeamsPage,
  ManageUsersPage,
  MgmtRouteRail,
  NotificationsHome,
  NflPlayoffBracket,
  RolesHome,
  SettingsHome,
  TeamManagePlaceholderPage,
  TeamOwnershipTable,
  TeamRosterForm,
  TeamScheduleForm,
  type MgmtNavId,
} from "../features/league/management/index.js";
import {
  LeagueCareerStatsHome,
  LeagueStatsHome,
  StatsRouteRail,
  type StatsFamilyView,
} from "../features/league/stats/index.js";
import { LeagueStandingsHome } from "../features/league/standings/index.js";
import { LeagueRecordsHome } from "../features/league/records/index.js";
import { LeagueHistoryHome } from "../features/league/history/index.js";
import { RulesHome } from "../features/league/rules/index.js";
import { TeamRouteRail, TeamHomePage, type TeamNavId } from "../features/league/team/index.js";
import { RosterPage } from "../features/league/roster/index.js";
import { StorePage } from "../features/league/store/index.js";
import { TradesPage } from "../features/league/trades/index.js";

// Consolidated from 11 separately-imported files into 3 purpose-named bundles (Phase 4 CSS
// centralization) -- see hub-tokens.css/hub-layout.css/hub-features.css for what each groups
// and why. responsive.css stays its own final import; it must load after every other
// stylesheet regardless of bundle grouping (see hub-features.css's comment).
import "../../../web/src/styles/hub-tokens.css";
import "../../../web/src/styles/hub-layout.css";
import "../../../web/src/styles/hub-features.css";
import "../../../web/src/styles/responsive.css";

type HubView = "home" | "matchups" | "team" | "store" | "wagers" | "roster" | "trades" | "rules" | "stats" | "standings" | "career-stats" | "history" | "records" | "mgmt" | "playoff-bracket";

function viewFromPath(pathname: string): HubView {
  // Check /mgmt first — mgmt sub-routes like manage-league/teams or
  // manage-league/teams/link otherwise match the "/team" substring below and get
  // misrouted to the My Team view instead of League Mgmt.
  if (pathname.includes("/mgmt")) return "mgmt";
  if (pathname.includes("/playoff-bracket")) return "playoff-bracket";
  if (pathname.includes("/matchups")) return "matchups";
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
  return "home";
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

const VIEW_PATH_SEGMENT: Record<"home" | "matchups" | "team" | "store" | "wagers" | "roster" | "trades", string> = {
  home: "home", matchups: "matchups", team: "team", store: "store", wagers: "wagers", roster: "roster", trades: "trades",
};

function isTeamFamilyView(view: HubView): view is "team" | "store" | "roster" | "trades" {
  return view === "team" || view === "store" || view === "roster" || view === "trades";
}


/** League Mgmt sub-pages have no chrome of their own on the site (unlike apps/web's
 * AppShell, which always renders a Back button) — so give them one here. */
function MgmtSubPage({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="site-mgmt-subpage league-mgmt-content">
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

/** Top status strip persistent across League Mgmt destinations. */
function MgmtSectionLayout({ active, leagueId, children }: { active: MgmtNavId; leagueId: string; children: ReactNode }) {
  return (
    <>
      <MgmtRouteRail active={active} leagueId={leagueId} />
      <div className="league-mgmt-content">{children}</div>
    </>
  );
}

function HubMgmtRoutes({ leagueId }: { leagueId: string }) {
  return (
    <Routes>
      <Route index element={<Navigate replace to="users" />} />
      <Route path="games" element={<MgmtSectionLayout active="games" leagueId={leagueId}><ImportGamesPage /></MgmtSectionLayout>} />
      <Route path="advance" element={<MgmtSectionLayout active="advance" leagueId={leagueId}><AdvanceHome /></MgmtSectionLayout>} />
      <Route path="pending" element={<MgmtSectionLayout active="pending" leagueId={leagueId}><NotificationsHome /></MgmtSectionLayout>} />
      <Route path="users" element={<MgmtSectionLayout active="users" leagueId={leagueId}><ManageUsersPage /></MgmtSectionLayout>} />
      <Route path="teams" element={<MgmtSectionLayout active="teams" leagueId={leagueId}><ManageTeamsPage /></MgmtSectionLayout>} />
      <Route path="teams/:teamId" element={<MgmtSectionLayout active="teams" leagueId={leagueId}><TeamManagePlaceholderPage /></MgmtSectionLayout>} />
      <Route path="league" element={<MgmtSectionLayout active="league" leagueId={leagueId}><ManageLeaguePage /></MgmtSectionLayout>} />
      <Route path="media" element={<MgmtSectionLayout active="media" leagueId={leagueId}><ManageMediaPlaceholderPage /></MgmtSectionLayout>} />

      {/* Legacy paths — keep deep links working while the rail destinations settle. */}
      <Route path="inbox" element={<Navigate replace to="../pending" />} />
      <Route path="tools" element={<Navigate replace to="../league" />} />
      <Route path="notifications" element={<Navigate replace to="../pending" />} />
      <Route path="commissioner-chat" element={<Navigate replace to="../pending" />} />
      <Route path="manage-league" element={<Navigate replace to="../teams" />} />
      <Route path="manage-league/roles" element={<MgmtSubPage><RolesHome /></MgmtSubPage>} />
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
      <Route path="publishing" element={<Navigate replace to="../media" />} />
      <Route path="*" element={<Navigate replace to="users" />} />
    </Routes>
  );
}

function LeagueSettingsSection() {
  const { leagueId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const category = searchParams.get("category");
  // Mirrors SettingsHome's topTab resolution: any category value other than "discord"/null
  // routes to the League Settings tab (including a settings-category deep link like
  // "gameplay"), so the Discord server card should only show on the Discord tab itself.
  const showDiscordServerCard = !category || category === "discord";
  return (
    <>
      {showDiscordServerCard && <DiscordServerSettings leagueId={leagueId} />}
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

function isStatsFamilyView(view: HubView): view is StatsFamilyView {
  return view === "stats" || view === "standings" || view === "records"
    || view === "history" || view === "career-stats" || view === "playoff-bracket";
}

/** Persistent chassis for the Stats-family destinations (League Stats / Division Standings /
 * League Records / League History / Career Stats / Playoff Bracket): site owns the top rail
 * through features/league/stats, so switching between these six no longer unmounts/remounts
 * the nav along with the page content. Bodies still come from @rec/hub-ui until those pages
 * move. Wrapped in .hub-page (the same universal frame HubHome/RulesHome use at their own top
 * level) so the outer position/width/vertical-rhythm of this whole section never shifts when
 * the view changes -- only the nav's active button and the page content below it do. */
function StatsSectionLayout({ view, leagueId, children }: { view: StatsFamilyView; leagueId: string; children: ReactNode }) {
  return (
    <div className="hub-page">
      <StatsRouteRail view={view} leagueId={leagueId} />
      {children}
    </div>
  );
}

/**
 * Renders the Discord hub panels inside the site shell (no iframe).
 * Uses the site BrowserRouter only — never nest MemoryRouter.
 */
// Switching leagues changes the :leagueId URL param but keeps the same route pattern (e.g.
// /l/A/home -> /l/B/home), so React Router reuses this exact component instance instead of
// remounting it. That left this component's own context/loading state (below) holding the
// PREVIOUS league's Discord guildId/discordId for at least one render after the param changed --
// the header (a separate HubContext consumer, see hub-context.tsx) had already updated to the new
// league, producing the classic "header shows league B, body still renders league A" bug. Keying
// the actual body on leagueId forces a full remount on every league switch, so context/loading
// always start fresh for the league actually being viewed -- no stale-carryover window at all.
export function LeagueHubPage() {
  const { leagueId = "" } = useParams();
  return <LeagueHubPageForLeague key={leagueId} leagueId={leagueId} />;
}

function LeagueHubPageForLeague({ leagueId }: { leagueId: string }) {
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
        void siteApi.openLeagueHub({ leagueId, view: "home" }).then((result) => {
          if (cancelled) return;
          const guildId = String(result.guildId ?? "").trim();
          const discordId = String(result.discordId ?? "").trim();
          if (!guildId || !discordId) return;
          persistCachedHubOpen(leagueId, { guildId, discordId });
          setContext({ guildId, discordId });
        }).catch(() => undefined);
        return;
      }

      setLoading(true);
      const composed = await composeHubContextFromLists(leagueId);
      if (cancelled) return;
      if (composed) {
        painted = true;
        persistCachedHubOpen(leagueId, composed);
        setContext(composed);
        setLoading(false);
      }

      try {
        const result = await siteApi.openLeagueHub({ leagueId, view: "home" });
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
    return <LeagueChassisLoading />;
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
    <LeagueChassis>
      <InjectedAuthProvider
        key={leagueId}
        discordId={context.discordId}
        guildId={context.guildId}
        accessToken={accessToken}
      >
        <HubChromeProvider embedded>
          <ImportStatusProvider>
          <AdvanceStatusProvider>
          <HighlightUploadProvider>
            <LeagueThemeProvider game={gameTheme}>
              <HubErrorBoundary>
                {view === "mgmt" ? (
                  <div className="hub-page"><HubMgmtRoutes leagueId={leagueId} /></div>
                ) : isStatsFamilyView(view) ? (
                  <StatsSectionLayout view={view} leagueId={leagueId}>
                    {view === "playoff-bracket" ? <NflPlayoffBracket />
                      : view === "history" ? <LeagueHistoryHome />
                      : view === "records" ? <LeagueRecordsHome />
                      : view === "stats" ? <LeagueStatsHome />
                      : view === "standings" ? <LeagueStandingsHome />
                      : <LeagueCareerStatsHome />}
                  </StatsSectionLayout>
                ) : view === "rules" ? (
                  <RulesHome />
                ) : view === "matchups" ? (
                  <>
                    <GameDayRouteRail leagueId={leagueId} />
                    <GameDayPage key={leagueId} />
                  </>
                ) : isTeamFamilyView(view) ? (
                  <>
                    <TeamRouteRail
                      active={view as TeamNavId}
                      leagueId={leagueId}
                      isRise={isRise}
                      tradesUnlocked={!isRise || routeLeague?.rtiTradesUnlocked !== false}
                      storeUnlocked={!isRise || Boolean(routeLeague?.rtiStoreUnlocked ?? routeLeague?.riseHubUnlocked)}
                      progressionAvailable={isRise}
                    />
                    {view === "team" ? <TeamHomePage />
                      : view === "roster" ? <RosterPage />
                      : view === "store" ? <StorePage />
                      : <TradesPage />}
                  </>
                ) : view === "home" ? (
                  <LeagueHomePage />
                ) : view === "wagers" ? (
                  <Navigate replace to={`/l/${leagueId}/matchups`} />
                ) : (
                  <Navigate replace to={`/l/${leagueId}/${VIEW_PATH_SEGMENT.home}`} />
                )}
              </HubErrorBoundary>
              <ImportStatusDrawer />
              <AdvanceStatusDrawer />
              <HighlightUploadDrawer />
            </LeagueThemeProvider>
          </HighlightUploadProvider>
          </AdvanceStatusProvider>
          </ImportStatusProvider>
        </HubChromeProvider>
      </InjectedAuthProvider>
    </LeagueChassis>
  );
}
