import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ProTrackerCard } from "@rec/hub-ui";
import { siteApi, type ProTrackerRenderData } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Rise to Immortality weekly Pro Tracker Discord
// post's image (apps/api/src/lib/pro-tracker-render.ts) -- no SiteShell/nav, no auth, just the
// card. Same pattern as RenderPlayerOfWeek.tsx.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

export function RenderProTracker() {
  const { userId = "", leagueId = "", weekNumber = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<ProTrackerRenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !leagueId || !weekNumber || !token) {
      setError("Missing userId, leagueId, weekNumber, or token.");
      return;
    }
    siteApi.getProTrackerRenderData(userId, leagueId, weekNumber, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load Pro Tracker."));
  }, [userId, leagueId, weekNumber, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ width: 1400, padding: 24, background: "#0b0d10" }}>
      <ProTrackerCard seasonNumber={data.seasonNumber} weekNumber={data.weekNumber} offense={data.offense} defense={data.defense} />
    </div>
  );
}
