import { useEffect, useState } from "react";
import { Bell, CalendarDays, FastForward, MessagesSquare, Shield, SlidersHorizontal, Trash2, Users, Wand2 } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { ActivityTile } from "../../components/ui/ActivityTile.js";

export function LeagueMgmtHome() {
  const { guildId } = useReadyAuth();
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    recApi
      .listCommissionerNotifications(guildId)
      .then((res) => setNotificationCount(res.notifications.length))
      .catch(() => setNotificationCount(0));
  }, [guildId]);

  return (
    <div>
      <PageHeader title="League Mgmt" subtitle="Everything a commissioner or co-commissioner can manage, in one place." />
      <div className="activity-grid">
        <ActivityTile to="/league-mgmt/notifications" icon={Bell} title="Notifications" description="Pending payouts, purchases, and reviews awaiting action." badgeCount={notificationCount} />
        <ActivityTile to="/league-mgmt/schedule" icon={CalendarDays} title="Schedule" description="Set matchups, upload box scores, and record final scores." />
        <ActivityTile to="/league-mgmt/teams" icon={Users} title="Teams" description="Link and unlink users to teams." />
        <ActivityTile to="/league-mgmt/advance" icon={FastForward} title="Advance" description="Score entry, division winners, and next-advance scheduling." />
        <ActivityTile to="/league-mgmt/settings" icon={SlidersHorizontal} title="Settings" description="Economy, rules, gameplay, and more." />
        <ActivityTile to="/league-mgmt/roles" icon={Shield} title="Roles" description="Grant or revoke REC League roles." />
        <ActivityTile to="/league-mgmt/first-time-setup" icon={Wand2} title="First-Time Setup" description="Create a new league for this server." />
        <ActivityTile to="/league-mgmt/delete-league" icon={Trash2} title="Delete League" description="Permanently erase this server's league data." />
        <ActivityTile to="/league-mgmt/commissioner-chat" icon={MessagesSquare} title="Commissioner Chat" description="Discuss and vote on topics with your commissioners." />
      </div>
    </div>
  );
}
