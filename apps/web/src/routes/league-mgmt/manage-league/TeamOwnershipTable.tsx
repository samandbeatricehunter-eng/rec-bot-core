import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamLinkMatrix } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

export function TeamOwnershipTable() {
  const { guildId } = useReadyAuth();
  const [matrix, setMatrix] = useState<TeamLinkMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => recApi.getTeamLinkMatrix(guildId).then(setMatrix).catch((e) => setError(e instanceof Error ? e.message : "Failed to load teams."));
  useEffect(() => { void load(); }, [guildId]);
  const users = matrix?.users ?? [];
  const conferences = useMemo(() => {
    const grouped = new Map<string, TeamLinkMatrix["teams"]>();
    for (const team of matrix?.teams ?? []) { const key = team.conference ?? "Other"; grouped.set(key, [...(grouped.get(key) ?? []), team]); }
    return [...grouped.entries()];
  }, [matrix]);
  async function change(teamId: string, discordId: string) {
    setBusy(teamId); setError(null);
    try {
      if (discordId) await recApi.linkUserToTeam({ guildId, teamId, discordId });
      else await recApi.unlinkTeam({ guildId, teamId });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update team."); } finally { setBusy(null); }
  }
  return <div>
    <PageHeader title="Teams" subtitle="Assign each team directly. New links receive the Member role by default; change authority under Roles." />
    {error && <ErrorState message={error} />}{!matrix && !error && <LoadingState />}
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {conferences.map(([conference, teams]) => <Card key={conference}>
        <h3 style={{ marginTop: 0 }}>{conference}</h3>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {teams.map((team) => <div key={team.id} className="inline-admin-row">
            <label htmlFor={`team-${team.id}`}><strong>{team.name}</strong>{team.division ? <small style={{ display: "block", color: "var(--text-secondary)" }}>{team.division}</small> : null}</label>
            <select id={`team-${team.id}`} className="form-select" value={team.discordId ?? ""} disabled={busy === team.id} onChange={(e) => change(team.id, e.target.value)}>
              <option value="">None</option>
              {users.map((user) => <option key={user.discordId} value={user.discordId}>{user.displayName}{user.displayName !== user.username ? ` (${user.username})` : ""}</option>)}
            </select>
          </div>)}
        </div>
      </Card>)}
    </div>
  </div>;
}
