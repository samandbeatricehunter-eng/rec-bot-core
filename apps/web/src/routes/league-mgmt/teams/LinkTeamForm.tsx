import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueIdentity, OpenTeam } from "../../../types/api.js";

// The searchable-list replacement for Discord's paginated 25-option team/user selects
// (apps/bot/src/ui/team-options.ts's buildUserSelectRows/buildOpenTeamSelectRow).
export function LinkTeamForm() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [openTeams, setOpenTeams] = useState<OpenTeam[] | null>(null);
  const [identities, setIdentities] = useState<LeagueIdentity[] | null>(null);
  const [teamQuery, setTeamQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [discordId, setDiscordId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([recApi.listOpenTeams(guildId), recApi.listLeagueIdentities(guildId)])
      .then(([teamsRes, identitiesRes]) => {
        setOpenTeams(teamsRes.openTeams);
        setIdentities(identitiesRes.identities);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams/users."));
  }, [guildId]);

  const filteredTeams = useMemo(() => {
    if (!openTeams) return [];
    const q = teamQuery.trim().toLowerCase();
    return q ? openTeams.filter((t) => t.name.toLowerCase().includes(q)) : openTeams;
  }, [openTeams, teamQuery]);

  const filteredUsers = useMemo(() => {
    if (!identities) return [];
    const q = userQuery.trim().toLowerCase();
    return q ? identities.filter((u) => u.displayName.toLowerCase().includes(q)) : identities;
  }, [identities, userQuery]);

  async function handleSubmit() {
    if (!teamId || !discordId) return;
    setSaving(true);
    setError(null);
    try {
      await recApi.linkUserToTeam({ guildId, teamId, discordId });
      navigate("/league-mgmt/teams");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link user to team.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!openTeams || !identities) return <p>Loading…</p>;

  return (
    <div>
      <h2>Link User to Team</h2>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h3>Team</h3>
          <input placeholder="Search teams…" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <ul style={{ listStyle: "none", padding: 0, maxHeight: 300, overflowY: "auto" }}>
            {filteredTeams.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setTeamId(t.id)}
                  style={{ width: "100%", textAlign: "left", padding: 6, background: teamId === t.id ? "#ddd" : undefined }}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 1 }}>
          <h3>User</h3>
          <input placeholder="Search users…" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          <ul style={{ listStyle: "none", padding: 0, maxHeight: 300, overflowY: "auto" }}>
            {filteredUsers.map((u) => (
              <li key={u.userId}>
                <button
                  disabled={!u.discordId}
                  onClick={() => u.discordId && setDiscordId(u.discordId)}
                  style={{ width: "100%", textAlign: "left", padding: 6, background: discordId === u.discordId ? "#ddd" : undefined }}
                >
                  {u.displayName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <button onClick={handleSubmit} disabled={!teamId || !discordId || saving} style={{ marginTop: 16, padding: "8px 16px" }}>
        {saving ? "Linking…" : "Link"}
      </button>
    </div>
  );
}
