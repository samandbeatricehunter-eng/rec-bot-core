import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { CommissionerNotification } from "../../types/api.js";

const POLL_MS = 45_000;

export function HubNotificationsBell() {
  const auth = useAuth();
  const hub = useHubChrome();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commissioner, setCommissioner] = useState<CommissionerNotification[]>([]);

  const canManage = hub.currentLeague?.isCommissioner ?? false;

  async function refresh() {
    if (auth.status !== "ready") return;
    setLoading(true);
    setError(null);
    try {
      // Phase 1: no Discord-user member updates API — Updates stays empty.
      if (canManage) {
        const res = await recApi.listCommissionerNotifications(auth.guildId);
        setCommissioner(res.notifications);
      } else {
        setCommissioner([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
      setCommissioner([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function load() {
      void refresh();
    }
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener("rec:notifications-changed", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("rec:notifications-changed", load);
    };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, canManage]);

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

  const unreadCount = commissioner.length;

  return (
    <div className="hub-chrome-notif-bell" ref={rootRef}>
      <button
        type="button"
        className="hub-chrome-notif-bell-trigger"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} pending` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} />
        {unreadCount > 0 ? (
          <span className="hub-chrome-notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="hub-chrome-notif-panel" role="dialog" aria-label="Notifications">
          <header className="hub-chrome-notif-panel-header">
            <h2>Notifications</h2>
            {loading ? <span className="hub-chrome-muted">Updating…</span> : null}
          </header>
          {error ? <p className="hub-chrome-modal-error">{error}</p> : null}

          <section className="hub-chrome-notif-section">
            <h3>Updates</h3>
            <p className="hub-chrome-notif-section-note">No member updates yet.</p>
          </section>

          {canManage ? (
            <section className="hub-chrome-notif-section hub-chrome-notif-section-commish">
              <h3>Commissioner</h3>
              <p className="hub-chrome-notif-section-note">
                Pending Office inbox items — open League Mgmt for full review.
              </p>
              <ul>
                <li>
                  <button
                    type="button"
                    className="is-inbox-link"
                    onClick={() => {
                      setOpen(false);
                      navigate("/league-mgmt/notifications");
                    }}
                  >
                    <span className="hub-chrome-notif-title">
                      Open {hub.currentLeague?.name ?? "league"} commissioner inbox
                    </span>
                    <span className="hub-chrome-notif-body">League Mgmt · Office</span>
                  </button>
                </li>
                {commissioner.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="is-unread"
                      onClick={() => {
                        setOpen(false);
                        navigate("/league-mgmt/notifications");
                      }}
                    >
                      <span className="hub-chrome-notif-title">{item.title}</span>
                      {item.subtitle ? (
                        <span className="hub-chrome-notif-body">{item.subtitle}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {commissioner.length === 0 ? (
                  <li>
                    <p className="hub-chrome-notif-section-note">Inbox is clear.</p>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
