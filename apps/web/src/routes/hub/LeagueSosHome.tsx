import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";

type HubResponse = Awaited<ReturnType<typeof recApi.getHub>>;
type SosTeam = NonNullable<HubResponse["sos"]>["teams"][number];

function SosTable({ title, subtitle, teams, value }: {
  title: string;
  subtitle: string;
  teams: SosTeam[];
  value: (team: SosTeam) => number;
}) {
  const ranked = useMemo(() => [...teams].sort((a, b) => value(b) - value(a) || a.teamName.localeCompare(b.teamName)), [teams, value]);
  return (
    <Card className="hub-sos-card">
      <div className="hub-sos-card-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="hub-sos-table-wrap"><table className="hub-sos-table">
        <thead><tr><th>Rank</th><th>Team</th><th>Score</th><th>Opponent W%</th><th>H / CPU</th></tr></thead>
        <tbody>{ranked.map((team, index) => <tr key={team.teamId}>
          <td>#{index + 1}</td>
          <td><span className="hub-team-cell"><TeamLogo abbreviation={team.abbr} alt={team.teamName} /> <strong>{team.teamName}</strong></span></td>
          <td>{value(team).toFixed(2)}</td>
          <td>{(team.oppRecord * 100).toFixed(1)}%</td>
          <td>{team.humanCount} / {team.cpuCount}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>
  );
}

export function LeagueSosHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load strength of schedule."));
  }, [guildId]);
  const teams = hub?.sos?.teams ?? [];
  return <div className="hub-section hub-dedicated-page">
    <button type="button" className="hub-page-back" onClick={() => navigate(`/l/${hub?.league.id ?? ""}/standings`)}>← Back to Standings</button>
    <PageHeader title="Strength of Schedule" subtitle="Toughest schedule ranks first. Compare the original full-season slate with the games still ahead." />
    {error ? <ErrorState message={error} /> : !hub ? <LoadingState label="Loading strength of schedule…" /> : !teams.length ? (
      <Card><p className="form-hint">Strength of schedule will appear once the season schedule is loaded.</p></Card>
    ) : <div className="hub-sos-grid">
      <SosTable title="Start of Season" subtitle="All scheduled opponents, including completed games." teams={teams} value={(team) => team.sosFull} />
      <SosTable title="Current / Remaining" subtitle="Only unplayed games on each team's remaining schedule." teams={teams} value={(team) => team.sosRemaining} />
    </div>}
  </div>;
}
