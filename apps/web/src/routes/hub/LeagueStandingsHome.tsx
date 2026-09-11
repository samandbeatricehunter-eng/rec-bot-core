import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
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

export function LeagueStandingsHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setHubError(cause instanceof Error ? cause.message : "Could not load standings."));
  }, [guildId]);

  const teams = hub?.powerRankings?.teams ?? [];
  // Bracket starts forming once the league crosses the NFL playoff-picture week.
  const bracketAvailable = Number(hub?.league.weekNumber ?? 0) >= 12;

  return (
    <div className="hub-section">
      <PageHeader title="Standings" subtitle="Conference standings and power rankings." />
      {hubError ? <ErrorState message={hubError} /> : !hub ? <LoadingState label="Loading standings…" /> : (
        <>
          <div className="hub-standings-actions">
            <button type="button" onClick={() => navigate(`/l/${hub.league.id}/sos`)}><strong>S.O.S.</strong><span>Strength of Schedule</span></button>
            <button type="button" disabled={!bracketAvailable} title={bracketAvailable ? "Open playoff bracket" : "Playoff bracket unlocks in Week 12"} onClick={() => navigate(`/l/${hub.league.id}/playoff-bracket`)}><strong>Playoff Bracket</strong><span>{bracketAvailable ? "View bracket" : "Unlocks Week 12"}</span></button>
          </div>
          <PlayoffMarkerKey className="hub-standings-key" />
          <Card><h2 style={{ marginTop: 0 }}>Conference Standings</h2><ConferenceStandings teams={teams} /></Card>
          <PowerRankingsCard teams={teams} />
        </>
      )}
    </div>
  );
}
