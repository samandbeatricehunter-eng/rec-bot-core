import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { DivisionTeamsBoard } from "./DivisionTeamsBoard.js";

/** Division-grouped board showing EA names; click a team to open its management page. */
export function ManageTeamsPage() {
  const { guildId } = useReadyAuth();
  const { leagueId = "" } = useParams();
  const navigate = useNavigate();
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
        title="Manage Teams"
        subtitle="Pick a team to open its dedicated management page."
      />
      <DivisionTeamsBoard
        teams={teams}
        mode="teams"
        loading={!teams && !error}
        error={error}
        onTeamClick={(team) => navigate(`/l/${leagueId}/mgmt/teams/${team.id}`)}
      />
    </div>
  );
}
