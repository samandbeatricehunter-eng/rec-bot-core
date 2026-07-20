import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import type { HubMatchupGame } from "../../types/api.js";

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#080A0C" : "#F4F5F6";
}

export function MatchupCard({ game, featured = false }: { game: HubMatchupGame; featured?: boolean }) {
  const isRivalry = Boolean(game.rivalryName);
  const isGotw = Boolean(game.isGameOfWeek);

  // Center @-section tag placement:
  //  - GOTW (not rivalry): GOTW tag top, Your Matchup bottom.
  //  - Rivalry: RIVALRY tag + name top; Your Matchup bottom. When it is ALSO GOTW, the
  //    GOTW tag drops to the bottom stack (above Your Matchup), keeping the rivalry on top.
  const bottomTags = [
    isRivalry && isGotw ? <span key="gotw" className="rec-tag rec-tag--gotw">Game of the Week</span> : null,
    game.involvesMe ? <span key="mine" className="rec-tag rec-tag--mine">Your Matchup</span> : null,
  ].filter(Boolean);

  const topTag = isRivalry
    ? (
      <div className="rec-matchup-card__ctag rec-matchup-card__ctag--top">
        <span className="rec-tag rec-tag--rivalry">Rivalry</span>
        <em className="rec-matchup-card__rivalry-name">{game.rivalryName}</em>
      </div>
    )
    : isGotw
      ? (
        <div className="rec-matchup-card__ctag rec-matchup-card__ctag--top">
          <span className="rec-tag rec-tag--gotw">Game of the Week</span>
        </div>
      )
      : null;

  const card = (
    <article className={`rec-matchup-card${featured ? " rec-matchup-card--featured" : ""}${game.involvesMe ? " rec-matchup-card--mine" : ""}${isGotw ? " rec-matchup-card--gotw" : ""}`}>
      <span className="rec-matchup-card__sheen" aria-hidden="true" />
      {game.streams.length > 0 && !game.isFinal && <span className="rec-matchup-card__live">Live</span>}
      <div className="rec-matchup-card__team rec-matchup-card__team--away" style={{ "--team-color": game.awayTeamColor, "--team-text": readableText(game.awayTeamColor) } as CSSProperties}>
        <small>Away</small><strong>{game.awayTeamName}</strong>
      </div>
      <div className="rec-matchup-card__center">
        {topTag}
        <div className="rec-matchup-card__result">
          {game.isFinal && game.awayScore != null && game.homeScore != null
            ? <><b>{game.awayScore}</b><span>Final</span><b>{game.homeScore}</b></>
            : <span className="rec-matchup-card__at">@</span>}
        </div>
        {game.matchupType !== "h2h" && <small>CPU</small>}
        {bottomTags.length > 0 && <div className="rec-matchup-card__ctag rec-matchup-card__ctag--bottom">{bottomTags}</div>}
      </div>
      <div className="rec-matchup-card__team rec-matchup-card__team--home" style={{ "--team-color": game.homeTeamColor, "--team-text": readableText(game.homeTeamColor) } as CSSProperties}>
        <small>Home</small><strong>{game.homeTeamName}</strong>
      </div>
    </article>
  );
  return game.matchupType === "h2h" ? <Link className="rec-matchup-card-link" to={`/matchups/${game.gameId}`}>{card}</Link> : <div className="rec-matchup-card-link cpu">{card}</div>;
}
