import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { CoinAmount } from "../../../../../web/src/components/ui/CoinAmount.js";
import { TeamLogo } from "../../../../../web/src/components/ui/TeamLogo.js";

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
  onOpenWallet,
  onOpenSavings,
}: LeagueHomeSnapshotProps) {
  return (
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
        )}
        {isRise ? (
          <article><span>Record</span><strong>{heroSeasonRecord}</strong></article>
        ) : (
          <Link to={`/l/${leagueId}/standings`}><span>Record</span><strong>{heroSeasonRecord}</strong></Link>
        )}
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
      {!isRise ? (
        <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="Team progression snapshot">
          <Link to={`/l/${leagueId}/standings?view=power`}><span>Power ranking</span><strong>{heroRank}</strong></Link>
          <Link className="hub-season-form-card" to={`/l/${leagueId}/matchups?view=myschedule`}>
            <span>Streak · Recent form</span>
            <strong>
              <em>{userStreakText ?? "—"}</em>
              {recentForm.length ? recentForm.map((game, index) => (
                <span className={`hub-season-form-game is-${game.result.toLowerCase()}`} key={`${game.opponentName}-${index}`} title={`${game.result} vs ${game.opponentName}`}>
                  <TeamLogo abbreviation={game.opponentAbbr} logoUrl={game.opponentLogoUrl} alt={game.opponentName} />
                  <b>{game.result}</b>
                </span>
              )) : <small>—</small>}
            </strong>
          </Link>
          <Link className="hub-season-team-xp" to={`/l/${leagueId}/player-progression`}>
            <span>Player XP</span>
            <strong>{playerXpTotal.toLocaleString()}</strong>
            <div className="hub-season-team-xp-track" aria-label={`${playerXpTotal} Player XP`}>
              <i style={{ width: `${playerXpProgress}%` }} />
            </div>
          </Link>
          <Link className="hub-season-team-xp" to={`/l/${leagueId}/owner-progression`}>
            <span>Team XP</span>
            <strong>{teamXpTotal.toLocaleString()} <Shield size={17} aria-label="Steel shield" /></strong>
            <div className="hub-season-team-xp-track" aria-label={`${teamXpTotal} Team XP toward steel shield`}>
              <i style={{ width: `${teamXpProgress}%` }} />
            </div>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
