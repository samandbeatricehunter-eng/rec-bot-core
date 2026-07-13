import { CalendarDays, FastForward, SlidersHorizontal } from "lucide-react";
import { ActivityTile } from "../../components/ui/ActivityTile.js";
import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { WeeklyH2hPanel } from "../../components/home/WeeklyH2hPanel.js";
import { CommissionerChatHome } from "./commissioner-chat/CommissionerChatHome.js";

export function LeagueMgmtHome() {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: "var(--space-5)",
          marginBottom: "var(--space-6)",
        }}
      >
        <LinkedRosterPanel />
        <CommissionerChatHome />
        <WeeklyH2hPanel />
      </div>
      <div className="activity-grid">
        <ActivityTile to="/league-mgmt/manage-league" icon={CalendarDays} title="Manage League" description="Find a team, assign a coach, and enter its schedule and scores." />
        <ActivityTile to="/league-mgmt/advance" icon={FastForward} title="Advance" description="Score entry, division winners, and next-advance scheduling." />
        <ActivityTile to="/league-mgmt/settings" icon={SlidersHorizontal} title="Settings" description="Economy, rules, gameplay, first-time setup, and more." />
      </div>
    </div>
  );
}
