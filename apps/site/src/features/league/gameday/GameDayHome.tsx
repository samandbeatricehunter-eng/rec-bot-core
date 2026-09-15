import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  americanFromDecimal,
  coinsNumber,
  parlayOdds,
  potentialPayout,
  stageForWeek,
  stageHasScheduledGames,
  stageLabel,
  type LeagueGame,
} from "@rec/shared";
import { useAuth } from "@rec/hub-ui";
import { HeroMatchupActions } from "../../../components/hub/HeroMatchupActions.js";
import { HeroMatchupBreakdown } from "../../../components/hub/HeroMatchupBreakdown.js";
import { GotwVotingCarousel } from "../../../components/hub/GotwVotingCarousel.js";
import { GameDayEmpty, byeWeekEmptyCopy, noGotwEmptyCopy, noScheduleEmptyCopy, offseasonEmptyCopy } from "../../../components/hub/GameDayEmpty.js";
import { MatchupGameMedia } from "../../../components/hub/MatchupGameMedia.js";
import { MatchupTeamLeaders } from "../../../components/hub/MatchupTeamLeaders.js";
import { ShareStreamModal } from "../../../components/hub/ShareStreamModal.js";
import { RequestHelpSheet } from "../../../components/matchups/RequestHelpSheet.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type {
  GotwGuessingRecordsResponse,
  HubMatchupSchedule,
  HubResponse,
  MatchupPreview as MatchupPreviewData,
  TeamScheduleManualState,
  WagerOptionsResponse,
} from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { CoinAmount } from "../../../components/ui/CoinAmount.js";
import { TeamLogo } from "../../../components/ui/TeamLogo.js";
import { SectionFrame } from "../../../components/design-system/SectionFrame.js";
import { StatusChip } from "../../../components/design-system/StatusChip.js";
import { LateSubmissionsModal } from "../../../components/hub/LateSubmissionsModal.js";
import { HighlightUploadModal } from "../../../components/hub/HighlightUploadModal.js";
import { MatchupCard } from "../../../components/matchups/MatchupCard.js";
import { ExpandableMatchupCard } from "../../../components/matchups/ExpandableMatchupCard.js";
import { GameDayMiniNav, type GameDayNavId } from "./GameDayMiniNav.js";

type WagerMode = "single" | "parlay" | "peer";
type WagerLeg = { gameId: string; label: string; options: WagerOptionsResponse; market: string; pick: string };
type WagerPanel = {
  game: HubMatchupSchedule["games"][number];
  gameId: string;
  label: string;
  options: WagerOptionsResponse | null;
  mode: WagerMode;
  tab: "slip" | "board";
  market: string;
  pick: string;
  /** Overrides the market's system-generated line — empty string means use the default line. */
  stake: string;
  parlay: WagerLeg[];
  challengeType: "open" | "direct";
  targetUserId: string;
  coaches: Array<{ userId: string; discordId: string | null; teamAbbr: string; conference: string }>;
  board: Array<{
    id: string;
    gameId: string;
    gameLabel: string;
    challengeType: string;
    market: string;
    pick: string;
    line: number | null;
    odds: number;
    stake: number;
    potentialPayout: number;
    placedByDiscordId: string;
    isMine: boolean;
    canAccept: boolean;
    createdAt: string;
    status?: string;
    boardState?: "open" | "active";
  }>;
  notice: string | null;
  busy: boolean;
};

function displayLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function WagerSlip({ panel }: { panel: WagerPanel }) {
  const legs = panel.mode === "parlay"
    ? panel.parlay
    : panel.market && panel.pick && panel.options
      ? [{ gameId: panel.gameId, label: panel.label, options: panel.options, market: panel.market, pick: panel.pick }]
      : [];
  const renderedLegs = legs.map((leg) => {
    const market = leg.options.markets.find((item) => item.market === leg.market);
    const side = market?.sides.find((item) => item.pick === leg.pick);
    const line = market?.line;
    const pickLabel = leg.pick === "over" || leg.pick === "under"
      ? `${leg.pick.toUpperCase()}${line == null ? "" : ` ${line}`}`
      : side?.label ?? displayLabel(leg.pick);
    return {
      key: `${leg.gameId}-${leg.market}`,
      game: leg.label,
      market: market?.label ?? displayLabel(leg.market),
      pickLabel,
      odds: side?.odds ?? 1,
    };
  });
  const decimalOdds = panel.mode === "parlay"
    ? parlayOdds(renderedLegs.map((leg) => leg.odds))
    : renderedLegs[0]?.odds ?? 1;
  const stake = Math.max(0, Number(panel.stake) || 0);
  const payout = potentialPayout(stake, decimalOdds);

  return (
    <aside className="hub-bet-slip" aria-label="Current bet slip">
      <header className="hub-bet-slip-head">
        <span>REC League eSports</span>
        <strong>Bet Slip</strong>
        <small>{panel.mode === "parlay" ? `${renderedLegs.length}-leg parlay` : panel.mode === "peer" ? "User wager" : "House single"}</small>
      </header>
      <div className="hub-bet-slip-status"><span>{panel.label}</span><b>Draft</b></div>
      <div className="hub-bet-slip-legs">
        {renderedLegs.length ? renderedLegs.map((leg, index) => (
          <article key={leg.key}>
            <span className="hub-bet-slip-number">{index + 1}</span>
            <div><strong>{leg.pickLabel}</strong><small>{leg.game} · {leg.market}</small></div>
            <b>{americanFromDecimal(leg.odds)}</b>
          </article>
        )) : <p>Select a line to build your ticket.</p>}
      </div>
      <dl className="hub-bet-slip-total">
        <div><dt>Stake</dt><dd><CoinAmount amount={stake} /></dd></div>
        <div><dt>{panel.mode === "parlay" ? "Combined odds" : "Odds"}</dt><dd>{decimalOdds.toFixed(2)}x</dd></div>
        <div className="hub-bet-slip-win"><dt>To win</dt><dd><CoinAmount amount={Math.max(0, payout - stake)} /></dd></div>
      </dl>
    </aside>
  );
}

/**
 * Game Day — matchups-only (mine / gotw / schedule / myschedule + wager + highlight modals).
 * Site-owned; team/home/store bodies live in other features/league modules.
 */
export function GameDayHome({ showGameDayNav = true }: { showGameDayNav?: boolean } = {}) {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupAccess, setSetupAccess] = useState<{ leagueExists: boolean; canSetup: boolean } | null>(null);
  const [matchupWeek, setMatchupWeek] = useState<number | null>(null);
  const [matchupSeason, setMatchupSeason] = useState<number | null>(null);
  const [matchupSchedule, setMatchupSchedule] = useState<HubMatchupSchedule | null>(null);
  const [matchupScheduleLoading, setMatchupScheduleLoading] = useState(false);
  const [matchupScheduleError, setMatchupScheduleError] = useState<string | null>(null);
  const [matchupReloadKey, setMatchupReloadKey] = useState(0);
  const gotwGames = useMemo(() => (matchupSchedule?.games ?? []).filter((game) => Boolean(game.gotw)), [matchupSchedule]);
  const gameDayView: GameDayNavId = (() => {
    const raw = searchParams.get("view");
    if (raw === "gotw" || raw === "schedule" || raw === "myschedule") return raw;
    return "mine";
  })();
  const [wagerPanel, setWagerPanel] = useState<WagerPanel | null>(null);
  const [heroPreview, setHeroPreview] = useState<MatchupPreviewData | null>(null);
  const [heroBreakdownExpanded, setHeroBreakdownExpanded] = useState(false);
  const [shareStreamGame, setShareStreamGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [highlightUploadGame, setHighlightUploadGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [requestHelpGame, setRequestHelpGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [lateSubmissionsOpen, setLateSubmissionsOpen] = useState(false);
  const [mySchedule, setMySchedule] = useState<TeamScheduleManualState | null>(null);
  const [myScheduleSeason, setMyScheduleSeason] = useState<number | null>(null);
  const [myScheduleLoading, setMyScheduleLoading] = useState(false);
  const [myScheduleError, setMyScheduleError] = useState<string | null>(null);
  const [lateSubmissionsWeek, setLateSubmissionsWeek] = useState<number | undefined>(undefined);
  const [gotwGuessing, setGotwGuessing] = useState<GotwGuessingRecordsResponse | null>(null);

  // Game Day deep links — schedule + wager only (retire/financials live on League Home / Team Home).
  useEffect(() => {
    const requested = searchParams.get("openModal");
    if (!requested) return;
    const next = new URLSearchParams(searchParams);
    next.delete("openModal");
    if (requested === "schedule" && (hub?.league.rosterType !== "rise_to_immortality" || hub?.league.riseHubUnlocked === true)) {
      next.set("view", "myschedule");
    } else if (requested === "wager" && hub?.league.rosterType !== "rise_to_immortality") {
      openSportsbook();
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Deep link from Discord /highlights: ?openHighlights=1[&week=N]
  useEffect(() => {
    const openHighlights = searchParams.get("openHighlights") === "1";
    if (!openHighlights) return;
    const weekParam = searchParams.get("week");
    const week = weekParam ? Number(weekParam) : undefined;
    setLateSubmissionsWeek(Number.isFinite(week) ? week : undefined);
    setLateSubmissionsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openHighlights");
    next.delete("week");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const heroCurrentGameId: string | null = (hub?.myTeam?.display as { currentGameId?: string } | undefined)?.currentGameId
    ?? matchupSchedule?.games.find((game) => game.involvesMe)?.gameId
    ?? null;

  useEffect(() => {
    if (auth.status !== "ready" || !heroCurrentGameId) {
      setHeroPreview(null);
      return;
    }
    recApi.getMatchupPreview({ guildId: auth.guildId, gameId: heroCurrentGameId }).catch(() => null).then(setHeroPreview);
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, heroCurrentGameId, matchupReloadKey]);

  async function load() {
    if (auth.status !== "ready") return;
    const guildId = auth.guildId;
    try {
      const hubP = recApi.getHub(guildId);
      const guessingP = recApi.getGotwGuessingRecords(guildId).catch(() => null);
      const hubResult = await hubP;
      setHub(hubResult);
      setError(null);
      setSetupAccess(null);
      setGotwGuessing(await guessingP);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("404")) {
        try { setSetupAccess(await recApi.getHubBootstrapStatus(guildId)); }
        catch { setSetupAccess({ leagueExists: false, canSetup: false }); }
        setError(null);
      } else {
        setError(message);
      }
    }
  }

  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    setMatchupScheduleLoading(true);
    setMatchupScheduleError(null);
    const requestedWeek = gameDayView === "schedule" ? matchupWeek : null;
    recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: requestedWeek, seasonNumber: matchupSeason })
      .then((schedule) => {
        setMatchupSchedule(schedule);
        setMatchupScheduleError(null);
        if (matchupSeason == null) setMatchupSeason(schedule.seasonNumber);
        if (matchupWeek == null && !schedule.isOffseason) setMatchupWeek(schedule.selectedWeek);
      })
      .catch((cause) => {
        setMatchupSchedule(null);
        setMatchupScheduleError(cause instanceof Error ? cause.message : "Failed to load matchups.");
      })
      .finally(() => setMatchupScheduleLoading(false));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, gameDayView, matchupWeek, matchupSeason, matchupReloadKey]);

  useEffect(() => {
    if (gameDayView === "schedule" || !hub) return;
    if (!stageHasScheduledGames(hub.league.seasonStage, hub.league.game as LeagueGame)) {
      setMatchupWeek(null);
    }
  }, [gameDayView, hub?.league.seasonStage, hub?.league.game]);

  function retryMatchups() {
    setMatchupSchedule(null);
    setMatchupScheduleError(null);
    setMatchupReloadKey((key) => key + 1);
  }

  function renderMatchupLoadState(label: string) {
    if (matchupScheduleError) {
      return (
        <div className="hub-gameday-empty">
          <strong>{matchupScheduleError}</strong>
          <Button variant="secondary" size="compact" onClick={retryMatchups}>Try again</Button>
        </div>
      );
    }
    if (matchupScheduleLoading || !matchupSchedule) return <GameDayEmpty title={label} />;
    return null;
  }

  useEffect(() => {
    if (gameDayView !== "myschedule" || auth.status !== "ready") return;
    let cancelled = false;
    setMyScheduleLoading(true);
    setMyScheduleError(null);
    recApi.getMyTeamSchedule({ guildId: auth.guildId, seasonNumber: myScheduleSeason })
      .then((schedule) => {
        if (cancelled) return;
        setMySchedule(schedule);
      })
      .catch((cause) => {
        if (cancelled) return;
        setMySchedule(null);
        setMyScheduleError(cause instanceof Error ? cause.message : "Your schedule could not be loaded.");
      })
      .finally(() => { if (!cancelled) setMyScheduleLoading(false); });
    return () => { cancelled = true; };
  }, [gameDayView, auth.status, auth.status === "ready" ? auth.guildId : null, myScheduleSeason]);

  async function voteGotw(pollId: string, selectedTeamId: string) {
    if (auth.status !== "ready" || !matchupSchedule) return;
    await recApi.voteGameOfWeek({ guildId: auth.guildId, pollId, selectedTeamId });
    setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupSchedule.selectedWeek }));
  }

  async function openWager(game: HubMatchupSchedule["games"][number], tab: WagerPanel["tab"] = "slip") {
    if (auth.status !== "ready") return;
    const label = `${game.awayTeamName} at ${game.homeTeamName}`;
    setWagerPanel({ game, gameId: game.gameId, label, options: null, mode: "single", tab, market: "", pick: "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: [], board: [], notice: null, busy: true });
    try {
      const [options, board, coaches] = await Promise.all([
        recApi.getWagerOptions({ guildId: auth.guildId, gameId: game.gameId }),
        recApi.getPeerWagerBoard(auth.guildId),
        recApi.listChallengeableCoaches(auth.guildId),
      ]);
      const firstMarket = options.markets[0];
      setWagerPanel({ game, gameId: game.gameId, label, options, mode: "single", tab, market: firstMarket?.market ?? "", pick: firstMarket?.sides[0]?.pick ?? "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: coaches.coaches, board: board.wagers, notice: null, busy: false });
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, notice: cause instanceof Error ? cause.message : "Lines unavailable.", busy: false } : current);
    }
  }

  function openSportsbook(tab: WagerPanel["tab"] = "slip") {
    const game = matchupSchedule?.games.find((item) => item.matchupType === "h2h" && !item.isFinal && !item.involvesMe && item.wageringOpen)
      ?? matchupSchedule?.games.find((item) => item.matchupType === "h2h" && !item.isFinal && item.wageringOpen)
      ?? matchupSchedule?.games[0];
    if (game) void openWager(game, tab);
  }

  function addParlayLeg() {
    if (!wagerPanel?.options || wagerPanel.parlay.length >= 3) return;
    setWagerPanel({
      ...wagerPanel,
      parlay: [...wagerPanel.parlay.filter((leg) => leg.market !== wagerPanel.market), {
        gameId: wagerPanel.gameId,
        label: wagerPanel.label,
        options: wagerPanel.options,
        market: wagerPanel.market,
        pick: wagerPanel.pick,
      }].slice(0, 3),
    });
  }

  async function placeWager() {
    if (auth.status !== "ready" || !wagerPanel) return;
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
          : [{ gameId: wagerPanel.gameId, label: wagerPanel.label, options: wagerPanel.options!, market: wagerPanel.market, pick: wagerPanel.pick }];
        const result = await recApi.placeParlay({
          guildId: auth.guildId,
          stake: Math.floor(stake),
          legs: legs.map((leg) => ({ gameId: leg.gameId, market: leg.market, pick: leg.pick })),
        });
        message = `Parlay placed. Potential payout ${coinsNumber(result.payout)}.`;
      } else if (wagerPanel.mode === "peer") {
        const result = await recApi.placePeerWager({
          guildId: auth.guildId,
          gameId: wagerPanel.gameId,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
          stake: Math.floor(stake),
          challengeType: wagerPanel.challengeType,
          targetUserId: wagerPanel.challengeType === "direct" ? wagerPanel.targetUserId : null,
        });
        message = `Peer wager posted. Pot payout ${coinsNumber(result.payout)}.`;
      } else {
        const result = await recApi.placeHouseWager({
          guildId: auth.guildId,
          gameId: wagerPanel.gameId,
          market: wagerPanel.market,
          pick: wagerPanel.pick,
          stake: Math.floor(stake),
        });
        message = `House wager placed. Potential payout ${coinsNumber(result.payout)}.`;
      }
      const board = await recApi.getPeerWagerBoard(auth.guildId).catch(() => ({ wagers: wagerPanel.board }));
      setWagerPanel((current) => current ? { ...current, board: board.wagers, busy: false, notice: message } : current);
      await load();
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, busy: false, notice: cause instanceof Error ? cause.message : "Wager failed." } : current);
    }
  }

  async function acceptPeer(wagerId: string) {
    if (auth.status !== "ready" || !wagerPanel) return;
    setWagerPanel({ ...wagerPanel, busy: true, notice: null });
    try {
      await recApi.acceptPeerWager({ guildId: auth.guildId, wagerId });
      const board = await recApi.getPeerWagerBoard(auth.guildId);
      setWagerPanel((current) => current ? { ...current, board: board.wagers, busy: false, notice: "Peer wager accepted." } : current);
      await load();
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, busy: false, notice: cause instanceof Error ? cause.message : "Could not accept wager." } : current);
    }
  }

  if (error) {
    return (
      <div className="hub-state">
        <h1>League Hub</h1>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (setupAccess && !setupAccess.leagueExists) {
    return (
      <div className="hub-state">
        <h1>Welcome to REC League</h1>
        {setupAccess.canSetup ? (
          <p>This Discord server doesn't have a league linked yet. Create or open the league on the REC website, then link this server during league setup.</p>
        ) : (
          <p>This Discord server doesn't have a league linked yet. Ask the league owner to create and link it from the REC website.</p>
        )}
      </div>
    );
  }
  if (!hub) return <div className="hub-state"><h1>Loading League Hub…</h1></div>;
  if (!hub.league) {
    return (
      <div className="hub-state">
        <h1>League Hub</h1>
        <p>This server’s league data is incomplete. Ask a commissioner to finish its website setup and Discord linking, then refresh.</p>
        <button className="btn btn-primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }

  const isRise = hub.league.rosterType === "rise_to_immortality";
  const riseHubUnlocked = !isRise || hub.league.riseHubUnlocked === true;
  const rtiGates = hub.league.rtiGates ?? null;
  const heroMatchup = stageHasScheduledGames(hub.league.seasonStage, hub.league.game as LeagueGame)
    ? (matchupSchedule?.games.find((game) => game.gameId === heroCurrentGameId)
      ?? matchupSchedule?.games.find((game) => game.involvesMe)
      ?? null)
    : null;

  return (
    <div className="hub-page" data-bg={isRise ? "rise" : "madden"}>
      <div className="hub-body">
        <main className="hub-content">
          <div className="hub-league-tab">
            {showGameDayNav ? <GameDayMiniNav active={gameDayView} leagueId={hub.league.id} /> : null}

            {gameDayView === "mine" ? (
              <SectionFrame eyebrow="This week" title="My Matchup" className="hub-matchup-section">
                {isRise && !riseHubUnlocked ? (
                  <div className="hub-hero-no-matchup">
                    <strong>Registration pool</strong>
                    <span>Complete Origins before Game Day unlocks your weekly matchup.</span>
                  </div>
                ) : heroMatchup ? (
                  <div className="hub-hero-matchup-stack">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={heroBreakdownExpanded}
                      className="hub-expandable-matchup-trigger"
                      onClick={() => setHeroBreakdownExpanded((value) => !value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setHeroBreakdownExpanded((value) => !value);
                        }
                      }}
                    >
                      <MatchupCard game={heroMatchup} showReactions reactionsBelow />
                    </div>
                    {heroBreakdownExpanded ? (
                      <div className="hub-expandable-matchup-drawer">
                        {heroPreview?.gameId === heroMatchup.gameId
                          ? <HeroMatchupBreakdown preview={heroPreview} />
                          : <GameDayEmpty title="Loading matchup breakdown…" />}
                      </div>
                    ) : null}
                    {auth.status === "ready" && (
                      <HeroMatchupActions
                        guildId={auth.guildId}
                        matchup={heroMatchup}
                        onChanged={() => setMatchupReloadKey((value) => value + 1)}
                        onOpenShareStream={() => setShareStreamGame(heroMatchup)}
                        onUploadHighlight={() => setHighlightUploadGame(heroMatchup)}
                        onOpenRequestHelp={heroMatchup.matchupType === "h2h" ? () => setRequestHelpGame(heroMatchup) : undefined}
                      />
                    )}
                    <MatchupGameMedia game={heroMatchup} />
                    {auth.status === "ready" ? (
                      <MatchupTeamLeaders
                        guildId={auth.guildId}
                        awayTeamId={heroMatchup.awayTeamId}
                        homeTeamId={heroMatchup.homeTeamId}
                        awayTeamName={heroMatchup.awayTeamName}
                        homeTeamName={heroMatchup.homeTeamName}
                      />
                    ) : null}
                    {isRise && rtiGates?.weeklyChallenges?.length ? (
                      <div className="hub-rti-challenges">
                        <header className="hub-matchup-challenges-head">
                          <span>Weekly challenges</span>
                          <small>Visible only to you</small>
                        </header>
                        {rtiGates.weeklyChallenges.map((player) => (
                          <article key={player.prospectId}>
                            <strong>{player.name || player.position} · {player.position}</strong>
                            <ul>
                              {player.challenges.map((challenge) => (
                                <li key={challenge.id} className={challenge.complete ? "is-complete" : undefined}>
                                  <span>{challenge.tier}</span> {challenge.label}
                                </li>
                              ))}
                            </ul>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (() => {
                  const empty = matchupSchedule?.isOffseason
                    ? offseasonEmptyCopy(matchupSchedule.offseasonStageLabel)
                    : byeWeekEmptyCopy();
                  return <GameDayEmpty title={empty.title} detail={empty.detail} />;
                })()}
              </SectionFrame>
            ) : null}

            {gameDayView === "gotw" ? (
              <section className="hub-matchup-section hub-gotw-page">
                {(() => {
                  const state = renderMatchupLoadState("Loading Game of the Week...");
                  if (state) return state;
                  if (auth.status === "ready" && gotwGames.length) {
                    return (
                      <GotwVotingCarousel
                        guildId={auth.guildId}
                        games={gotwGames}
                        guessingRecord={gotwGuessing?.mine}
                        onVote={voteGotw}
                        onOpenWager={isRise ? undefined : (game) => void openWager(game)}
                      />
                    );
                  }
                  const empty = matchupSchedule?.isOffseason
                    ? offseasonEmptyCopy(matchupSchedule.offseasonStageLabel)
                    : noGotwEmptyCopy();
                  return <GameDayEmpty title={empty.title} detail={empty.detail} />;
                })()}
              </section>
            ) : null}

            {gameDayView === "schedule" ? (
              <SectionFrame eyebrow="Archive & slate" title="League Schedule" className="hub-matchup-section">
                {(() => {
                  const state = renderMatchupLoadState("Loading matchups...");
                  if (state) return state;
                  const schedule = matchupSchedule;
                  if (!schedule) return null;
                  const leagueGame = hub.league.game as LeagueGame;
                  const weekLabelFor = (week: number) => stageLabel(stageForWeek(week, leagueGame), week, leagueGame);
                  const selectedWeekLabel = weekLabelFor(schedule.selectedWeek);
                  if (schedule.isOffseason && !(schedule.seasonNumbers?.length > 1)) {
                    const empty = offseasonEmptyCopy(schedule.offseasonStageLabel);
                    return <GameDayEmpty title={empty.title} detail={empty.detail} />;
                  }
                  const h2hGames = schedule.games.filter((game) => game.matchupType === "h2h");
                  const cpuGames = schedule.games.filter((game) => game.matchupType === "human_cpu" || game.matchupType === "cpu");
                  return (
                    <>
                      <div className="hub-schedule-pickers">
                        <label className="hub-week-select">
                          <span>Season</span>
                          <select
                            className="form-input"
                            value={schedule.seasonNumber}
                            onChange={(event) => {
                              setMatchupSeason(Number(event.target.value));
                              setMatchupWeek(null);
                            }}
                          >
                            {(schedule.seasonNumbers?.length ? schedule.seasonNumbers : [schedule.seasonNumber]).map((season) => (
                              <option key={season} value={season}>
                                Season {season}{season === schedule.currentSeasonNumber ? " (Current)" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="hub-week-select">
                          <span>Week</span>
                          <select
                            className="form-input"
                            value={schedule.selectedWeek}
                            onChange={(event) => setMatchupWeek(Number(event.target.value))}
                            disabled={!schedule.weekNumbers.length}
                          >
                            {schedule.weekNumbers.map((week) => (
                              <option key={week} value={week}>
                                {weekLabelFor(week)}{week === schedule.currentWeek && schedule.seasonNumber === schedule.currentSeasonNumber ? " (Current)" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {!schedule.games.length ? (
                        <GameDayEmpty {...noScheduleEmptyCopy(selectedWeekLabel)} />
                      ) : (
                        <div className="hub-schedule-stack">
                          <section className="hub-schedule-group">
                            <h3>H2H Matchups</h3>
                            {h2hGames.length ? (
                              <div className="rec-matchup-list">
                                {h2hGames.map((game, index) => (
                                  <ExpandableMatchupCard key={game.gameId} game={game} featured={game.isGameOfWeek || game.involvesMe || index === 0} />
                                ))}
                              </div>
                            ) : (
                              <GameDayEmpty title="No H2H matchups for this week." detail="Human vs CPU games are listed below when available." />
                            )}
                          </section>
                          <section className="hub-schedule-group">
                            <h3>Human vs CPU</h3>
                            {cpuGames.length ? (
                              <div className="rec-matchup-list">
                                {cpuGames.map((game, index) => (
                                  <ExpandableMatchupCard key={game.gameId} game={game} featured={index === 0} />
                                ))}
                              </div>
                            ) : (
                              <GameDayEmpty title="No CPU matchups for this week." />
                            )}
                          </section>
                        </div>
                      )}
                    </>
                  );
                })()}
              </SectionFrame>
            ) : null}

            {gameDayView === "myschedule" ? (
              <SectionFrame eyebrow="Archive & slate" title="My Schedule" className="hub-matchup-section">
                {myScheduleError ? (
                  <div className="hub-empty">
                    <p>{myScheduleError}</p>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMySchedule(null);
                        setMyScheduleLoading(true);
                        setMyScheduleError(null);
                        if (auth.status !== "ready") return;
                        recApi.getMyTeamSchedule({ guildId: auth.guildId, seasonNumber: myScheduleSeason })
                          .then(setMySchedule)
                          .catch((cause) => setMyScheduleError(cause instanceof Error ? cause.message : "Your schedule could not be loaded."))
                          .finally(() => setMyScheduleLoading(false));
                      }}
                    >
                      Try again
                    </Button>
                  </div>
                ) : myScheduleLoading || !mySchedule ? (
                  <GameDayEmpty title="Loading your schedule..." />
                ) : (() => {
                  const seasonNumbers = mySchedule.seasonNumbers?.length
                    ? mySchedule.seasonNumbers
                    : [mySchedule.seasonNumber];
                  const currentSeasonNumber = mySchedule.currentSeasonNumber ?? mySchedule.seasonNumber;
                  const myGames = mySchedule.weeks
                    .map((week) => week.matchupCard)
                    .filter((game): game is NonNullable<typeof game> => Boolean(game));
                  const h2hGames = myGames.filter((game) => game.matchupType === "h2h");
                  const cpuGames = myGames.filter((game) => game.matchupType === "human_cpu" || game.matchupType === "cpu");
                  return (
                    <>
                      <div className="hub-schedule-pickers">
                        <label className="hub-week-select">
                          <span>Season</span>
                          <select
                            className="form-input"
                            value={mySchedule.seasonNumber}
                            onChange={(event) => setMyScheduleSeason(Number(event.target.value))}
                          >
                            {seasonNumbers.map((season) => (
                              <option key={season} value={season}>
                                Season {season}{season === currentSeasonNumber ? " (Current)" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {!myGames.length ? (
                        <GameDayEmpty title="No matchups on your schedule for this season." detail="Pick another season to browse past games." />
                      ) : (
                        <div className="hub-schedule-stack">
                          <section className="hub-schedule-group">
                            <h3>H2H Matchups</h3>
                            {h2hGames.length ? (
                              <div className="rec-matchup-list">
                                {h2hGames.map((game, index) => (
                                  <ExpandableMatchupCard key={game.gameId} game={game} featured={game.isGameOfWeek || index === 0} />
                                ))}
                              </div>
                            ) : (
                              <GameDayEmpty title="No H2H matchups this season." detail="Human vs CPU games are listed below when available." />
                            )}
                          </section>
                          <section className="hub-schedule-group">
                            <h3>Human vs CPU</h3>
                            {cpuGames.length ? (
                              <div className="rec-matchup-list">
                                {cpuGames.map((game, index) => (
                                  <ExpandableMatchupCard key={game.gameId} game={game} featured={index === 0} />
                                ))}
                              </div>
                            ) : (
                              <GameDayEmpty title="No CPU matchups this season." />
                            )}
                          </section>
                        </div>
                      )}
                    </>
                  );
                })()}
              </SectionFrame>
            ) : null}
          </div>
        </main>
      </div>

      {shareStreamGame && auth.status === "ready" && (
        <ShareStreamModal
          guildId={auth.guildId}
          gameId={shareStreamGame.gameId}
          onClose={() => setShareStreamGame(null)}
          onSubmitted={() => { setShareStreamGame(null); setMatchupReloadKey((value) => value + 1); }}
        />
      )}
      {highlightUploadGame && auth.status === "ready" && (
        <HighlightUploadModal
          guildId={auth.guildId}
          gameId={highlightUploadGame.gameId}
          onClose={() => setHighlightUploadGame(null)}
          onSubmitted={() => { setHighlightUploadGame(null); setMatchupReloadKey((value) => value + 1); }}
        />
      )}
      {requestHelpGame && auth.status === "ready" && (
        <RequestHelpSheet
          matchup={requestHelpGame}
          guildId={auth.guildId}
          onClose={() => setRequestHelpGame(null)}
          onSubmitted={() => setRequestHelpGame(null)}
        />
      )}
      {wagerPanel && (
        <Modal title={`Sportsbook · ${wagerPanel.label}`} panelClassName="hub-wager-slip-modal" hideHeader onClose={() => setWagerPanel(null)}>
          <div className="hub-wager-modal">
            <header className="hub-wager-modal-brand">
              <span>REC League eSports</span>
              <div className="hub-wager-matchup-title">
                <TeamLogo abbreviation={wagerPanel.game.awayTeamAbbr} logoUrl={wagerPanel.game.awayTeamLogoUrl} alt={wagerPanel.game.awayTeamMascot} />
                <strong>{wagerPanel.game.awayTeamAbbr ?? wagerPanel.game.awayTeamName} <em>at</em> {wagerPanel.game.homeTeamAbbr ?? wagerPanel.game.homeTeamName}</strong>
                <TeamLogo abbreviation={wagerPanel.game.homeTeamAbbr} logoUrl={wagerPanel.game.homeTeamLogoUrl} alt={wagerPanel.game.homeTeamMascot} />
              </div>
              <small>Sportsbook</small>
            </header>
            {!wagerPanel.options ? (
              <p className="hub-empty">{wagerPanel.notice ?? "Loading lines..."}</p>
            ) : (
              <>
                <label className="form-field hub-wager-game-picker">
                  <span className="form-label">Game</span>
                  <select
                    className="form-select"
                    value={wagerPanel.gameId}
                    onChange={(event) => {
                      const nextGame = matchupSchedule?.games.find((game) => game.gameId === event.target.value);
                      if (nextGame) void openWager(nextGame, wagerPanel.tab);
                    }}
                  >
                    {(matchupSchedule?.games ?? [])
                      .filter((game) => game.matchupType === "h2h" && !game.isFinal && !game.involvesMe && game.wageringOpen)
                      .map((game) => (
                        <option key={game.gameId} value={game.gameId}>{game.awayTeamName} at {game.homeTeamName}</option>
                      ))}
                  </select>
                </label>
                <div className="hub-wager-modal-tabs" role="tablist" aria-label="Sportsbook views">
                  <button type="button" role="tab" aria-selected={wagerPanel.tab === "slip"} className={wagerPanel.tab === "slip" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, tab: "slip" })}>Build Wager</button>
                  <button type="button" role="tab" aria-selected={wagerPanel.tab === "board"} className={wagerPanel.tab === "board" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, tab: "board" })}>Open Wager Board</button>
                </div>
                {wagerPanel.tab === "slip" ? (
                  <>
                    <div className="hub-wager-mode">
                      <button className={wagerPanel.mode === "single" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "single" })}>House Single</button>
                      <button className={wagerPanel.mode === "parlay" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "parlay" })}>3-Pick Parlay</button>
                      <button className={wagerPanel.mode === "peer" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "peer" })}>User Wager</button>
                    </div>
                    {wagerPanel.mode === "parlay" && (
                      <p className="hub-muted">Choose exactly three different stat-line Over/Under picks from this game. Each side is a separate selection.</p>
                    )}
                    <div className="hub-wager-workbench">
                      <div className="hub-wager-lines">
                        {wagerPanel.options.markets
                          .filter((market) => wagerPanel.mode !== "parlay" || (!["moneyline", "spread", "total_points"].includes(market.market)))
                          .map((market) => {
                            const isSelectedMarket = wagerPanel.market === market.market;
                            const effectiveLine = market.line;
                            return (
                              <article key={market.market} className={isSelectedMarket ? "active" : ""}>
                                <button onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: market.sides[0]?.pick ?? "" })}>
                                  <strong>{market.label}</strong>
                                  <span>{market.line != null ? `Stat line: ${market.line}` : "Pick a winner"}</span>
                                </button>
                                <div>
                                  {market.sides.map((side) => (
                                    <button
                                      key={side.pick}
                                      aria-label={`${market.label}: ${side.label}`}
                                      className={isSelectedMarket && wagerPanel.pick === side.pick ? "active" : ""}
                                      onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: side.pick })}
                                    >
                                      <b>{side.pick === "over" ? `OVER ${effectiveLine ?? ""}` : side.pick === "under" ? `UNDER ${effectiveLine ?? ""}` : side.label}</b>
                                      <small>{side.label} · {americanFromDecimal(side.odds)}</small>
                                    </button>
                                  ))}
                                </div>
                              </article>
                            );
                          })}
                      </div>
                      <div className="hub-wager-ticket-column">
                        <WagerSlip panel={wagerPanel} />
                        {wagerPanel.mode === "parlay" && (
                          <Button variant="secondary" disabled={wagerPanel.parlay.length >= 3 || !wagerPanel.market || !wagerPanel.pick} onClick={addParlayLeg}>
                            Add Selection to Slip · {wagerPanel.parlay.length}/3
                          </Button>
                        )}
                        {wagerPanel.mode === "peer" && (
                          <div className="hub-peer-controls">
                            <select className="form-input" value={wagerPanel.challengeType} onChange={(event) => setWagerPanel({ ...wagerPanel, challengeType: event.target.value as "open" | "direct" })}>
                              <option value="open">Post to board</option>
                              <option value="direct">Direct challenge</option>
                            </select>
                            {wagerPanel.challengeType === "direct" && (
                              <select className="form-input" value={wagerPanel.targetUserId} onChange={(event) => setWagerPanel({ ...wagerPanel, targetUserId: event.target.value })}>
                                <option value="">Select coach</option>
                                {wagerPanel.coaches.map((coach) => (
                                  <option key={coach.userId} value={coach.userId}>{coach.teamAbbr} · {coach.conference}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                        <div className="hub-wager-submit">
                          <label className="form-field">
                            <span className="form-label">Stake</span>
                            <input className="form-input" type="number" min="1" value={wagerPanel.stake} onChange={(event) => setWagerPanel({ ...wagerPanel, stake: event.target.value })} />
                          </label>
                          <Button
                            variant="primary"
                            disabled={
                              wagerPanel.busy
                              || !wagerPanel.market
                              || !wagerPanel.pick
                              || (wagerPanel.mode === "peer" && wagerPanel.challengeType === "direct" && !wagerPanel.targetUserId)
                              || (wagerPanel.mode === "parlay" && wagerPanel.parlay.length !== 3)
                            }
                            onClick={() => void placeWager()}
                          >
                            {wagerPanel.busy ? "Submitting..." : wagerPanel.mode === "peer" ? "Post User Wager" : wagerPanel.mode === "parlay" ? "Place 3-Pick Parlay" : "Place Bet"}
                          </Button>
                        </div>
                        {wagerPanel.notice && <p className="hub-transfer-status">{wagerPanel.notice}</p>}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="hub-peer-board hub-peer-board-tab">
                    <h3>Open Wager Board</h3>
                    {wagerPanel.board.length ? wagerPanel.board.map((wager) => (
                      <article key={wager.id}>
                        <div>
                          <strong>{wager.gameLabel}</strong>
                          <span>{displayLabel(wager.market)} · <CoinAmount amount={wager.stake} /> · {displayLabel(wager.challengeType)}</span>
                        </div>
                        {wager.canAccept ? (
                          <Button variant="secondary" size="compact" disabled={wagerPanel.busy} onClick={() => void acceptPeer(wager.id)}>Accept</Button>
                        ) : (
                          <StatusChip status={wager.isMine ? "pending" : "locked"} label={wager.isMine ? "Your offer" : "Unavailable"} />
                        )}
                      </article>
                    )) : <p className="hub-empty">No open user wagers yet.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {lateSubmissionsOpen && auth.status === "ready" && (
        <LateSubmissionsModal
          guildId={auth.guildId}
          currentWeek={hub.league.weekNumber}
          initialWeek={lateSubmissionsWeek}
          onClose={() => {
            setLateSubmissionsOpen(false);
            setLateSubmissionsWeek(undefined);
          }}
        />
      )}
    </div>
  );
}
