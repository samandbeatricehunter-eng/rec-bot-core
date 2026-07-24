import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";
import { IconInbox } from "./icons.js";

export function MessagesLink() {
  const auth = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setUnread(0);
      return;
    }
    let cancelled = false;
    async function refresh() {
      try {
        const response = await siteApi.listConversations();
        const count = (response.conversations ?? []).filter((row) => row.unread).length;
        if (!cancelled) setUnread(count);
      } catch {
        if (!cancelled) setUnread(0);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auth.status]);

  if (auth.status !== "signed-in") return null;

  return (
    <Link to="/inbox" className="site-messages-link" title="Messages" aria-label="Messages">
      <IconInbox />
      {unread > 0 ? <span className="site-messages-badge">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
}