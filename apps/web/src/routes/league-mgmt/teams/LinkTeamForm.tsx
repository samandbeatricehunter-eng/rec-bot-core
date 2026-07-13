import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueIdentity, OpenTeam } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

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

  if (error) return <ErrorState message={error} />;
  if (!openTeams || !identities) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Link User to Team" subtitle="Pick an open team, then the user to assign it to." />
      <div style={{ display: "flex", gap: "var(--space-5)" }}>
        <Card style={{ flex: 1 }}>
          <h3 style={{ marginTop: 0 }}>Team</h3>
          <SearchInput placeholder="Search teams…" value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} style={{ marginBottom: "var(--space-3)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 320, overflowY: "auto" }}>
            {filteredTeams.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeamId(t.id)}
                className={`btn ${teamId === t.id ? "btn-primary" : "btn-ghost"}`}
                style={{ width: "100%", textAlign: "left", justifyContent: "flex-start" }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </Card>
        <Card style={{ flex: 1 }}>
          <h3 style={{ marginTop: 0 }}>User</h3>
          <SearchInput placeholder="Search users…" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} style={{ marginBottom: "var(--space-3)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 320, overflowY: "auto" }}>
            {filteredUsers.map((u) => (
              <button
                key={u.userId}
                disabled={!u.discordId}
                onClick={() => u.discordId && setDiscordId(u.discordId)}
                className={`btn ${discordId === u.discordId ? "btn-primary" : "btn-ghost"}`}
                style={{ width: "100%", textAlign: "left", justifyContent: "flex-start" }}
              >
                {u.displayName}
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Button variant="primary" onClick={handleSubmit} disabled={!teamId || !discordId || saving} style={{ marginTop: "var(--space-5)" }}>
        {saving ? "Linking…" : "Link"}
      </Button>
    </div>
  );
}
