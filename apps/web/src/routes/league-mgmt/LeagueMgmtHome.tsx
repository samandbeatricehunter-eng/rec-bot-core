import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";
import { PendingCommissionerPollsBanner } from "../../components/league-mgmt/PendingCommissionerPollsBanner.js";

// Linked coaches used to render here as their own panel — the Manage League division grid
// now shows every linked coach inline, so the duplicate panel was removed.
export function LeagueMgmtHome() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PendingCommissionerPollsBanner />
      <CommandCenterDashboard />
    </div>
  );
}
