import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type SiteNotificationItem } from "../lib/site-api.js";
import { useSiteActivity } from "../lib/site-activity-context.js";
import { IconBell } from "./icons.js";

export function NotificationsBell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const { counts, refresh: refreshCounts } = useSiteActivity();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regular, setRegular] = useState<SiteNotificationItem[]>([]);
  const [commissioner, setCommissioner] = useState<SiteNotificationItem[]>([]);
  const [clearing, setClearing] = useState(false);
  // Closed-bell badge comes from the shared, lightly-polled counts context (see
  // site-activity-context.tsx) instead of this component fetching the full lists on its own
  // 45s timer just to derive a number. Full lists still load below only when the panel opens.
  const unreadCount = counts.unreadNotifications + counts.unreadCommissionerItems;

  async function refreshLists() {
    if (auth.status !== "signed-in") return;
    setLoading(true);
    setError(null);
    try {
      const response = await siteApi.listNotifications();
      setRegular(response.regular);
      setCommissioner(response.commissioner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
      setRegular([]);
      setCommissioner([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshLists();
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
    const isStoredUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id);
    if (!item.read && isStoredUuid) {
      try {
        await siteApi.markNotificationsRead([item.id]);
        setRegular((items) =>
          items.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
        );
        refreshCounts();
      } catch {
        /* navigation still proceeds */
      }
    }
    navigate(item.href);
  }

  async function openCommissionerItem(item: SiteNotificationItem) {
    setOpen(false);
    if (!item.read && item.leagueId) {
      try {
        await siteApi.markCommissionerLeaguesViewed([item.leagueId]);
        setCommissioner((items) =>
          items.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
        );
        refreshCounts();
      } catch {
        /* navigation still proceeds */
      }
    }
    navigate(item.href);
  }

  async function clearAll() {
    setClearing(true);
    try {
      await siteApi.clearNotifications();
      setRegular([]);
      refreshCounts();
    } catch {
      /* leave list as-is on failure */
    } finally {
      setClearing(false);
    }
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
        <>
          <button
            type="button"
            className="site-notif-backdrop"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="site-notif-panel" role="dialog" aria-label="Notifications">
          <header className="site-notif-panel-header">
            <h2>Notifications</h2>
            {loading ? (
              <span className="site-muted">Updating…</span>
            ) : regular.length > 0 ? (
              <button
                type="button"
                className="site-text-link"
                disabled={clearing}
                onClick={() => void clearAll()}
              >
                {clearing ? "Clearing…" : "Clear"}
              </button>
            ) : null}
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
            <section className="site-notif-section">
              <h3>Commissioner</h3>
              <ul>
                {commissioner.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.read ? undefined : "is-unread"}
                      onClick={() => void openCommissionerItem(item)}
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
        </>
      ) : null}
    </div>
  );
}
