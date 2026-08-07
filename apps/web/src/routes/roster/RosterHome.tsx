import { useEffect, useMemo, useState } from "react";
import { CFB_POSITION_GROUPS } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterPlayer, TeamRosterResponse } from "../../types/api.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PlayerStatsModal } from "../../components/hub/PlayerStatsModal.js";
import { RosterMovesPanel } from "./RosterMovesPanel.js";

type ViewMode = "grid" | "list";

type RosterUiStatus = "no_change" | "drafted" | "graduated" | "transferred_out";
const STATUS_OPTIONS: Array<{ value: RosterUiStatus; label: string }> = [
  { value: "no_change", label: "No Change" },
  { value: "drafted", label: "Went Pro" },
  { value: "graduated", label: "Graduated/Retired" },
  { value: "transferred_out", label: "Transferred" },
];

// Per-player offseason status change — only rendered when canEditRosterStatus is true
// (CFB leagues, outside the regular season/postseason). "No Change" just reinstates a
// player back to active if they'd previously been marked departed; the other three call
// setPlayerDeparture, which removes the player from the active roster view. Transferred
// requires a destination school, captured as the departure note.
function RosterStatusCell({ guildId, player, onChanged }: { guildId: string; player: RosterPlayer; onChanged: () => void }) {
  const current: RosterUiStatus = player.rosterStatus === "drafted" || player.rosterStatus === "graduated" || player.rosterStatus === "retired" || player.rosterStatus === "transferred_out"
    ? (player.rosterStatus === "retired" ? "graduated" : (player.rosterStatus as RosterUiStatus))
    : "no_change";
  const [pending, setPending] = useState<RosterUiStatus | null>(null);
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(status: RosterUiStatus, note?: string) {
    setBusy(true);
    setError(null);
    try {
      if (status === "no_change") {
        await recApi.reinstatePlayer({ guildId, playerId: player.id });
      } else {
        await recApi.setPlayerDeparture({ guildId, playerId: player.id, status, note: note ?? null });
      }
      setPending(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  function handleChange(next: RosterUiStatus) {
    if (next === "transferred_out") {
      setPending("transferred_out");
      setDestination("");
      return;
    }
    void apply(next);
  }

  return (
    <div className="hub-roster-status-cell">
      {error && <span className="hub-roster-status-error">{error}</span>}
      {pending === "transferred_out" ? (
        <div className="hub-roster-status-transfer">
          <input className="form-input" placeholder="Transferred to…" value={destination} onChange={(event) => setDestination(event.target.value)} />
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy || !destination.trim()} onClick={() => void apply("transferred_out", destination)}>Save</button>
          <button type="button" className="btn btn-ghost btn-compact" onClick={() => setPending(null)}>Cancel</button>
        </div>
      ) : (
        <select className="form-select" value={current} disabled={busy} onChange={(event) => handleChange(event.target.value as RosterUiStatus)}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </div>
  );
}

function formatHeight(inches: number | null): string {
  if (inches == null) return "—";
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

const ROSTER_ACTIVE_STATUSES = new Set(["active", "transferred_in"]);

export function RosterHome() {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<TeamRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("grid");
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [statsPlayer, setStatsPlayer] = useState<RosterPlayer | null>(null);

  function load() {
    recApi
      .getTeamRoster({ guildId })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your roster."));
  }

  useEffect(load, [guildId]);

  const rosteredPlayers = useMemo(
    () => (data?.players ?? []).filter((p) => ROSTER_ACTIVE_STATUSES.has(p.rosterStatus)),
    [data],
  );
  const departedPlayers = useMemo(
    () => (data?.players ?? []).filter((p) => !ROSTER_ACTIVE_STATUSES.has(p.rosterStatus)),
    [data],
  );

  const filteredPlayers = useMemo(
    () => (groupFilter === "ALL" ? rosteredPlayers : rosteredPlayers.filter((p) => p.positionGroup === groupFilter)),
    [rosteredPlayers, groupFilter],
  );
  const showingDraftPicks = groupFilter === "Draft Picks";

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading your roster…" />;

  return (
    <div className="hub-section hub-roster-page">
      <div className="hub-section-heading">
        <div>
          <p className="hub-eyebrow">Team roster</p>
          <h2>{data.team.name ?? data.team.abbreviation ?? "Your team"}</h2>
          <p>{rosteredPlayers.length} players on roster</p>
        </div>
        <div className="hub-roster-view-toggle">
          <button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>
            Position Grades
          </button>
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            Roster List
          </button>
        </div>
      </div>

      <RosterMovesPanel
        guildId={guildId}
        teamId={data.team.id}
        activePlayers={rosteredPlayers}
        departedPlayers={departedPlayers}
        onChanged={load}
      />

      {view === "grid" ? (
        <div className="hub-roster-grade-grid">
          {data.positionGroups.map((group) => (
            <button
              type="button"
              key={group.group}
              className="hub-roster-grade-card"
              onClick={() => {
                setGroupFilter(group.group);
                setView("list");
              }}
            >
              <span className="hub-roster-grade-group">{group.group}</span>
              <span className="hub-roster-grade-letter" data-grade-letter={group.grade?.charAt(0) ?? ""}>
                {group.grade}
              </span>
              <span className="hub-roster-grade-meta">
                {group.avgOverall != null ? `${group.avgOverall} OVR avg` : "No players"} · {group.playerCount}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <label className="form-field hub-roster-group-selector">
            <span className="form-label">Position group</span>
            <select className="form-input" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              <option value="ALL">All positions</option>
              {CFB_POSITION_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
              {data.draftPicks.length > 0 && <option value="Draft Picks">Draft Picks</option>}
            </select>
          </label>
          {showingDraftPicks ? (
            <div className="hub-roster-table-wrap">
              <table className="hub-roster-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Round</th>
                    <th>Pick #</th>
                    <th>Original owner</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {data.draftPicks.map((pick) => (
                    <tr key={pick.id}>
                      <td>Season {pick.seasonNumber}</td>
                      <td>Round {pick.round}</td>
                      <td>{pick.pickNumber ?? "TBD"}</td>
                      <td>{pick.isOwnPick ? "Own pick" : pick.originalTeamName}</td>
                      <td>
                        {pick.tradeChain.length === 0 ? (
                          "—"
                        ) : (
                          <span className="hub-roster-pick-chain">
                            {pick.tradeChain.length} trade{pick.tradeChain.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.draftPicks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="hub-empty">
                        No draft picks logged yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="hub-roster-table-wrap">
              <table className="hub-roster-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Ht</th>
                    <th>Wt</th>
                    <th>Class</th>
                    <th>OVR</th>
                    <th />
                    {data.canEditRosterStatus && <th>Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <strong>{player.fullName}</strong>
                        <span className="hub-roster-pos">{player.position}</span>
                      </td>
                      <td>{formatHeight(player.heightInches)}</td>
                      <td>{player.weightLbs != null ? `${player.weightLbs} lbs` : "—"}</td>
                      <td>{player.classYear ?? "—"}</td>
                      <td>
                        {player.overallRating ?? "—"}
                        {player.recentIncrease ? <span className="hub-roster-increase">+{player.recentIncrease}</span> : null}
                      </td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-compact" onClick={() => setStatsPlayer(player)}>
                          Add Stats
                        </button>
                      </td>
                      {data.canEditRosterStatus && <td><RosterStatusCell guildId={guildId} player={player} onChanged={load} /></td>}
                    </tr>
                  ))}
                  {filteredPlayers.length === 0 && (
                    <tr>
                      <td colSpan={data.canEditRosterStatus ? 7 : 6} className="hub-empty">
                        No players in this group.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {statsPlayer && (
        <PlayerStatsModal
          guildId={guildId}
          initialPlayerName={statsPlayer.fullName}
          onClose={() => setStatsPlayer(null)}
          onSubmitted={() => setStatsPlayer(null)}
        />
      )}
    </div>
  );
}
