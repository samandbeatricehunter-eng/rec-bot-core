import { SectionMiniNav } from "./SectionMiniNav.js";

export type GameDayNavId = "mine" | "gotw" | "schedule" | "myschedule";

/** My Matchup / My Schedule (top row), Game of the Week / League Schedule (bottom row) --
 * SectionMiniNav's universal 4-column grid naturally lays four items out as one row that
 * wraps to 2x2 on narrow screens, same chassis every other mini-nav uses. All four are real
 * routes -- My Schedule renders inline on the page body (the same matchup-card style League
 * Schedule uses), not a modal. */
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
      items={[
        { id: "mine", top: "My", bottom: "Matchup", to: base },
        { id: "myschedule", top: "My", bottom: "Schedule", to: `${base}?view=myschedule` },
        { id: "gotw", top: "Game of", bottom: "the Week", to: `${base}?view=gotw` },
        { id: "schedule", top: "League", bottom: "Schedule", to: `${base}?view=schedule` },
      ]}
    />
  );
}
