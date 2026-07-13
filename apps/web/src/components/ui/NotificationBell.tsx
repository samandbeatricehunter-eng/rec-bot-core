import { Link } from "react-router-dom";
import { Bell } from "lucide-react";

export function NotificationBell({ count }: { count: number }) {
  return (
    <Link to="/league-mgmt/notifications" className="notification-bell" aria-label={`Notifications${count > 0 ? ` (${count} pending)` : ""}`}>
      <Bell size={20} />
      {count > 0 && <span className="notification-bell-count">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
