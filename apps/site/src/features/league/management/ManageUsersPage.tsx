import { useEffect, useState } from "react";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { DivisionTeamsBoard } from "./DivisionTeamsBoard.js";

/** Division-grouped team cards with Site / Discord / EA identity labels. */
export function ManageUsersPage() {
  const { guildId } = useReadyAuth();
  const [teams, setTeams] = useState<TeamManagementSummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        subtitle="Teams by division with each coach's site, Discord, and EA identity."
      />
      <DivisionTeamsBoard teams={teams} mode="users" loading={!teams && !error} error={error} />
    </div>
  );
}
