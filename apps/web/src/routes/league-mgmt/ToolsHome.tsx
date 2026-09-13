import { Link } from "react-router-dom";
import { Settings, Trash2 } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { TroubleshootModal } from "./manage-league/TroubleshootModal.js";

/** Tools bottom-tab: League Settings and Delete League link out to their existing dedicated
 * sub-pages (unchanged), and the rest of what used to be a header "Tools" modal
 * (TroubleshootModal -- Roles, team-link assignment, EOS payouts, wager/transaction
 * maintenance, EA admin actions, etc.) renders inline as this page's own body. */
export function ToolsHome() {
  const { guildId } = useReadyAuth();
  const chrome = useHubChrome();
  const { game } = useLeagueTheme();
  const leagueId = chrome.currentLeague?.id ?? null;
  const dataMode = chrome.currentLeague?.dataMode ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
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
