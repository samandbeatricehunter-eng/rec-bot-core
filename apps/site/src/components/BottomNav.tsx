import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { useSiteActivity } from "../lib/site-activity-context.js";
import {
  IconAccount,
  IconComp,
  IconHome,
  IconInbox,
  IconLeagues,
  IconMore,
} from "./icons.js";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: ReactNode;
  action?: "more";
  badge?: number;
};

export type BottomNavLayout = "bottom" | "sidebar";

function isActivePath(pathname: string, to: string) {
  if (to === "/home") return pathname === "/home" || pathname === "/";
  if (to === "/tournaments") return pathname === "/tournaments" || pathname.startsWith("/tournaments/") || pathname === "/comp" || pathname.startsWith("/comp/");
  return pathname === to || pathname.startsWith(`${to}/`);
}

// One constant global nav — Home/Leagues/Comp/Messages/(More|Account) — for every scope,
// including inside a league. League-specific navigation (Buzz/Matchups/Team/Store/Mgmt) lives
// in LeagueTopNav, rendered in the page body by league-scoped routes, not swapped in here.
function globalItems(unreadMessages: number): NavItem[] {
  return [
    { key: "home", label: "Home", to: "/home", icon: <IconHome /> },
    { key: "leagues", label: "Leagues", to: "/leagues", icon: <IconLeagues /> },
    { key: "comp", label: "Tournaments", to: "/tournaments", icon: <IconComp /> },
    { key: "messages", label: "Messages", to: "/inbox", icon: <IconInbox />, badge: unreadMessages },
    {
      key: "account",
      label: "My Account",
      to: "/account",
      icon: <IconAccount />,
    },
  ];
}

export function BottomNav({ layout = "bottom" }: { layout?: BottomNavLayout }) {
  const auth = useAuth();
  const { counts } = useSiteActivity();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const baseItems: NavItem[] = globalItems(counts.unreadMessages);
  // On the mobile bottom bar (not the desktop sidebar, which has room to show every item
  // directly), the last slot becomes a "More" popup instead of a direct link to My Account —
  // that's where My Account, Help/FAQ, and Log Out live instead.
  const items: NavItem[] =
    layout === "bottom"
      ? [...baseItems.slice(0, -1), { key: "more", label: "More", icon: <IconMore />, action: "more" }]
      : baseItems;

  async function handleSignOut() {
    setSignOutBusy(true);
    try {
      await auth.signOut();
    } finally {
      setSignOutBusy(false);
      setMoreOpen(false);
    }
  }

  const showLabelsAlways = true;
  const navClass = layout === "sidebar" ? "site-sidebar-nav" : "site-bottom-nav";
  const btnClass = layout === "sidebar" ? "site-sidebar-nav-btn" : "site-bottom-nav-btn";

  return (
    <>
      <nav className={navClass} aria-label="Global">
        {items.map((item) => {
          if (item.action === "more") {
            const active = moreOpen;
            return (
              <button
                key={item.key}
                type="button"
                aria-expanded={active}
                className={[btnClass, active ? "is-active" : ""].filter(Boolean).join(" ")}
                onClick={() => setMoreOpen((value) => !value)}
              >
                {item.icon}
                {showLabelsAlways || active ? <span>{item.label}</span> : null}
              </button>
            );
          }
          const to = item.to!;
          const active = isActivePath(location.pathname, to);
          return (
            <NavLink
              key={item.key}
              to={to}
              end={item.key === "home" || item.key === "leagues"}
              className={[btnClass, active ? "is-active" : ""].filter(Boolean).join(" ")}
            >
              <span className="site-bottom-nav-icon-wrap">
                {item.icon}
                {item.badge ? (
                  <span className="site-bottom-nav-badge">{item.badge > 9 ? "9+" : item.badge}</span>
                ) : null}
              </span>
              {showLabelsAlways || active ? <span>{item.label}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      {moreOpen ? (
        <div className="site-account-menu" role="dialog" aria-modal="true" aria-label="More">
          <button
            type="button"
            className="site-account-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="site-account-menu-panel">
            <NavLink to="/account" role="menuitem" className="site-account-menu-item" onClick={() => setMoreOpen(false)}>
              My Account
            </NavLink>
            <NavLink to="/help" role="menuitem" className="site-account-menu-item" onClick={() => setMoreOpen(false)}>
              Help / FAQ
            </NavLink>
            <button
              type="button"
              role="menuitem"
              className="site-account-menu-item is-danger"
              disabled={signOutBusy}
              onClick={() => void handleSignOut()}
            >
              {signOutBusy ? "Logging out…" : "Log Out"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
