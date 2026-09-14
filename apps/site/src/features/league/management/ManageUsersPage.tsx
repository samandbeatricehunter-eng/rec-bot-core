import { useEffect, useState } from "react";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { DivisionTeamsBoard } from "./DivisionTeamsBoard.js";
import { ManageUserActionsModal } from "./ManageUserActionsModal.js";

/** Division-grouped team cards; click a linked user row to open management actions. */
export function ManageUsersPage() {
  const { guildId } = useReadyAuth();
  const [teams, setTeams] = useState<TeamManagementSummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamManagementSummaryRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    recApi.getTeamManagementSummary(guildId)
      .then((res) => { if (!cancelled) setTeams(res.teams); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load teams.");
      });
    return () => { cancelled = true; };
  }, [guildId]);

  return (
    <div>
      <PageHeader
        title="Manage Users"
        subtitle="Click a linked team to view activity, transactions, or take user actions."
      />
      <DivisionTeamsBoard
        teams={teams}
        mode="users"
        loading={!teams && !error}
        error={error}
        onTeamClick={(team) => {
          if (!team.linkedUser) return;
          setSelected(team);
        }}
      />
      {selected ? (
        <ManageUserActionsModal
          guildId={guildId}
          team={selected}
          onClose={() => setSelected(null)}
          onUnlinked={(teamId) => {
            setTeams((prev) =>
              prev
                ? prev.map((row) =>
                  row.id === teamId
                    ? { ...row, linkedUser: null, pendingRequest: null }
                    : row,
                )
                : prev,
            );
          }}
        />
      ) : null}
    </div>
  );
}
