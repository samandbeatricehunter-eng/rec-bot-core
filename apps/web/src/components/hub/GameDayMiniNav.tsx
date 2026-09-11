import { SectionMiniNav } from "./SectionMiniNav.js";

export type GameDayNavId = "mine" | "gotw" | "schedule";

/** Plan order: My Matchup → Game of the Week → League Schedule. */
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
        { id: "gotw", top: "Game of", bottom: "the Week", to: `${base}?view=gotw` },
        { id: "schedule", top: "League", bottom: "Schedule", to: `${base}?view=schedule` },
      ]}
    />
  );
}
