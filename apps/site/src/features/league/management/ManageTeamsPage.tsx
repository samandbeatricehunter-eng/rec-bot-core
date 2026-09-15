import { useEffect, useState } from "react";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { DivisionTeamsBoard } from "./DivisionTeamsBoard.js";
import { ManageTeamIdentityModal } from "./ManageTeamIdentityModal.js";

/** Division-grouped board; click a team to edit logo / abbr / city / nick. */
export function ManageTeamsPage() {
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
        title="Manage Teams"
        subtitle="Click a team to update its logo, abbreviation, city, or nickname."
      />
      <DivisionTeamsBoard
        teams={teams}
        mode="teams"
        loading={!teams && !error}
        error={error}
        onTeamClick={setSelected}
      />
      {selected ? (
        <ManageTeamIdentityModal
          guildId={guildId}
          team={selected}
          onClose={() => setSelected(null)}
          onSaved={(next) => {
            setTeams((prev) =>
              prev
                ? prev.map((row) => (row.id === next.id ? { ...row, ...next } : row))
                : prev,
            );
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
