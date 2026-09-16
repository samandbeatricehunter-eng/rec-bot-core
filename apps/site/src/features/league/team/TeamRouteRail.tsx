import { LeagueTopRail } from "../chassis/index.js";
import type { TeamNavId } from "./TeamMiniNav.js";
import { TeamStatusStrip } from "./TeamStatusStrip.js";

export type TeamFamilyView = "team" | "roster" | "store" | "trades" | "progression";

export function TeamRouteRail({
  active,
  leagueId,
  isRise = false,
  tradesUnlocked = true,
  storeUnlocked = true,
}: {
  active: TeamNavId;
  leagueId: string;
  isRise?: boolean;
  tradesUnlocked?: boolean;
  storeUnlocked?: boolean;
}) {
  return (
    <LeagueTopRail>
      <TeamStatusStrip
        active={active}
        leagueId={leagueId}
        isRise={isRise}
        tradesUnlocked={tradesUnlocked}
        storeUnlocked={storeUnlocked}
      />
    </LeagueTopRail>
  );
}
