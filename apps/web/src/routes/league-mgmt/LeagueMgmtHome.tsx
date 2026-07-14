import { CalendarDays, DollarSign, FastForward, GraduationCap, Newspaper, SlidersHorizontal } from "lucide-react";
import { ActivityTile } from "../../components/ui/ActivityTile.js";
import { LinkedRosterPanel } from "../../components/home/LinkedRosterPanel.js";
import { WeeklyH2hPanel } from "../../components/home/WeeklyH2hPanel.js";
import { CommissionerChatHome } from "./commissioner-chat/CommissionerChatHome.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";

export function LeagueMgmtHome() {
  // Recruiting/Transfer Portal only make sense for CFB leagues (class year, star rating
  // aren't Madden concepts) — gated off the theme context AppShell already provides, no
  // extra fetch needed on this otherwise-static page.
  const { game } = useLeagueTheme();
  const isCfb = game === "cfb_27";

  return (
    <div>
      <div className="league-home-panels">
        <LinkedRosterPanel />
        <CommissionerChatHome />
        <WeeklyH2hPanel />
      </div>
      <div className="activity-grid">
        <ActivityTile to="/league-mgmt/manage-league" icon={CalendarDays} title="Manage League" description="Find a team, assign a coach, and enter its schedule and scores." />
        <ActivityTile to="/league-mgmt/advance" icon={FastForward} title="Advance" description="Score entry, GOTW settlement, game channels, and next-advance scheduling." />
        <ActivityTile to="/league-mgmt/payouts" icon={DollarSign} title="Pending Payouts" description="Review, adjust, approve, or reject EOS payout ledgers." />
        <ActivityTile to="/league-mgmt/settings" icon={SlidersHorizontal} title="Settings" description="Economy, rules, gameplay, first-time setup, and more." />
        <ActivityTile to="/league-mgmt/publishing" icon={Newspaper} title="League Publishing" description="Publish Hub announcements, headlines, and roundtable articles." />
        {isCfb && <ActivityTile to="/league-mgmt/recruiting" icon={GraduationCap} title="Recruiting & Transfers" description="Track incoming recruits and outgoing transfers, with auto-generated headlines." />}
      </div>
    </div>
  );
}
