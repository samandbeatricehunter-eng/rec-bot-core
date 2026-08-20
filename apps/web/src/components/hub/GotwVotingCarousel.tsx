import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import type {
  GotwGuessingRecordsResponse,
  HubMatchupGame,
  MatchupPreview as MatchupPreviewData,
  WagerOptionsResponse,
} from "../../types/api.js";
import { SectionFrame } from "../design-system/SectionFrame.js";
import { Button } from "../ui/Button.js";
import { MatchupCard } from "../matchups/MatchupCard.js";
import { MatchupPreview } from "../matchups/MatchupPreview.js";

type GotwVotingCarouselProps = {
  guildId: string;
  games: HubMatchupGame[];
  canManageLeague: boolean;
  guessingRecord: GotwGuessingRecordsResponse["mine"] | null | undefined;
  onVote: (pollId: string, selectedTeamId: string) => Promise<void>;
  onCloseVoting: (pollId: string) => Promise<void>;
  onOpenWager: (game: HubMatchupGame) => void;
};

export function GotwVotingCarousel({
  guildId,
  games,
  canManageLeague,
  guessingRecord,
  onVote,
  onCloseVoting,
  onOpenWager,
}: GotwVotingCarouselProps) {
  const [index, setIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewByGame, setPreviewByGame] = useState<Record<string, MatchupPreviewData>>({});
  const [wagersByGame, setWagersByGame] = useState<Record<string, WagerOptionsResponse>>({});
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const gameIds = useMemo(() => games.map((game) => game.gameId).join("|"), [games]);
  const activeIndex = games.length ? index % games.length : 0;
  const game = games[activeIndex] ?? null;
  const poll = game?.gotw ?? null;

  useEffect(() => {
    setIndex(0);
    setDrawerOpen(false);
    setDetailsError(null);
  }, [gameIds]);

  useEffect(() => {
    if (!drawerOpen || !game || previewByGame[game.gameId] || loadingGameId === game.gameId) return;
    let cancelled = false;
    setLoadingGameId(game.gameId);
    setDetailsError(null);
    Promise.all([
      recApi.getMatchupPreview({ guildId, gameId: game.gameId }),
      game.matchupType === "h2h"
        ? recApi.getWagerOptions({ guildId, gameId: game.gameId }).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([preview, wagerOptions]) => {
        if (cancelled) return;
        setPreviewByGame((current) => ({ ...current, [game.gameId]: preview }));
        if (wagerOptions) setWagersByGame((current) => ({ ...current, [game.gameId]: wagerOptions }));
      })
      .catch((cause) => {
        if (!cancelled) setDetailsError(cause instanceof Error ? cause.message : "Matchup details are unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoadingGameId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, game, guildId, loadingGameId, previewByGame]);

  if (!game || !poll) return null;

  const totalVotes = poll.awayVotes + poll.homeVotes;
  const awayShare = totalVotes ? Math.round((poll.awayVotes / totalVotes) * 100) : 50;
  const canPlaceWager = !game.involvesMe && game.matchupType === "h2h" && game.wageringOpen && !game.isFinal;
  const preview = previewByGame[game.gameId] ?? null;

  function move(direction: -1 | 1) {
    setIndex((current) => (current + direction + games.length) % games.length);
    setDrawerOpen(false);
    setDetailsError(null);
  }

  return (
    <SectionFrame
      eyebrow={poll.status === "open" ? "Voting is open" : "Voting closed"}
      title="Game of the Week"
      subtitle={`Week ${game.weekNumber}${games.length > 1 ? ` · Matchup ${activeIndex + 1} of ${games.length}` : ""}`}
      className="hub-gotw-carousel"
      action={canManageLeague && poll.status === "open" ? (
        <Button variant="tactical" size="compact" onClick={() => void onCloseVoting(poll.pollId)}>Close Voting</Button>
      ) : undefined}
    >
      <div className="hub-gotw-carousel-stage">
        {games.length > 1 ? <button type="button" className="hub-highlight-arrow previous" aria-label="Previous Game of the Week" onClick={() => move(-1)}><ChevronLeft /></button> : null}
        <div className="hub-gotw-carousel-content">
          <MatchupCard game={game} featured showReactions={false} />

          <div className="hub-gotw-voting" aria-label="Game of the Week voting">
            <button
              type="button"
              className={`hub-gotw-choice away${poll.myVote === poll.awayTeamId ? " active" : ""}`}
              disabled={poll.status !== "open" || !poll.canVote}
              onClick={() => void onVote(poll.pollId, poll.awayTeamId)}
            >
              <span>Vote {game.awayTeamAbbr ?? poll.awayTeamName}</span>
              <strong>{poll.awayVotes}</strong>
            </button>
            <div className="hub-gotw-meter" style={{ "--away-share": `${awayShare}%` } as CSSProperties}>
              <strong>{awayShare}%</strong>
              <i />
              <strong>{100 - awayShare}%</strong>
            </div>
            <button
              type="button"
              className={`hub-gotw-choice home${poll.myVote === poll.homeTeamId ? " active" : ""}`}
              disabled={poll.status !== "open" || !poll.canVote}
              onClick={() => void onVote(poll.pollId, poll.homeTeamId)}
            >
              <span>Vote {game.homeTeamAbbr ?? poll.homeTeamName}</span>
              <strong>{poll.homeVotes}</strong>
            </button>
          </div>

          <div className="hub-gotw-toolbar">
            <button
              type="button"
              className="hub-gotw-drawer-toggle"
              aria-expanded={drawerOpen}
              aria-controls={`gotw-details-${game.gameId}`}
              onClick={() => setDrawerOpen((current) => !current)}
            >
              <span><strong>Matchup &amp; wager details</strong><small>Scouting, prediction and current lines</small></span>
              {drawerOpen ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
            </button>
            {canPlaceWager ? <Button variant="primary" onClick={() => onOpenWager(game)}>Place a Wager</Button> : null}
          </div>

          {guessingRecord ? <p className="hub-gotw-record">Your record: {guessingRecord.wins}-{guessingRecord.losses}{guessingRecord.ties ? `-${guessingRecord.ties}` : ""}{guessingRecord.current_streak > 1 ? ` · ${guessingRecord.current_streak}-game streak` : ""}</p> : null}

          {drawerOpen ? (
            <div className="hub-gotw-drawer" id={`gotw-details-${game.gameId}`}>
              {preview ? <MatchupPreview preview={preview} wagerOptions={wagersByGame[game.gameId] ?? null} /> : detailsError ? <p className="hub-empty">{detailsError}</p> : <p className="hub-empty">Loading matchup and wager details…</p>}
            </div>
          ) : null}
        </div>
        {games.length > 1 ? <button type="button" className="hub-highlight-arrow next" aria-label="Next Game of the Week" onClick={() => move(1)}><ChevronRight /></button> : null}
      </div>
    </SectionFrame>
  );
}
