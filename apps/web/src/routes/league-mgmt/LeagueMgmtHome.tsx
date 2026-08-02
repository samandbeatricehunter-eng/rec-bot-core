import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";

export function LeagueMgmtHome() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <CommandCenterDashboard />
      <LinkedRosterPanel />
    </div>
  );
}
