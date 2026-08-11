import { useEffect, useMemo, useState } from "react";
import { formatStatValue, getStatLabel, getStatShortLabel, statCategoriesForPosition, statKeysForCategories, type StatCategory } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Modal } from "../../components/ui/Modal.js";

type StatsResponse = Awaited<ReturnType<typeof recApi.getLeagueStats>>;
type TeamStatsResponse = Awaited<ReturnType<typeof recApi.getLeagueTeamStats>>;
type StatsPlayer = StatsResponse["players"][number];

const ALL_CATEGORIES: StatCategory[] = ["passing", "rushing", "receiving", "defense", "kicking", "punting"];

function label(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Position has no canonical stat category (offensive line) — fall back to whichever raw keys
// this position's players actually have data for, same spirit as the old frequency-based
// column set, just scoped to the current position instead of the whole roster.
function fallbackColumnsForPlayers(players: StatsPlayer[]): string[] {
  const frequency = new Map<string, number>();
  players.forEach((player) => Object.keys(player.stats).forEach((key) => frequency.set(key, (frequency.get(key) ?? 0) + 1)));
  return [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([key]) => key);
}

function columnsForPosition(position: string, players: StatsPlayer[]): string[] {
  if (!position) {
    const keys = statKeysForCategories(ALL_CATEGORIES);
    return keys.length ? keys : fallbackColumnsForPlayers(players);
  }
  const categories = statCategoriesForPosition(position);
  const keys = statKeysForCategories(categories);
  return keys.length ? keys : fallbackColumnsForPlayers(players);
}

function statColumnLabel(key: string): string {
  const short = getStatShortLabel(key);
  return short === key ? label(key) : short;
}

/** Bio + every recorded stat for one player — mirrors the Draft Room's player card, minus the
 * attributes/abilities tabs (this page is about production, not ratings). */
function PlayerStatsModal({ player, onClose }: { player: StatsPlayer; onClose: () => void }) {
  const entries = Object.entries(player.stats).filter(([, value]) => Number(value) !== 0).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Modal title={player.fullName} onClose={onClose}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        {player.photoUrl ? (
          <img src={player.photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-2, #222)", fontWeight: 700 }}>
            {player.position ?? "—"}
          </div>
        )}
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{player.fullName}{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}</p>
          <p className="hub-muted" style={{ margin: 0 }}>{player.position ?? "—"} · {player.teamAbbreviation ?? player.teamName ?? "Free Agent"}{player.devTrait ? ` · ${player.devTrait.replaceAll("_", " ")}` : ""}</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="hub-empty">No recorded stats yet this season.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
          {entries.map(([key, value]) => (
            <div key={key} style={{ padding: "8px 10px", border: "1px solid var(--card-border)", borderRadius: 8 }}>
              <div className="hub-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{getStatLabel(key)}</div>
              <div style={{ fontWeight: 700 }}>{formatStatValue(key, value)}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function PlayerStatsTab({ guildId }: { guildId: string }) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("");
  const [leaderCategory, setLeaderCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);

  useEffect(() => {
    setData(null); setError(null);
    recApi.getLeagueStats({ guildId, teamId: teamId || null, position: position || null })
      .then((response) => {
        setData(response);
        if (!leaderCategory) setLeaderCategory(Object.keys(response.leaders)[0] ?? "");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "League statistics could not be loaded."));
  }, [guildId, teamId, position]);

  const columns = useMemo(() => data ? columnsForPosition(position, data.players) : [], [data, position]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading league statistics…" />;
  const leaders = data.leaders[leaderCategory] ?? [];

  return <>
    <Card>
      <h2 style={{ marginTop: 0 }}>League Leaders</h2>
      <label className="form-field"><span className="form-label">Stat category</span>
        <select className="form-select" value={leaderCategory} onChange={(event) => setLeaderCategory(event.target.value)}>
          {Object.keys(data.leaders).map((key) => <option key={key} value={key}>{getStatLabel(key)}</option>)}
        </select>
      </label>
      {leaders.length ? <div style={{ display: "grid", gap: 8 }}>{leaders.map((leader) => <div key={leader.playerId} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 12, alignItems: "center", borderBottom: "1px solid var(--card-border)", padding: "8px 0" }}>
        <strong>#{leader.rank}</strong><span><strong>{leader.playerName}</strong><small style={{ display: "block" }}>{leader.teamAbbreviation ?? leader.teamName ?? "Free Agent"} · {leader.position ?? "—"}</small></span><strong>{formatStatValue(leaderCategory, leader.value)}</strong>
      </div>)}</div> : <p className="form-hint">No approved or imported stats are available for this category yet.</p>}
    </Card>
    <Card>
      <h2 style={{ marginTop: 0 }}>Player Season Stats</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        <label className="form-field"><span className="form-label">Team</span><select className="form-select" value={teamId} onChange={(event) => { setTeamId(event.target.value); }}><option value="">All teams</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label className="form-field"><span className="form-label">Position</span><select className="form-select" value={position} onChange={(event) => setPosition(event.target.value)}><option value="">All positions</option>{data.positions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%", minWidth: 760 }}><thead><tr><th>Player</th><th>Team</th><th>Pos</th>{columns.map((key) => <th key={key} title={getStatLabel(key)}>{statColumnLabel(key)}</th>)}</tr></thead><tbody>
        {data.players.map((player) => <tr key={player.id}>
          <td>
            <button type="button" style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={() => setOpenPlayer(player)}>
              {player.photoUrl ? <img src={player.photoUrl} alt="" loading="lazy" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--surface-2, #222)", fontSize: 10 }}>{player.position ?? "—"}</span>}
              <strong>{player.fullName}</strong>{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}
            </button>
          </td>
          <td>{player.teamAbbreviation ?? player.teamName ?? "FA"}</td>
          <td>{player.position ?? "—"}</td>
          {columns.map((key) => <td key={key}>{formatStatValue(key, player.stats[key] ?? 0)}</td>)}
        </tr>)}
      </tbody></table></div>
      {!data.players.length && <p className="form-hint">No players match these filters.</p>}
    </Card>
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </>;
}

const TEAM_OFFENSE_COLUMNS = ["points_for", "total_offense_yards", "team_pass_yards", "team_rush_yards", "first_downs", "turnovers"];
const TEAM_DEFENSE_COLUMNS = ["points_allowed", "total_yards_allowed", "pass_yards_allowed", "rush_yards_allowed", "takeaways"];

function TeamStatsTab({ guildId }: { guildId: string }) {
  const [data, setData] = useState<TeamStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState("");
  const [groupBy, setGroupBy] = useState<"conference" | "division">("conference");

  useEffect(() => {
    setData(null); setError(null);
    recApi.getLeagueTeamStats(guildId).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "Team statistics could not be loaded."));
  }, [guildId]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading team statistics…" />;

  const groups = new Map<string, TeamStatsResponse["teams"]>();
  for (const team of data.teams) {
    const key = (groupBy === "conference" ? team.conference : team.division) || "Ungrouped";
    const list = groups.get(key) ?? [];
    list.push(team);
    groups.set(key, list);
  }

  const selectedTeam = teamId ? data.teams.find((t) => t.id === teamId) ?? null : null;

  return <Card>
    <h2 style={{ marginTop: 0 }}>Team Stats</h2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
      <label className="form-field"><span className="form-label">Team</span>
        <select className="form-select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">All Teams</option>
          {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      {!teamId && (
        <label className="form-field"><span className="form-label">Group by</span>
          <select className="form-select" value={groupBy} onChange={(event) => setGroupBy(event.target.value as "conference" | "division")}>
            <option value="conference">Conference</option>
            <option value="division">Division</option>
          </select>
        </label>
      )}
    </div>

    {selectedTeam ? (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h3 style={{ marginBottom: 8 }}>Offense</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
            {TEAM_OFFENSE_COLUMNS.map((key) => (
              <div key={key} style={{ padding: "8px 10px", border: "1px solid var(--card-border)", borderRadius: 8 }}>
                <div className="hub-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{getStatLabel(key)}</div>
                <div style={{ fontWeight: 700 }}>{formatStatValue(key, selectedTeam.stats[key] ?? 0)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Defense</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
            {TEAM_DEFENSE_COLUMNS.map((key) => (
              <div key={key} style={{ padding: "8px 10px", border: "1px solid var(--card-border)", borderRadius: 8 }}>
                <div className="hub-muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{getStatLabel(key)}</div>
                <div style={{ fontWeight: 700 }}>{formatStatValue(key, selectedTeam.stats[key] ?? 0)}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="hub-muted">{formatStatValue("games_played", selectedTeam.stats.games_played ?? 0)} games played this season.</p>
      </div>
    ) : (
      [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupLabel, teams]) => (
        <div key={groupLabel} style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>{groupLabel}</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 720 }}>
              <thead><tr><th>Team</th>{[...TEAM_OFFENSE_COLUMNS, ...TEAM_DEFENSE_COLUMNS].map((key) => <th key={key} title={getStatLabel(key)}>{statColumnLabel(key)}</th>)}</tr></thead>
              <tbody>
                {teams.sort((a, b) => (b.stats.points_for ?? 0) - (a.stats.points_for ?? 0)).map((team) => (
                  <tr key={team.id}>
                    <td><button type="button" style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => setTeamId(team.id)}><strong>{team.name}</strong></button></td>
                    {[...TEAM_OFFENSE_COLUMNS, ...TEAM_DEFENSE_COLUMNS].map((key) => <td key={key}>{formatStatValue(key, team.stats[key] ?? 0)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))
    )}
  </Card>;
}

export function LeagueStatsHome() {
  const { guildId } = useReadyAuth();
  const [tab, setTab] = useState<"player" | "team">("player");

  return <div className="hub-section">
    <PageHeader title="League Stats" subtitle="Player production and team totals for the current season." />
    <div className="rec-matchup-tabs" role="tablist" aria-label="Stats view">
      <button type="button" role="tab" aria-selected={tab === "player"} className={tab === "player" ? "active" : ""} onClick={() => setTab("player")}>Player Stats</button>
      <button type="button" role="tab" aria-selected={tab === "team"} className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}>Team Stats</button>
    </div>
    {tab === "player" ? <PlayerStatsTab guildId={guildId} /> : <TeamStatsTab guildId={guildId} />}
  </div>;
}
