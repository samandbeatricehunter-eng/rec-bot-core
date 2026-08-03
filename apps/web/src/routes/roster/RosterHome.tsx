import { useEffect, useMemo, useState } from "react";
import { CFB_POSITION_GROUPS } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { RosterPlayer, TeamRosterResponse } from "../../types/api.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { PlayerStatsModal } from "../../components/hub/PlayerStatsModal.js";

type ViewMode = "grid" | "list";

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

  useEffect(() => {
    recApi
      .getTeamRoster({ guildId })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your roster."));
  }, [guildId]);

  const rosteredPlayers = useMemo(
    () => (data?.players ?? []).filter((p) => ROSTER_ACTIVE_STATUSES.has(p.rosterStatus)),
    [data],
  );

  const filteredPlayers = useMemo(
    () => (groupFilter === "ALL" ? rosteredPlayers : rosteredPlayers.filter((p) => p.positionGroup === groupFilter)),
    [rosteredPlayers, groupFilter],
  );

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
              <span className="hub-roster-grade-letter">{group.grade}</span>
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
            </select>
          </label>
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
                  </tr>
                ))}
                {filteredPlayers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="hub-empty">
                      No players in this group.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
