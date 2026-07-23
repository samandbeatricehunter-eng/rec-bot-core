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

function applyTheme(_theme: SiteTheme) {
  const root = document.documentElement;
  // Universal Platinum face for the whole product — CFB/Madden no longer reskin fonts or colors.
  root.setAttribute("data-site-theme", "app");
  root.removeAttribute("data-game-theme");
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

/** Kept for call sites — league pages stay on universal Platinum app chrome. */
export function useLeagueSiteTheme(_game: string | null | undefined) {
  const { setTheme } = useSiteTheme();
  useEffect(() => {
    setTheme("app");
  }, [setTheme]);
}
