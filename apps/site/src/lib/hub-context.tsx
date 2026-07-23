import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
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
      return;
    }
    void refreshLeagues();
  }, [auth.status]);

  useEffect(() => {
    if (scope.kind === "main") {
      setTheme("app");
      return;
    }
    if (selectedLeague) {
      setTheme(selectedLeague.game);
      return;
    }
    // After a successful load, drop stale league ids (e.g. just retired).
    if (leaguesReady && !leaguesLoading && !leaguesError) {
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
    if (league) setTheme(league.game);
    navigate(`/l/${leagueId}/buzz`);
  }

  function ensureLeagueScope(leagueId: string) {
    if (scope.kind === "league" && scope.leagueId === leagueId) return;
    const league = leagues.find((item) => item.id === leagueId);
    const next: HubScope = { kind: "league", leagueId };
    setScope(next);
    persistScope(next);
    if (league) setTheme(league.game);
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
