import { createContext, useContext, type ReactNode } from "react";

type LeagueThemeValue = { game: string | null };

const LeagueThemeContext = createContext<LeagueThemeValue>({ game: null });

export function LeagueThemeProvider({ game, children }: { game: string | null; children: ReactNode }) {
  return <LeagueThemeContext.Provider value={{ game }}>{children}</LeagueThemeContext.Provider>;
}

export function useLeagueTheme() {
  return useContext(LeagueThemeContext);
}
