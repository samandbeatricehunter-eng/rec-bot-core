import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type LinkProfileResponse } from "../lib/site-api.js";
import { useSiteActivity } from "../lib/site-activity-context.js";
import { useHeaderMenu } from "./HeaderMenu.js";
import { IconGear } from "./icons.js";

/** Settings drawer, opened from a plain gear icon (no username/avatar pill in the header
 * itself). The drawer's own top row shows the username, then a single "Notifications" row
 * (badge count only -- tapping it deep-links to the account inbox tab rather than rendering
 * the list inline here), then the account actions a settings gear would hold (My Account /
 * Help / Sign Out). */
export function ProfileChip() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const [signOutBusy, setSignOutBusy] = useState(false);

  const { counts } = useSiteActivity();
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

  return (
    <div className="site-profile-chip">
      <button
        ref={triggerRef}
        type="button"
        className="site-profile-avatar-btn"
        aria-label={unreadCount > 0 ? `Settings, ${unreadCount} unread notifications` : "Settings"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGear />
        {unreadCount > 0 ? <span className="site-notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      <Panel className="site-account-drawer" role="dialog" ariaLabel="Settings">
        <div className="site-account-drawer-user">{name}</div>
        <button
          type="button"
          role="menuitem"
          className="site-account-menu-item site-account-menu-item-notif"
          onClick={() => { setOpen(false); navigate("/account?tab=inbox"); }}
        >
          Notifications
          {unreadCount > 0 ? <span className="site-notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>
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
