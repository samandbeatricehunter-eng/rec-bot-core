import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { HubHome } from "@rec/hub-ui";

/**
 * Game Day body owned by apps/site. Top rail is GameDayRouteRail; this page only hosts the
 * matchup views that still live in the legacy HubHome matchups branch.
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

  return <HubHome showGameDayNav={false} />;
}
