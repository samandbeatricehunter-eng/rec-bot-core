import { useEffect, useMemo, useState } from "react";
import {
  formatStatValue,
  getStatLabel,
  getStatShortLabel,
  statCategoriesForPosition,
  statKeysForCategories,
  NFL_TEAM_PRIMARY_COLORS,
  type StatPageCategoryKey,
} from "@rec/shared";
import { useSearchParams } from "react-router-dom";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { resolveTeamLogoAbbr } from "../../lib/team-logos.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Modal } from "../../components/ui/Modal.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";
import { PlayerPhoto } from "../../components/hub/PlayerPhoto.js";
import { StatsMiniNav, type StatsNavId } from "../../components/hub/StatsMiniNav.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import leagueLeadersPill from "../../assets/league-leaders-pill.png";

// Same technique LeagueStandingsHome.tsx uses for division-standings cards: a team-color
// gradient background (via a --team-color custom property) with the logo bled off the edge as a
// low-opacity watermark, text in a separate opaque layer on top. Duplicated here (not imported)
// rather than extracted into a shared util, since LeagueStandingsHome.tsx is under active
// concurrent edit in this repo right now and touching it risks colliding with that work.
function leaderTeamColor(abbreviation: string | null | undefined): string {
  const abbr = resolveTeamLogoAbbr(abbreviation ?? "");
  if (abbr && NFL_TEAM_PRIMARY_COLORS[abbr]) return NFL_TEAM_PRIMARY_COLORS[abbr];
  return "#1a1d24";
}

function leaderContrastingInk(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "#fff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? "#111111" : "#ffffff";
}

/** Splits a full display name into a stacked first/last pair for the leader card -- everything
 * but the last word is "first" (so multi-word first names like "Mary Jane" stay together),
 * the last word is "last". Imperfect for suffixes ("Jr.") but matches the same
 * good-enough-for-a-card-label approach LeagueStandingsHome.tsx uses for team city/nick. */
function splitLeaderName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: fullName.trim() };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

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

function columnsForPosition(position: string, players: StatsPlayer[]): string[] {
  if (!position) return fallbackColumnsForPlayers(players);
  const categories = statCategoriesForPosition(position);
  const keys = statKeysForCategories(categories);
  return keys.length ? keys : fallbackColumnsForPlayers(players);
}

function statColumnLabel(key: string): string {
  const short = getStatShortLabel(key);
  return short === key ? label(key) : short;
}

function PlayerAvatar({ player }: { player: { photoUrl: string | null; position: string | null } }) {
  return (
    <PlayerPhoto
      photoUrl={player.photoUrl}
      loading="lazy"
      className="rec-stat-player-card-avatar"
      fallback={<span className="rec-stat-player-card-avatar-fallback">{player.position ?? "—"}</span>}
    />
  );
}

function ModalPlayerAvatar({ player }: { player: { photoUrl: string | null; position: string | null } }) {
  return (
    <PlayerPhoto
      photoUrl={player.photoUrl}
      style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      fallback={
        <div style={{ width: 72, height: 72, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-2, #222)", fontWeight: 700, flexShrink: 0 }}>
          {player.position ?? "—"}
        </div>
      }
    />
  );
}

/** Bio + every recorded stat for one player — mirrors the Draft Room's player card, minus the
 * attributes/abilities tabs (this page is about production, not ratings). */
function PlayerStatsModal({ player, onClose }: { player: StatsPlayer; onClose: () => void }) {
  const entries = Object.entries(player.stats).filter(([, value]) => Number(value) !== 0).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Modal title={player.fullName} onClose={onClose}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16 }}>
        <ModalPlayerAvatar player={player} />
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

type SortState = { key: string; direction: "asc" | "desc" };

/** A real sortable table instead of a card strip — every column header toggles ascending/
 * descending on click, which a strip of cards has no natural place to put. */
function StatsTable({ players, columns, onOpenPlayer }: { players: StatsPlayer[]; columns: string[]; onOpenPlayer: (player: StatsPlayer) => void }) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return players;
    return [...players].sort((a, b) => {
      const av = Number(a.stats[sort.key] ?? 0);
      const bv = Number(b.stats[sort.key] ?? 0);
      return sort.direction === "asc" ? av - bv : bv - av;
    });
  }, [players, sort]);

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "desc" };
      return current.direction === "desc" ? { key, direction: "asc" } : null;
    });
  };

  if (!players.length) return <p className="form-hint">No players with recorded stats here yet.</p>;

  return (
    <div className="rec-stats-table-wrap">
      <table className="rec-stats-table">
        <thead>
          <tr>
            <th className="rec-stats-table-player-col">Player</th>
            {columns.map((key) => (
              <th key={key}>
                <button type="button" className="rec-stats-table-sort" onClick={() => toggleSort(key)} title={getStatLabel(key)}>
                  {statColumnLabel(key)}
                  <span className="rec-stats-table-sort-arrow">{sort?.key === key ? (sort.direction === "asc" ? "▲" : "▼") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((player) => (
            <tr key={player.id} onClick={() => onOpenPlayer(player)}>
              <td className="rec-stats-table-player-col">
                <div className="rec-stats-table-player">
                  <PlayerAvatar player={player} />
                  <span style={{ minWidth: 0 }}>
                    <span className="rec-stat-player-card-name" style={{ display: "block" }}>{player.fullName}{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}</span>
                    <span className="rec-stat-player-card-meta">{player.teamAbbreviation ?? player.teamName ?? "Free Agent"} · {player.position ?? "—"}</span>
                  </span>
                </div>
              </td>
              {columns.map((key) => <td key={key}>{formatStatValue(key, player.stats[key] ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Stats page's one player-production display — pick a team (or ALL, every team in the
 * league) then a position, and see that group's season totals in a sortable table. Replaces the
 * old "Stats by Category" pill entirely: it showed every position for a hand-picked category,
 * but duplicated everything this view already does once ALL was an option here, without a
 * working per-column sort. */
export function TeamStatsView({ guildId, scope }: { guildId: string; scope: "season" | "career" }) {
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("QB");
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);
  const allTeams = useLeagueStats(guildId, { scope });
  const teamData = useLeagueStats(guildId, { teamId: teamId || null, scope });

  if (allTeams.error) return <ErrorState message={allTeams.error} />;
  if (!allTeams.data) return <LoadingState label="Loading league statistics…" />;

  const positions = teamData.data ? [...new Set(teamData.data.players.map((p) => p.position).filter((p): p is string => Boolean(p)))].sort() : [];
  const effectivePosition = positions.includes(position) ? position : (positions[0] ?? "");
  const columns = teamData.data ? columnsForPosition(effectivePosition, teamData.data.players) : [];
  // A player with every relevant column at 0 (a backup who never took a snap) just adds noise.
  const players = teamData.data
    ? teamData.data.players.filter((p) => p.position === effectivePosition && columns.some((key) => Number(p.stats[key] ?? 0) !== 0))
    : [];

  return <Card>
    <div className="rec-stats-filter-row">
      <label className="form-field"><span className="form-label">Team</span>
        <select className="form-select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">All Teams</option>
          {allTeams.data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <label className="form-field"><span className="form-label">Position</span>
        <select className="form-select" value={effectivePosition} onChange={(event) => setPosition(event.target.value)}>
          {positions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
    {teamData.error ? <ErrorState message={teamData.error} /> : !teamData.data ? <LoadingState label="Loading roster statistics…" /> : (
      <StatsTable players={players} columns={columns} onOpenPlayer={setOpenPlayer} />
    )}
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </Card>;
}

type LeaderCategory = { label: string; columns: string[]; category: StatPageCategoryKey };
// Top row (offense) / bottom row (divider between) / bottom row (defense) -- exactly 3 columns
// each, per the requested 3x2 layout.
const OFFENSE_LEADER_CATEGORIES: LeaderCategory[] = [
  { label: "Passing Yards", columns: ["pass_yards", "pass_tds"], category: "passing" },
  { label: "Rushing Yards", columns: ["rush_yards", "rush_tds"], category: "rushing" },
  { label: "Receiving Yards", columns: ["receiving_yards", "receiving_tds"], category: "receiving" },
];
const DEFENSE_LEADER_CATEGORIES: LeaderCategory[] = [
  { label: "Sacks", columns: ["sacks"], category: "defense" },
  { label: "Tackles", columns: ["tackles"], category: "defense" },
  { label: "Interceptions", columns: ["interceptions"], category: "defense" },
];

/** "League Leaders" — one card per category (3 offense on top, 3 defense on bottom, a neon
 * divider between the two rows), top 5 players ranked by that category's headline stat, each
 * showing the ranking stat alongside a secondary column (TDs for the three yardage categories)
 * while still sorting purely by the ranking stat. */
function LeagueLeadersView({ guildId }: { guildId: string }) {
  const [openPlayer, setOpenPlayer] = useState<StatsPlayer | null>(null);
  const { data, error } = useLeagueStats(guildId);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading league leaders…" />;

  const playersById = new Map(data.players.map((p) => [p.id, p]));

  const renderCategory = (cat: LeaderCategory) => {
    const primaryKey = cat.columns[0];
    const leaders = data.leaders[primaryKey] ?? [];
    return (
      <section key={cat.label} className="hub-league-leader-category">
        <h3>{cat.label}</h3>
        {!leaders.length ? (
          <p className="form-hint">No approved or imported stats are available for this category yet.</p>
        ) : (
          <div className="rec-stat-card-list">
            {leaders.map((leader) => {
              const player = playersById.get(leader.playerId);
              const photoUrl = player?.photoUrl ?? null;
              const position = player?.position ?? leader.position ?? null;
              const teamColor = leaderTeamColor(leader.teamAbbreviation);
              const teamInk = leaderContrastingInk(teamColor);
              const { first, last } = splitLeaderName(leader.playerName);
              return (
                <div
                  key={leader.playerId}
                  className="rec-stat-player-card"
                  style={{ ["--team-color" as string]: teamColor, ["--team-ink" as string]: teamInk }}
                >
                  <TeamLogo abbreviation={leader.teamAbbreviation} alt="" className="rec-stat-player-card-logo" priority />
                  <div className="rec-stat-player-card-head">
                    <span className="rec-stat-player-card-rank">#{leader.rank}</span>
                    <button type="button" onClick={() => player && setOpenPlayer(player)} disabled={!player}>
                      <PlayerAvatar player={{ photoUrl, position }} />
                      <span className="rec-stat-player-card-identity">
                        {first ? <small className="rec-stat-player-card-first">{first}</small> : null}
                        <strong className="rec-stat-player-card-last">{last}</strong>
                      </span>
                    </button>
                  </div>
                  <div className="rec-stat-chip-row">
                    {cat.columns.map((key) => (
                      <div key={key} className="rec-stat-chip">
                        <div className="rec-stat-chip-label">{statColumnLabel(key)}</div>
                        <div className="rec-stat-chip-value">{formatStatValue(key, key === primaryKey ? leader.value : (player?.stats[key] ?? 0))}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return <Card>
    <div className="hub-league-leader-grid">
      {OFFENSE_LEADER_CATEGORIES.map(renderCategory)}
      <div className="hub-league-leader-divider" aria-hidden="true" />
      {DEFENSE_LEADER_CATEGORIES.map(renderCategory)}
    </div>
    {openPlayer && <PlayerStatsModal player={openPlayer} onClose={() => setOpenPlayer(null)} />}
  </Card>;
}

export function LeagueStatsHome() {
  const { guildId } = useReadyAuth();
  const { currentLeague } = useHubChrome();
  const [searchParams] = useSearchParams();
  const rawView = searchParams.get("view");
  const view: "leaders" | "season" | "team" =
    rawView === "season" || rawView === "team" ? rawView : "leaders";
  const activeNav: StatsNavId = view;

  return <div className="hub-section">
    {currentLeague?.id ? <StatsMiniNav active={activeNav} leagueId={currentLeague.id} /> : null}
    {view === "leaders" ? (
      <>
        <img className="rec-league-leaders-pill" src={leagueLeadersPill} alt="League Leaders" />
        <LeagueLeadersView guildId={guildId} />
      </>
    ) : null}
    {view === "season" ? (
      <>
        <PageHeader title="Season Stats" subtitle="Complete player production for the current season." />
        <TeamStatsView guildId={guildId} scope="season" />
      </>
    ) : null}
    {view === "team" ? (
      <>
        <PageHeader title="Team Stats" subtitle="Filter the league by team and position." />
        <TeamStatsView guildId={guildId} scope="season" />
      </>
    ) : null}
  </div>;
}
