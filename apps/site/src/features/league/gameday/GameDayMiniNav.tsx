import { SectionMiniNav } from "../chassis/SectionMiniNav.js";

export type GameDayNavId = "mine" | "gotw" | "schedule" | "myschedule";

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
