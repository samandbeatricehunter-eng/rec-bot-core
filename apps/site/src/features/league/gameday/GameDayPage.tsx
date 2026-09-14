import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { GameDayHome } from "./GameDayHome.js";

/**
 * Game Day body owned by apps/site. Top rail is GameDayRouteRail; matchup views render
 * via local GameDayHome (moved out of apps/web HubHome).
 */
export function GameDayPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const section = searchParams.get("section");
    const subTab = searchParams.get("subTab");
    if (section === "league" && subTab === "matchups") return;
    const next = new URLSearchParams(searchParams);
    next.set("section", "league");
    next.set("subTab", "matchups");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return <GameDayHome showGameDayNav={false} />;
}
