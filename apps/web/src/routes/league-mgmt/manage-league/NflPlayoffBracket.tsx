import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { useHubChrome } from "../../../lib/hub-chrome-context.js";
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

// A team's `division` field sometimes already carries its conference prefix ("AFC West") and
// sometimes doesn't (just "West") depending on how the league's team data was seeded -- render
// whichever shape it is without ever duplicating the conference ("AFC AFC West").
function divisionLabel(team: NflTeamSummary): string {
  const division = team.division?.trim() ?? "";
  if (!division) return team.conference;
  return division.toUpperCase().startsWith(team.conference.toUpperCase()) ? division : `${team.conference} ${division}`;
}

function TeamRow({ team, seed, score, isWinner, isDecided }: {
  team: NflTeamSummary; seed: number; score: number | null; isWinner: boolean; isDecided: boolean;
}) {
  return (
    <div className={`nfl-bracket-team-row${isDecided ? (isWinner ? " is-winner" : " is-loser") : ""}`} style={teamColorStyle(team)}>
      <span className="nfl-bracket-seed">{seed}</span>
      <TeamBadge team={team} />
      <span className="nfl-bracket-name">
        <span className="nfl-bracket-name-text" title={team.name}>{team.name}</span>
        <span className="nfl-bracket-record">{divisionLabel(team)}</span>
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
  return <img className="nfl-bracket-trophy" src="/assets/nfl-playoff-bracket/lombardi.png" alt="Lombardi Trophy" />;
}

function TbdSlot({ label, gridColumn, gridRow }: { label: string; gridColumn: number; gridRow: string }) {
  return <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}><div className="nfl-bracket-tbd">{label}</div></div>;
}

/** The #1 seed's own card, styled like every other matchup box -- it sits IN the divisional
 * round's slot as that game's already-known participant (the other slot fills in once the
 * wild-card game beneath it is decided), not as a disconnected pill floating above the bracket. */
function ByeCard({ team, gridColumn, gridRow }: { team: NflTeamSummary; gridColumn: number; gridRow: string }) {
  return (
    <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}>
      <div className="nfl-bracket-matchup">
        <span className="nfl-bracket-tag is-bye">First-Round Bye</span>
        <TeamRow team={team} seed={1} score={null} isWinner={false} isDecided={false} />
      </div>
    </div>
  );
}

function MatchupSlot({ matchup, tag, gridColumn, gridRow, tbdLabel }: {
  matchup: NflPlayoffMatchup | null; tag: string; gridColumn: number; gridRow: string; tbdLabel?: string;
}) {
  if (!matchup) return <TbdSlot label={tbdLabel ?? "TBD"} gridColumn={gridColumn} gridRow={gridRow} />;
  return <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}><MatchupBlock matchup={matchup} tag={tag} /></div>;
}

/** One conference's full side of the bracket: 4 wild-card-round slots (the #1 seed's bye plus
 * its 3 wild-card games, ordered by seed) stacked in a shared 4-row track, with the 2 divisional
 * games and the conference championship centered across the wild-card slot(s) that feed them --
 * exactly the classic broadcast-bracket shape (bye card sits directly across from the divisional
 * game it plays into, not above the bracket as a separate element). */
function ConferenceSide({ picture, conference, columns }: {
  picture: NflPlayoffPicture; conference: "AFC" | "NFC"; columns: { wildCard: number; divisional: number; conference: number };
}) {
  const byRound = new Map(picture.rounds.map((r) => [r.round, r.matchups]));
  const decidedInto = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round)?.length ?? 0) > 0;
  const forConf = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round) ?? []).filter((m) => m.conference === conference);

  const wildCard = [...forConf("wild_card")].sort((a, b) => Math.min(a.homeSeed, a.awaySeed) - Math.min(b.homeSeed, b.awaySeed));
  const seeded = new Set(wildCard.flatMap((m) => [m.homeSeed, m.awaySeed]));
  const byeTeam = picture.conferences.find((c) => c.conference === conference)?.seeds.find((s) => s.seed === 1 && !seeded.has(1))?.team ?? null;
  const divisional = forConf("divisional");
  const championship = forConf("conference_championship")[0] ?? null;
  const divisionalTbd = decidedInto("divisional") ? undefined : "TBD";
  const championshipTbd = decidedInto("conference_championship") ? undefined : "TBD";
  const tag = `${conference} ·`;

  return (
    <>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.wildCard, gridRow: 1 }}>Wild Card</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.divisional, gridRow: 1 }}>Divisional</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.conference, gridRow: 1 }}>Conference</div>

      {byeTeam
        ? <ByeCard team={byeTeam} gridColumn={columns.wildCard} gridRow="2" />
        : <TbdSlot label="TBD" gridColumn={columns.wildCard} gridRow="2" />}
      <MatchupSlot matchup={wildCard[0] ?? null} tag={`${tag} Wild Card`} gridColumn={columns.wildCard} gridRow="3" />
      <MatchupSlot matchup={wildCard[1] ?? null} tag={`${tag} Wild Card`} gridColumn={columns.wildCard} gridRow="4" />
      <MatchupSlot matchup={wildCard[2] ?? null} tag={`${tag} Wild Card`} gridColumn={columns.wildCard} gridRow="5" />

      <MatchupSlot matchup={divisional[0] ?? null} tag={`${tag} Divisional`} gridColumn={columns.divisional} gridRow="2 / 4" tbdLabel={divisionalTbd} />
      <MatchupSlot matchup={divisional[1] ?? null} tag={`${tag} Divisional`} gridColumn={columns.divisional} gridRow="4 / 6" tbdLabel={divisionalTbd} />

      <MatchupSlot matchup={championship} tag={`${tag} Championship`} gridColumn={columns.conference} gridRow="2 / 6" tbdLabel={championshipTbd} />
    </>
  );
}

export function DesktopBracket({ picture }: { picture: NflPlayoffPicture }) {
  const byRound = new Map(picture.rounds.map((r) => [r.round, r.matchups]));
  const superBowl = (byRound.get("super_bowl") ?? [])[0] ?? null;

  return (
    <div className="nfl-bracket">
      <ConferenceSide picture={picture} conference="AFC" columns={{ wildCard: 1, divisional: 2, conference: 3 }} />

      <div className="nfl-bracket-center" style={{ gridColumn: 4, gridRow: "2 / 6" }}>
        <div className="nfl-bracket-trophy-wrap"><TrophyIcon /></div>
        <div className="nfl-bracket-sb-label">Super Bowl</div>
        {superBowl ? (
          <div className="nfl-bracket-sb-matchup">
            <TeamRow team={superBowl.homeTeam} seed={superBowl.homeSeed} score={superBowl.homeScore} isWinner={superBowl.winnerTeamId === superBowl.homeTeam.teamId} isDecided={superBowl.status === "completed"} />
            <TeamRow team={superBowl.awayTeam} seed={superBowl.awaySeed} score={superBowl.awayScore} isWinner={superBowl.winnerTeamId === superBowl.awayTeam.teamId} isDecided={superBowl.status === "completed"} />
          </div>
        ) : <div className="nfl-bracket-tbd">TBD</div>}
        {picture.champion && (
          <div className="nfl-bracket-champion-banner">
            Champion
            <strong>{picture.champion.name}</strong>
          </div>
        )}
      </div>

      <ConferenceSide picture={picture} conference="NFC" columns={{ wildCard: 7, divisional: 6, conference: 5 }} />
    </div>
  );
}

export function NflPlayoffBracket() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showStandingsBack = location.pathname.includes("/playoff-bracket") && !location.pathname.includes("/mgmt/");
  const isCommissioner = useHubChrome().currentLeague?.isCommissioner ?? false;
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
      {showStandingsBack && <button type="button" className="hub-page-back" onClick={() => navigate("../standings")}>← Back to Standings</button>}
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

          <p className="nfl-bracket-legend">
            Seven teams per conference — the No. 1 seed gets the first-round bye, and each
            conference reseeds (lowest surviving seed vs. highest) after every round.
          </p>
        </>
      )}
      {isCommissioner && (
        <button type="button" className="nfl-bracket-mgmt-link" onClick={() => navigate("/league-mgmt")}>
          League Management
        </button>
      )}
    </div>
  );
}
