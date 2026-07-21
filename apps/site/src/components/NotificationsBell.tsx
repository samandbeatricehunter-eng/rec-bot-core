import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type SiteNotificationItem } from "../lib/site-api.js";
import { IconBell } from "./icons.js";

export function NotificationsBell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regular, setRegular] = useState<SiteNotificationItem[]>([]);
  const [commissioner, setCommissioner] = useState<SiteNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function refresh() {
    if (auth.status !== "signed-in") return;
    setLoading(true);
    setError(null);
    try {
      const response = await siteApi.listNotifications();
      setRegular(response.regular);
      setCommissioner(response.commissioner);
      setUnreadCount(response.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
      setRegular([]);
      setCommissioner([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(timer);
  }, [auth.status]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(item: SiteNotificationItem) {
    setOpen(false);
    if (!item.read && !item.id.startsWith("commish:") && !item.id.startsWith("inbox-link:")) {
      try {
        await siteApi.markNotificationsRead([item.id]);
        setUnreadCount((count) => Math.max(0, count - 1));
        setRegular((items) =>
          items.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
        );
      } catch {
        /* navigation still proceeds */
      }
    }
    navigate(item.href);
  }

  return (
    <div className="site-notif-bell" ref={rootRef}>
      <button
        type="button"
        className="site-notif-bell-trigger"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconBell />
        {unreadCount > 0 ? (
          <span className="site-notif-bell-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="site-notif-panel" role="dialog" aria-label="Notifications">
          <header className="site-notif-panel-header">
            <h2>Notifications</h2>
            {loading ? <span className="site-muted">Updating…</span> : null}
          </header>
          {error ? <p className="site-auth-error">{error}</p> : null}

          <section className="site-notif-section">
            <h3>Updates</h3>
            {regular.length === 0 ? (
              <p className="site-muted">No notifications yet.</p>
            ) : (
              <ul>
                {regular.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.read ? undefined : "is-unread"}
                      onClick={() => void openItem(item)}
                    >
                      <span className="site-notif-title">{item.title}</span>
                      {item.body ? (
                        <span className="site-notif-body">{item.body}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {commissioner.length > 0 ? (
            <section className="site-notif-section site-notif-section-commish">
              <h3>Commissioner</h3>
              <p className="site-muted site-notif-section-note">
                Review items open this league&apos;s commissioner inbox — separate from
                the Commissioners Office tools in League Mgmt.
              </p>
              <ul>
                {commissioner.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={[
                        item.isInboxLink ? "is-inbox-link" : "",
                        !item.read && !item.isInboxLink ? "is-unread" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                      onClick={() => void openItem(item)}
                    >
                      <span className="site-notif-title">{item.title}</span>
                      {item.body ? (
                        <span className="site-notif-body">{item.body}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
