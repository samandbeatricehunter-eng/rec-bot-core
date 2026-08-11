import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

type StatsResponse = Awaited<ReturnType<typeof recApi.getLeagueStats>>;

function label(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function LeagueStatsHome() {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("");
  const [leaderCategory, setLeaderCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setError(null);
    recApi.getLeagueStats({ guildId, teamId: teamId || null, position: position || null })
      .then((response) => {
        setData(response);
        if (!leaderCategory) setLeaderCategory(Object.keys(response.leaders)[0] ?? "");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "League statistics could not be loaded."));
  }, [guildId, teamId, position]);

  const columns = useMemo(() => {
    if (!data) return [];
    const frequency = new Map<string, number>();
    data.players.forEach((player) => Object.keys(player.stats).forEach((key) => frequency.set(key, (frequency.get(key) ?? 0) + 1)));
    return [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16).map(([key]) => key);
  }, [data]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading league statistics…" />;
  const leaders = data.leaders[leaderCategory] ?? [];
  return <div className="hub-section">
    <PageHeader title="League Stats" subtitle={`${data.league.name} · Season ${data.league.season_number}`} />
    <Card>
      <h2 style={{ marginTop: 0 }}>League Leaders</h2>
      <label className="form-field"><span className="form-label">Stat category</span>
        <select className="form-select" value={leaderCategory} onChange={(event) => setLeaderCategory(event.target.value)}>
          {Object.keys(data.leaders).map((key) => <option key={key} value={key}>{label(key)}</option>)}
        </select>
      </label>
      {leaders.length ? <div style={{ display: "grid", gap: 8 }}>{leaders.map((leader) => <div key={leader.playerId} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 12, alignItems: "center", borderBottom: "1px solid var(--card-border)", padding: "8px 0" }}>
        <strong>#{leader.rank}</strong><span><strong>{leader.playerName}</strong><small style={{ display: "block" }}>{leader.teamAbbreviation ?? leader.teamName ?? "Free Agent"} · {leader.position ?? "—"}</small></span><strong>{Number(leader.value).toLocaleString()}</strong>
      </div>)}</div> : <p className="form-hint">No approved or imported stats are available for this category yet.</p>}
    </Card>
    <Card>
      <h2 style={{ marginTop: 0 }}>Player Season Stats</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        <label className="form-field"><span className="form-label">Team</span><select className="form-select" value={teamId} onChange={(event) => { setTeamId(event.target.value); setPosition(""); }}><option value="">All teams</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label className="form-field"><span className="form-label">Position</span><select className="form-select" value={position} onChange={(event) => setPosition(event.target.value)}><option value="">All positions</option>{data.positions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%", minWidth: 760 }}><thead><tr><th>Player</th><th>Team</th><th>Pos</th>{columns.map((key) => <th key={key}>{label(key)}</th>)}</tr></thead><tbody>
        {data.players.map((player) => <tr key={player.id}><td><strong>{player.fullName}</strong>{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}</td><td>{player.teamAbbreviation ?? player.teamName ?? "FA"}</td><td>{player.position ?? "—"}</td>{columns.map((key) => <td key={key}>{Number(player.stats[key] ?? 0).toLocaleString()}</td>)}</tr>)}
      </tbody></table></div>
      {!data.players.length && <p className="form-hint">No players match these filters.</p>}
    </Card>
  </div>;
}
