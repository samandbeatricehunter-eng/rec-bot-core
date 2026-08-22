import { useEffect, useMemo, useState } from "react";
import {
  displayStatKeysForPageCategory,
  formatStatValue,
  getStatLabel,
  getStatShortLabel,
  positionsForStatPageCategory,
  primaryStatKeyForPageCategory,
  statCategoriesForPosition,
  statKeysForCategories,
  STAT_PAGE_CATEGORIES,
  type StatCategory,
  type StatPageCategoryKey,
} from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Modal } from "../../components/ui/Modal.js";
import { PlayerAvatar } from "../../components/hub/PlayerAvatar.js";
import { LeagueRecordsHome } from "./LeagueRecordsHome.js";
import { LeagueHistoryHome } from "./LeagueHistoryHome.js";
import { FinancialLedger, RankChange } from "./HubHome.js";

type StatsResponse = Awaited<ReturnType<typeof recApi.getLeagueStats>>;
type StatsPlayer = StatsResponse["players"][number];

function label(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Position has no canonical stat category (offensive line) — fall back to whichever raw keys
// this position's players actually have data for, same spirit as the old frequency-based
// column set, just scoped to the current position/category instead of the whole roster.
function fallbackColumnsForPlayers(players: StatsPlayer[]): string[] {
  const frequency = new Map<string, number>();
  players.forEach((player) => Object.keys(player.stats).forEach((key) => frequency.set(key, (frequency.get(key) ?? 0) + 1)));
  return [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([key]) => key);
}

const CATEGORY_TO_PAGE: Partial<Record<StatCategory, StatPageCategoryKey>> = {
  passing: "passing",
  rushing: "rushing",
  receiving: "receiving",
  defense: "defense",
  kicking: "special_teams",
  punting: "special_teams",
  returns: "special_teams",
};

function columnsForPosition(position: string, players: StatsPlayer[]): string[] {
  if (!position) return fallbackColumnsForPlayers(players);
  const pageKeys = [...new Set(statCategoriesForPosition(position).map((category) => CATEGORY_TO_PAGE[category]).filter((key): key is StatPageCategoryKey => Boolean(key)))];
  const keys = [...new Set(pageKeys.flatMap((key) => displayStatKeysForPageCategory(key)))];
  if (keys.length) return keys;
  const fallback = statKeysForCategories(statCategoriesForPosition(position));
  return fallback.length ? fallback : fallbackColumnsForPlayers(players);
}

function columnsForPageCategory(categoryKey: StatPageCategoryKey, players: StatsPlayer[]): string[] {
  const keys = displayStatKeysForPageCategory(categoryKey);
  return keys.length ? keys : fallbackColumnsForPlayers(players);
}

function statColumnLabel(key: string): string {
  const short = getStatShortLabel(key);
  return short === key ? label(key) : short;
}

/** Identity row + a wrapping labeled stat grid (readable on mobile without sideways scrolling). */
function PlayerStatCard({ player, columns, rank, onOpen }: { player: StatsPlayer; columns: string[]; rank?: number; onOpen: () => void }) {
  return (
    <div className="rec-stat-player-card">
      <div className="rec-stat-player-card-head">
        {rank != null && <span className="rec-stat-player-card-rank">#{rank}</span>}
        <button type="button" onClick={onOpen}>
          <PlayerAvatar photoUrl={player.photoUrl} alt="" className="rec-stat-player-card-avatar" />
          <span style={{ minWidth: 0 }}>
            <span className="rec-stat-player-card-name" style={{ display: "block" }}>{player.fullName}{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}</span>
            <span className="rec-stat-player-card-meta">{player.teamAbbreviation ?? player.teamName ?? "Free Agent"} · {player.position ?? "—"}</span>
          </span>
        </button>
      </div>
      <div className="rec-stat-grid">
        {columns.map((key) => (
          <div key={key} className="rec-stat-cell" title={getStatLabel(key)}>
            <div className="rec-stat-cell-label">{statColumnLabel(key)}</div>
            <div className="rec-stat-cell-value">{formatStatValue(key, player.stats[key] ?? 0)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bio + every recorded stat for one player — mirrors the Draft Room's player card, minus the
 * attributes/abilities tabs (this page is about production, not ratings). */
function PlayerStatsModal({ player, onClose }: { player: StatsPlayer; onClose: () => void }) {
  const entries = Object.entries(player.stats).filter(([, value]) => Number(value) !== 0).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Modal title={player.fullName} onClose={onClose}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <PlayerAvatar photoUrl={player.photoUrl} alt="" className="rec-stat-player-modal-avatar" />
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

function useLeagueStats(guildId: string, filters: { teamId?: string | null; position?: string | null; scope?: "season" | "career" } = {}) {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setError(null);
    recApi.getLeagueStats({ guildId, teamId: filters.teamId ?? null, position: filters.position ?? null, scope: filters.scope ?? "season" })
      .then(setData)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "League statistics could not be loaded."));
  }, [guildId, filters.teamId, filters.position, filters.scope]);
  return { data, error };
}

/** "Stats by Category" — pick Passing/Rushing/Receiving/Blocking/Defensive/Special Teams and
 * see every player who plays that side of the ball, ranked by that category's headline stat. */
function CategoryStatsView({ guildId, scope }: { guildId: string; scope: "season" | "career" }) {
  const [categoryKey, setCategoryKey] = useState<StatPageCategoryKey>("passing");
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);
  const { data, error } = useLeagueStats(guildId, { scope });

  const positions = useMemo(() => new Set(positionsForStatPageCategory(categoryKey)), [categoryKey]);
  const players = useMemo(() => {
    if (!data) return [];
    const filtered = positions.size ? data.players.filter((p) => p.position && positions.has(p.position.toUpperCase())) : data.players;
    const primaryKey = primaryStatKeyForPageCategory(categoryKey);
    if (!primaryKey) return filtered;
    return [...filtered].sort((a, b) => (Number(b.stats[primaryKey] ?? 0)) - (Number(a.stats[primaryKey] ?? 0)));
  }, [data, positions, categoryKey]);
  const columns = useMemo(() => (data ? columnsForPageCategory(categoryKey, players) : []), [data, categoryKey, players]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading league statistics…" />;

  return <Card>
    <div className="rec-stats-category-pills" role="tablist" aria-label="Stat category">
      {STAT_PAGE_CATEGORIES.map((cat) => (
        <button key={cat.key} type="button" role="tab" aria-selected={categoryKey === cat.key} className={categoryKey === cat.key ? "active" : ""} onClick={() => setCategoryKey(cat.key)}>{cat.label}</button>
      ))}
    </div>
    <div className="rec-stat-card-list">
      {players.map((player) => <PlayerStatCard key={player.id} player={player} columns={columns} onOpen={() => setOpenPlayer(player)} />)}
    </div>
    {!players.length && <p className="form-hint">No players with recorded stats in this category yet.</p>}
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </Card>;
}

/** "Stats by Team" — pick a team, then a position (defaults to QB); shows that position group's
 * season totals for the selected team. */
function TeamStatsView({ guildId, scope }: { guildId: string; scope: "season" | "career" }) {
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("QB");
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);
  const allTeams = useLeagueStats(guildId, { scope });
  const teamData = useLeagueStats(guildId, { teamId: teamId || null, scope });

  useEffect(() => {
    if (!teamId && allTeams.data?.teams.length) setTeamId(allTeams.data.teams[0].id);
  }, [teamId, allTeams.data]);

  if (allTeams.error) return <ErrorState message={allTeams.error} />;
  if (!allTeams.data) return <LoadingState label="Loading league statistics…" />;

  const positions = teamData.data ? [...new Set(teamData.data.players.map((p) => p.position).filter((p): p is string => Boolean(p)))].sort() : [];
  const effectivePosition = positions.includes(position) ? position : (positions[0] ?? "");
  const players = teamData.data ? teamData.data.players.filter((p) => p.position === effectivePosition) : [];
  const columns = teamData.data ? columnsForPosition(effectivePosition, players) : [];

  return <Card>
    <div className="rec-stats-filter-row">
      <label className="form-field"><span className="form-label">Team</span>
        <select className="form-select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          {allTeams.data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <label className="form-field"><span className="form-label">Position</span>
        <select className="form-select" value={effectivePosition} onChange={(event) => setPosition(event.target.value)}>
          {positions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
    {teamData.error ? <ErrorState message={teamData.error} /> : !teamData.data ? <LoadingState label="Loading team roster…" /> : (
      <div className="rec-stat-card-list">
        {players.map((player) => <PlayerStatCard key={player.id} player={player} columns={columns} onOpen={() => setOpenPlayer(player)} />)}
        {!players.length && <p className="form-hint">This team has no players at this position yet.</p>}
      </div>
    )}
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </Card>;
}

function LeagueLeadersView({ guildId }: { guildId: string }) {
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);
  const { data, error } = useLeagueStats(guildId);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading league leaders…" />;

  const playersById = new Map(data.players.map((p) => [p.id, p]));

  const leaderCategories = [
    { label: "Passing Yards", key: "pass_yards", category: "passing" as StatPageCategoryKey },
    { label: "QBR", key: "qbr", category: "passing" as StatPageCategoryKey },
    { label: "Rushing Yards", key: "rush_yards", category: "rushing" as StatPageCategoryKey },
    { label: "Receiving Yards", key: "receiving_yards", category: "receiving" as StatPageCategoryKey },
    { label: "Interceptions", key: "interceptions", category: "defense" as StatPageCategoryKey },
    { label: "Tackles", key: "tackles", category: "defense" as StatPageCategoryKey },
  ];
  return <Card><h2 style={{ marginTop: 0 }}>League Leaders</h2><div className="hub-league-leader-grid">
    {leaderCategories.map((cat) => {
      const primaryKey = cat.key;
      const leaders = primaryKey ? data.leaders[primaryKey] ?? [] : [];
      const columns = displayStatKeysForPageCategory(cat.category).slice(0, 6);
      return (
        <section key={`${cat.category}-${cat.key}`} className="hub-league-leader-category">
          <h3>{cat.label}</h3>
          {!primaryKey || !leaders.length ? (
            <p className="form-hint">No approved or imported stats are available for this category yet.</p>
          ) : (
            <div className="rec-stat-card-list">
              {leaders.map((leader) => {
                const player = playersById.get(leader.playerId);
                return player ? (
                  <PlayerStatCard key={leader.playerId} player={player} columns={columns.length ? columns : [primaryKey]} rank={leader.rank} onOpen={() => setOpenPlayer(player)} />
                ) : (
                  <div key={leader.playerId} className="rec-stat-player-card">
                    <div className="rec-stat-player-card-head">
                      <span className="rec-stat-player-card-rank">#{leader.rank}</span>
                      <PlayerAvatar photoUrl={leader.photoUrl} alt="" className="rec-stat-player-card-avatar" />
                      <span style={{ minWidth: 0 }}>
                        <span className="rec-stat-player-card-name" style={{ display: "block" }}>{leader.playerName}</span>
                        <span className="rec-stat-player-card-meta">{leader.teamAbbreviation ?? leader.teamName ?? "Free Agent"} · {leader.position ?? "—"}</span>
                      </span>
                    </div>
                    <div className="rec-stat-grid">
                      <div className="rec-stat-cell"><div className="rec-stat-cell-label">{statColumnLabel(primaryKey)}</div><div className="rec-stat-cell-value">{formatStatValue(primaryKey, leader.value)}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      );
    })}
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </div></Card>;
}

export function LeagueStatsHome() {
  const { guildId } = useReadyAuth();
  const hubChrome = useHubChrome();
  const [view, setView] = useState<"category" | "team">("category");
  const [scope, setScope] = useState<"season" | "career">("season");
  const [resource, setResource] = useState<"stats" | "records" | "history" | "sos" | "financial" | null>(null);
  const [hub, setHub] = useState<Awaited<ReturnType<typeof recApi.getHub>> | null>(null);
  useEffect(() => { recApi.getHub(guildId).then(setHub).catch(() => setHub(null)); }, [guildId]);
  const leagueId = hubChrome.currentLeague?.id;

  return <div className="hub-section">
    <PageHeader title="Stats" subtitle="League rankings, leaders, and complete player production." />
    <Card><h2 style={{ marginTop: 0 }}>Power Rankings</h2><div className="hub-stats-power-grid">{(hub?.powerRankings?.teams ?? []).map((team) => <article key={team.teamId}><strong>#{team.rank}</strong><span>{team.teamName}{team.playoffMarker ? ` - ${team.playoffMarker}` : ""}</span><small>{team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`} · <RankChange change={team.change} /></small></article>)}</div>{!hub?.powerRankings?.teams?.length ? <p className="form-hint">Power rankings will appear after the first completed slate.</p> : null}{hub?.powerRankings?.teams?.some((team) => team.playoffMarker) ? <p className="hub-stats-playoff-key"><span>X · Playoff berth</span><span>Y · Division secured</span><span>Z · First-round bye</span></p> : null}</Card>
    <LeagueLeadersView guildId={guildId} />
    {leagueId ? <Card><h2 style={{ marginTop: 0 }}>League Resources</h2><div className="hub-stats-resource-grid">{([
      ["stats", "League Stats"], ["records", "League Records"], ["history", "League History"], ["sos", "Strength of Schedule"], ["financial", "Financial Profile"],
    ] as const).map(([key, text]) => <button key={key} type="button" className={resource === key ? "active" : ""} aria-expanded={resource === key} onClick={() => setResource((current) => current === key ? null : key)}>{text}</button>)}</div></Card> : null}
    {resource === "stats" && <div className="hub-stats-resource-panel">
      <Card><div id="league-stats" className="rec-matchup-tabs" role="tablist" aria-label="Statistics scope"><button type="button" role="tab" aria-selected={scope === "season"} className={scope === "season" ? "active" : ""} onClick={() => setScope("season")}>This Season</button><button type="button" role="tab" aria-selected={scope === "career"} className={scope === "career" ? "active" : ""} onClick={() => setScope("career")}>Career</button></div></Card>
      <div className="rec-matchup-tabs" role="tablist" aria-label="Stats view">
        <button type="button" role="tab" aria-selected={view === "category"} className={view === "category" ? "active" : ""} onClick={() => setView("category")}>Stats by Category</button>
        <button type="button" role="tab" aria-selected={view === "team"} className={view === "team" ? "active" : ""} onClick={() => setView("team")}>Stats by Team</button>
      </div>
      {view === "category" && <CategoryStatsView guildId={guildId} scope={scope} />}
      {view === "team" && <TeamStatsView guildId={guildId} scope={scope} />}
    </div>}
    {resource === "records" && <div className="hub-stats-resource-panel"><LeagueRecordsHome embedded /></div>}
    {resource === "history" && <div className="hub-stats-resource-panel"><LeagueHistoryHome embedded /></div>}
    {resource === "sos" && <Card className="hub-stats-resource-panel"><h2>Strength of Schedule</h2>{hub?.sos?.teams?.length ? <div className="hub-stats-power-grid">{hub.sos.teams.map((team) => <article key={team.teamId}><strong>#{team.rank}</strong><span>{team.teamName}</span><small>{team.humanCount}H/{team.cpuCount}C · Opponent record {(team.oppRecord * 100).toFixed(0)}% · {team.sosFull.toFixed(2)}</small></article>)}</div> : <p className="hub-empty">Strength of schedule will appear once the season slate is logged.</p>}</Card>}
    {resource === "financial" && <Card className="hub-stats-resource-panel"><h2>Financial Profile</h2><FinancialLedger summary={(hub as any)?.myTeam?.profile?.financialSummary ?? (hub as any)?.profile?.financialSummary} /></Card>}
  </div>;
}
