import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import type { HubMatchupGame } from "../../types/api.js";

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#080A0C" : "#F4F5F6";
}

export function MatchupCard({ game, featured = false }: { game: HubMatchupGame; featured?: boolean }) {
  const card = <article className={`rec-matchup-card${featured ? " rec-matchup-card--featured" : ""}${game.involvesMe ? " rec-matchup-card--mine" : ""}`}>
    <div className="rec-matchup-card__team rec-matchup-card__team--away" style={{ "--team-color": game.awayTeamColor, "--team-text": readableText(game.awayTeamColor) } as CSSProperties}>
      <small>Away</small><strong>{game.awayTeamName}</strong>
    </div>
    <div className="rec-matchup-card__center">
      {game.rivalryName && <div className="rec-matchup-card__rivalry"><strong>{game.rivalryName}</strong><span>Rivalry</span></div>}
      <div className="rec-matchup-card__result">
        {game.isFinal && game.awayScore != null && game.homeScore != null
          ? <><b>{game.awayScore}</b><span>Final</span><b>{game.homeScore}</b></>
          : <span className="rec-matchup-card__at">@</span>}
      </div>
      {game.matchupType !== "h2h" && <small>CPU</small>}
    </div>
    <div className="rec-matchup-card__team rec-matchup-card__team--home" style={{ "--team-color": game.homeTeamColor, "--team-text": readableText(game.homeTeamColor) } as CSSProperties}>
      <small>Home</small><strong>{game.homeTeamName}</strong>
    </div>
    <div className="rec-matchup-card__badges">
      {game.isGameOfWeek && <span>Game of the Week</span>}
      {game.involvesMe && <span>Your Matchup</span>}
      {game.streams.length > 0 && !game.isFinal && <span className="live">Live</span>}
    </div>
  </article>;
  return game.matchupType === "h2h" ? <Link className="rec-matchup-card-link" to={`/matchups/${game.gameId}`}>{card}</Link> : <div className="rec-matchup-card-link cpu">{card}</div>;
}
