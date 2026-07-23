import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type SiteTheme = "app" | "cfb_27" | "madden_26" | "madden_27" | string;

type SiteThemeContextValue = {
  theme: SiteTheme;
  setTheme: (theme: SiteTheme) => void;
};

const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

function applyTheme(theme: SiteTheme) {
  const root = document.documentElement;
  const next = theme || "app";
  root.setAttribute("data-site-theme", next);
  // Hub CSS (apps/web themes) keys off data-game-theme; keep it in sync when the
  // site shell owns theming for in-process Discord /app embeds.
  if (next !== "app") root.setAttribute("data-game-theme", next);
  else root.removeAttribute("data-game-theme");
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<SiteTheme>(() => {
    return document.documentElement.getAttribute("data-site-theme") || "app";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setTheme(next: SiteTheme) {
    setThemeState(next || "app");
  }

  return (
    <SiteThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </SiteThemeContext.Provider>
  );
}

export function useSiteTheme() {
  const context = useContext(SiteThemeContext);
  if (!context) throw new Error("useSiteTheme must be used within SiteThemeProvider");
  return context;
}

/** While mounted, switch chrome to the league game theme; restore app on leave. */
export function useLeagueSiteTheme(game: string | null | undefined) {
  const { setTheme } = useSiteTheme();
  useEffect(() => {
    if (!game) {
      setTheme("app");
      return;
    }
    setTheme(game);
    return () => setTheme("app");
  }, [game, setTheme]);
}
