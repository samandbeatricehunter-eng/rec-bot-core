import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MatchupCard, HeroMatchupBreakdown, type HubMatchupGame, type MatchupPreview } from "@rec/hub-ui";
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
  const [preview, setPreview] = useState<MatchupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId || !token) {
      setError("Missing gameId or token.");
      return;
    }
    siteApi.getMatchupCardRenderData(gameId, token)
      .then((data: any) => { setGame(data.game as HubMatchupGame); setPreview(data.preview as MatchupPreview | null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load matchup."));
  }, [gameId, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!game) return null;

  return (
    // Discord caps an embed image's DISPLAYED WIDTH to a fixed ceiling regardless of source
    // resolution and scales height to match the image's own aspect ratio -- a skewed
    // transform: scale(x,y) just distorts the same effective footprint rather than growing it.
    // A genuinely taller card (via the .rec-matchup-card--render CSS override, hub.css) is what
    // actually displays bigger, since Discord preserves that taller aspect ratio when it scales
    // width down to its cap.
    //
    // data-matchup-render-root (not the card's own data-matchup-render) is what Playwright
    // actually screenshots now, so the breakdown table below the card is captured too -- see
    // apps/api/src/lib/matchup-render.ts.
    <div data-matchup-render-root style={{ width: 1400, padding: 24, background: "#0b0d10", display: "flex", flexDirection: "column", gap: 20 }}>
      <MatchupCard game={game} featured renderMode="discord" showReactions={false} />
      {preview ? <HeroMatchupBreakdown preview={preview} /> : null}
    </div>
  );
}
