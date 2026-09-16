import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { stageHasScheduledGames, type LeagueGame } from "@rec/shared";
import { useReadyAuth, useAuth } from "@rec/hub-ui";
import { ManageFundsModal, SnapshotFundsModal } from "../../../components/hub/WalletSavingsCard.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { HubMatchupSchedule, HubResponse } from "../../../types/api.js";
import { LeagueTopRail } from "../chassis/index.js";
import { RetireFromLeagueModal } from "../team/RetireFromLeagueModal.js";
import { LeagueHomeSnapshot } from "./LeagueHomeSnapshot.js";

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

  return (
    <div className="hub-page">
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
          rtiProspects={rtiGates?.playerSnapshots ?? []}
          rtiOwner={rtiGates?.owner ?? null}
          onOpenWallet={() => setSnapshotFundsKind("wallet")}
          onOpenSavings={() => setSnapshotFundsKind("savings")}
        />
      </LeagueTopRail>

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
  );
}
