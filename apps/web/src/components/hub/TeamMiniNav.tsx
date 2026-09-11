import { SectionMiniNav } from "./SectionMiniNav.js";

export type TeamNavId = "team" | "roster" | "progression" | "trades" | "store";

/** Plan order: My Team → Roster Search → Progression → Trade Center → Store. */
export function TeamMiniNav({
  active,
  leagueId,
  isRise = false,
  tradesUnlocked = true,
  storeUnlocked = true,
  progressionAvailable = true,
}: {
  active: TeamNavId;
  leagueId: string;
  isRise?: boolean;
  tradesUnlocked?: boolean;
  storeUnlocked?: boolean;
  /** Non-RTI leagues may not have a progression surface yet. */
  progressionAvailable?: boolean;
}) {
  const base = `/l/${leagueId}`;
  const items = [
    { id: "team", top: "My", bottom: "Team", to: `${base}/team` },
    { id: "roster", top: "Roster", bottom: "Search", to: `${base}/roster` },
    progressionAvailable
      ? {
          id: "progression",
          top: isRise ? "Build Your" : "Team",
          bottom: isRise ? "Legacy" : "Progression",
          to: `${base}/team/progression`,
        }
      : null,
    {
      id: "trades",
      top: "Trade",
      bottom: "Center",
      to: `${base}/trades`,
      disabled: !tradesUnlocked,
      disabledTitle: "Trades unlock after the fantasy draft import.",
    },
    {
      id: "store",
      top: "League",
      bottom: "Store",
      to: `${base}/store`,
      disabled: !storeUnlocked,
      disabledTitle: isRise ? "Store unlocks after Week 1." : undefined,
    },
  ].filter(Boolean) as Array<{
    id: string;
    top: string;
    bottom: string;
    to: string;
    disabled?: boolean;
    disabledTitle?: string;
  }>;

  return <SectionMiniNav ariaLabel="Team views" active={active} items={items} />;
}
