import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";
import { PendingCommissionerPollsBanner } from "../../components/league-mgmt/PendingCommissionerPollsBanner.js";

export function LeagueMgmtHome() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PendingCommissionerPollsBanner />
      <CommandCenterDashboard />
      <LinkedRosterPanel />
    </div>
  );
}
