import { useEffect, useState, type CSSProperties } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { NflPlayoffMatchup, NflPlayoffPicture, NflTeamSummary } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { TeamLogo } from "../../../components/ui/TeamLogo.js";

const ROUND_LABELS: Record<NflPlayoffPicture["rounds"][number]["round"], string> = {
  wild_card: "Wild Card",
  divisional: "Divisional",
  conference_championship: "Conference",
  super_bowl: "Super Bowl",
};

function teamColorStyle(team: NflTeamSummary): CSSProperties {
  return team.primaryColor ? ({ "--team": team.primaryColor } as CSSProperties) : {};
}

function TeamBadge({ team, size = 30 }: { team: NflTeamSummary; size?: number }) {
  return (
    <span className="nfl-bracket-badge" style={{ ...teamColorStyle(team), width: size, height: size }}>
      <TeamLogo abbreviation={team.abbreviation} logoUrl={team.logoUrl} alt={team.name} />
    </span>
  );
}

function TeamRow({ team, seed, score, isWinner, isDecided }: {
  team: NflTeamSummary; seed: number; score: number | null; isWinner: boolean; isDecided: boolean;
}) {
  return (
    <div className={`nfl-bracket-team-row${isDecided ? (isWinner ? " is-winner" : " is-loser") : ""}`} style={teamColorStyle(team)}>
      <span className="nfl-bracket-seed">{seed}</span>
      <TeamBadge team={team} />
      <span className="nfl-bracket-name">
        {team.name}
        <span className="nfl-bracket-record">{team.conference} {team.division}</span>
      </span>
      <span className="nfl-bracket-score">{score ?? ""}</span>
    </div>
  );
}

function MatchupBlock({ matchup, tag }: { matchup: NflPlayoffMatchup; tag?: string }) {
  const decided = matchup.status === "completed";
  return (
    <div className="nfl-bracket-matchup" data-round={matchup.conference}>
      {tag && <span className="nfl-bracket-tag">{tag}</span>}
      <TeamRow team={matchup.homeTeam} seed={matchup.homeSeed} score={matchup.homeScore} isWinner={matchup.winnerTeamId === matchup.homeTeam.teamId} isDecided={decided} />
      <TeamRow team={matchup.awayTeam} seed={matchup.awaySeed} score={matchup.awayScore} isWinner={matchup.winnerTeamId === matchup.awayTeam.teamId} isDecided={decided} />
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg className="nfl-bracket-trophy" viewBox="0 0 24 30" aria-hidden="true">
      <defs>
        <linearGradient id="nflBracketSilverBall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2f4f6" />
          <stop offset="45%" stopColor="#c7ccd3" />
          <stop offset="100%" stopColor="#8b9099" />
        </linearGradient>
        <linearGradient id="nflBracketSilverRod" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8ebee" />
          <stop offset="100%" stopColor="#767b83" />
        </linearGradient>
      </defs>
      <rect x="6" y="27" width="12" height="2.2" rx="1.1" fill="url(#nflBracketSilverRod)" />
      <path d="M9 27 L11.2 10.5" stroke="url(#nflBracketSilverRod)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M12 27 L12 9" stroke="url(#nflBracketSilverRod)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M15 27 L12.8 10.5" stroke="url(#nflBracketSilverRod)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <ellipse cx="12" cy="6.2" rx="3.1" ry="5.6" fill="url(#nflBracketSilverBall)" stroke="#5f646c" strokeWidth="0.5" />
      <path d="M12 1.6V10.8M10.2 3.4h3.6M10 5.2h4M10 7h4M9.7 8.8h4.6" stroke="#5f646c" strokeWidth="0.45" fill="none" />
    </svg>
  );
}

function DesktopBracket({ picture }: { picture: NflPlayoffPicture }) {
  const byRound = new Map(picture.rounds.map((r) => [r.round, r.matchups]));
  const afc = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round) ?? []).filter((m) => m.conference === "AFC");
  const nfc = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round) ?? []).filter((m) => m.conference === "NFC");
  const superBowl = (byRound.get("super_bowl") ?? [])[0] ?? null;

  const bye = (matchups: NflPlayoffMatchup[]) => {
    const seeded = new Set(matchups.flatMap((m) => [m.homeSeed, m.awaySeed]));
    return picture.conferences.find((c) => matchups[0]?.conference === c.conference)?.seeds.find((s) => s.seed === 1 && !seeded.has(1)) ?? null;
  };
  const afcBye = bye(afc("wild_card"));
  const nfcBye = bye(nfc("wild_card"));

  return (
    <div className="nfl-bracket">
      <div className="nfl-bracket-round-label">Wild Card</div>
      <div className="nfl-bracket-round-label">Divisional</div>
      <div className="nfl-bracket-round-label is-active">Conference</div>
      <div className="nfl-bracket-round-label">&nbsp;</div>
      <div className="nfl-bracket-round-label">&nbsp;</div>
      <div className="nfl-bracket-round-label is-active">Conference</div>
      <div className="nfl-bracket-round-label">Divisional</div>
      <div className="nfl-bracket-round-label">Wild Card</div>

      <div className="nfl-bracket-matchup-group round-wild_card">
        {afc("wild_card").map((m, i) => <MatchupBlock key={i} matchup={m} tag="AFC · Wild Card" />)}
      </div>
      <div className="nfl-bracket-matchup-group round-divisional">
        {afcBye ? <div className="nfl-bracket-bye"><TeamBadge team={afcBye.team} size={24} /><span><strong>{afcBye.team.name}</strong> — first-round bye</span></div> : null}
      </div>
      <div className="nfl-bracket-matchup-group round-conference_championship">
        {afc("conference_championship").map((m, i) => <MatchupBlock key={i} matchup={m} tag="AFC Championship" />)}
      </div>

      <div className="nfl-bracket-center">
        <div className="nfl-bracket-trophy-wrap"><TrophyIcon /></div>
        <div className="nfl-bracket-sb-label">Super Bowl</div>
        {superBowl && (
          <div className="nfl-bracket-sb-matchup">
            <TeamRow team={superBowl.homeTeam} seed={superBowl.homeSeed} score={superBowl.homeScore} isWinner={superBowl.winnerTeamId === superBowl.homeTeam.teamId} isDecided={superBowl.status === "completed"} />
            <TeamRow team={superBowl.awayTeam} seed={superBowl.awaySeed} score={superBowl.awayScore} isWinner={superBowl.winnerTeamId === superBowl.awayTeam.teamId} isDecided={superBowl.status === "completed"} />
          </div>
        )}
        {picture.champion && (
          <div className="nfl-bracket-champion-banner">
            {picture.isLiveProjection ? "Projected Champion" : "Champion"}
            <strong>{picture.champion.name}</strong>
          </div>
        )}
      </div>

      <div className="nfl-bracket-matchup-group round-conference_championship">
        {nfc("conference_championship").map((m, i) => <MatchupBlock key={i} matchup={m} tag="NFC Championship" />)}
      </div>
      <div className="nfl-bracket-matchup-group round-divisional">
        {nfcBye ? <div className="nfl-bracket-bye"><TeamBadge team={nfcBye.team} size={24} /><span><strong>{nfcBye.team.name}</strong> — first-round bye</span></div> : null}
      </div>
      <div className="nfl-bracket-matchup-group round-wild_card">
        {nfc("wild_card").map((m, i) => <MatchupBlock key={i} matchup={m} tag="NFC · Wild Card" />)}
      </div>
    </div>
  );
}

function StandingsPanel({ picture }: { picture: NflPlayoffPicture }) {
  return (
    <div className="nfl-standings-grid">
      {picture.conferences.map((conference) => (
        <div key={conference.conference}>
          <h3 className="rec-display" style={{ fontSize: "1rem", margin: "0 0 var(--space-2)" }}>{conference.conference}</h3>
          {conference.divisions.map((division) => (
            <div key={division.division} className="nfl-standings-division" style={{ marginBottom: "var(--space-3)" }}>
              <h4>{division.division}</h4>
              {division.teams.map((row) => (
                <div key={row.teamId} className={`nfl-standings-row${row.isDivisionWinner ? " is-division-winner" : ""}`}>
                  <span className="nfl-standings-seed">{row.seed ?? "—"}</span>
                  <TeamBadge team={row.team} size={22} />
                  <span className="nfl-bracket-name">{row.team.name}</span>
                  <span className="nfl-standings-record">{row.wins}-{row.losses}{row.ties ? `-${row.ties}` : ""}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function NflPlayoffBracket() {
  const { guildId } = useReadyAuth();
  const [picture, setPicture] = useState<NflPlayoffPicture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ seasonNumber: number; picture: NflPlayoffPicture } | null | undefined>(undefined);

  useEffect(() => {
    recApi.getNflPlayoffPicture(guildId)
      .then(setPicture)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the playoff picture."));
  }, [guildId]);

  // Once the live picture comes back not-yet-unlocked (new season's week has reset below the
  // projection threshold), check for a settled bracket from the most recently completed season
  // instead of just showing "not unlocked yet" over a postseason that already happened.
  useEffect(() => {
    if (!picture || picture.showBracket) return;
    recApi.getNflPlayoffBracketSnapshot(guildId)
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, [guildId, picture]);

  return (
    <div className="nfl-bracket-page">
      <PageHeader title="Playoff Bracket" subtitle="Real NFL seeding computed automatically from your league's standings — reseeds live as every round plays out." />
      {error && <ErrorState message={error} />}
      {!picture && !error && <LoadingState label="Loading the playoff picture…" />}

      {picture && !picture.showBracket && snapshot === undefined && <LoadingState label="Checking for a settled bracket…" />}

      {picture && !picture.showBracket && snapshot === null && (
        <Card><p className="nfl-bracket-empty">The playoff picture unlocks starting Week 12 of the regular season, once there's enough of a season to project seeding from.</p></Card>
      )}

      {picture && !picture.showBracket && snapshot && (
        <>
          <div className="nfl-bracket-meta">
            <span className="is-live">● Final — Season {snapshot.seasonNumber}</span>
          </div>
          <Card><DesktopBracket picture={snapshot.picture} /></Card>
          <p className="nfl-bracket-legend">
            This season's postseason is complete. The next live playoff picture unlocks starting
            Week 12 of the new regular season.
          </p>
        </>
      )}

      {picture && picture.showBracket && (
        <>
          <div className="nfl-bracket-meta">
            {picture.isLiveProjection ? <span className="is-live">● Live Projection</span> : <span className="is-live">● Postseason</span>}
            <span>Week {picture.league.currentWeek}</span>
          </div>

          <Card><DesktopBracket picture={picture} /></Card>

          <Card>
            <h2 style={{ marginTop: 0 }}>Standings</h2>
            <StandingsPanel picture={picture} />
          </Card>

          <p className="nfl-bracket-legend">
            Seven teams per conference — the No. 1 seed gets the first-round bye, and each
            conference reseeds (lowest surviving seed vs. highest) after every round.
          </p>
        </>
      )}
    </div>
  );
}
