import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MatchupCard, type HubMatchupGame } from "@rec/hub-ui";
import { siteApi } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Discord game-channel matchup-card embed
// image (apps/api/src/lib/matchup-render.ts) -- no SiteShell/nav, no auth, just the card. The
// Playwright caller only screenshots the [data-matchup-render] element itself, so this
// wrapper's own background/padding never appear in the final PNG.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

export function RenderMatchup() {
  const { gameId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [game, setGame] = useState<HubMatchupGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId || !token) {
      setError("Missing gameId or token.");
      return;
    }
    siteApi.getMatchupCardRenderData(gameId, token)
      .then((data) => setGame(data as unknown as HubMatchupGame))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load matchup."));
  }, [gameId, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!game) return null;

  return (
    <div style={{ width: 1650, height: 330, padding: 24, background: "#0b0d10" }}>
      {/* Discord scales an embed image's DISPLAYED width to fit its own layout regardless of
          source resolution -- a higher-res screenshot of the same short/wide card doesn't look
          any bigger on screen, only crisper. Stretching the actual rendered element (Playwright
          screenshots the painted/transformed bounding box, not the static layout box) is what
          actually changes the card's proportions in the final image. */}
      <div style={{ width: 1400, transform: "scale(1.15, 1.65)", transformOrigin: "top left" }}>
        <MatchupCard game={game} featured renderMode="discord" showReactions={false} />
      </div>
    </div>
  );
}
