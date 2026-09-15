import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { CoinAmount } from "../../../components/ui/CoinAmount.js";
import { TeamLogo } from "../../../components/ui/TeamLogo.js";

type RtiMiniProspect = {
  playerId: string;
  playerName: string;
  position: string | null;
  side: string;
  headshotUrl?: string | null;
  xpProgressPct: number;
  playerXpTotal: number;
};

export type LeagueHomeSnapshotProps = {
  leagueId: string;
  isRise: boolean;
  heroTeam: string;
  heroSeasonRecord: string;
  heroRank: string;
  heroOpponent: {
    abbreviation: string | null | undefined;
    logoUrl: string | null | undefined;
    name: string;
  } | null;
  viewerSide: "home" | "away" | null | undefined;
  myTeamAbbr: string | null | undefined;
  myTeamLogoUrl: string | null | undefined;
  wallet: number;
  savings: number;
  playerXpTotal: number;
  teamXpTotal: number;
  playerXpProgress: number;
  teamXpProgress: number;
  recentForm: Array<{
    result: "W" | "L" | "T";
    opponentName: string;
    opponentAbbr: string | null;
    opponentLogoUrl: string | null;
  }>;
  userStreakText: string | null | undefined;
  rtiProspects?: RtiMiniProspect[];
  rtiOwner?: { name: string; headshotUrl: string | null } | null;
  onOpenWallet: () => void;
  onOpenSavings: () => void;
};

/** Season snapshot rail content for League Home — placement owned by LeagueTopRail. */
export function LeagueHomeSnapshot({
  leagueId,
  isRise,
  heroTeam,
  heroSeasonRecord,
  heroRank,
  heroOpponent,
  viewerSide,
  myTeamAbbr,
  myTeamLogoUrl,
  wallet,
  savings,
  playerXpTotal,
  teamXpTotal,
  playerXpProgress,
  teamXpProgress,
  recentForm,
  userStreakText,
  rtiProspects = [],
  rtiOwner,
  onOpenWallet,
  onOpenSavings,
}: LeagueHomeSnapshotProps) {
  const playerProgressionPath = isRise ? `/l/${leagueId}/team/upgrades` : `/l/${leagueId}/player-progression`;
  const ownerProgressionPath = isRise ? `/l/${leagueId}/team/progression` : `/l/${leagueId}/owner-progression`;
  const offense = rtiProspects.find((player) => player.side === "offense") ?? null;
  const defense = rtiProspects.find((player) => player.side === "defense") ?? null;

  function rtiProspectCard(player: RtiMiniProspect | null, side: "offense" | "defense") {
    const label = side === "offense" ? "Offensive Prospect" : "Defensive Prospect";
    const title = player?.playerName?.trim() || label;
    const position = player?.position?.trim() || "Prospect";
    const progress = Math.max(0, Math.min(100, Number(player?.xpProgressPct ?? 0)));
    const sp = Math.max(0, Number(player?.playerXpTotal ?? 0));
    return (
      <Link className="hub-rti-mini-card" to={playerProgressionPath}>
        <div className="hub-rti-mini-card-info">
          <span>{label}</span>
          <strong>{title}</strong>
          <small>{position} · {sp.toLocaleString()} SP</small>
          <div className="hub-season-team-xp-track" aria-label={`${title} XP progress`}>
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
        <span className="hub-rti-mini-card-avatar" aria-hidden="true">
          {player?.headshotUrl ? <img src={player.headshotUrl} alt="" /> : null}
        </span>
      </Link>
    );
  }

  return (
    <div className="hub-season-snapshot-box">
      <div className="hub-season-snapshot-grid" aria-label="Season snapshot">
        <Link to={`/l/${leagueId}/matchups`} aria-label="Open my game day matchup">
          <span>Matchup</span>
          <strong className="hub-season-snapshot-opponent">
            {heroOpponent ? (
              viewerSide === "home" ? (
                <>
                  <TeamLogo abbreviation={heroOpponent.abbreviation} logoUrl={heroOpponent.logoUrl} alt={heroOpponent.name} />
                  <em>AT</em>
                  <TeamLogo abbreviation={myTeamAbbr} logoUrl={myTeamLogoUrl} alt={heroTeam} />
                </>
              ) : (
                <>
                  <TeamLogo abbreviation={myTeamAbbr} logoUrl={myTeamLogoUrl} alt={heroTeam} />
                  <em>AT</em>
                  <TeamLogo abbreviation={heroOpponent.abbreviation} logoUrl={heroOpponent.logoUrl} alt={heroOpponent.name} />
                </>
              )
            ) : (
              <>
                <TeamLogo abbreviation={myTeamAbbr} logoUrl={myTeamLogoUrl} alt={heroTeam} />
                <em>—</em>
              </>
            )}
          </strong>
        </Link>
        <Link to={`/l/${leagueId}/standings`}><span>Record</span><strong>{heroSeasonRecord}</strong></Link>
        {isRise ? (
          <article><span>Wallet</span><strong><CoinAmount amount={wallet} /></strong></article>
        ) : (
          <button type="button" onClick={onOpenWallet}>
            <span>Wallet</span><strong><CoinAmount amount={wallet} /></strong>
          </button>
        )}
        {isRise ? (
          <article><span>Savings</span><strong><CoinAmount amount={savings} /></strong></article>
        ) : (
          <button type="button" onClick={onOpenSavings}>
            <span>Savings</span><strong><CoinAmount amount={savings} /></strong>
          </button>
        )}
      </div>
      {isRise ? (
        <div className="hub-season-snapshot-grid hub-season-snapshot-secondary hub-season-snapshot-rti-trio" aria-label="Rise progression snapshot">
          {rtiProspectCard(offense, "offense")}
          <Link className="hub-rti-mini-card hub-rti-mini-card-owner" to={ownerProgressionPath}>
            <div className="hub-rti-mini-card-info">
              <span>Owner</span>
              <strong>{rtiOwner?.name?.trim() || "Owner"}</strong>
              <small>{teamXpTotal.toLocaleString()} SP</small>
              <div className="hub-season-team-xp-track" aria-label="Owner XP progress">
                <i style={{ width: `${teamXpProgress}%` }} />
              </div>
            </div>
            <span className="hub-rti-mini-card-avatar" aria-hidden="true">
              {rtiOwner?.headshotUrl ? <img src={rtiOwner.headshotUrl} alt="" /> : null}
            </span>
          </Link>
          {rtiProspectCard(defense, "defense")}
        </div>
      ) : (
        <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="Team progression snapshot">
        <Link to={`/l/${leagueId}/standings?view=power`}><span>Power ranking</span><strong>{heroRank}</strong></Link>
        <Link className="hub-season-form-card" to={`/l/${leagueId}/matchups?view=myschedule`}>
          <span>Recent form · Streak</span>
          <strong>
            {recentForm.length ? recentForm.map((game, index) => (
              <span className={`hub-season-form-game is-${game.result.toLowerCase()}`} key={`${game.opponentName}-${index}`} title={`${game.result} vs ${game.opponentName}`}>
                <TeamLogo abbreviation={game.opponentAbbr} logoUrl={game.opponentLogoUrl} alt={game.opponentName} />
                <b>{game.result}</b>
              </span>
            )) : <small>—</small>}
            <em>{userStreakText ?? "—"}</em>
          </strong>
        </Link>
        <Link className="hub-season-team-xp" to={playerProgressionPath}>
          <span>Player XP</span>
          <strong>{playerXpTotal.toLocaleString()}</strong>
          <div className="hub-season-team-xp-track" aria-label={`${playerXpTotal} Player XP`}>
            <i style={{ width: `${playerXpProgress}%` }} />
          </div>
        </Link>
        <Link className="hub-season-team-xp" to={ownerProgressionPath}>
          <span>Team XP</span>
          <strong>{teamXpTotal.toLocaleString()} <Shield size={17} aria-label="Steel shield" /></strong>
          <div className="hub-season-team-xp-track" aria-label={`${teamXpTotal} Team XP toward steel shield`}>
            <i style={{ width: `${teamXpProgress}%` }} />
          </div>
        </Link>
        </div>
      )}
    </div>
  );
}
