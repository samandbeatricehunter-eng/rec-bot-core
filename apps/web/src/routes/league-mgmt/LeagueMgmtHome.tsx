import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { WeeklyH2hPanel } from "../../components/home/WeeklyH2hPanel.js";
import { CommissionerChatHome } from "./commissioner-chat/CommissionerChatHome.js";

export function LeagueMgmtHome() {
  return (
    <div>
      <div className="league-home-panels">
        <LinkedRosterPanel />
        <CommissionerChatHome />
        <WeeklyH2hPanel />
      </div>
    </div>
  );
}
