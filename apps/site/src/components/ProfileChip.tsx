import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type LinkProfileResponse, type SiteNotificationItem } from "../lib/site-api.js";
import { useSiteActivity } from "../lib/site-activity-context.js";
import { useHeaderMenu } from "./HeaderMenu.js";
import { IconSliders } from "./icons.js";

/** Username + account drawer. Consolidates what used to be three separate header controls
 * (a far-right settings gear, the notifications bell, and this profile chip) into one: the
 * trigger opens a single drawer with notifications as its top section, followed by the
 * account actions the gear used to hold (My Account / Help / Sign Out). Shows the site
 * username only: no Discord name in parentheses (formatUserIdentity's job elsewhere, e.g.
 * AccountHub's linked-accounts section, is to surface that) and no subscription tier. */
export function ProfileChip() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const [signOutBusy, setSignOutBusy] = useState(false);

  const { counts, refresh: refreshCounts } = useSiteActivity();
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [regular, setRegular] = useState<SiteNotificationItem[]>([]);
  const [commissioner, setCommissioner] = useState<SiteNotificationItem[]>([]);
  const [clearing, setClearing] = useState(false);
  const unreadCount = counts.unreadNotifications + counts.unreadCommissionerItems;

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setProfile(null);
      return;
    }
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  async function refreshNotifLists() {
    if (auth.status !== "signed-in") return;
    setNotifLoading(true);
    setNotifError(null);
    try {
      const response = await siteApi.listNotifications();
      setRegular(response.regular);
      setCommissioner(response.commissioner);
    } catch (err) {
      setNotifError(err instanceof Error ? err.message : "Could not load notifications.");
      setRegular([]);
      setCommissioner([]);
    } finally {
      setNotifLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshNotifLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (auth.status !== "signed-in") return null;

  const name = profile?.username?.trim() || profile?.displayName?.trim() || auth.user.email?.split("@")[0] || "Member";

  async function handleSignOut() {
    setSignOutBusy(true);
    try {
      await auth.signOut();
    } finally {
      setSignOutBusy(false);
      setOpen(false);
    }
  }

  async function openItem(item: SiteNotificationItem) {
    setOpen(false);
    const isStoredUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id);
    if (!item.read && isStoredUuid) {
      try {
        await siteApi.markNotificationsRead([item.id]);
        setRegular((items) => items.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
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
        setCommissioner((items) => items.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
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
    <div className="site-profile-chip">
      <button
        ref={triggerRef}
        type="button"
        className="site-profile-avatar-btn"
        aria-label={unreadCount > 0 ? `Account menu, ${unreadCount} unread notifications` : "Account menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconSliders />
        {unreadCount > 0 ? <span className="site-notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      <span className="site-profile-meta">
        <strong>{name}</strong>
      </span>
      <Panel className="site-account-drawer" role="dialog" ariaLabel="Account and notifications">
        <section className="site-notif-section">
          <header className="site-notif-panel-header">
            <h2>Notifications{unreadCount > 0 ? ` (${unreadCount > 99 ? "99+" : unreadCount})` : ""}</h2>
            {notifLoading ? (
              <span className="site-muted">Updating…</span>
            ) : regular.length > 0 ? (
              <button type="button" className="site-text-link" disabled={clearing} onClick={() => void clearAll()}>
                {clearing ? "Clearing…" : "Clear"}
              </button>
            ) : null}
          </header>
          {notifError ? <p className="site-auth-error">{notifError}</p> : null}
          <h3>Updates</h3>
          {regular.length === 0 ? (
            <p className="site-muted">No notifications yet.</p>
          ) : (
            <ul>
              {regular.map((item) => (
                <li key={item.id}>
                  <button type="button" className={item.read ? undefined : "is-unread"} onClick={() => void openItem(item)}>
                    <span className="site-notif-title">{item.title}</span>
                    {item.body ? <span className="site-notif-body">{item.body}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {commissioner.length > 0 ? (
            <>
              <h3>Commissioner</h3>
              <ul>
                {commissioner.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={item.read ? undefined : "is-unread"} onClick={() => void openCommissionerItem(item)}>
                      <span className="site-notif-title">{item.title}</span>
                      {item.body ? <span className="site-notif-body">{item.body}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <div className="site-account-drawer-divider" />
        <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setOpen(false); navigate("/account"); }}>My Account</button>
        <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setOpen(false); navigate("/help"); }}>Help / FAQ</button>
        <button type="button" role="menuitem" className="site-account-menu-item is-danger" disabled={signOutBusy} onClick={() => void handleSignOut()}>
          {signOutBusy ? "Signing out…" : "Sign Out"}
        </button>
      </Panel>
    </div>
  );
}
