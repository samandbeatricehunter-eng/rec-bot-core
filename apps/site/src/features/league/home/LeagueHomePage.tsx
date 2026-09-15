import { Fragment, Suspense, lazy, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { stageHasScheduledGames, type LeagueGame } from "@rec/shared";
import { useReadyAuth, useAuth } from "@rec/hub-ui";
import { HeadshotUploadOverlay } from "../../../components/hub/HeadshotUploadOverlay.js";
import { ManageFundsModal, SnapshotFundsModal } from "../../../components/hub/WalletSavingsCard.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { HubMatchupSchedule, HubResponse } from "../../../types/api.js";
import { LeagueTopRail } from "../chassis/index.js";
import { RetireFromLeagueModal } from "../team/RetireFromLeagueModal.js";
import { LeagueHomeSnapshot } from "./LeagueHomeSnapshot.js";

const RiseOverviewMediaDayCard = lazy(() =>
  import("./RiseOverviewMediaDay.js").then((m) => ({ default: m.RiseOverviewMediaDayCard })),
);

function HubSurfaceFallback() {
  return <div className="hub-empty" role="status">Loading…</div>;
}

/**
 * League Home — site-owned. Replaces the retired buzz/news destinations.
 * Season snapshot sits in LeagueTopRail (same Y as every other league page rail).
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

  const hasRiseBody = Boolean(isRise && rtiGates?.playerSnapshots?.length);
  const showRiseMediaDay = isRise && auth.status === "ready";

  return (
    <>
      <LeagueTopRail>
        <LeagueHomeSnapshot
          leagueId={hub.league.id}
          isRise={isRise}
          heroTeam={String(heroTeam)}
          heroSeasonRecord={heroSeasonRecord}
          heroRank={heroRank}
          heroOpponent={heroOpponent}
          viewerSide={heroMatchup?.viewerSide}
          myTeamAbbr={my.teamAbbr}
          myTeamLogoUrl={my.teamLogoUrl}
          wallet={Number(my.wallet ?? 0)}
          savings={Number(my.savings ?? 0)}
          playerXpTotal={playerXpTotal}
          teamXpTotal={teamXpTotal}
          playerXpProgress={playerXpProgress}
          teamXpProgress={teamXpProgress}
          recentForm={recentForm}
          userStreakText={(my.userStreakText === "â€”" ? "—" : my.userStreakText) ?? "—"}
          onOpenWallet={() => setSnapshotFundsKind("wallet")}
          onOpenSavings={() => setSnapshotFundsKind("savings")}
        />
      </LeagueTopRail>

      <div className="hub-page">
        {(hasRiseBody || showRiseMediaDay) ? (
          <div className="hub-body">
            <main className="hub-content">
              <div className="hub-league-tab">
                <div className="hub-buzz-top">
                  <section className="hub-hero hub-hero-rebuilt">
                    {hasRiseBody && rtiGates?.playerSnapshots?.length ? (() => {
                      const bannerTeam = rtiGates.playerSnapshots.find((player) => player.teamLogoUrl) ?? rtiGates.playerSnapshots[0];
                      return bannerTeam.teamName ? (
                        <div className="hub-rti-team-banner">
                          {bannerTeam.teamLogoUrl ? <img src={bannerTeam.teamLogoUrl} alt="" /> : null}
                          <strong>{bannerTeam.teamName}</strong>
                        </div>
                      ) : null;
                    })() : null}

                    {hasRiseBody && rtiGates?.playerSnapshots?.length ? (
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

                    {hasRiseBody && rtiGates?.playerSnapshots?.length ? (
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

                    {showRiseMediaDay ? (
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
              </div>
            </main>
          </div>
        ) : null}

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

        {retireOpen ? (
          <RetireFromLeagueModal
            leagueName={hub.league.name}
            teamNickname={String(heroTeam)}
            onClose={() => setRetireOpen(false)}
          />
        ) : null}
      </div>
    </>
  );
}
