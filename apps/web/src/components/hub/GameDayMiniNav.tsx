import { SectionMiniNav } from "./SectionMiniNav.js";

export type GameDayNavId = "mine" | "gotw" | "schedule";

/** 2x2 grid: My Matchup / My Schedule (top row), Game of the Week / League Schedule (bottom
 * row). My Schedule opens the existing full-season schedule modal in place rather than
 * navigating -- it has no "active" state of its own, so `active` only ever matches one of the
 * other three. */
export function GameDayMiniNav({
  active,
  leagueId,
  onMySchedule,
}: {
  active: GameDayNavId;
  leagueId: string;
  onMySchedule: () => void;
}) {
  const base = `/l/${leagueId}/matchups`;
  return (
    <SectionMiniNav
      ariaLabel="Game Day views"
      active={active}
      className="hub-section-mini-nav--gameday"
      items={[
        { id: "mine", top: "My", bottom: "Matchup", to: base },
        { id: "myschedule", top: "My", bottom: "Schedule", onClick: onMySchedule },
        { id: "gotw", top: "Game of", bottom: "the Week", to: `${base}?view=gotw` },
        { id: "schedule", top: "League", bottom: "Schedule", to: `${base}?view=schedule` },
      ]}
    />
  );
}
