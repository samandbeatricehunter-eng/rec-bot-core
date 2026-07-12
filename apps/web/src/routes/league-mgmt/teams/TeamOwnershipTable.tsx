import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LinkedTeamRow } from "../../../types/api.js";

export function TeamOwnershipTable() {
  const { guildId } = useReadyAuth();
  const [linked, setLinked] = useState<LinkedTeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);

  function load() {
    recApi
      .listLinkedUsersTeams(guildId)
      .then((res) => setLinked(res.linked))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load linked teams."));
  }

  useEffect(load, [guildId]);

  async function handleUnlink(teamId: string) {
    setBusyTeamId(teamId);
    try {
      await recApi.unlinkTeam({ guildId, teamId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink team.");
    } finally {
      setBusyTeamId(null);
    }
  }

  return (
    <div>
      <h2>Teams</h2>
      <Link to="/league-mgmt/teams/link">Link a user to a team →</Link>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!linked && !error && <p>Loading…</p>}
      {linked && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Team</th>
              <th style={cellStyle}>User</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {linked.map((row) => (
              <tr key={row.id}>
                <td style={cellStyle}>{row.team?.name ?? "Unknown"}</td>
                <td style={cellStyle}>{row.user?.display_name ?? "Unknown"}</td>
                <td style={cellStyle}>
                  <button
                    disabled={!row.team || busyTeamId === row.team.id}
                    onClick={() => row.team && handleUnlink(row.team.id)}
                  >
                    {busyTeamId === row.team?.id ? "Unlinking…" : "Unlink"}
                  </button>
                </td>
              </tr>
            ))}
            {linked.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={3}>No teams are linked yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cellStyle = { border: "1px solid #ccc", padding: 6, textAlign: "left" as const };
