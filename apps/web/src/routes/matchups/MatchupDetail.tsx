import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { americanFromDecimal } from "@rec/shared";
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Coins,
  Film,
  MessageCircle,
  Radio,
  Send,
  Share2,
} from "lucide-react";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";
import { MatchupPreview } from "../../components/matchups/MatchupPreview.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { Modal } from "../../components/ui/Modal.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type {
  HubMatchupDetail,
  HubMatchupGame,
  MatchupPreview as MatchupPreviewData,
  PeerWagerBoardResponse,
  WagerOptionsResponse,
  WatchedPlayer,
} from "../../types/api.js";
import { UploadBoxScoreModal } from "../league-mgmt/manage-league/UploadBoxScoreModal.js";

const PLAYER_STAT_FIELDS: Record<string, Array<[string, string]>> = {
  passing: [
    ["completions", "Completions"],
    ["attempts", "Attempts"],
    ["yards", "Passing yards"],
    ["touchdowns", "Passing touchdowns"],
    ["interceptions", "Interceptions"],
  ],
  rushing: [
    ["carries", "Carries"],
    ["yards", "Rushing yards"],
    ["touchdowns", "Rushing touchdowns"],
    ["fumbles", "Fumbles"],
    ["longest", "Longest rush"],
  ],
  receiving: [
    ["receptions", "Receptions"],
    ["yards", "Receiving yards"],
    ["touchdowns", "Receiving touchdowns"],
    ["drops", "Drops"],
    ["longest", "Longest reception"],
  ],
  defense: [
    ["tackles", "Total tackles"],
    ["tfl", "Tackles for loss"],
    ["sacks", "Sacks"],
    ["interceptions", "Interceptions"],
    ["forced_fumbles", "Forced fumbles"],
  ],
  kick_returns: [
    ["returns", "Kick returns"],
    ["yards", "Return yards"],
    ["touchdowns", "Return touchdowns"],
    ["longest", "Longest return"],
  ],
  punt_returns: [
    ["returns", "Punt returns"],
    ["yards", "Return yards"],
    ["touchdowns", "Return touchdowns"],
    ["longest", "Longest return"],
  ],
  kicking: [
    ["fg_made", "Field goals made"],
    ["fg_attempted", "Field goals attempted"],
    ["longest", "Longest field goal"],
    ["xp_made", "Extra points made"],
    ["xp_attempted", "Extra points attempted"],
  ],
  punting: [
    ["punts", "Punts"],
    ["yards", "Punt yards"],
    ["average", "Average"],
    ["inside_20", "Inside the 20"],
    ["touchbacks", "Touchbacks"],
  ],
};

const PLAYER_STAT_CATEGORY_OPTIONS = Object.keys(PLAYER_STAT_FIELDS);

type WagerMode = "single" | "parlay" | "peer";
type WagerLeg = {
  gameId: string;
  label: string;
  options: WagerOptionsResponse;
  market: string;
  pick: string;
};
type WagerPanel = {
  gameId: string;
  label: string;
  options: WagerOptionsResponse | null;
  mode: WagerMode;
  market: string;
  pick: string;
  stake: string;
  parlay: WagerLeg[];
  challengeType: "open" | "direct";
  targetUserId: string;
  coaches: Array<{
    userId: string;
    discordId: string | null;
    teamAbbr: string;
    conference: string;
  }>;
  board: PeerWagerBoardResponse["wagers"];
  notice: string | null;
  busy: boolean;
};

function displayLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayOdds(odds: number) {
  return americanFromDecimal(Number(odds));
}

function canViewerUploadBoxScore(matchup: HubMatchupGame) {
  if (matchup.matchupType === "h2h") return matchup.viewerSide === "home";
  if (matchup.matchupType === "human_cpu") return matchup.involvesMe;
  return false;
}

function boxScoreExpectationText(matchup: HubMatchupGame) {
  if (matchup.matchupType === "h2h") {
    return `${matchup.homeTeamName} (home team) is responsible for uploading the box score.`;
  }
  if (matchup.matchupType === "human_cpu") {
    return "The human-controlled team is responsible for uploading the box score.";
  }
  return "Box score uploads are only expected for human-involved matchups.";
}

function MatchupActions({
  matchup,
  canUploadBoxScore,
  onOpenBoxScore,
  onOpenPlayerStats,
  onOpenWager,
}: {
  matchup: HubMatchupGame;
  canUploadBoxScore: boolean;
  onOpenBoxScore: () => void;
  onOpenPlayerStats: () => void;
  onOpenWager: () => void;
}) {
  const isParticipant = matchup.involvesMe;
  const canOpenBoxScore = canUploadBoxScore;
  const canOpenPlayerStats = Boolean(matchup.boxScoreSubmissionId);
  const canOpenWager =
    !isParticipant &&
    matchup.matchupType === "h2h" &&
    matchup.wageringOpen &&
    !matchup.isFinal;
  return (
    <div className="matchup-actions" role="group" aria-label="Matchup actions">
      {isParticipant ? (
        <>
          <button
            type="button"
            className="matchup-action"
            disabled={!canOpenBoxScore}
            onClick={onOpenBoxScore}
            title={
              canOpenBoxScore
                ? "Upload box score"
                : matchup.viewerSide !== "home" && matchup.matchupType === "h2h"
                  ? "Only the home team can upload the box score for H2H matchups."
                  : "Box score already submitted or game is final."
            }
          >
            <ClipboardList size={16} /> Box Score
          </button>
          <button
            type="button"
            className="matchup-action"
            disabled={!canOpenPlayerStats}
            onClick={onOpenPlayerStats}
            title={
              canOpenPlayerStats
                ? "Submit player stats"
                : "Submit a box score first."
            }
          >
            <BarChart3 size={16} /> Player Stats
          </button>
          <button
            type="button"
            className="matchup-action"
            disabled
            title="Share your stream in the Discord game channel for now."
          >
            <Share2 size={16} /> Share Stream
          </button>
          <button
            type="button"
            className="matchup-action"
            disabled
            title="Highlight uploads run through Discord for now."
          >
            <Film size={16} /> Upload Highlight(s)
          </button>
        </>
      ) : (
        <button
          type="button"
          className="matchup-action matchup-action--wager"
          disabled={!canOpenWager}
          onClick={onOpenWager}
          title={
            canOpenWager
              ? "Open sportsbook"
              : "Wagering is unavailable for this matchup."
          }
        >
          <Coins size={16} /> Wagers
        </button>
      )}
    </div>
  );
}

export function MatchupDetailPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { guildId, discordId } = useReadyAuth();
  const [detail, setDetail] = useState<HubMatchupDetail | null>(null);
  const [preview, setPreview] = useState<MatchupPreviewData | null>(null);
  const [previewWagerOptions, setPreviewWagerOptions] =
    useState<WagerOptionsResponse | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [voting, setVoting] = useState(false);
  const [boxScoreUploadGame, setBoxScoreUploadGame] =
    useState<HubMatchupGame | null>(null);

  const [playerStatsGame, setPlayerStatsGame] = useState<HubMatchupGame | null>(
    null,
  );
  const [myWatchedPlayers, setMyWatchedPlayers] = useState<WatchedPlayer[] | null>(
    null,
  );
  const [playerStatsDraft, setPlayerStatsDraft] = useState({
    playerName: "",
    watchedPlayerId: "",
    category: "passing",
    values: {} as Record<string, string>,
  });
  const [playerStatsNotice, setPlayerStatsNotice] = useState<string | null>(null);
  const [playerStatsBusy, setPlayerStatsBusy] = useState(false);

  const [wagerPanel, setWagerPanel] = useState<WagerPanel | null>(null);

  const load = useCallback(async () => {
    if (!gameId) return;
    try {
      setDetail(await recApi.getHubMatchupDetail({ guildId, gameId }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load matchup.");
    }
  }, [gameId, guildId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!gameId) return;
    let active = true;
    recApi
      .getMatchupPreview({ guildId, gameId })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [gameId, guildId]);

  useEffect(() => {
    const matchup = detail?.matchup;
    if (!gameId || !matchup || matchup.matchupType !== "h2h") {
      setPreviewWagerOptions(null);
      return;
    }
    let active = true;
    recApi
      .getWagerOptions({ guildId, gameId })
      .then((options) => {
        if (active) setPreviewWagerOptions(options);
      })
      .catch(() => {
        if (active) setPreviewWagerOptions(null);
      });
    return () => {
      active = false;
    };
  }, [detail?.matchup, gameId, guildId]);

  useEffect(() => {
    let active = true;
    recApi
      .getHub(guildId)
      .then((hub) => {
        if (active) setSeasonNumber(hub.league.seasonNumber);
      })
      .catch(() => {
        if (active) setSeasonNumber(null);
      });
    return () => {
      active = false;
    };
  }, [guildId]);

  async function send() {
    if (!gameId || !body.trim()) return;
    setSending(true);
    try {
      await recApi.sendHubMatchupMessage({ guildId, gameId, body });
      setBody("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function voteGotw(selectedTeamId: string) {
    const gotw = detail?.gotw;
    if (!gameId || !gotw || gotw.status !== "open") return;
    setVoting(true);
    try {
      await recApi.voteGameOfWeek({
        guildId,
        pollId: gotw.pollId,
        selectedTeamId,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to record your vote.");
    } finally {
      setVoting(false);
    }
  }

  async function openPlayerStats(game: HubMatchupGame) {
    setPlayerStatsGame(game);
    setPlayerStatsNotice(null);
    setPlayerStatsDraft({
      playerName: "",
      watchedPlayerId: "",
      category: "passing",
      values: {},
    });
    setMyWatchedPlayers(null);
    try {
      const result = await recApi.listMyWatchedPlayers({ guildId });
      setMyWatchedPlayers(result.players);
    } catch (cause) {
      setPlayerStatsNotice(
        cause instanceof Error
          ? cause.message
          : "Could not load your players to watch.",
      );
      setMyWatchedPlayers([]);
    }
  }

  async function submitPlayerStats() {
    if (!playerStatsGame) return;
    const selectedPlayer = myWatchedPlayers?.find(
      (player) => player.id === playerStatsDraft.watchedPlayerId,
    );
    const playerName = selectedPlayer?.playerName ?? playerStatsDraft.playerName.trim();
    const statLines = (PLAYER_STAT_FIELDS[playerStatsDraft.category] ?? []).flatMap(
      ([statKey, label]) => {
        const raw = playerStatsDraft.values[statKey]?.trim();
        if (!raw) return [];
        const value = Number(raw);
        return Number.isFinite(value) ? [{ statKey, label, value }] : [];
      },
    );
    if (!playerName || !statLines.length) {
      setPlayerStatsNotice("Pick or enter a player and add at least one stat.");
      return;
    }
    setPlayerStatsBusy(true);
    setPlayerStatsNotice(null);
    try {
      await recApi.submitPlayerStatLine({
        guildId,
        playerName,
        category: playerStatsDraft.category,
        statLines,
      });
      setPlayerStatsNotice("Player stats submitted.");
      setPlayerStatsDraft((current) => ({
        playerName: "",
        watchedPlayerId: "",
        category: current.category,
        values: {},
      }));
    } catch (cause) {
      setPlayerStatsNotice(
        cause instanceof Error ? cause.message : "Player stats submission failed.",
      );
    } finally {
      setPlayerStatsBusy(false);
    }
  }

  async function openWager(game: HubMatchupGame) {
    const label = `${game.awayTeamName} at ${game.homeTeamName}`;
    setWagerPanel({
      gameId: game.gameId,
      label,
      options: null,
      mode: "single",
      market: "",
      pick: "",
      stake: "25",
      parlay: [],
      challengeType: "open",
      targetUserId: "",
      coaches: [],
      board: [],
      notice: null,
      busy: true,
    });
    try {
      const [options, board, coaches] = await Promise.all([
        recApi.getWagerOptions({ guildId, gameId: game.gameId }),
        recApi.getPeerWagerBoard(guildId),
        recApi.listChallengeableCoaches(guildId),
      ]);
      const firstMarket = options.markets[0];
      setWagerPanel({
        gameId: game.gameId,
        label,
        options,
        mode: "single",
        market: firstMarket?.market ?? "",
        pick: firstMarket?.sides[0]?.pick ?? "",
        stake: "25",
        parlay: [],
        challengeType: "open",
        targetUserId: "",
        coaches: coaches.coaches,
        board: board.wagers,
        notice: null,
        busy: false,
      });
    } catch (cause) {
      setWagerPanel((current) =>
        current
          ? {
              ...current,
              notice: cause instanceof Error ? cause.message : "Lines unavailable.",
              busy: false,
            }
          : current,
      );
    }
  }

  function addParlayLeg() {
    if (!wagerPanel?.options || wagerPanel.parlay.length >= 3) return;
    setWagerPanel({
      ...wagerPanel,
      parlay: [
        ...wagerPanel.parlay.filter((leg) => leg.market !== wagerPanel.market),
        {
          gameId: wagerPanel.gameId,
          label: wagerPanel.label,
          options: wagerPanel.options,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
        },
      ].slice(0, 3),
    });
  }

  async function placeWager() {
    if (!wagerPanel) return;
    const stake = Number(wagerPanel.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      setWagerPanel({ ...wagerPanel, notice: "Enter a positive stake." });
      return;
    }
    setWagerPanel({ ...wagerPanel, busy: true, notice: null });
    try {
      let message = "Wager placed.";
      if (wagerPanel.mode === "parlay") {
        const legs = wagerPanel.parlay.length
          ? wagerPanel.parlay
          : [
              {
                gameId: wagerPanel.gameId,
                label: wagerPanel.label,
                options: wagerPanel.options!,
                market: wagerPanel.market,
                pick: wagerPanel.pick,
              },
            ];
        const result = await recApi.placeParlay({
          guildId,
          stake: Math.floor(stake),
          legs: legs.map((leg) => ({
            gameId: leg.gameId,
            market: leg.market,
            pick: leg.pick,
          })),
        });
        message = `Parlay placed. Potential payout $${Number(result.payout ?? 0).toLocaleString()}.`;
      } else if (wagerPanel.mode === "peer") {
        const result = await recApi.placePeerWager({
          guildId,
          gameId: wagerPanel.gameId,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
          stake: Math.floor(stake),
          challengeType: wagerPanel.challengeType,
          targetUserId:
            wagerPanel.challengeType === "direct" ? wagerPanel.targetUserId : null,
        });
        message = `Peer wager posted. Pot payout $${Number(result.payout ?? 0).toLocaleString()}.`;
      } else {
        const result = await recApi.placeHouseWager({
          guildId,
          gameId: wagerPanel.gameId,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
          stake: Math.floor(stake),
        });
        message = `House wager placed. Potential payout $${Number(result.payout ?? 0).toLocaleString()}.`;
      }
      const board = await recApi
        .getPeerWagerBoard(guildId)
        .catch(() => ({ wagers: wagerPanel.board }));
      setWagerPanel((current) =>
        current
          ? { ...current, board: board.wagers, busy: false, notice: message }
          : current,
      );
      await load();
    } catch (cause) {
      setWagerPanel((current) =>
        current
          ? {
              ...current,
              busy: false,
              notice: cause instanceof Error ? cause.message : "Wager failed.",
            }
          : current,
      );
    }
  }

  async function acceptPeer(wagerId: string) {
    if (!wagerPanel) return;
    setWagerPanel({ ...wagerPanel, busy: true, notice: null });
    try {
      await recApi.acceptPeerWager({ guildId, wagerId });
      const board = await recApi.getPeerWagerBoard(guildId);
      setWagerPanel((current) =>
        current
          ? {
              ...current,
              board: board.wagers,
              busy: false,
              notice: "Peer wager accepted.",
            }
          : current,
      );
      await load();
    } catch (cause) {
      setWagerPanel((current) =>
        current
          ? {
              ...current,
              busy: false,
              notice:
                cause instanceof Error ? cause.message : "Could not accept wager.",
            }
          : current,
      );
    }
  }

  if (error && !detail) return <ErrorState message={error} />;
  if (!detail) return <LoadingState label="Loading matchup…" />;
  const matchup = detail.matchup;
  const canUploadBoxScore = Boolean(
    seasonNumber != null &&
      !matchup.isFinal &&
      !Boolean(matchup.boxScoreSubmissionId) &&
      canViewerUploadBoxScore(matchup),
  );
  const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;

  return (
    <main className="matchup-detail-page">
      <Link className="matchup-detail-back" to="/">
        <ArrowLeft size={18} /> Back to matchups
      </Link>
      <MatchupCard game={matchup} featured />
      {preview && (
        <MatchupPreview preview={preview} wagerOptions={previewWagerOptions} />
      )}
      {detail.gotw &&
        (() => {
          const gotw = detail.gotw;
          const total = gotw.awayVotes + gotw.homeVotes;
          const awayShare = total ? Math.round((gotw.awayVotes / total) * 100) : 50;
          const canVote = gotw.status === "open" && gotw.canVote;
          return (
            <section className="matchup-gotw">
              <header className="matchup-gotw__head">
                <span>Game of the Week</span>
                <strong>
                  {gotw.status === "open" ? "Cast your vote" : "Voting closed"}
                </strong>
              </header>
              <div className="matchup-gotw__options">
                <button
                  type="button"
                  className={`matchup-gotw__opt${gotw.myVote === gotw.awayTeamId ? " is-picked" : ""}`}
                  disabled={!canVote || voting}
                  onClick={() => void voteGotw(gotw.awayTeamId)}
                >
                  <small>Away</small>
                  <strong>{gotw.awayTeamName}</strong>
                  <b>
                    {gotw.awayVotes} vote{gotw.awayVotes === 1 ? "" : "s"}
                  </b>
                </button>
                <button
                  type="button"
                  className={`matchup-gotw__opt${gotw.myVote === gotw.homeTeamId ? " is-picked" : ""}`}
                  disabled={!canVote || voting}
                  onClick={() => void voteGotw(gotw.homeTeamId)}
                >
                  <small>Home</small>
                  <strong>{gotw.homeTeamName}</strong>
                  <b>
                    {gotw.homeVotes} vote{gotw.homeVotes === 1 ? "" : "s"}
                  </b>
                </button>
              </div>
              <div
                className="matchup-gotw__meter"
                style={{ "--away-share": `${awayShare}%` } as CSSProperties}
              >
                <span className="away" />
                <span className="home" />
              </div>
              <div className="matchup-gotw__meter-labels">
                <span>{awayShare}%</span>
                <span>{100 - awayShare}%</span>
              </div>
            </section>
          );
        })()}
      <MatchupActions
        matchup={matchup}
        canUploadBoxScore={canUploadBoxScore}
        onOpenBoxScore={() => {
          if (!canUploadBoxScore) return;
          setBoxScoreUploadGame(matchup);
        }}
        onOpenPlayerStats={() => void openPlayerStats(matchup)}
        onOpenWager={() => void openWager(matchup)}
      />
      <section className="matchup-boxscore-reminder">
        <strong>Box score reminder</strong>
        <p>{boxScoreExpectationText(matchup)}</p>
      </section>
      <div className="matchup-detail-grid">
        <section className="matchup-detail-panel">
          <h2>
            <Radio size={20} /> Active Streams
          </h2>
          {matchup.streams.length ? (
            matchup.streams.map((stream) => (
              <a
                className="matchup-stream-row"
                key={stream.streamLogId}
                href={`${apiBaseUrl}${stream.watchPath}`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="matchup-live-dot" />
                <strong>Watch {stream.teamName}</strong>
                <small>
                  {stream.viewCount} viewer{stream.viewCount === 1 ? "" : "s"}
                </small>
              </a>
            ))
          ) : (
            <p>No active streams for this matchup.</p>
          )}
        </section>
        <section className="matchup-detail-panel matchup-chat">
          <h2>
            <MessageCircle size={20} /> Game Chat
          </h2>
          <div className="matchup-chat-messages">
            {detail.messages.length ? (
              detail.messages.map((message) => (
                <article key={message.id}>
                  <header>
                    <strong>{message.author_display_name}</strong>
                    <time>
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </header>
                  <p>{message.body}</p>
                </article>
              ))
            ) : (
              <p>Start the matchup conversation.</p>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              className="form-input"
              value={body}
              maxLength={1000}
              rows={3}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Message this matchup…"
            />
            <Button variant="primary" disabled={sending || !body.trim()}>
              <Send size={16} /> Send
            </Button>
          </form>
        </section>
      </div>

      {boxScoreUploadGame && seasonNumber != null && (
        <UploadBoxScoreModal
          guildId={guildId}
          discordId={discordId}
          weekNumber={boxScoreUploadGame.weekNumber}
          seasonNumber={seasonNumber}
          gameId={boxScoreUploadGame.gameId}
          commissionerSubmission={false}
          requireSecondImage
          onClose={() => setBoxScoreUploadGame(null)}
          onSubmitted={async () => {
            setBoxScoreUploadGame(null);
            await load();
          }}
        />
      )}

      {playerStatsGame && (
        <Modal
          title="Players to Watch"
          onClose={() => setPlayerStatsGame(null)}
        >
          <div className="hub-submission-modal">
            {playerStatsNotice && (
              <p className="hub-transfer-status">{playerStatsNotice}</p>
            )}
            <p className="hub-muted">
              {playerStatsGame.awayTeamName} at {playerStatsGame.homeTeamName}
            </p>
            <label className="form-field">
              <span className="form-label">Player</span>
              <select
                className="form-input"
                value={playerStatsDraft.watchedPlayerId}
                onChange={(event) => {
                  const player = myWatchedPlayers?.find(
                    (item) => item.id === event.target.value,
                  );
                  setPlayerStatsDraft((current) => ({
                    ...current,
                    watchedPlayerId: event.target.value,
                    playerName: player?.playerName ?? "",
                  }));
                }}
              >
                <option value="">Enter a new player</option>
                {(myWatchedPlayers ?? []).map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.playerName} - {player.position}
                  </option>
                ))}
              </select>
            </label>
            {!playerStatsDraft.watchedPlayerId && (
              <label className="form-field">
                <span className="form-label">Player name</span>
                <input
                  className="form-input"
                  value={playerStatsDraft.playerName}
                  onChange={(event) =>
                    setPlayerStatsDraft((current) => ({
                      ...current,
                      playerName: event.target.value,
                    }))
                  }
                />
              </label>
            )}
            <label className="form-field">
              <span className="form-label">Category</span>
              <select
                className="form-input"
                value={playerStatsDraft.category}
                onChange={(event) =>
                  setPlayerStatsDraft((current) => ({
                    ...current,
                    category: event.target.value,
                    values: {},
                  }))
                }
              >
                {PLAYER_STAT_CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {displayLabel(category)}
                  </option>
                ))}
              </select>
            </label>
            <div className="hub-submission-grid">
              {(PLAYER_STAT_FIELDS[playerStatsDraft.category] ?? []).map(
                ([key, label]) => (
                  <label className="form-field" key={key}>
                    <span className="form-label">{label}</span>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      value={playerStatsDraft.values[key] ?? ""}
                      onChange={(event) =>
                        setPlayerStatsDraft((current) => ({
                          ...current,
                          values: {
                            ...current.values,
                            [key]: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <Button
              variant="primary"
              disabled={playerStatsBusy}
              onClick={() => void submitPlayerStats()}
            >
              {playerStatsBusy ? "Submitting..." : "Submit Player Stats"}
            </Button>
          </div>
        </Modal>
      )}

      {wagerPanel && (
        <Modal
          title={`Sportsbook · ${wagerPanel.label}`}
          onClose={() => setWagerPanel(null)}
        >
          <div className="hub-wager-modal">
            {!wagerPanel.options ? (
              <p className="hub-empty">{wagerPanel.notice ?? "Loading lines..."}</p>
            ) : (
              <>
                <div className="hub-wager-mode">
                  <button
                    className={wagerPanel.mode === "single" ? "active" : ""}
                    onClick={() => setWagerPanel({ ...wagerPanel, mode: "single" })}
                  >
                    House Single
                  </button>
                  <button
                    className={wagerPanel.mode === "parlay" ? "active" : ""}
                    onClick={() => setWagerPanel({ ...wagerPanel, mode: "parlay" })}
                  >
                    3-Pick Parlay
                  </button>
                  <button
                    className={wagerPanel.mode === "peer" ? "active" : ""}
                    onClick={() => setWagerPanel({ ...wagerPanel, mode: "peer" })}
                  >
                    User Wager
                  </button>
                </div>
                {wagerPanel.mode === "parlay" && (
                  <p className="hub-muted">
                    Choose exactly three different stat-line Over/Under picks from this
                    game. Each side is a separate selection.
                  </p>
                )}
                <div className="hub-wager-lines">
                  {wagerPanel.options.markets
                    .filter(
                      (market) =>
                        wagerPanel.mode !== "parlay" ||
                        !["moneyline", "spread", "total_points"].includes(market.market),
                    )
                    .map((market) => (
                      <article
                        key={market.market}
                        className={wagerPanel.market === market.market ? "active" : ""}
                      >
                        <button
                          onClick={() =>
                            setWagerPanel({
                              ...wagerPanel,
                              market: market.market,
                              pick: market.sides[0]?.pick ?? "",
                            })
                          }
                        >
                          <strong>{market.label}</strong>
                          <span>
                            {market.line != null
                              ? `Stat line: ${market.line}`
                              : "Pick a winner"}
                          </span>
                        </button>
                        <div>
                          {market.sides.map((side) => (
                            <button
                              key={side.pick}
                              aria-label={`${market.label}: ${side.label}`}
                              className={
                                wagerPanel.market === market.market &&
                                wagerPanel.pick === side.pick
                                  ? "active"
                                  : ""
                              }
                              onClick={() =>
                                setWagerPanel({
                                  ...wagerPanel,
                                  market: market.market,
                                  pick: side.pick,
                                })
                              }
                            >
                              <b>
                                {side.pick === "over"
                                  ? `OVER ${market.line ?? ""}`
                                  : side.pick === "under"
                                    ? `UNDER ${market.line ?? ""}`
                                    : side.label}
                              </b>
                              <small>
                                {side.label} · odds {displayOdds(side.odds)}
                              </small>
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                </div>
                {wagerPanel.mode === "parlay" && (
                  <div className="hub-parlay-slip">
                    <div>
                      <strong>Parlay slip</strong>
                      <span>{wagerPanel.parlay.length}/3 picks</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="compact"
                      disabled={wagerPanel.parlay.length >= 3}
                      onClick={addParlayLeg}
                    >
                      Add Pick
                    </Button>
                    {wagerPanel.parlay.map((leg) => (
                      <p key={`${leg.gameId}-${leg.market}`}>
                        {leg.label}: {leg.market}
                      </p>
                    ))}
                  </div>
                )}
                {wagerPanel.mode === "peer" && (
                  <div className="hub-peer-controls">
                    <select
                      className="form-input"
                      value={wagerPanel.challengeType}
                      onChange={(event) =>
                        setWagerPanel({
                          ...wagerPanel,
                          challengeType: event.target.value as "open" | "direct",
                        })
                      }
                    >
                      <option value="open">Post to board</option>
                      <option value="direct">Direct challenge</option>
                    </select>
                    {wagerPanel.challengeType === "direct" && (
                      <select
                        className="form-input"
                        value={wagerPanel.targetUserId}
                        onChange={(event) =>
                          setWagerPanel({
                            ...wagerPanel,
                            targetUserId: event.target.value,
                          })
                        }
                      >
                        <option value="">Select coach</option>
                        {wagerPanel.coaches.map((coach) => (
                          <option key={coach.userId} value={coach.userId}>
                            {coach.teamAbbr} · {coach.conference}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div className="hub-wager-submit">
                  <label className="form-field">
                    <span className="form-label">Stake</span>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={wagerPanel.stake}
                      onChange={(event) =>
                        setWagerPanel({ ...wagerPanel, stake: event.target.value })
                      }
                    />
                  </label>
                  <Button
                    variant="primary"
                    disabled={
                      wagerPanel.busy ||
                      !wagerPanel.market ||
                      !wagerPanel.pick ||
                      (wagerPanel.mode === "peer" &&
                        wagerPanel.challengeType === "direct" &&
                        !wagerPanel.targetUserId) ||
                      (wagerPanel.mode === "parlay" &&
                        wagerPanel.parlay.length !== 3)
                    }
                    onClick={() => void placeWager()}
                  >
                    {wagerPanel.busy
                      ? "Submitting..."
                      : wagerPanel.mode === "peer"
                        ? "Post User Wager"
                        : wagerPanel.mode === "parlay"
                          ? "Place 3-Pick Parlay"
                          : "Bet House"}
                  </Button>
                </div>
                {wagerPanel.notice && (
                  <p className="hub-transfer-status">{wagerPanel.notice}</p>
                )}
                <div className="hub-peer-board">
                  <h3>Peer Wager Board</h3>
                  {wagerPanel.board.length ? (
                    wagerPanel.board.map((wager) => (
                      <article key={wager.id}>
                        <div>
                          <strong>{wager.gameLabel}</strong>
                          <span>
                            {wager.market} · ${wager.stake.toLocaleString()} ·{" "}
                            {wager.challengeType}
                          </span>
                        </div>
                        {wager.canAccept ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={wagerPanel.busy}
                            onClick={() => void acceptPeer(wager.id)}
                          >
                            Accept
                          </Button>
                        ) : (
                          <span className="hub-muted">
                            {wager.isMine ? "Your offer" : "Unavailable"}
                          </span>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="hub-empty">No open user wagers yet.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
