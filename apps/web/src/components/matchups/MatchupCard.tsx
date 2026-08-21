import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import type { HubMatchupGame } from "../../types/api.js";
import { useAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { MatchupReactionBar } from "./MatchupReactionBar.js";
import { TeamLogo } from "../ui/TeamLogo.js";

function teamMetaLine(rank: number | null, record: string | null): string | null {
  const parts = [rank ? `#${rank}` : null, record].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#080A0C" : "#F4F5F6";
}

export function MatchupCard({
  game: initialGame,
  featured = false,
  showReactions = true,
  reactionsBelow = false,
  passive = false,
  renderMode = "site",
}: {
  game: HubMatchupGame;
  featured?: boolean;
  showReactions?: boolean;
  reactionsBelow?: boolean;
  /** Prevent the card surface from triggering navigation or other parent tap behavior. */
  passive?: boolean;
  /** "discord" strips interactivity (link/reactions/hover) for the Playwright screenshot used in game-channel embeds. */
  renderMode?: "site" | "discord";
}) {
  const auth = useAuth();
  const guildId = auth.status === "ready" ? auth.guildId : "";
  const [game, setGame] = useState(initialGame);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGame(initialGame);
  }, [initialGame]);

  const isRivalry = Boolean(game.rivalryName);
  const isGotw = Boolean(game.isGameOfWeek);
  const reactionsEnabled = renderMode !== "discord" && showReactions && game.matchupType === "h2h";

  const bottomTags = [
    isRivalry && isGotw ? <span key="gotw" className="rec-tag rec-tag--gotw">Game of the Week</span> : null,
    // "Your Matchup" is a personalized, viewer-relative tag -- meaningless (and always
    // technically "true" from the neutral render-pipeline viewer) on the Discord card image.
    renderMode !== "discord" && game.involvesMe ? <span key="mine" className="rec-tag rec-tag--mine">Your Matchup</span> : null,
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

  async function react(reactionKey: "like" | "dislike") {
    const previous = game;
    const has = game.myReactions.includes(reactionKey);
    const withoutStandard = game.myReactions.filter((key) => !["love", "like", "dislike", "poop"].includes(key));
    const nextMine = has ? withoutStandard : [...withoutStandard, reactionKey];
    const nextCounts = { ...game.reactionCounts };
    for (const key of ["love", "like", "dislike", "poop"] as const) {
      if (game.myReactions.includes(key)) nextCounts[key] = Math.max(0, nextCounts[key] - 1);
    }
    if (!has) nextCounts[reactionKey] += 1;
    setGame({ ...game, myReactions: nextMine, reactionCounts: nextCounts });
    setBusy(true);
    try {
      await recApi.toggleHubGameReaction({ guildId, gameId: game.gameId, reactionKey });
    } catch {
      setGame(previous);
    } finally {
      setBusy(false);
    }
  }

  async function submitGoty(comment: string) {
    const already = game.myReactions.includes("goty");
    await recApi.toggleHubGameReaction({
      guildId,
      gameId: game.gameId,
      reactionKey: "goty",
      comment,
      mode: "set",
    });
    setGame({
      ...game,
      myReactions: already ? game.myReactions : [...game.myReactions, "goty"],
      reactionCounts: {
        ...game.reactionCounts,
        goty: already ? game.reactionCounts.goty : game.reactionCounts.goty + 1,
      },
      myGotyComment: comment || null,
    });
  }

  async function clearGoty() {
    const already = game.myReactions.includes("goty");
    await recApi.toggleHubGameReaction({
      guildId,
      gameId: game.gameId,
      reactionKey: "goty",
      mode: "clear",
    });
    if (!already) return;
    setGame({
      ...game,
      myReactions: game.myReactions.filter((key) => key !== "goty"),
      reactionCounts: {
        ...game.reactionCounts,
        goty: Math.max(0, game.reactionCounts.goty - 1),
      },
      myGotyComment: null,
    });
  }

  function stopCardNav(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  const card = (
    <article
      className={`rec-matchup-card${featured ? " rec-matchup-card--featured" : ""}${game.involvesMe ? " rec-matchup-card--mine" : ""}${isGotw ? " rec-matchup-card--gotw" : ""}${passive ? " rec-matchup-card--passive" : ""}${renderMode === "discord" ? " rec-matchup-card--render" : ""}`}
      data-matchup-render={renderMode === "discord" ? "" : undefined}
      onClick={passive ? stopCardNav : undefined}
      onPointerDown={passive ? stopCardNav : undefined}
    >
      <span className="rec-matchup-card__sheen" aria-hidden="true" />
      {game.streams.length > 0 && !game.isFinal && <span className="rec-matchup-card__live">Live</span>}
      <div className="rec-matchup-card__team rec-matchup-card__team--away" style={{ "--team-color": game.awayTeamColor, "--team-text": readableText(game.awayTeamColor) } as CSSProperties}>
        <TeamLogo abbreviation={game.awayTeamAbbr} alt={game.awayTeamMascot} className="rec-matchup-card__team-logo" priority={renderMode === "discord"} />
        <span className="rec-matchup-card__team-text">
          <small>{game.awayTeamName}</small>
          <strong>{game.awayTeamMascot}</strong>
          {teamMetaLine(game.awayTeamRank, game.awayTeamRecord) && <em className="rec-matchup-card__team-meta">{teamMetaLine(game.awayTeamRank, game.awayTeamRecord)}</em>}
        </span>
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
        <span className="rec-matchup-card__team-text">
          <small>{game.homeTeamName}</small>
          <strong>{game.homeTeamMascot}</strong>
          {teamMetaLine(game.homeTeamRank, game.homeTeamRecord) && <em className="rec-matchup-card__team-meta">{teamMetaLine(game.homeTeamRank, game.homeTeamRecord)}</em>}
        </span>
        <TeamLogo abbreviation={game.homeTeamAbbr} alt={game.homeTeamMascot} className="rec-matchup-card__team-logo" priority={renderMode === "discord"} />
      </div>
      {reactionsEnabled && !reactionsBelow ? (
        <div className="rec-matchup-card__reactions" onClick={stopCardNav} onPointerDown={stopCardNav}>
          <MatchupReactionBar
            game={game}
            busy={busy}
            onLike={() => void react("like")}
            onDislike={() => void react("dislike")}
            onSubmitGoty={submitGoty}
            onClearGoty={clearGoty}
          />
        </div>
      ) : null}
    </article>
  );
  if (renderMode === "discord") return <div className="rec-matchup-card-link render">{card}</div>;
  return <div className={`rec-matchup-card-link${game.matchupType === "cpu" ? " cpu" : ""}`}>
    {card}
    {reactionsEnabled && reactionsBelow ? <div className="rec-matchup-card__reactions rec-matchup-card__reactions--below">
      <MatchupReactionBar game={game} busy={busy} onLike={() => void react("like")} onDislike={() => void react("dislike")} onSubmitGoty={submitGoty} onClearGoty={clearGoty} />
    </div> : null}
  </div>;
}
