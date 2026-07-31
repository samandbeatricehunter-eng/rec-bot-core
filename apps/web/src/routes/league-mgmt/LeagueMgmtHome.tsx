import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { WeeklyH2hPanel } from "../../components/home/WeeklyH2hPanel.js";
import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";

export function LeagueMgmtHome() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <CommandCenterDashboard />
      <div className="league-home-panels" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
        <LinkedRosterPanel />
        <WeeklyH2hPanel />
      </div>
    </div>
  );
}