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
  document.documentElement.setAttribute("data-site-theme", theme || "app");
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
