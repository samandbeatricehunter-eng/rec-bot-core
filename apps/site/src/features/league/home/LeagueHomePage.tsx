import { Fragment, Suspense, lazy, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { stageHasScheduledGames, type LeagueGame } from "@rec/shared";
import { useReadyAuth, useAuth } from "@rec/hub-ui";
import { Shield } from "lucide-react";
import { CoinAmount } from "../../../../../web/src/components/ui/CoinAmount.js";
import { TeamLogo } from "../../../../../web/src/components/ui/TeamLogo.js";
import { HeadshotUploadOverlay } from "../../../../../web/src/components/hub/HeadshotUploadOverlay.js";
import { ManageFundsModal, SnapshotFundsModal } from "../../../../../web/src/components/hub/WalletSavingsCard.js";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { HubMatchupSchedule, HubResponse } from "../../../../../web/src/types/api.js";
import { RetireFromLeagueModal } from "../team/RetireFromLeagueModal.js";

const FantasyDraftCard = lazy(() =>
  import("../../../../../web/src/routes/hub/FantasyDraftCard.js").then((m) => ({ default: m.FantasyDraftCard })),
);
const RiseOverviewMediaDayCard = lazy(() =>
  import("../../../../../web/src/routes/hub/RiseOverviewMediaDay.js").then((m) => ({ default: m.RiseOverviewMediaDayCard })),
);

function HubSurfaceFallback() {
  return <div className="hub-empty" role="status">Loading…</div>;
}

/**
 * League Home — site-owned. Replaces the retired buzz/news destinations.
 * Keeps the season snapshot + draft/RTI footholds; media feed/news room are gone.
 */
export function LeagueHomePage() {
  const { leagueId = "" } = useParams();
  const { guildId } = useReadyAuth();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [schedule, setSchedule] = useState<HubMatchupSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const [manageFundsOpen, setManageFundsOpen] = useState(false);
  const [snapshotFundsKind, setSnapshotFundsKind] = useState<"wallet" | "savings" | null>(null);

  async function load() {
    const next = await recApi.getHub(guildId);
    setHub(next);
    try {
      setSchedule(await recApi.getHubMatchupSchedule({ guildId }));
    } catch {
      setSchedule(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load League Home.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  useEffect(() => {
    const requested = searchParams.get("openModal");
    if (!requested) return;
    if (requested === "retire") setRetireOpen(true);
    else if (requested === "financials") setManageFundsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openModal");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (error && !hub) {
    return (
      <div className="hub-page">
        <p className="hub-empty">{error}</p>
      </div>
    );
  }

  if (!hub?.league) {
    return (
      <div className="hub-page">
        <p className="hub-empty">Loading League Home…</p>
      </div>
    );
  }

  const my = hub.myTeam?.display ?? {};
  const profile = hub.myTeam?.profile ?? {};
  const isRise = hub.league.rosterType === "rise_to_immortality";
  const riseHubUnlocked = !isRise || hub.league.riseHubUnlocked === true;
  const rtiGates = hub.league.rtiGates ?? null;
  const heroTeam = profile.teamName ?? my.teamName ?? "No team linked";
  const heroSeasonRecord = my.leagueSeasonRecordText ?? profile.seasonRecord?.text ?? "0-0";
  const heroRank = profile.powerRank?.rank ? `#${profile.powerRank.rank}` : "Unranked";
  const heroCurrentGameId: string | null = (hub.myTeam?.display as { currentGameId?: string | null } | undefined)?.currentGameId
    ?? null;
  const heroMatchup = stageHasScheduledGames(hub.league.seasonStage, hub.league.game as LeagueGame)
    ? (schedule?.games ?? []).find((game) => game.gameId === heroCurrentGameId)
      ?? (schedule?.games ?? []).find((game) => Boolean((game as { isViewerGame?: boolean }).isViewerGame))
      ?? null
    : null;
  const heroOpponent = heroMatchup
    ? heroMatchup.viewerSide === "home"
      ? { abbreviation: heroMatchup.awayTeamAbbr, logoUrl: heroMatchup.awayTeamLogoUrl, name: heroMatchup.awayTeamName }
      : { abbreviation: heroMatchup.homeTeamAbbr, logoUrl: heroMatchup.homeTeamLogoUrl, name: heroMatchup.homeTeamName }
    : null;
  const playerXpTotal = Number(rtiGates?.playerXpTotal ?? my.progressionSummary?.playerXpTotal ?? 0);
  const teamXpTotal = Number(rtiGates?.teamXpTotal ?? my.progressionSummary?.teamXpTotal ?? 0);
  const teamXpProgress = Math.max(0, Math.min(100, Number(my.progressionSummary?.teamXpProgressPct ?? 0)));
  const playerXpProgress = Math.max(0, Math.min(100, Number(my.progressionSummary?.playerXpProgressPct ?? 0)));
  const recentForm = (my.recentForm ?? []) as Array<{
    result: "W" | "L" | "T";
    opponentName: string;
    opponentAbbr: string | null;
    opponentLogoUrl: string | null;
  }>;

  return (
    <div className="hub-page">
      <div className="hub-body">
        <main className="hub-content">
          <div className="hub-league-tab">
            <div className="hub-buzz-top">
              <section className="hub-hero hub-hero-rebuilt">
                <section className="hub-season-snapshot">
                  <div className="hub-season-snapshot-box">
                    <div className="hub-season-snapshot-grid" aria-label="Season snapshot">
                      {isRise ? (
                        <article>
                          <span>Matchup</span>
                          <strong className="hub-season-snapshot-opponent">
                            {heroOpponent ? (
                              <TeamLogo abbreviation={heroOpponent.abbreviation} logoUrl={heroOpponent.logoUrl} alt={heroOpponent.name} />
                            ) : "—"}
                          </strong>
                        </article>
                      ) : (
                        <Link to={`/l/${hub.league.id}/matchups`} aria-label="Open my game day matchup">
                          <span>Matchup</span>
                          <strong className="hub-season-snapshot-opponent">
                            {heroOpponent ? (
                              heroMatchup?.viewerSide === "home" ? (
                                <>
                                  <TeamLogo abbreviation={heroOpponent.abbreviation} logoUrl={heroOpponent.logoUrl} alt={heroOpponent.name} />
                                  <em>AT</em>
                                  <TeamLogo abbreviation={my.teamAbbr} logoUrl={my.teamLogoUrl} alt={heroTeam} />
                                </>
                              ) : (
                                <>
                                  <TeamLogo abbreviation={my.teamAbbr} logoUrl={my.teamLogoUrl} alt={heroTeam} />
                                  <em>AT</em>
                                  <TeamLogo abbreviation={heroOpponent.abbreviation} logoUrl={heroOpponent.logoUrl} alt={heroOpponent.name} />
                                </>
                              )
                            ) : (
                              <>
                                <TeamLogo abbreviation={my.teamAbbr} logoUrl={my.teamLogoUrl} alt={heroTeam} />
                                <em>—</em>
                              </>
                            )}
                          </strong>
                        </Link>
                      )}
                      {isRise ? (
                        <article><span>Record</span><strong>{heroSeasonRecord}</strong></article>
                      ) : (
                        <Link to={`/l/${hub.league.id}/standings`}><span>Record</span><strong>{heroSeasonRecord}</strong></Link>
                      )}
                      {isRise ? (
                        <article><span>Wallet</span><strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong></article>
                      ) : (
                        <button type="button" onClick={() => setSnapshotFundsKind("wallet")}>
                          <span>Wallet</span><strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong>
                        </button>
                      )}
                      {isRise ? (
                        <article><span>Savings</span><strong><CoinAmount amount={Number(my.savings ?? 0)} /></strong></article>
                      ) : (
                        <button type="button" onClick={() => setSnapshotFundsKind("savings")}>
                          <span>Savings</span><strong><CoinAmount amount={Number(my.savings ?? 0)} /></strong>
                        </button>
                      )}
                    </div>
                    {!isRise ? (
                      <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="Team progression snapshot">
                        <Link to={`/l/${hub.league.id}/standings?view=power`}><span>Power ranking</span><strong>{heroRank}</strong></Link>
                        <Link className="hub-season-form-card" to={`/l/${hub.league.id}/matchups?view=myschedule`}>
                          <span>Recent form · Streak</span>
                          <strong>
                            {recentForm.length ? [...recentForm].reverse().map((game, index) => (
                              <span className={`hub-season-form-game is-${game.result.toLowerCase()}`} key={`${game.opponentName}-${index}`} title={`${game.result} vs ${game.opponentName}`}>
                                <TeamLogo abbreviation={game.opponentAbbr} logoUrl={game.opponentLogoUrl} alt={game.opponentName} />
                                <b>{game.result}</b>
                              </span>
                            )) : <small>—</small>}
                            <em>{my.userStreakText ?? "—"}</em>
                          </strong>
                        </Link>
                        <Link className="hub-season-team-xp" to={`/l/${hub.league.id}/player-progression`}>
                          <span>Player XP</span>
                          <strong>{playerXpTotal.toLocaleString()}</strong>
                          <div className="hub-season-team-xp-track" aria-label={`${playerXpTotal} Player XP`}>
                            <i style={{ width: `${playerXpProgress}%` }} />
                          </div>
                        </Link>
                        <Link className="hub-season-team-xp" to={`/l/${hub.league.id}/owner-progression`}>
                          <span>Team XP</span>
                          <strong>{teamXpTotal.toLocaleString()} <Shield size={17} aria-label="Steel shield" /></strong>
                          <div className="hub-season-team-xp-track" aria-label={`${teamXpTotal} Team XP toward steel shield`}>
                            <i style={{ width: `${teamXpProgress}%` }} />
                          </div>
                        </Link>
                      </div>
                    ) : null}
                  </div>

                  {isRise && rtiGates?.playerSnapshots?.length ? (() => {
                    const bannerTeam = rtiGates.playerSnapshots.find((player) => player.teamLogoUrl) ?? rtiGates.playerSnapshots[0];
                    return bannerTeam.teamName ? (
                      <div className="hub-rti-team-banner">
                        {bannerTeam.teamLogoUrl ? <img src={bannerTeam.teamLogoUrl} alt="" /> : null}
                        <strong>{bannerTeam.teamName}</strong>
                      </div>
                    ) : null;
                  })() : null}

                  {isRise && rtiGates?.playerSnapshots?.length ? (
                    <div className={`hub-rti-player-snapshot-grid${rtiGates.owner ? " has-owner" : ""}`}>
                      {rtiGates.playerSnapshots.map((player, index) => (
                        <Fragment key={player.playerId}>
                          <article className="hub-rti-player-snapshot-card">
                            <HeadshotUploadOverlay
                              disabled={!guildId}
                              onUpload={async (resized) => {
                                await recApi.uploadImmortalityProspectHeadshot({
                                  guildId,
                                  side: player.side === "defense" ? "defense" : "offense",
                                  ...resized,
                                });
                                await load();
                              }}
                            >
                              <div className="hub-rti-player-portrait">
                                {player.headshotUrl ? <img src={player.headshotUrl} alt={`${player.playerName} headshot`} /> : <span>{player.playerName.slice(0, 1)}</span>}
                                {player.teamLogoUrl ? <img className="hub-rti-player-team-logo" src={player.teamLogoUrl} alt="" /> : null}
                              </div>
                            </HeadshotUploadOverlay>
                            <div className="hub-rti-player-copy">
                              <p>{player.teamAbbr ?? player.teamName} · {player.position ?? "Player"}</p>
                              <h3>{player.playerName}</h3>
                              <div className="hub-rti-player-rank">
                                <strong>{player.positionRank ? `#${player.positionRank}` : "—"}</strong>
                                <span>{player.position ?? "POS"} league rank{player.positionCount ? ` · ${player.positionCount} ranked` : ""}</span>
                              </div>
                              <ul>{player.seasonLines.map((line, lineIndex) => <li key={`${player.playerId}-${lineIndex}`}>{line}</li>)}</ul>
                            </div>
                          </article>
                          {index === 0 && rtiGates.owner ? (
                            <article className="hub-rti-player-snapshot-card hub-rti-owner-snapshot-card">
                              <HeadshotUploadOverlay
                                disabled={!guildId}
                                onUpload={async (resized) => {
                                  await recApi.uploadImmortalityOwnerHeadshot({ guildId, ...resized });
                                  await load();
                                }}
                              >
                                <div className="hub-rti-player-portrait">
                                  {rtiGates.owner.headshotUrl
                                    ? <img src={rtiGates.owner.headshotUrl} alt={`${rtiGates.owner.name} headshot`} />
                                    : <span>{rtiGates.owner.name.slice(0, 1)}</span>}
                                </div>
                              </HeadshotUploadOverlay>
                              <div className="hub-rti-player-copy">
                                <p>Owner</p>
                                <h3>{rtiGates.owner.name}</h3>
                              </div>
                            </article>
                          ) : null}
                        </Fragment>
                      ))}
                    </div>
                  ) : null}

                  {isRise && rtiGates?.playerSnapshots?.length ? (
                    <div className="hub-rti-hof-progress-grid">
                      {rtiGates.playerSnapshots.map((player) => (
                        <article key={`hof-${player.playerId}`}>
                          <div className="hub-rti-progress-row">
                            <span>Player XP Progress</span>
                            <strong>{player.playerXpTotal.toLocaleString("en-US")} XP · {player.xpProgressPct.toFixed(1)}%</strong>
                          </div>
                          <p>{player.playerName} · {player.position} · to next Player XP point</p>
                          <div
                            className="hub-rti-xp-meter"
                            role="progressbar"
                            aria-label={`${player.playerName} progress to next Player XP point`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={player.xpProgressPct}
                          >
                            <i style={{ width: `${player.xpProgressPct}%` }} />
                          </div>
                          <div className="hub-rti-progress-row">
                            <span>{player.side === "offense" ? "Offensive" : "Defensive"} HOF Progress</span>
                            <strong>{player.hofProgress.toFixed(1)}%</strong>
                          </div>
                          <p>{player.playerName} · {player.position}</p>
                          <div
                            className="hub-rti-hof-meter"
                            role="progressbar"
                            aria-label={`${player.playerName} Hall of Fame progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={player.hofProgress}
                          >
                            <i style={{ width: `${player.hofProgress}%` }} />
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>

                {isRise && auth.status === "ready" ? (
                  <Suspense fallback={<HubSurfaceFallback />}>
                    <RiseOverviewMediaDayCard
                      guildId={auth.guildId}
                      seasonStage={hub.league.seasonStage}
                      game={hub.league.game as LeagueGame}
                    />
                  </Suspense>
                ) : null}
              </section>
            </div>

            {manageFundsOpen && auth.status === "ready" ? (
              <ManageFundsModal
                guildId={auth.guildId}
                wallet={Number(my.wallet ?? 0)}
                savings={Number(my.savings ?? 0)}
                onTransferred={load}
                onClose={() => setManageFundsOpen(false)}
              />
            ) : null}
            {snapshotFundsKind && auth.status === "ready" ? (
              <SnapshotFundsModal
                kind={snapshotFundsKind}
                guildId={auth.guildId}
                wallet={Number(my.wallet ?? 0)}
                savings={Number(my.savings ?? 0)}
                onTransferred={load}
                onClose={() => setSnapshotFundsKind(null)}
              />
            ) : null}

            {(hub.league.game === "madden_26" || hub.league.game === "madden_27")
              && (!isRise || riseHubUnlocked)
              && hub.league.fantasyDraftStatus
              && hub.league.fantasyDraftStatus !== "not_applicable"
              && hub.league.fantasyDraftStatus !== "concluded"
              && guildId ? (
              <Suspense fallback={<HubSurfaceFallback />}>
                <FantasyDraftCard guildId={guildId} leagueId={leagueId || hub.league.id} compact />
              </Suspense>
            ) : null}
          </div>
        </main>
      </div>

      {retireOpen ? (
        <RetireFromLeagueModal
          leagueName={hub.league.name}
          teamNickname={String(heroTeam)}
          onClose={() => setRetireOpen(false)}
        />
      ) : null}
    </div>
  );
}
