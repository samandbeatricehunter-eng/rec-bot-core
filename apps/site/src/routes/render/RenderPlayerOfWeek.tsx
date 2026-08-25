import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PlayerOfWeekCard } from "@rec/hub-ui";
import { siteApi, type PlayerOfWeekRenderData } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Discord Player of the Week post's image
// (apps/api/src/lib/player-of-week-render.ts) -- no SiteShell/nav, no auth, just the card.
// Same pattern as RenderMatchup.tsx.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

export function RenderPlayerOfWeek() {
  const { storyId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<PlayerOfWeekRenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId || !token) {
      setError("Missing storyId or token.");
      return;
    }
    siteApi.getPlayerOfWeekRenderData(storyId, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load Player of the Week."));
  }, [storyId, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ width: 1400, padding: 24, background: "#0b0d10" }}>
      <PlayerOfWeekCard weekNumber={data.week} winners={data.winners} />
    </div>
  );
}
