import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { CfpPostseasonState } from "../../types/api.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { RankChange } from "./HubHome.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";

type HubResponse = Awaited<ReturnType<typeof recApi.getHub>>;
type PowerRankingTeam = NonNullable<HubResponse["powerRankings"]>["teams"][number];

/** Groups the same hub.powerRankings feed the Stats page already renders by conference —
 * works for both Madden (real NFL conferences) and CFB (college conferences) without any new
 * backend endpoint, since every power-ranked team already carries wins/losses/ties/conference. */
function useConferenceStandings(teams: PowerRankingTeam[]) {
  return useMemo(() => {
    const groups = new Map<string, PowerRankingTeam[]>();
    for (const team of teams) {
      const key = team.conference ?? "Independents";
      const list = groups.get(key) ?? [];
      list.push(team);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const winPct = (t: PowerRankingTeam) => {
          const games = t.wins + t.losses + t.ties;
          return games ? (t.wins + t.ties * 0.5) / games : 0;
        };
        return winPct(b) - winPct(a) || b.wins - a.wins;
      });
    }
    const conferenceSortKey = (conference: string) => {
      const idx = (CONFERENCE_ORDER as readonly string[]).indexOf(conference);
      return idx === -1 ? CONFERENCE_ORDER.length : idx;
    };
    return [...groups.entries()].sort(([a], [b]) => conferenceSortKey(a) - conferenceSortKey(b) || a.localeCompare(b));
  }, [teams]);
}

function ConferenceStandings({ teams }: { teams: PowerRankingTeam[] }) {
  const grouped = useConferenceStandings(teams);
  if (!teams.length) return <p className="form-hint">Standings will appear after the first completed slate.</p>;
  return (
    <div className="hub-standings-conference-grid">
      {grouped.map(([conference, list]) => (
        <section key={conference} className="hub-standings-conference">
          <h3>{conference}</h3>
          <div className="hub-standings-rows">
            {list.map((team, index) => (
              <div key={team.teamId} className={`hub-standings-row${team.playoffMarker === "Y" || team.playoffMarker === "Z" ? " is-division-leader" : ""}`}>
                <span className="hub-standings-seed">{index + 1}</span>
                <TeamLogo abbreviation={team.abbr} alt={team.teamName} />
                <span className="hub-standings-name">{team.teamName}{team.playoffMarker ? <span className="hub-standings-marker"> {team.playoffMarker}</span> : null}{!team.isHuman ? <span className="hub-standings-open-pill">Open</span> : null}</span>
                <span className="hub-standings-record">{team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlayoffMarkerKey({ className }: { className: string }) {
  return (
    <p className={className}><span>X · Playoff berth</span><span>Y · Division secured</span><span>Z · First-round bye</span></p>
  );
}

function PowerRankingsCard({ teams }: { teams: PowerRankingTeam[] }) {
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Power Rankings</h2>
      <div className="hub-stats-power-grid">
        {teams.map((team) => (
          <article key={team.teamId}>
            <strong>#{team.rank}</strong>
            <span className="hub-team-cell"><TeamLogo abbreviation={team.abbr} alt={team.teamName} /><span>{team.teamName}{team.playoffMarker ? ` - ${team.playoffMarker}` : ""}</span></span>
            <small>{team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`} · <RankChange change={team.change} /></small>
          </article>
        ))}
      </div>
      {!teams.length ? <p className="form-hint">Power rankings will appear after the first completed slate.</p> : null}
      <PlayoffMarkerKey className="hub-stats-playoff-key" />
    </Card>
  );
}

/** Read-only CFP rankings + bracket — the commissioner-only editing controls in
 * CfpPostseasonManager (Save Top 25 / Generate Bracket) are intentionally left out. */
export function CfpStandingsDrawer({ guildId }: { guildId: string }) {
  const [state, setState] = useState<CfpPostseasonState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    recApi.getCfpPostseason(guildId).then(setState).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the CFP postseason."));
  }, [guildId]);

  if (error) return <ErrorState message={error} />;
  if (!state) return <LoadingState label="Loading postseason bracket…" />;

  const rounds = ["first_round", "quarterfinal", "semifinal", "championship"] as const;
  const roundLabel: Record<(typeof rounds)[number], string> = {
    first_round: "First Round", quarterfinal: "Quarterfinals", semifinal: "Semifinals", championship: "Championship",
  };

  return (
    <div className="hub-standings-bracket">
      {state.rankings.length ? (
        <ol className="hub-standings-poll">
          {state.rankings.slice(0, 25).map((team) => (
            <li key={team.team_id}>#{team.rank} {team.name} {team.conference_champion ? <span className="hub-standings-marker">Conf. Champ</span> : null}</li>
          ))}
        </ol>
      ) : <p className="form-hint">The Top 25 has not been released yet.</p>}
      {rounds.map((round) => {
        const games = state.bracket.filter((game) => game.round === round);
        if (!games.length) return null;
        return (
          <section key={round} className="hub-standings-bracket-round">
            <h3>{roundLabel[round]}</h3>
            {games.map((game) => (
              <div key={game.id} className="hub-standings-bracket-game">
                <span>{game.bowl_name ? `${game.bowl_name} — ` : ""}{game.away_seed ? `(${game.away_seed}) ` : ""}{game.away_team_name ?? "TBD"} @ {game.home_seed ? `(${game.home_seed}) ` : ""}{game.home_team_name ?? "TBD"}</span>
                {game.game_status === "completed" ? <strong>{game.away_score}–{game.home_score}</strong> : null}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function LeagueStandingsHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [cfpTop25Locked, setCfpTop25Locked] = useState(false);
  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setHubError(cause instanceof Error ? cause.message : "Could not load standings."));
  }, [guildId]);

  const isMadden = hub?.league.game?.startsWith("madden") ?? false;
  useEffect(() => {
    if (!hub || isMadden) return;
    recApi.getCfpPostseason(guildId).then((state) => setCfpTop25Locked(state.top25Locked)).catch(() => setCfpTop25Locked(false));
  }, [guildId, hub, isMadden]);

  const teams = hub?.powerRankings?.teams ?? [];
  // Madden's bracket starts forming once the league crosses the NFL playoff-picture week
  // (week 12); CFB has no equivalent week number (its postseason schedule runs a totally
  // different week range), so it gates on the Top 25 actually being released instead --
  // that's the real "a bracket is starting to form" signal for CFP.
  const bracketAvailable = isMadden ? Number(hub?.league.weekNumber ?? 0) >= 12 : cfpTop25Locked;

  return (
    <div className="hub-section">
      <PageHeader title="Standings" subtitle="Conference standings and power rankings." />
      {hubError ? <ErrorState message={hubError} /> : !hub ? <LoadingState label="Loading standings…" /> : (
        <>
          <div className="hub-standings-actions">
            <button type="button" onClick={() => navigate(`/l/${hub.league.id}/sos`)}><strong>S.O.S.</strong><span>Strength of Schedule</span></button>
            <button type="button" disabled={!bracketAvailable} title={bracketAvailable ? "Open playoff bracket" : isMadden ? "Playoff bracket unlocks in Week 12" : "Playoff bracket unlocks once the Top 25 is released"} onClick={() => navigate(`/l/${hub.league.id}/playoff-bracket`)}><strong>Playoff Bracket</strong><span>{bracketAvailable ? "View bracket" : isMadden ? "Unlocks Week 12" : "Unlocks at Top 25"}</span></button>
          </div>
          <PlayoffMarkerKey className="hub-standings-key" />
          <Card><h2 style={{ marginTop: 0 }}>Conference Standings</h2><ConferenceStandings teams={teams} /></Card>
          <PowerRankingsCard teams={teams} />
        </>
      )}
    </div>
  );
}
