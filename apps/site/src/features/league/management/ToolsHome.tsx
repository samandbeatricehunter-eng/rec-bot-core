import { Link } from "react-router-dom";
import { Settings, Trash2 } from "lucide-react";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { Button } from "../../../../../web/src/components/ui/Button.js";
import { TroubleshootModal } from "./manage-league/TroubleshootModal.js";
import { useReadyAuth, useHubChrome, useLeagueTheme } from "@rec/hub-ui";

/** Tools menu body. When embedded under Manage League, skip the page chrome — the parent
 * title block already owns navigation (and Settings / Delete live elsewhere on that page). */
export function ToolsHome({ embedded = false }: { embedded?: boolean } = {}) {
  const { guildId } = useReadyAuth();
  const chrome = useHubChrome();
  const { game } = useLeagueTheme();
  const leagueId = chrome.currentLeague?.id ?? null;
  const dataMode = chrome.currentLeague?.dataMode ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {embedded ? null : (
        <PageHeader
          title="League Tools"
          subtitle="Settings, roles, team assignment, and maintenance tools."
          actions={
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <Link to={`/l/${leagueId}/mgmt/settings`}><Button variant="secondary"><Settings size={16} /> League Settings</Button></Link>
              <Link to={`/l/${leagueId}/mgmt/delete-league`}><Button variant="danger"><Trash2 size={16} /> Delete League</Button></Link>
            </div>
          }
        />
      )}
      <TroubleshootModal
        embedded
        guildId={guildId}
        leagueId={leagueId}
        game={game}
        showImportAudit={dataMode === "import"}
        onClose={() => undefined}
      />
    </div>
  );
}