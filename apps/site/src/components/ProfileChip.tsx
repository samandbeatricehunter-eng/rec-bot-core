import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type LinkProfileResponse } from "../lib/site-api.js";
import { useHeaderMenu } from "./HeaderMenu.js";
import { IconSliders } from "./icons.js";

/** Username + account-menu trigger. The trigger button (left of the name) doubles as what used
 * to be a separate far-right gear icon opening My Account / Help / Sign Out -- merged here so
 * there's one account control instead of two. Shows the site username only: no Discord name in
 * parentheses (formatUserIdentity's job elsewhere, e.g. AccountHub's linked-accounts section, is
 * to surface that; the header is not the place for it) and no subscription tier. */
export function ProfileChip() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const [signOutBusy, setSignOutBusy] = useState(false);

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
      <button ref={triggerRef} type="button" className="site-profile-avatar-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <IconSliders />
      </button>
      <span className="site-profile-meta">
        <strong>{name}</strong>
      </span>
      <Panel className="site-header-dropdown-panel" role="menu">
        <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setOpen(false); navigate("/account"); }}>My Account</button>
        <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setOpen(false); navigate("/help"); }}>Help / FAQ</button>
        <button type="button" role="menuitem" className="site-account-menu-item is-danger" disabled={signOutBusy} onClick={() => void handleSignOut()}>
          {signOutBusy ? "Signing out…" : "Sign Out"}
        </button>
      </Panel>
    </div>
  );
}
