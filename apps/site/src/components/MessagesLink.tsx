import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { useSiteActivity } from "../lib/site-activity-context.js";
import { IconInbox } from "./icons.js";

export function MessagesLink() {
  const auth = useAuth();
  const { counts } = useSiteActivity();

  if (auth.status !== "signed-in") return null;

  const unread = counts.unreadMessages;
  return (
    <Link to="/inbox" className="site-messages-link" title="Messages" aria-label="Messages">
      <IconInbox />
      {unread > 0 ? <span className="site-messages-badge">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
}
