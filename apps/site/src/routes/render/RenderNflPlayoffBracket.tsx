import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { NflPlayoffPicture } from "@rec/hub-ui";
import { NflPlayoffBracketDesktop, PlayoffPictureBoard } from "../../features/league/management/index.js";
import { siteApi } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Discord playoff-picture post's image
// (apps/api/src/lib/nfl-playoff-bracket-render.ts) -- no SiteShell/nav, no auth, just the board.
import "../../styles/web/tokens.css";
import "../../styles/web/themes/madden27.css";
import "../../styles/web/typography.css";
import "../../styles/web/surfaces.css";
import "../../styles/web/football-components.css";
import "../../styles/web/nfl-playoff-bracket.css";

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
