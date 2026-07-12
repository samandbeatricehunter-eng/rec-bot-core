import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ScheduleTeam } from "../../../types/api.js";

export function TeamPicker() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    recApi
      .listScheduleTeams(guildId)
      .then((res) => setTeams(res.teams))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [guildId]);

  const filtered = useMemo(() => {
    if (!teams) return [];
    const q = query.trim().toLowerCase();
    return q ? teams.filter((t) => t.name.toLowerCase().includes(q)) : teams;
  }, [teams, query]);

  return (
    <div>
      <h2>Enter Team Schedule</h2>
      <p>Pick the team whose schedule you're entering.</p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!teams && !error && <p>Loading teams…</p>}
      {teams && (
        <>
          <input
            type="text"
            placeholder="Search teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 12 }}
          />
          <ul style={{ listStyle: "none", padding: 0 }}>
            {filtered.map((team) => (
              <li key={team.id}>
                <button
                  onClick={() => navigate(`/league-mgmt/schedule/${team.id}`)}
                  style={{ width: "100%", textAlign: "left", padding: 8, marginBottom: 4, cursor: "pointer" }}
                >
                  {team.name} {team.conference ? `(${team.conference})` : ""}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <p>No teams match.</p>}
          </ul>
        </>
      )}
    </div>
  );
}
