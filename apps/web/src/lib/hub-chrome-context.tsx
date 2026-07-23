import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context.js";
import { recApi } from "./rec-api-client.js";

const SCOPE_KEY = "rec-web-hub-scope";

export type HubScope = { kind: "main" } | { kind: "league" };

export type HubLeagueMeta = {
  id: string;
  name: string;
  game: string;
  gameLabel: string;
  isCommissioner: boolean;
};

const GAME_LABELS: Record<string, string> = {
  cfb_27: "CFB 27",
  madden_26: "Madden 26",
  madden_27: "Madden 27",
};

export function gameLabelFor(game: string): string {
  return GAME_LABELS[game] ?? game.replace(/_/g, " ").toUpperCase();
}

type HubChromeContextValue = {
  scope: HubScope;
  currentLeague: HubLeagueMeta | null;
  leagueLoading: boolean;
  selectMainHub: () => void;
  selectLeague: () => void;
  retireFromCurrentLeague: () => Promise<void>;
  refreshLeague: () => Promise<HubLeagueMeta | null>;
};

const HubChromeContext = createContext<HubChromeContextValue | null>(null);

function readStoredScope(): HubScope {
  try {
    const raw = sessionStorage.getItem(SCOPE_KEY);
    if (!raw) return { kind: "league" };
    const parsed = JSON.parse(raw) as HubScope;
    if (parsed?.kind === "main" || parsed?.kind === "league") return parsed;
  } catch {
    /* ignore */
  }
  // Discord Activity opens into a single guild's hub — default to league scope.
  return { kind: "league" };
}

function persistScope(scope: HubScope) {
  try {
    sessionStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
  } catch {
    /* ignore */
  }
}

function applyTheme(scope: HubScope, league: HubLeagueMeta | null) {
  const root = document.documentElement;
  if (scope.kind === "main") {
    root.setAttribute("data-site-theme", "app");
    root.removeAttribute("data-game-theme");
    return;
  }
  root.removeAttribute("data-site-theme");
  if (league?.game) {
    root.setAttribute("data-game-theme", league.game);
  }
}

export function HubChromeProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<HubScope>(() => readStoredScope());
  const [currentLeague, setCurrentLeague] = useState<HubLeagueMeta | null>(null);
  const [leagueLoading, setLeagueLoading] = useState(false);

  const refreshLeague = useCallback(async () => {
    if (auth.status !== "ready") {
      setCurrentLeague(null);
      return null;
    }
    setLeagueLoading(true);
    try {
      const [header, hub] = await Promise.all([
        recApi.getLeagueHeaderSummary(auth.guildId).catch(() => null),
        recApi.getHub(auth.guildId).catch(() => null),
      ]);
      if (!header?.league && !hub?.league) {
        setCurrentLeague(null);
        return null;
      }
      const id = hub?.league.id ?? "";
      const name = header?.league.name ?? hub?.league.name ?? "League";
      const game = header?.league.game ?? hub?.league.game ?? "cfb_27";
      const meta: HubLeagueMeta = {
        id,
        name,
        game,
        gameLabel: gameLabelFor(game),
        isCommissioner: hub?.canManageLeague ?? false,
      };
      setCurrentLeague(meta);
      return meta;
    } finally {
      setLeagueLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void refreshLeague();
  }, [refreshLeague]);

  useEffect(() => {
    applyTheme(scope, currentLeague);
  }, [scope, currentLeague]);

  const selectMainHub = useCallback(() => {
    const next: HubScope = { kind: "main" };
    setScope(next);
    persistScope(next);
    applyTheme(next, currentLeague);
    // Keep the Discord hub surface mounted — main chrome differs, content stays HubHome.
    navigate("/?section=league&subTab=buzz");
  }, [currentLeague, navigate]);

  const selectLeague = useCallback(() => {
    const next: HubScope = { kind: "league" };
    setScope(next);
    persistScope(next);
    applyTheme(next, currentLeague);
    navigate("/?section=league&subTab=buzz");
  }, [currentLeague, navigate]);

  const retireFromCurrentLeague = useCallback(async () => {
    if (auth.status !== "ready") return;
    await recApi.retireFromHub(auth.guildId);
    await refreshLeague();
    const next: HubScope = { kind: "main" };
    setScope(next);
    persistScope(next);
    applyTheme(next, null);
    navigate("/?section=league&subTab=buzz");
  }, [auth, navigate, refreshLeague]);

  const value = useMemo<HubChromeContextValue>(
    () => ({
      scope,
      currentLeague,
      leagueLoading,
      selectMainHub,
      selectLeague,
      retireFromCurrentLeague,
      refreshLeague,
    }),
    [
      scope,
      currentLeague,
      leagueLoading,
      selectMainHub,
      selectLeague,
      retireFromCurrentLeague,
      refreshLeague,
    ],
  );

  return <HubChromeContext.Provider value={value}>{children}</HubChromeContext.Provider>;
}

export function useHubChrome() {
  const context = useContext(HubChromeContext);
  if (!context) throw new Error("useHubChrome must be used within HubChromeProvider");
  return context;
}
