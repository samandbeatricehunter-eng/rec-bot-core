import { LeagueTopRail } from "../chassis/index.js";
import { TeamMiniNav, type TeamNavId } from "./TeamMiniNav.js";

export type TeamFamilyView = "team" | "roster" | "store" | "trades" | "progression";

export function TeamRouteRail({
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
  progressionAvailable?: boolean;
}) {
  return (
    <LeagueTopRail>
      <TeamMiniNav
        active={active}
        leagueId={leagueId}
        isRise={isRise}
        tradesUnlocked={tradesUnlocked}
        storeUnlocked={storeUnlocked}
        progressionAvailable={progressionAvailable}
      />
    </LeagueTopRail>
  );
}
