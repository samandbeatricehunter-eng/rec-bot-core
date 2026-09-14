import { LeagueTopRail } from "../chassis/index.js";
import { MgmtStatusStrip, type MgmtNavId } from "./MgmtStatusStrip.js";

export function MgmtRouteRail({
  active,
  leagueId,
}: {
  active: MgmtNavId;
  leagueId: string;
}) {
  return (
    <LeagueTopRail>
      <MgmtStatusStrip leagueId={leagueId} active={active} />
    </LeagueTopRail>
  );
}
