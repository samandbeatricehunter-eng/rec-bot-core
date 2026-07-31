import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { WeeklyH2hPanel } from "../../components/home/WeeklyH2hPanel.js";
import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";
import { CommissionerChatHome } from "./commissioner-chat/CommissionerChatHome.js";

export function LeagueMgmtHome() {
  return (
    <div>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <CommandCenterDashboard />
      </div>
      <div className="league-home-panels">
        <LinkedRosterPanel />
        <CommissionerChatHome embedded />
        <WeeklyH2hPanel />
      </div>
    </div>
  );
}
