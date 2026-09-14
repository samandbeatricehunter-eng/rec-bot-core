import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { GameDayHome } from "@rec/hub-ui";

/**
 * Game Day body owned by apps/site. Top rail is GameDayRouteRail; matchup views still
 * render via GameDayHome in apps/web until the remaining hooks/modals move here.
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
