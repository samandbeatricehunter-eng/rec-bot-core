import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context.js";
import { siteApi, type SiteLeagueSummary } from "./site-api.js";
import { useSiteTheme } from "./site-theme-context.js";

const SCOPE_KEY = "rec-site-hub-scope";

export type HubScope = { kind: "main" } | { kind: "league"; leagueId: string };

type HubContextValue = {
  scope: HubScope;
  leagues: SiteLeagueSummary[];
  leaguesLoading: boolean;
  leaguesError: string | null;
  selectedLeague: SiteLeagueSummary | null;
  selectMainHub: () => void;
  /** Leave league scope and navigate to a main-chrome route. */
  exitToMain: (path?: string) => void;
  selectLeague: (leagueId: string) => void;
  /** Enter league scope without navigating (e.g. already on /l/:id/…). */
  ensureLeagueScope: (leagueId: string) => void;
  refreshLeagues: () => Promise<SiteLeagueSummary[]>;
  retireFromLeague: (leagueId: string) => Promise<void>;
};

const HubContext = createContext<HubContextValue | null>(null);

function readStoredScope(): HubScope {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    if (!raw) return { kind: "main" };
    const parsed = JSON.parse(raw) as HubScope;
    if (parsed?.kind === "league" && typeof parsed.leagueId === "string") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { kind: "main" };
}

function persistScope(scope: HubScope) {
  try {
    sessionStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
  } catch {
    /* ignore */
  }
}

export function HubProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { setTheme } = useSiteTheme();
  const [scope, setScope] = useState<HubScope>(() => readStoredScope());
  const [leagues, setLeagues] = useState<SiteLeagueSummary[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [leaguesReady, setLeaguesReady] = useState(false);

  const selectedLeague =
    scope.kind === "league"
      ? leagues.find((league) => league.id === scope.leagueId) ?? null
      : null;

  async function refreshLeagues() {
    setLeaguesLoading(true);
    setLeaguesError(null);
    try {
      const response = await siteApi.listMyLeagues();
      setLeagues(response.leagues);
      setLeaguesReady(true);
      return response.leagues;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load leagues.";
      setLeaguesError(message);
      setLeagues([]);
      setLeaguesReady(true);
      return [];
    } finally {
      setLeaguesLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setLeagues([]);
      setLeaguesError(null);
      setLeaguesReady(false);
      // A different account can sign in on the same tab/session while still parked on a
      // /l/:id URL that belonged to the previous account -- without dropping scope here,
      // it stays {kind:"league", leagueId} for that stale id (selectedLeague resolves to
      // null once the new leagues list loads, but scope.kind itself never self-corrects,
      // which SiteShell reads independently of selectedLeague -- see its isLeague check).
      const next: HubScope = { kind: "main" };
      setScope(next);
      persistScope(next);
      return;
    }
    void refreshLeagues();
  }, [auth.status]);

  // useLayoutEffect (not useEffect) so scope is corrected before paint -- otherwise a
  // navigation off /l/:id via a plain link (not exitToMain()) could paint one frame of
  // LeagueRow3 for the old league on top of the newly-navigated-to page before this runs.
  useLayoutEffect(() => {
    // Game theme is only for /l/:id hub surfaces. Site chrome (leagues list, home,
    // account, etc.) always stays on the app carbon theme — otherwise selecting a
    // league re-skinned the whole website. /league-mgmt/* counts too -- it's the legacy
    // leagueId-less path a handful of hub-ui buttons still navigate to (Settings,
    // Notifications, Publishing, the playoff-bracket mgmt link), which App.tsx's
    // LegacyLeagueMgmtRedirect immediately maps onto the real /l/:leagueId/mgmt/* route.
    // Treating it as "left the hub" here would drop league scope in the instant before
    // that redirect runs, so the redirect's own scope.leagueId fallback reads "main" and
    // falls through to hub.leagues[0] -- silently landing on a different league entirely.
    const match = location.pathname.match(/^\/l\/([^/]+)/);
    if (match) {
      const urlLeagueId = match[1];
      if (scope.kind !== "league" || scope.leagueId !== urlLeagueId) {
        const next: HubScope = { kind: "league", leagueId: urlLeagueId };
        setScope(next);
        persistScope(next);
      }
      setTheme("app");
      return;
    }
    const onLeagueHubPage = location.pathname.startsWith("/l/") || location.pathname.startsWith("/league-mgmt");
    if (scope.kind === "league" && selectedLeague && onLeagueHubPage) {
      // Universal Platinum chrome for every league (CFB + Madden share one face).
      setTheme("app");
      return;
    }
    if (scope.kind === "main") {
      setTheme("app");
      return;
    }
    if (!onLeagueHubPage) {
      setTheme("app");
      // Any navigation off /l/:id back to main chrome (brand-link click, browser
      // back/forward, a plain <NavLink to="/home"> that doesn't go through
      // exitToMain()) must drop league scope too -- otherwise the header keeps
      // reading scope.kind === "league" and renders the stale league's row2/row3
      // switcher/nav on top of the home page.
      if (scope.kind === "league") {
        const next: HubScope = { kind: "main" };
        setScope(next);
        persistScope(next);
      }
      return;
    }
    // Keep league scope while the route still points at that league (Discord handoff
    // can land before mine-list resolves). Only drop stale ids after load.
    if (leaguesReady && !leaguesLoading && !leaguesError) {
      const stillOnLeagueRoute = location.pathname.startsWith(`/l/${scope.leagueId}`);
      if (stillOnLeagueRoute) return;
      const next: HubScope = { kind: "main" };
      setScope(next);
      persistScope(next);
      setTheme("app");
    }
  }, [
    scope,
    selectedLeague,
    leaguesReady,
    leaguesLoading,
    leaguesError,
    location.pathname,
    setTheme,
  ]);

  function exitToMain(path = "/home") {
    const next: HubScope = { kind: "main" };
    setScope(next);
    persistScope(next);
    setTheme("app");
    navigate(path);
  }

  function selectMainHub() {
    exitToMain("/home");
  }

  function selectLeague(leagueId: string) {
    const league = leagues.find((item) => item.id === leagueId);
    const next: HubScope = { kind: "league", leagueId };
    setScope(next);
    persistScope(next);
    setTheme("app");
    const dest = league?.rosterType === "rise_to_immortality" && !league.riseHubUnlocked ? "rise" : "buzz";
    navigate(`/l/${leagueId}/${dest}`);
  }

  function ensureLeagueScope(leagueId: string) {
    if (scope.kind === "league" && scope.leagueId === leagueId) return;
    const next: HubScope = { kind: "league", leagueId };
    setScope(next);
    persistScope(next);
  }

  async function retireFromLeague(leagueId: string) {
    await siteApi.retireFromLeague(leagueId);
    await refreshLeagues();
    const next: HubScope = { kind: "main" };
    setScope(next);
    persistScope(next);
    setTheme("app");
    navigate("/home");
  }

  return (
    <HubContext.Provider
      value={{
        scope,
        leagues,
        leaguesLoading,
        leaguesError,
        selectedLeague,
        selectMainHub,
        exitToMain,
        selectLeague,
        ensureLeagueScope,
        refreshLeagues,
        retireFromLeague,
      }}
    >
      {children}
    </HubContext.Provider>
  );
}

export function useHub() {
  const context = useContext(HubContext);
  if (!context) throw new Error("useHub must be used within HubProvider");
  return context;
}
