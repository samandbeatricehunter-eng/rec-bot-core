import { useSearchParams } from "react-router-dom";
import { LeagueTopRail } from "../chassis/index.js";
import { GameDayMiniNav, type GameDayNavId } from "./GameDayMiniNav.js";

function gameDayNavIdFromSearch(searchParams: URLSearchParams): GameDayNavId {
  const view = searchParams.get("view");
  if (view === "gotw" || view === "schedule" || view === "myschedule") return view;
  return "mine";
}

export function GameDayRouteRail({ leagueId }: { leagueId: string }) {
  const [searchParams] = useSearchParams();
  return (
    <LeagueTopRail>
      <GameDayMiniNav active={gameDayNavIdFromSearch(searchParams)} leagueId={leagueId} />
    </LeagueTopRail>
  );
}
