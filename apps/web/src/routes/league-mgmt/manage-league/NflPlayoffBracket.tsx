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
    <svg className="nfl-bracket-trophy" viewBox="0 0 64 92" aria-hidden="true">
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
      <ellipse cx="32" cy="18" rx="13" ry="18" transform="rotate(-18 32 18)" fill="url(#nflBracketSilverBall)" stroke="#6b7078" strokeWidth="1.5" />
      <path d="M22 6c8 4 16 15 20 27M19 13l24 9M18 22l22 8" stroke="#737983" strokeWidth="1.4" fill="none" opacity=".85" />
      <path d="M33 34L23 76M40 31L34 78M28 35L29 77" stroke="url(#nflBracketSilverRod)" strokeWidth="5" strokeLinecap="round" />
      <path d="M16 78h32l7 10H9z" fill="url(#nflBracketSilverRod)" stroke="#676c74" strokeWidth="1.5" />
      <rect x="6" y="87" width="52" height="5" rx="2" fill="#bfc4ca" />
    </svg>
  );
}

function TbdSlot({ label }: { label: string }) {
  return <div className="nfl-bracket-tbd">{label}</div>;
}

/** One side's column stack (bye row + wild card, or a TBD placeholder for a round that hasn't
 * been decided yet) -- pinned to an explicit grid column/row so it can't drift the way the old
 * pure-DOM-order auto-placement did (that's what produced the scattered/duplicated-looking
 * layout: the grid template had 9 columns but rows never contained 9 real elements, so nothing
 * lined up with its round label above it). */
function RoundColumn({ column, matchups, tag, bye, tbdLabel }: {
  column: number; matchups: NflPlayoffMatchup[]; tag: string; bye?: { team: NflTeamSummary } | null; tbdLabel?: string;
}) {
  if (tbdLabel) return <div className="nfl-bracket-matchup-group" style={{ gridColumn: column, gridRow: 2 }}><TbdSlot label={tbdLabel} /></div>;
  return (
    <div className="nfl-bracket-matchup-group" style={{ gridColumn: column, gridRow: 2 }}>
      {bye ? <div className="nfl-bracket-bye"><TeamBadge team={bye.team} size={24} /><span><strong>{bye.team.name}</strong> — first-round bye</span></div> : null}
      {matchups.map((m, i) => <MatchupBlock key={i} matchup={m} tag={tag} />)}
    </div>
  );
}

export function DesktopBracket({ picture }: { picture: NflPlayoffPicture }) {
  const byRound = new Map(picture.rounds.map((r) => [r.round, r.matchups]));
  const afc = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round) ?? []).filter((m) => m.conference === "AFC");
  const nfc = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round) ?? []).filter((m) => m.conference === "NFC");
  const superBowl = (byRound.get("super_bowl") ?? [])[0] ?? null;
  // A round with zero matchups either hasn't been decided into yet (the round before it isn't
  // finished) or genuinely has nothing to show (e.g. super_bowl before conference championships
  // exist) -- either way, "not populated yet" rather than blank, so it doesn't read as broken.
  const decidedInto = (round: NflPlayoffPicture["rounds"][number]["round"]) => (byRound.get(round)?.length ?? 0) > 0;

  const bye = (matchups: NflPlayoffMatchup[], conference: "AFC" | "NFC") => {
    const seeded = new Set(matchups.flatMap((m) => [m.homeSeed, m.awaySeed]));
    return picture.conferences.find((c) => c.conference === conference)?.seeds.find((s) => s.seed === 1 && !seeded.has(1)) ?? null;
  };
  const afcWildCard = afc("wild_card");
  const nfcWildCard = nfc("wild_card");
  const afcBye = bye(afcWildCard, "AFC");
  const nfcBye = bye(nfcWildCard, "NFC");

  return (
    <div className="nfl-bracket">
      <div className="nfl-bracket-round-label" style={{ gridColumn: 1, gridRow: 1 }}>Wild Card</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: 2, gridRow: 1 }}>Divisional</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: 3, gridRow: 1 }}>Conference</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: 5, gridRow: 1 }}>Conference</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: 6, gridRow: 1 }}>Divisional</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: 7, gridRow: 1 }}>Wild Card</div>

      <RoundColumn column={1} matchups={afcWildCard} tag="AFC · Wild Card" bye={afcBye} />
      <RoundColumn column={2} matchups={afc("divisional")} tag="AFC Divisional" tbdLabel={decidedInto("divisional") ? undefined : "TBD"} />
      <RoundColumn column={3} matchups={afc("conference_championship")} tag="AFC Championship" tbdLabel={decidedInto("conference_championship") ? undefined : "TBD"} />

      <div className="nfl-bracket-center" style={{ gridColumn: 4, gridRow: "1 / 3" }}>
        <div className="nfl-bracket-trophy-wrap"><TrophyIcon /></div>
        <div className="nfl-bracket-sb-label">Super Bowl</div>
        {superBowl ? (
          <div className="nfl-bracket-sb-matchup">
            <TeamRow team={superBowl.homeTeam} seed={superBowl.homeSeed} score={superBowl.homeScore} isWinner={superBowl.winnerTeamId === superBowl.homeTeam.teamId} isDecided={superBowl.status === "completed"} />
            <TeamRow team={superBowl.awayTeam} seed={superBowl.awaySeed} score={superBowl.awayScore} isWinner={superBowl.winnerTeamId === superBowl.awayTeam.teamId} isDecided={superBowl.status === "completed"} />
          </div>
        ) : <TbdSlot label="TBD" />}
        {picture.champion && (
          <div className="nfl-bracket-champion-banner">
            Champion
            <strong>{picture.champion.name}</strong>
          </div>
        )}
      </div>

      <RoundColumn column={5} matchups={nfc("conference_championship")} tag="NFC Championship" tbdLabel={decidedInto("conference_championship") ? undefined : "TBD"} />
      <RoundColumn column={6} matchups={nfc("divisional")} tag="NFC Divisional" tbdLabel={decidedInto("divisional") ? undefined : "TBD"} />
      <RoundColumn column={7} matchups={nfcWildCard} tag="NFC · Wild Card" bye={nfcBye} />
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
      {isCommissioner && (
        <button type="button" className="nfl-bracket-mgmt-link" onClick={() => navigate("/league-mgmt")}>
          League Management
        </button>
      )}
    </div>
  );
}
