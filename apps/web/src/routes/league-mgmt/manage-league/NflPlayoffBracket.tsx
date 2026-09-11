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

function teamColorStyle(team: NflTeamSummary): CSSProperties {
  return team.primaryColor ? ({ "--team": team.primaryColor } as CSSProperties) : {};
}

function teamShort(team: NflTeamSummary): string {
  if (team.abbreviation?.trim()) return team.abbreviation.trim().toUpperCase();
  const parts = team.name.trim().split(/\s+/);
  return (parts[parts.length - 1] || "TEAM").toUpperCase();
}

function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

function matchupResultLine(matchup: NflPlayoffMatchup): string | null {
  if (matchup.status !== "completed" || matchup.homeScore == null || matchup.awayScore == null || !matchup.winnerTeamId) {
    return null;
  }
  const winner = matchup.winnerTeamId === matchup.homeTeam.teamId ? matchup.homeTeam : matchup.awayTeam;
  const high = Math.max(matchup.homeScore, matchup.awayScore);
  const low = Math.min(matchup.homeScore, matchup.awayScore);
  return `${teamShort(winner)} WIN ${high}-${low}`;
}

function TeamTile({ team, seed, side, isWinner, isDecided }: {
  team: NflTeamSummary;
  seed: number;
  side: "left" | "right";
  isWinner: boolean;
  isDecided: boolean;
}) {
  return (
    <div
      className={`nfl-bracket-team-tile is-${side}${isDecided ? (isWinner ? " is-winner" : " is-loser") : ""}`}
      style={teamColorStyle(team)}
    >
      {side === "left" ? <span className="nfl-bracket-seed">{seed}</span> : null}
      <div className="nfl-bracket-logo-box" title={team.name}>
        <TeamLogo abbreviation={team.abbreviation} logoUrl={team.logoUrl} alt={team.name} className="nfl-bracket-logo" priority />
      </div>
      {side === "right" ? <span className="nfl-bracket-seed">{seed}</span> : null}
    </div>
  );
}

function MatchupBlock({ matchup, side }: { matchup: NflPlayoffMatchup; side: "left" | "right" }) {
  const decided = matchup.status === "completed";
  const result = matchupResultLine(matchup);
  return (
    <div className="nfl-bracket-matchup" data-round={matchup.conference}>
      <TeamTile
        team={matchup.homeTeam}
        seed={matchup.homeSeed}
        side={side}
        isWinner={matchup.winnerTeamId === matchup.homeTeam.teamId}
        isDecided={decided}
      />
      <TeamTile
        team={matchup.awayTeam}
        seed={matchup.awaySeed}
        side={side}
        isWinner={matchup.winnerTeamId === matchup.awayTeam.teamId}
        isDecided={decided}
      />
      {result ? <div className="nfl-bracket-result">{result}</div> : null}
    </div>
  );
}

function TbdSlot({ label, gridColumn, gridRow }: { label: string; gridColumn: number; gridRow: string }) {
  return (
    <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}>
      <div className="nfl-bracket-tbd">{label}</div>
    </div>
  );
}

function ByeCard({ team, side, gridColumn, gridRow }: {
  team: NflTeamSummary;
  side: "left" | "right";
  gridColumn: number;
  gridRow: string;
}) {
  return (
    <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}>
      <div className="nfl-bracket-matchup">
        <TeamTile team={team} seed={1} side={side} isWinner={false} isDecided={false} />
        <div className="nfl-bracket-result is-bye">FIRST-ROUND BYE</div>
      </div>
    </div>
  );
}

function MatchupSlot({ matchup, side, gridColumn, gridRow, tbdLabel }: {
  matchup: NflPlayoffMatchup | null;
  side: "left" | "right";
  gridColumn: number;
  gridRow: string;
  tbdLabel?: string;
}) {
  if (!matchup) return <TbdSlot label={tbdLabel ?? "TBD"} gridColumn={gridColumn} gridRow={gridRow} />;
  return (
    <div className="nfl-bracket-matchup-group" style={{ gridColumn, gridRow, alignSelf: "center" }}>
      <MatchupBlock matchup={matchup} side={side} />
    </div>
  );
}

/** One conference side: NFC left / AFC right, matching broadcast bracket column flow. */
function ConferenceSide({ picture, conference, side, columns }: {
  picture: NflPlayoffPicture;
  conference: "AFC" | "NFC";
  side: "left" | "right";
  columns: { wildCard: number; divisional: number; conference: number };
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

  return (
    <>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.wildCard, gridRow: 1 }}>{conference} Wild Card</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.divisional, gridRow: 1 }}>{conference} Divisional</div>
      <div className="nfl-bracket-round-label" style={{ gridColumn: columns.conference, gridRow: 1 }}>{conference} Championship</div>

      {byeTeam
        ? <ByeCard team={byeTeam} side={side} gridColumn={columns.wildCard} gridRow="2" />
        : <TbdSlot label="TBD" gridColumn={columns.wildCard} gridRow="2" />}
      <MatchupSlot matchup={wildCard[0] ?? null} side={side} gridColumn={columns.wildCard} gridRow="3" />
      <MatchupSlot matchup={wildCard[1] ?? null} side={side} gridColumn={columns.wildCard} gridRow="4" />
      <MatchupSlot matchup={wildCard[2] ?? null} side={side} gridColumn={columns.wildCard} gridRow="5" />

      <MatchupSlot matchup={divisional[0] ?? null} side={side} gridColumn={columns.divisional} gridRow="2 / 4" tbdLabel={divisionalTbd} />
      <MatchupSlot matchup={divisional[1] ?? null} side={side} gridColumn={columns.divisional} gridRow="4 / 6" tbdLabel={divisionalTbd} />

      <MatchupSlot matchup={championship} side={side} gridColumn={columns.conference} gridRow="2 / 6" tbdLabel={championshipTbd} />
    </>
  );
}

function PriorChampionshipFooter({ prior }: { prior: NonNullable<NflPlayoffPicture["priorChampionship"]> }) {
  return (
    <footer className="nfl-bracket-prior">
      <div className="nfl-bracket-prior-heading">Season {prior.seasonNumber} Super Bowl</div>
      <div className="nfl-bracket-prior-row">
        <span className="nfl-bracket-prior-label">Winner</span>
        <strong>{prior.winner.name}</strong>
        <span className="nfl-bracket-prior-record">{formatRecord(prior.winnerRecord)}</span>
      </div>
      <div className="nfl-bracket-prior-row">
        <span className="nfl-bracket-prior-label">Runner-up</span>
        <strong>{prior.runnerUp.name}</strong>
        <span className="nfl-bracket-prior-record">{formatRecord(prior.runnerUpRecord)}</span>
      </div>
    </footer>
  );
}

export function DesktopBracket({ picture }: { picture: NflPlayoffPicture }) {
  const byRound = new Map(picture.rounds.map((r) => [r.round, r.matchups]));
  const superBowl = (byRound.get("super_bowl") ?? [])[0] ?? null;
  const leagueName = picture.league.name?.trim() || "League";
  const seasonNumber = picture.league.seasonNumber || 1;
  const sbResult = superBowl ? matchupResultLine(superBowl) : null;

  return (
    <div className="nfl-bracket-board" data-bracket-render-root="">
      <header className="nfl-bracket-board-header">
        <h1>
          <span>{leagueName}</span>
          <span className="nfl-bracket-board-sep">-</span>
          <span>Season {seasonNumber}</span>
          <span className="nfl-bracket-board-sep">-</span>
          <em>PLAYOFFS</em>
        </h1>
      </header>

      <div className="nfl-bracket">
        <ConferenceSide picture={picture} conference="NFC" side="left" columns={{ wildCard: 1, divisional: 2, conference: 3 }} />

        <div className="nfl-bracket-center" style={{ gridColumn: 4, gridRow: "2 / 6" }}>
          <div className="nfl-bracket-sb-label">Super Bowl</div>
          {superBowl ? (
            <div className="nfl-bracket-sb-matchup">
              <TeamTile
                team={superBowl.homeTeam}
                seed={superBowl.homeSeed}
                side="left"
                isWinner={superBowl.winnerTeamId === superBowl.homeTeam.teamId}
                isDecided={superBowl.status === "completed"}
              />
              <TeamTile
                team={superBowl.awayTeam}
                seed={superBowl.awaySeed}
                side="left"
                isWinner={superBowl.winnerTeamId === superBowl.awayTeam.teamId}
                isDecided={superBowl.status === "completed"}
              />
              {sbResult ? <div className="nfl-bracket-result">{sbResult}</div> : null}
            </div>
          ) : <div className="nfl-bracket-tbd">TBD</div>}
          {picture.champion ? (
            <div className="nfl-bracket-champion-banner">
              Champion
              <strong>{picture.champion.name}</strong>
            </div>
          ) : null}
        </div>

        <ConferenceSide picture={picture} conference="AFC" side="right" columns={{ wildCard: 7, divisional: 6, conference: 5 }} />
      </div>

      {picture.priorChampionship ? <PriorChampionshipFooter prior={picture.priorChampionship} /> : null}
    </div>
  );
}

function SeedTile({ team, seed, wide = false }: { team: NflTeamSummary; seed: number; wide?: boolean }) {
  return (
    <div
      className={`nfl-picture-seed-tile${wide ? " is-wide" : ""}`}
      style={team.primaryColor ? ({ "--team": team.primaryColor } as CSSProperties) : undefined}
    >
      <TeamLogo abbreviation={team.abbreviation} logoUrl={team.logoUrl} alt={team.name} className="nfl-picture-seed-logo" priority />
      <strong>{seed} SEED</strong>
    </div>
  );
}

function PictureMatchup({ home, away }: {
  home: { team: NflTeamSummary; seed: number } | null;
  away: { team: NflTeamSummary; seed: number } | null;
}) {
  return (
    <div className="nfl-picture-matchup">
      <div className="nfl-picture-matchup-row">
        {away ? <SeedTile team={away.team} seed={away.seed} /> : <div className="nfl-picture-seed-tile is-empty">TBD</div>}
        <span className="nfl-picture-at">@</span>
        {home ? <SeedTile team={home.team} seed={home.seed} /> : <div className="nfl-picture-seed-tile is-empty">TBD</div>}
      </div>
      <div className="nfl-picture-seed-labels">
        <span>{away ? `${away.seed} SEED` : "—"}</span>
        <span>{home ? `${home.seed} SEED` : "—"}</span>
      </div>
    </div>
  );
}

function conferenceSeeds(picture: NflPlayoffPicture, conference: "AFC" | "NFC") {
  return [...(picture.conferences.find((c) => c.conference === conference)?.seeds ?? [])]
    .sort((a, b) => a.seed - b.seed);
}

/** Broadcast-style playoff picture board (AFC red / NFC blue) used for live projections
 *  and Discord screenshots. Pairings follow NFL wild-card seeding: 2@7, 3@6, 4@5, with #1 bye. */
export function PlayoffPictureBoard({ picture }: { picture: NflPlayoffPicture }) {
  const week = picture.league.currentWeek;
  const afc = conferenceSeeds(picture, "AFC");
  const nfc = conferenceSeeds(picture, "NFC");
  const bySeed = (list: typeof afc, seed: number) => list.find((s) => s.seed === seed) ?? null;
  const pair = (list: typeof afc, homeSeed: number, awaySeed: number) => ({
    home: bySeed(list, homeSeed),
    away: bySeed(list, awaySeed),
  });

  return (
    <div className="nfl-picture-board" data-bracket-render-root="">
      <header className="nfl-picture-header">
        <h1><span>PLAYOFF</span><span>PICTURE</span></h1>
        <p>THROUGH WEEK {week}</p>
      </header>
      <div className="nfl-picture-split">
        <section className="nfl-picture-conf" data-conf="afc">
          <h2>AFC</h2>
          <div className="nfl-picture-section">
            <h3>DIVISIONAL ROUND</h3>
            {bySeed(afc, 1)
              ? <SeedTile team={bySeed(afc, 1)!.team} seed={1} wide />
              : <div className="nfl-picture-seed-tile is-wide is-empty">1 SEED TBD</div>}
          </div>
          <div className="nfl-picture-section">
            <h3>WILD CARD ROUND</h3>
            <div className="nfl-picture-wc-list">
              <PictureMatchup {...pair(afc, 2, 7)} />
              <PictureMatchup {...pair(afc, 3, 6)} />
              <PictureMatchup {...pair(afc, 4, 5)} />
            </div>
          </div>
        </section>
        <section className="nfl-picture-conf" data-conf="nfc">
          <h2>NFC</h2>
          <div className="nfl-picture-section">
            <h3>DIVISIONAL ROUND</h3>
            {bySeed(nfc, 1)
              ? <SeedTile team={bySeed(nfc, 1)!.team} seed={1} wide />
              : <div className="nfl-picture-seed-tile is-wide is-empty">1 SEED TBD</div>}
          </div>
          <div className="nfl-picture-section">
            <h3>WILD CARD ROUND</h3>
            <div className="nfl-picture-wc-list">
              <PictureMatchup {...pair(nfc, 2, 7)} />
              <PictureMatchup {...pair(nfc, 3, 6)} />
              <PictureMatchup {...pair(nfc, 4, 5)} />
            </div>
          </div>
        </section>
      </div>
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

  useEffect(() => {
    if (!picture || picture.showBracket) return;
    recApi.getNflPlayoffBracketSnapshot(guildId)
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, [guildId, picture]);

  const showingDesktop = Boolean(
    (picture && picture.showBracket && !picture.isLiveProjection)
    || (picture && !picture.showBracket && snapshot),
  );

  return (
    <div className="nfl-bracket-page">
      {showStandingsBack && <button type="button" className="hub-page-back" onClick={() => navigate("../standings")}>← Back to Standings</button>}
      {!showingDesktop && (
        <PageHeader title="Playoff Picture" subtitle="Real NFL seeding computed automatically from your league's standings — reseeds live as every round plays out." />
      )}
      {error && <ErrorState message={error} />}
      {!picture && !error && <LoadingState label="Loading the playoff picture…" />}

      {picture && !picture.showBracket && snapshot === undefined && <LoadingState label="Checking for a settled bracket…" />}

      {picture && !picture.showBracket && snapshot === null && (
        <Card><p className="nfl-bracket-empty">The playoff picture unlocks starting Week 12 of the regular season, once there's enough of a season to project seeding from.</p></Card>
      )}

      {picture && !picture.showBracket && snapshot && (
        <>
          <DesktopBracket picture={snapshot.picture} />
          <p className="nfl-bracket-legend">
            This season's postseason is complete. The next live playoff picture unlocks starting
            Week 12 of the new regular season.
          </p>
        </>
      )}

      {picture && picture.showBracket && (
        <>
          {picture.isLiveProjection ? (
            <PlayoffPictureBoard picture={picture} />
          ) : (
            <DesktopBracket picture={picture} />
          )}
          <p className="nfl-bracket-legend">
            {picture.champion
              ? "This season's postseason is complete. The next live playoff picture unlocks starting Week 12 of the new regular season."
              : "Seven teams per conference — the No. 1 seed gets the first-round bye, and each conference reseeds (lowest surviving seed vs. highest) after every round."}
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
