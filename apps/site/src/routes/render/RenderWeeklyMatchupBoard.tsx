import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MatchupCard } from "@rec/hub-ui";
import { siteApi, type WeeklyMatchupBoardRenderData } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the weekly highlight recap's "here's this week's
// slate" hold screen (apps/api/src/lib/weekly-matchup-board-render.ts) -- no SiteShell/nav, no
// auth, just the matchup cards over black. Same pattern as RenderMatchup.tsx.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

function Section({ title, games }: { title: string; games: WeeklyMatchupBoardRenderData["gotw"] }) {
  if (!games.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, color: "#fff", fontFamily: "var(--font-display)", fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {games.map((game) => (
          // MatchupCard's team-name font uses clamp(...,Nvw,...) sized against the full page
          // viewport, not this tile's own width -- at a narrow tile (previously 420px) that
          // produces a font far too large for the available column, wrapping every letter onto
          // its own line and stretching the card absurdly tall. Widening the tile close to half
          // the board gives that vw-driven font enough real column width to wrap normally,
          // which is what actually fixes the height -- keeping cards landscape, 2 per row.
          <div key={game.gameId} style={{ width: 900 }}>
            {/* Deliberately NOT renderMode="discord" -- that mode hardcodes a fixed 3.4rem,
              non-wrapping team-name font sized for a single 1600px-wide Discord embed card
              (see matchup-render.ts), which clips badly at this grid tile's width. */}
            <MatchupCard game={game} showReactions={false} passive />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RenderWeeklyMatchupBoard() {
  const { leagueId = "", weekNumber = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<WeeklyMatchupBoardRenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !weekNumber || !token) {
      setError("Missing leagueId, weekNumber, or token.");
      return;
    }
    siteApi.getWeeklyMatchupBoardRenderData(leagueId, weekNumber, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load the weekly matchup board."));
  }, [leagueId, weekNumber, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div data-board-render-root style={{ width: 1920, minHeight: 1080, padding: 48, background: "#000", display: "flex", flexDirection: "column", gap: 32, boxSizing: "border-box" }}>
      <h1 style={{ margin: 0, color: "#fff", fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: "0.1em", textTransform: "uppercase" }}>Week {data.weekNumber}</h1>
      <Section title="Game of the Week" games={data.gotw} />
      <Section title="H2H Matchups" games={data.h2h} />
      <Section title="Human vs CPU" games={data.humanCpu} />
    </div>
  );
}
