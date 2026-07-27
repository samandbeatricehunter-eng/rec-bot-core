import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { CommissionerPendingSummary } from "../../types/api.js";

const POLL_MS = 45_000;

export function HubNotificationsBell() {
  const auth = useAuth();
  const hub = useHubChrome();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CommissionerPendingSummary | null>(null);

  const canManage = hub.currentLeague?.isCommissioner ?? false;
  const leagueId = hub.currentLeague?.id ?? null;

  async function refresh() {
    if (auth.status !== "ready") return;
    setLoading(true);
    setError(null);
    try {
      // Phase 1: no Discord-user member updates API — Updates stays empty.
      if (canManage && leagueId) {
        const res = await recApi.getCommissionerPendingSummary(auth.guildId, auth.discordId, leagueId);
        setSummary(res.summary);
      } else {
        setSummary(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  function openPendingItems() {
    setOpen(false);
    if (auth.status === "ready" && leagueId && summary?.unread) {
      void recApi.markCommissionerLeagueViewed(auth.guildId, auth.discordId, leagueId).catch(() => undefined);
      setSummary((prev) => (prev ? { ...prev, unread: false } : prev));
    }
    navigate("/league-mgmt/notifications");
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
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, canManage, leagueId]);

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

  const unreadCount = summary?.unread ? summary.pendingCount : 0;

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
        <>
          <button
            type="button"
            className="hub-chrome-notif-backdrop"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
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
              <ul>
                {summary && summary.pendingCount > 0 ? (
                  <li>
                    <button
                      type="button"
                      className={summary.unread ? "is-unread" : undefined}
                      onClick={openPendingItems}
                    >
                      <span className="hub-chrome-notif-title">
                        You have {summary.pendingCount} pending item{summary.pendingCount === 1 ? "" : "s"} in {summary.leagueName}
                      </span>
                      <span className="hub-chrome-notif-body">{summary.gameLabel} · League Mgmt · Payouts</span>
                    </button>
                  </li>
                ) : (
                  <li>
                    <p className="hub-chrome-notif-section-note">Inbox is clear.</p>
                  </li>
                )}
              </ul>
            </section>
          ) : null}
        </div>
        </>
      ) : null}
    </div>
  );
}
