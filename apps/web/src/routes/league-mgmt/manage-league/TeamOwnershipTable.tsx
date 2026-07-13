import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LinkedTeamRow } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Table, Th, Td } from "../../../components/ui/Table.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

export function TeamOwnershipTable() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
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
      <PageHeader
        title="Teams"
        subtitle="Manage which users control which teams."
        actions={
          <Button variant="primary" onClick={() => navigate("/league-mgmt/manage-league/teams/link")}>
            <UserPlus size={16} /> Link User
          </Button>
        }
      />
      {error && <ErrorState message={error} />}
      {!linked && !error && <LoadingState />}
      {linked && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Team</Th>
                <Th>User</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {linked.map((row) => (
                <tr key={row.id}>
                  <Td>{row.team?.name ?? "Unknown"}</Td>
                  <Td>{row.user?.display_name ?? "Unknown"}</Td>
                  <Td style={{ textAlign: "right" }}>
                    <Button
                      variant="danger"
                      disabled={!row.team || busyTeamId === row.team.id}
                      onClick={() => row.team && handleUnlink(row.team.id)}
                    >
                      {busyTeamId === row.team?.id ? "Unlinking…" : "Unlink"}
                    </Button>
                  </Td>
                </tr>
              ))}
              {linked.length === 0 && (
                <tr>
                  <Td colSpan={3} style={{ color: "var(--text-secondary)" }}>No teams are linked yet.</Td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
