import { useEffect, useMemo, useState } from "react";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { CfpPostseasonState } from "../../types/api.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { NflPlayoffBracket } from "../league-mgmt/manage-league/NflPlayoffBracket.js";
import { RankChange } from "./HubHome.js";

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
          <table className="hub-standings-table">
            <thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead>
            <tbody>
              {list.map((team) => (
                <tr key={team.teamId}>
                  <td>{team.abbr ?? team.teamName}{team.playoffMarker ? <span className="hub-standings-marker"> {team.playoffMarker}</span> : null}</td>
                  <td>{team.wins}</td>
                  <td>{team.losses}</td>
                  <td>{team.ties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
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
            <span>{team.teamName}{team.playoffMarker ? ` - ${team.playoffMarker}` : ""}</span>
            <small>{team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`} · <RankChange change={team.change} /></small>
          </article>
        ))}
      </div>
      {!teams.length ? <p className="form-hint">Power rankings will appear after the first completed slate.</p> : null}
      {teams.some((team) => team.playoffMarker) ? (
        <p className="hub-stats-playoff-key"><span>X · Playoff berth</span><span>Y · Division secured</span><span>Z · First-round bye</span></p>
      ) : null}
    </Card>
  );
}

/** Read-only CFP rankings + bracket — the commissioner-only editing controls in
 * CfpPostseasonManager (Save Top 25 / Generate Bracket) are intentionally left out. */
function CfpStandingsDrawer({ guildId }: { guildId: string }) {
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
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [bracketOpen, setBracketOpen] = useState(false);
  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setHubError(cause instanceof Error ? cause.message : "Could not load standings."));
  }, [guildId]);

  const isMadden = hub?.league.game?.startsWith("madden") ?? false;
  const teams = hub?.powerRankings?.teams ?? [];

  return (
    <div className="hub-section">
      <PageHeader title="Standings" subtitle="Playoff picture, conference standings, and power rankings." />
      {hubError ? <ErrorState message={hubError} /> : !hub ? <LoadingState label="Loading standings…" /> : (
        <>
          <Card className="hub-standings-drawer">
            <button type="button" className="hub-standings-drawer-toggle" aria-expanded={bracketOpen} onClick={() => setBracketOpen((v) => !v)}>
              <h2 style={{ margin: 0 }}>Playoff Bracket</h2>
              <span>{bracketOpen ? "Hide" : "Show"}</span>
            </button>
            {bracketOpen ? (
              <div className="hub-standings-drawer-body">
                {isMadden ? <NflPlayoffBracket /> : <CfpStandingsDrawer guildId={guildId} />}
              </div>
            ) : null}
          </Card>
          <Card><h2 style={{ marginTop: 0 }}>Conference Standings</h2><ConferenceStandings teams={teams} /></Card>
          <PowerRankingsCard teams={teams} />
        </>
      )}
    </div>
  );
}
