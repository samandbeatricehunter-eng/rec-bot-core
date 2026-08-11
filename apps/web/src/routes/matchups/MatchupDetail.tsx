import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import { americanFromDecimal, formatCoins } from "@rec/shared";
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Coins,
  Film,
  LifeBuoy,
  MessageCircle,
  Radio,
  Share2,
} from "lucide-react";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";
import { MatchupPreview } from "../../components/matchups/MatchupPreview.js";
import { MatchupReactionBar } from "../../components/matchups/MatchupReactionBar.js";
import { Button } from "../../components/ui/Button.js";
import { CoinAmount } from "../../components/ui/CoinAmount.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { Modal } from "../../components/ui/Modal.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { useSharedChatChannel } from "../../lib/chat-store.js";
import { ConversationView } from "../../components/chat/ConversationView.js";
import { Composer } from "../../components/chat/Composer.js";
import type {
  HubMatchupDetail,
  HubMatchupGame,
  LeagueChatMember,
  MatchupPreview as MatchupPreviewData,
  MentionableList,
  PeerWagerBoardResponse,
  WagerOptionsResponse,
} from "../../types/api.js";
import { UploadBoxScoreModal } from "../league-mgmt/manage-league/UploadBoxScoreModal.js";
import { AssignBoxScoreStatsModal } from "../../components/hub/AssignBoxScoreStatsModal.js";
import { ShareStreamModal } from "../../components/hub/ShareStreamModal.js";
import { PlayerStatsModal } from "../../components/hub/PlayerStatsModal.js";
import { HighlightUploadModal } from "../../components/hub/HighlightUploadModal.js";
import { RequestHelpSheet } from "../../components/matchups/RequestHelpSheet.js";
import { MatchupStickyHeader } from "../../components/matchups/MatchupStickyHeader.js";
import { ActiveGamePrompt } from "../../components/matchups/ActiveGamePrompt.js";

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

function displayOdds(odds: number) {
  return americanFromDecimal(Number(odds));
}

export function canViewerUploadBoxScore(matchup: HubMatchupGame) {
  // App/matchup page: either participant may upload. H2H still *expects* home to
  // post the official score (see boxScoreExpectationText); that is policy copy, not a hard gate here.
  if (matchup.matchupType === "h2h" || matchup.matchupType === "human_cpu") return matchup.involvesMe;
  return false;
}

function boxScoreExpectationText(matchup: HubMatchupGame) {
  if (matchup.matchupType === "h2h") {
    return `${matchup.homeTeamName} (home team) is responsible for posting the official box score. Either coach in this matchup can upload from here if needed.`;
  }
  if (matchup.matchupType === "human_cpu") {
    return "The human-controlled team is responsible for uploading the box score.";
  }
  return "Box score uploads are only expected for human-involved matchups.";
}

export function MatchupActions({
  matchup,
  canUploadBoxScore,
  onOpenBoxScore,
  onOpenPlayerStats,
  onOpenWager,
  onOpenShareStream,
  onUploadHighlight,
  highlightUploading,
  onOpenRequestHelp,
}: {
  matchup: HubMatchupGame;
  canUploadBoxScore: boolean;
  onOpenBoxScore: () => void;
  onOpenPlayerStats: () => void;
  onOpenWager: () => void;
  onOpenShareStream: () => void;
  onUploadHighlight: () => void;
  highlightUploading: boolean;
  /** Optional so LeagueChatPanel's embedded MatchupActions (no Request Help there yet) doesn't
   * need updating too — omit the prop and the button just doesn't render. */
  onOpenRequestHelp?: () => void;
}) {
  const { currentLeague } = useHubChrome();
  const buzzLabel = currentLeague?.game?.startsWith("madden") ? "League News" : "Campus Buzz";
  const isParticipant = matchup.involvesMe;
  const canOpenBoxScore = canUploadBoxScore;
  const canOpenPlayerStats = Boolean(matchup.boxScoreSubmissionId) && matchup.boxScoreStatus !== "denied";
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
            onClick={onOpenShareStream}
            title={`Share your stream — mirrors to Discord and ${buzzLabel} Chat if this league is linked.`}
          >
            <Share2 size={16} /> Share Stream
          </button>
          <button
            type="button"
            className="matchup-action"
            disabled={highlightUploading}
            onClick={onUploadHighlight}
            title="Upload a highlight clip (720p playback on Cloudflare Stream)."
          >
            <Film size={16} /> {highlightUploading ? "Uploading…" : "Upload Highlight(s)"}
          </button>
          {onOpenRequestHelp && (
            <button
              type="button"
              className="matchup-action"
              onClick={onOpenRequestHelp}
              title="Request a Force Win, request opponent AutoPilot, or report an issue with this matchup."
            >
              <LifeBuoy size={16} /> Request Help
            </button>
          )}
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
  const { currentLeague } = useHubChrome();
  const isCommissioner = currentLeague?.isCommissioner ?? false;
  const [detail, setDetail] = useState<HubMatchupDetail | null>(null);
  const [preview, setPreview] = useState<MatchupPreviewData | null>(null);
  const [previewWagerOptions, setPreviewWagerOptions] =
    useState<WagerOptionsResponse | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [gotwActionBusy, setGotwActionBusy] = useState(false);
  const [wagersActionBusy, setWagersActionBusy] = useState(false);
  const [gameChannelId, setGameChannelId] = useState<string | null>(null);
  const [chatMembers, setChatMembers] = useState<LeagueChatMember[]>([]);
  const [replyTarget, setReplyTarget] = useState<{ id: string; authorDisplayName: string | null; body: string } | null>(null);
  const [assignStatsSubmissionId, setAssignStatsSubmissionId] = useState<string | null>(null);
  const [boxScoreUploadGame, setBoxScoreUploadGame] =
    useState<HubMatchupGame | null>(null);

  const [playerStatsOpen, setPlayerStatsOpen] = useState(false);
  const [highlightUploadOpen, setHighlightUploadOpen] = useState(false);
  const [shareStreamOpen, setShareStreamOpen] = useState(false);
  const [requestHelpOpen, setRequestHelpOpen] = useState(false);
  const [reactionBusy, setReactionBusy] = useState(false);

  const [wagerPanel, setWagerPanel] = useState<WagerPanel | null>(null);

  const gotwSectionRef = useRef<HTMLElement>(null);
  const streamsSectionRef = useRef<HTMLElement>(null);
  const actionsSectionRef = useRef<HTMLDivElement>(null);
  const chatSectionRef = useRef<HTMLElement>(null);
  const scrollTo = (ref: RefObject<HTMLElement>) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

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
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!gameId) return;
    let active = true;
    // Game chat is bridged-to-Discord and keyed to a rec_game_channels row (gameChannelId), not
    // the gameId itself — resolve it via the current week's active channel list. No match means
    // this matchup's channel hasn't been created (or has already rotated out) this week.
    recApi
      .listGameChatChannels(guildId)
      .then((res) => {
        if (!active) return;
        const channel = res.channels.find((item) => item.gameId === gameId);
        setGameChannelId(channel?.gameChannelId ?? null);
      })
      .catch(() => {
        if (active) setGameChannelId(null);
      });
    return () => {
      active = false;
    };
  }, [gameId, guildId]);

  useEffect(() => {
    recApi.listLeagueMembersForChat(guildId).then((res) => setChatMembers(res.members)).catch(() => undefined);
  }, [guildId]);

  const chatMentionable: MentionableList = {
    members: chatMembers.filter((m) => m.discordId).map((m) => ({ discordId: m.discordId as string, displayName: m.displayName })),
    roles: [],
  };
  const chatMentionOptions = chatMentionable.members.map((m) => ({ token: `<@${m.discordId}>`, label: m.displayName }));

  const {
    messages: gameChatMessages,
    reactionsByMessage: gameChatReactions,
    attachmentsByMessage: gameChatAttachments,
    sendMessage: sendGameChatMessage,
    editMessage: editGameChatMessage,
    deleteMessage: deleteGameChatMessage,
    toggleReaction: toggleGameChatReaction,
    sending: gameChatSending,
    error: gameChatError,
  } = useSharedChatChannel({
    guildId,
    channelType: "game",
    channelId: gameChannelId,
  });

  async function handleSendGameChat(body: string) {
    const replyToMessageId = replyTarget?.id ?? null;
    const row = await sendGameChatMessage(body, replyToMessageId);
    setReplyTarget(null);
    return row ? { id: row.id } : undefined;
  }

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

  async function closeGotwVoting() {
    const gotw = detail?.gotw;
    if (!gotw) return;
    setGotwActionBusy(true);
    try {
      await recApi.closeGameOfWeekVoting({ guildId, pollId: gotw.pollId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to close GOTW voting.");
    } finally {
      setGotwActionBusy(false);
    }
  }

  async function reopenGotwVoting() {
    const gotw = detail?.gotw;
    if (!gotw) return;
    setGotwActionBusy(true);
    try {
      await recApi.reopenGameOfWeekVoting({ guildId, pollId: gotw.pollId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reopen GOTW voting.");
    } finally {
      setGotwActionBusy(false);
    }
  }

  async function cancelGotwVoting() {
    const gotw = detail?.gotw;
    if (!gotw) return;
    if (!window.confirm("Cancel GOTW voting for this game? This voids the poll entirely — no correct-pick payouts will be issued.")) return;
    setGotwActionBusy(true);
    try {
      await recApi.cancelGameOfWeekVoting({ guildId, pollId: gotw.pollId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to cancel GOTW voting.");
    } finally {
      setGotwActionBusy(false);
    }
  }

  async function closeWagers() {
    if (!gameId) return;
    if (!window.confirm("Close wagering on this game? Any open (unaccepted) offers will be refunded.")) return;
    setWagersActionBusy(true);
    try {
      await recApi.closeGameWagering({ guildId, gameId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to close wagering.");
    } finally {
      setWagersActionBusy(false);
    }
  }

  async function cancelWagers() {
    if (!gameId) return;
    if (!window.confirm("Cancel and refund every wager on this game — including already-accepted ones? This can't be undone.")) return;
    setWagersActionBusy(true);
    try {
      await recApi.cancelGameWagering({ guildId, gameId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to cancel wagers.");
    } finally {
      setWagersActionBusy(false);
    }
  }

  async function reopenWagers() {
    if (!gameId) return;
    setWagersActionBusy(true);
    try {
      await recApi.reopenGameWagering({ guildId, gameId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reopen wagering.");
    } finally {
      setWagersActionBusy(false);
    }
  }

  function patchMatchupReactions(
    updater: (game: HubMatchupGame) => HubMatchupGame,
  ) {
    setDetail((current) =>
      current ? { ...current, matchup: updater(current.matchup) } : current,
    );
  }

  async function reactToMatchup(reactionKey: "like" | "dislike") {
    if (!detail || reactionBusy) return;
    const gameId = detail.matchup.gameId;
    const previous = detail.matchup;
    patchMatchupReactions((game) => {
      const has = game.myReactions.includes(reactionKey);
      const withoutStandard = game.myReactions.filter(
        (key) => !["love", "like", "dislike", "poop"].includes(key),
      );
      const nextMine = has
        ? withoutStandard
        : [...withoutStandard, reactionKey];
      const nextCounts = { ...game.reactionCounts };
      for (const key of ["love", "like", "dislike", "poop"] as const) {
        if (game.myReactions.includes(key)) nextCounts[key] = Math.max(0, nextCounts[key] - 1);
      }
      if (!has) nextCounts[reactionKey] += 1;
      return { ...game, myReactions: nextMine, reactionCounts: nextCounts };
    });
    setReactionBusy(true);
    try {
      await recApi.toggleHubGameReaction({ guildId, gameId, reactionKey });
    } catch {
      setDetail((current) =>
        current ? { ...current, matchup: previous } : current,
      );
    } finally {
      setReactionBusy(false);
    }
  }

  async function submitGotyNomination(comment: string) {
    if (!detail) return;
    const gameId = detail.matchup.gameId;
    const already = detail.matchup.myReactions.includes("goty");
    await recApi.toggleHubGameReaction({
      guildId,
      gameId,
      reactionKey: "goty",
      comment,
      mode: "set",
    });
    patchMatchupReactions((game) => ({
      ...game,
      myReactions: already ? game.myReactions : [...game.myReactions, "goty"],
      reactionCounts: {
        ...game.reactionCounts,
        goty: already ? game.reactionCounts.goty : game.reactionCounts.goty + 1,
      },
      myGotyComment: comment || null,
    }));
  }

  async function clearGotyNomination() {
    if (!detail) return;
    const gameId = detail.matchup.gameId;
    const already = detail.matchup.myReactions.includes("goty");
    await recApi.toggleHubGameReaction({
      guildId,
      gameId,
      reactionKey: "goty",
      mode: "clear",
    });
    if (!already) return;
    patchMatchupReactions((game) => ({
      ...game,
      myReactions: game.myReactions.filter((key) => key !== "goty"),
      reactionCounts: {
        ...game.reactionCounts,
        goty: Math.max(0, game.reactionCounts.goty - 1),
      },
      myGotyComment: null,
    }));
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
        message = `Parlay placed. Potential payout ${formatCoins(result.payout)}.`;
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
        message = `Peer wager posted. Pot payout ${formatCoins(result.payout)}.`;
      } else {
        const result = await recApi.placeHouseWager({
          guildId,
          gameId: wagerPanel.gameId,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
          stake: Math.floor(stake),
        });
        message = `House wager placed. Potential payout ${formatCoins(result.payout)}.`;
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
      matchup.boxScoreStatus !== "pending" &&
      matchup.boxScoreStatus !== "approved" &&
      canViewerUploadBoxScore(matchup),
  );
  const apiBaseUrl =
    (typeof window !== "undefined" ? window.__REC_WEB_CONFIG__?.VITE_REC_CORE_API_URL : undefined)
    || import.meta.env.VITE_REC_CORE_API_URL
    || "https://recapi-production.up.railway.app";

  return (
    <main className="matchup-detail-page">
      <Link className="matchup-detail-back" to="/">
        <ArrowLeft size={18} /> Back to matchups
      </Link>
      <MatchupStickyHeader
        matchup={matchup}
        hasGameChat={Boolean(gameChannelId)}
        onOpenChat={() => scrollTo(chatSectionRef)}
        onOpenActions={() => scrollTo(actionsSectionRef)}
      />
      <MatchupCard game={matchup} featured showReactions={false} />
      <ActiveGamePrompt
        detail={detail}
        canUploadBoxScore={canUploadBoxScore}
        onOpenBoxScore={() => {
          if (!canUploadBoxScore) return;
          setBoxScoreUploadGame(matchup);
        }}
        onVoteGotw={() => scrollTo(gotwSectionRef)}
        onWatchLive={() => scrollTo(streamsSectionRef)}
      />
      {matchup.matchupType === "h2h" ? (
        <MatchupReactionBar
          game={matchup}
          busy={reactionBusy}
          onLike={() => void reactToMatchup("like")}
          onDislike={() => void reactToMatchup("dislike")}
          onSubmitGoty={submitGotyNomination}
          onClearGoty={clearGotyNomination}
        />
      ) : null}
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
            <section className="matchup-gotw" ref={gotwSectionRef}>
              <header className="matchup-gotw__head">
                <span>Game of the Week</span>
                <strong>
                  {gotw.status === "open" ? "Cast your vote" : "Voting closed"}
                </strong>
              </header>
              {isCommissioner && (
                <div className="matchup-gotw__admin-actions">
                  {gotw.status === "open" && (
                    <Button variant="ghost" size="compact" disabled={gotwActionBusy} onClick={() => void closeGotwVoting()}>
                      Close Voting
                    </Button>
                  )}
                  {gotw.status === "closed" && (
                    <Button variant="ghost" size="compact" disabled={gotwActionBusy} onClick={() => void reopenGotwVoting()}>
                      Reopen Voting
                    </Button>
                  )}
                  <Button variant="ghost" size="compact" disabled={gotwActionBusy} onClick={() => void cancelGotwVoting()}>
                    Cancel Voting
                  </Button>
                </div>
              )}
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
      {matchup.matchupType === "h2h" && detail.lastMatchup && (
        <section className="matchup-h2h-history">
          <header className="matchup-h2h-history__head">
            <span>Last Matchup</span>
            {detail.h2hHistory.length > 1 && <small>{detail.h2hHistory.length} all-time meetings</small>}
          </header>
          <p className="matchup-h2h-history__last">
            <strong>{detail.lastMatchup.userTeamName ?? "Coach A"}</strong> {detail.lastMatchup.userScore}
            {" – "}
            {detail.lastMatchup.opponentScore} <strong>{detail.lastMatchup.opponentTeamName ?? "Coach B"}</strong>
            <span className="matchup-h2h-history__meta">
              {" "}· {detail.lastMatchup.leagueName}
              {detail.lastMatchup.weekNumber != null ? ` · Week ${detail.lastMatchup.weekNumber}` : ""}
              {detail.lastMatchup.playedAt ? ` · ${new Date(detail.lastMatchup.playedAt).toLocaleDateString()}` : ""}
            </span>
          </p>
          {detail.h2hHistory.length > 1 && (
            <details className="matchup-h2h-history__full">
              <summary>View all {detail.h2hHistory.length} meetings</summary>
              <ul>
                {detail.h2hHistory.map((game, index) => (
                  <li key={index}>
                    <span>{game.userTeamName ?? "Coach A"} {game.userScore} – {game.opponentScore} {game.opponentTeamName ?? "Coach B"}</span>
                    <small>
                      {game.leagueName}
                      {game.weekNumber != null ? ` · Week ${game.weekNumber}` : ""}
                      {game.playedAt ? ` · ${new Date(game.playedAt).toLocaleDateString()}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <div ref={actionsSectionRef}>
      <MatchupActions
        matchup={matchup}
        canUploadBoxScore={canUploadBoxScore}
        onOpenBoxScore={() => {
          if (!canUploadBoxScore) return;
          setBoxScoreUploadGame(matchup);
        }}
        onOpenPlayerStats={() => setPlayerStatsOpen(true)}
        onOpenWager={() => void openWager(matchup)}
        onOpenShareStream={() => setShareStreamOpen(true)}
        onUploadHighlight={() => setHighlightUploadOpen(true)}
        highlightUploading={false}
        onOpenRequestHelp={() => setRequestHelpOpen(true)}
      />
      {isCommissioner && matchup.matchupType === "h2h" && !matchup.isFinal && (
        <div className="matchup-wager-admin-actions">
          {matchup.wageringOpen && (
            <Button variant="ghost" size="compact" disabled={wagersActionBusy} onClick={() => void closeWagers()}>
              <Coins size={14} /> Close Wagers
            </Button>
          )}
          {!matchup.wageringOpen && (
            <Button variant="ghost" size="compact" disabled={wagersActionBusy} onClick={() => void reopenWagers()}>
              <Coins size={14} /> Reopen Wagers
            </Button>
          )}
          <Button variant="ghost" size="compact" disabled={wagersActionBusy} onClick={() => void cancelWagers()}>
            <Coins size={14} /> Cancel Wagers
          </Button>
        </div>
      )}
      </div>
      <section className={`matchup-boxscore-status matchup-boxscore-status--${matchup.boxScoreStatus ?? "none"}`}>
        {matchup.boxScoreStatus === "pending" ? (
          <>
            <strong>Awaiting Review</strong>
            <p>Submitted — a commissioner will review shortly.</p>
          </>
        ) : matchup.boxScoreStatus === "approved" ? (
          <p className="matchup-boxscore-status__confirm">Box score approved.</p>
        ) : matchup.boxScoreStatus === "denied" ? (
          <>
            <strong>Resubmission Required</strong>
            <p>
              Box score rejected{matchup.boxScoreDeniedReason ? `: ${matchup.boxScoreDeniedReason}` : "."} You can
              resubmit below.
            </p>
          </>
        ) : (
          <>
            <strong>Box score reminder</strong>
            <p>{boxScoreExpectationText(matchup)}</p>
          </>
        )}
      </section>
      <div className="matchup-detail-grid">
        <section className="matchup-detail-panel" ref={streamsSectionRef}>
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
        <section className="matchup-detail-panel matchup-chat" ref={chatSectionRef}>
          <h2>
            <MessageCircle size={20} /> Game Chat
          </h2>
          {gameChannelId ? (
            <div className="commissioner-chat-window">
              {gameChatError && <p className="hub-transfer-status">{gameChatError}</p>}
              <ConversationView
                messages={gameChatMessages}
                viewerDiscordId={discordId}
                mentionable={chatMentionable}
                reactionsByMessage={gameChatReactions}
                attachmentsByMessage={gameChatAttachments}
                onToggleReaction={(messageId, emojiKey) => void toggleGameChatReaction(messageId, emojiKey)}
                onEditMessage={(messageId, body) => editGameChatMessage(messageId, body)}
                onDeleteMessage={(messageId) => void deleteGameChatMessage(messageId)}
                onReplyMessage={setReplyTarget}
              />
              <Composer
                onSend={handleSendGameChat}
                sending={gameChatSending}
                mentionOptions={chatMentionOptions}
                guildId={guildId}
                channelType="game"
                replyTo={replyTarget ? { preview: `${replyTarget.authorDisplayName ?? "REC Member"}: ${replyTarget.body}` } : null}
                onCancelReply={() => setReplyTarget(null)}
              />
            </div>
          ) : (
            <p>Chat opens once this week's game channel is created.</p>
          )}
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
          onSubmitted={async (submissionId) => {
            setBoxScoreUploadGame(null);
            setAssignStatsSubmissionId(submissionId);
            await load();
          }}
        />
      )}
      {assignStatsSubmissionId && (
        <AssignBoxScoreStatsModal guildId={guildId} submissionId={assignStatsSubmissionId} onClose={() => setAssignStatsSubmissionId(null)} />
      )}

      {playerStatsOpen && (
        <PlayerStatsModal
          guildId={guildId}
          onClose={() => setPlayerStatsOpen(false)}
          onSubmitted={() => setPlayerStatsOpen(false)}
        />
      )}

      {highlightUploadOpen && gameId && (
        <HighlightUploadModal
          guildId={guildId}
          gameId={gameId}
          onClose={() => setHighlightUploadOpen(false)}
          onSubmitted={() => setHighlightUploadOpen(false)}
        />
      )}

      {shareStreamOpen && gameId && (
        <ShareStreamModal
          guildId={guildId}
          gameId={gameId}
          onClose={() => setShareStreamOpen(false)}
          onSubmitted={() => {
            setShareStreamOpen(false);
            void load();
          }}
        />
      )}

      {requestHelpOpen && (
        <RequestHelpSheet
          matchup={matchup}
          guildId={guildId}
          onClose={() => setRequestHelpOpen(false)}
          onSubmitted={() => {
            setRequestHelpOpen(false);
            void load();
          }}
        />
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
                            {wager.market} · <CoinAmount amount={wager.stake} /> ·{" "}
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
