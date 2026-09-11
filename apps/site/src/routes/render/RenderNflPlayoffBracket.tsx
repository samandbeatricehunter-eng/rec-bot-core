import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { NflPlayoffBracketDesktop, PlayoffPictureBoard, type NflPlayoffPicture } from "@rec/hub-ui";
import { siteApi } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Discord playoff-picture post's image
// (apps/api/src/lib/nfl-playoff-bracket-render.ts) -- no SiteShell/nav, no auth, just the board.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/nfl-playoff-bracket.css";

export function RenderNflPlayoffBracket() {
  const { leagueId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<NflPlayoffPicture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !token) {
      setError("Missing leagueId or token.");
      return;
    }
    siteApi.getNflPlayoffBracketRenderData(leagueId, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load playoff bracket."));
  }, [leagueId, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  const usePictureBoard = data.isLiveProjection || !data.rounds.some((r) => r.round !== "wild_card" && r.matchups.length);

  return (
    <div data-bracket-render-root style={{ width: usePictureBoard ? 1100 : 1600, padding: usePictureBoard ? 0 : 24, background: "#0b0d10" }}>
      {usePictureBoard ? <PlayoffPictureBoard picture={data} /> : <NflPlayoffBracketDesktop picture={data} />}
    </div>
  );
}
