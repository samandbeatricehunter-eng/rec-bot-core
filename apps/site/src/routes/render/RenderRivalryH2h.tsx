import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MatchupCard, HeroMatchupBreakdown, type HubMatchupGame, type MatchupPreview } from "@rec/hub-ui";
import { siteApi, type ProspectCardRenderData } from "../../lib/site-api.js";
import { RivalryProspectComparison } from "../../components/RivalryProspectComparison.js";

// Chromeless page Playwright screenshots for the Rise to Immortality Rivalry Head-to-Head
// Discord post's image (apps/api/src/lib/rivalry-h2h-render.ts) -- the existing team-comparison
// card/breakdown stacked with a new prospect-vs-prospect comparison. Same pattern as
// RenderMatchup.tsx/RenderProspectCard.tsx.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

type RenderData = {
  side: "offense" | "defense";
  matchup: { game: HubMatchupGame; preview: MatchupPreview | null } | null;
  homeProspect: ProspectCardRenderData | null;
  awayProspect: ProspectCardRenderData | null;
};

export function RenderRivalryH2h() {
  const { gameId = "", side = "offense" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<RenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId || !token || (side !== "offense" && side !== "defense")) {
      setError("Missing gameId, side, or token.");
      return;
    }
    siteApi.getRivalryH2hRenderData(gameId, side, token)
      .then((result) => setData(result as RenderData))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load rivalry head-to-head."));
  }, [gameId, side, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div data-rivalry-h2h-render-root style={{ width: 1400, padding: 32, background: "#0b0d10", display: "flex", flexDirection: "column", gap: 24, fontFamily: "sans-serif", color: "#fff" }}>
      <header style={{ textAlign: "center" }}>
        <p style={{ color: "#e0b84a", textTransform: "uppercase", letterSpacing: 4, fontSize: 13, fontWeight: 800, margin: 0 }}>Rise to Immortality</p>
        <h1 style={{ fontSize: 44, fontWeight: 900, letterSpacing: 2, margin: "4px 0 0" }}>RIVALRY WEEK</h1>
      </header>
      {data.matchup?.game ? <MatchupCard game={data.matchup.game} featured renderMode="discord" showReactions={false} /> : null}
      {data.matchup?.preview ? <HeroMatchupBreakdown preview={data.matchup.preview} /> : null}
      <RivalryProspectComparison a={data.homeProspect} b={data.awayProspect} />
    </div>
  );
}
