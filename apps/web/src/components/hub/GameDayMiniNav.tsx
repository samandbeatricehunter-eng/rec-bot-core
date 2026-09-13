import { SectionMiniNav } from "./SectionMiniNav.js";

export type GameDayNavId = "mine" | "gotw" | "schedule" | "myschedule";

/** 2x2 grid: My Matchup / My Schedule (top row), Game of the Week / League Schedule (bottom
 * row). All four are real routes -- My Schedule renders inline on the page body (the same
 * matchup-card style League Schedule uses), not a modal. */
export function GameDayMiniNav({
  active,
  leagueId,
}: {
  active: GameDayNavId;
  leagueId: string;
}) {
  const base = `/l/${leagueId}/matchups`;
  return (
    <SectionMiniNav
      ariaLabel="Game Day views"
      active={active}
      className="hub-section-mini-nav--gameday"
      items={[
        { id: "mine", top: "My", bottom: "Matchup", to: base },
        { id: "myschedule", top: "My", bottom: "Schedule", to: `${base}?view=myschedule` },
        { id: "gotw", top: "Game of", bottom: "the Week", to: `${base}?view=gotw` },
        { id: "schedule", top: "League", bottom: "Schedule", to: `${base}?view=schedule` },
      ]}
    />
  );
}
