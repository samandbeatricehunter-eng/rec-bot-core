import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import {
  IconAccount,
  IconBuzz,
  IconComp,
  IconHome,
  IconLeagues,
  IconMatchups,
  IconMgmt,
  IconMore,
  IconRetire,
  IconStore,
  IconTeam,
} from "./icons.js";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: ReactNode;
  action?: "retire" | "more";
};

export type BottomNavVariant = "auto" | "global" | "league";
export type BottomNavLayout = "bottom" | "sidebar";

function isActivePath(pathname: string, to: string) {
  if (to === "/home") return pathname === "/home" || pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function globalItems(): NavItem[] {
  return [
    { key: "home", label: "Home", to: "/home", icon: <IconHome /> },
    { key: "leagues", label: "Leagues", to: "/leagues", icon: <IconLeagues /> },
    { key: "comp", label: "Comp", to: "/comp", icon: <IconComp /> },
    {
      key: "account",
      label: "My Account",
      to: "/account",
      icon: <IconAccount />,
    },
  ];
}

function buzzLabelForGame(game: string | null | undefined): string {
  if (game && game.startsWith("madden")) return "Breaking News";
  return "Campus Buzz";
}

function leagueItems(leagueId: string, isCommissioner: boolean, game?: string | null): NavItem[] {
  return [
    {
      key: "buzz",
      label: buzzLabelForGame(game),
      to: `/l/${leagueId}/buzz`,
      icon: <IconBuzz />,
    },
    {
      key: "matchups",
      label: "Matchups",
      to: `/l/${leagueId}/matchups`,
      icon: <IconMatchups />,
    },
    {
      key: "team",
      label: "My Team",
      to: `/l/${leagueId}/team`,
      icon: <IconTeam />,
    },
    {
      key: "store",
      label: "Store",
      to: `/l/${leagueId}/store`,
      icon: <IconStore />,
    },
    isCommissioner
      ? {
          key: "mgmt",
          label: "League Mgmt",
          to: `/l/${leagueId}/mgmt`,
          icon: <IconMgmt />,
        }
      : {
          key: "retire",
          label: "Retire",
          icon: <IconRetire />,
          action: "retire",
        },
  ];
}

export function BottomNav({
  variant = "auto",
  layout = "bottom",
}: {
  variant?: BottomNavVariant;
  layout?: BottomNavLayout;
}) {
  const hub = useHub();
  const auth = useAuth();
  const location = useLocation();
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const leagueId =
    hub.scope.kind === "league" ? hub.scope.leagueId : null;
  const isCommissioner = hub.selectedLeague?.isCommissioner ?? false;

  const useLeague =
    variant === "league" ||
    (variant === "auto" && leagueId != null);
  const baseItems: NavItem[] =
    useLeague && leagueId != null
      ? leagueItems(leagueId, isCommissioner, hub.selectedLeague?.game)
      : globalItems();
  // On the mobile bottom bar (not the desktop sidebar, which has room to show every item
  // directly), the global scope's last slot becomes a "More" popup instead of a direct link
  // to My Account — that's where My Account, Help/FAQ, and Log Out live instead.
  const items: NavItem[] =
    !useLeague && layout === "bottom"
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

  const showLabelsAlways = layout === "sidebar";
  const navClass =
    layout === "sidebar" ? "site-sidebar-nav" : "site-bottom-nav";
  const btnClass =
    layout === "sidebar" ? "site-sidebar-nav-btn" : "site-bottom-nav-btn";

  async function confirmRetire() {
    if (!leagueId) return;
    setRetireBusy(true);
    setRetireError(null);
    try {
      await hub.retireFromLeague(leagueId);
      setRetireOpen(false);
    } catch (error) {
      setRetireError(
        error instanceof Error ? error.message : "Failed to retire.",
      );
    } finally {
      setRetireBusy(false);
    }
  }

  return (
    <>
      <nav className={navClass} aria-label={useLeague ? "League" : "Global"}>
        {items.map((item) => {
          if (item.action === "more") {
            const active = moreOpen;
            return (
              <button
                key={item.key}
                type="button"
                aria-expanded={active}
                className={[btnClass, active ? "is-active" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setMoreOpen((value) => !value)}
              >
                {item.icon}
                {showLabelsAlways || active ? <span>{item.label}</span> : null}
              </button>
            );
          }
          if (item.action === "retire") {
            const active = retireOpen;
            return (
              <button
                key={item.key}
                type="button"
                className={[btnClass, active ? "is-active" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setRetireError(null);
                  setRetireOpen(true);
                }}
              >
                {item.icon}
                {showLabelsAlways || active ? <span>{item.label}</span> : null}
              </button>
            );
          }
          const to = item.to!;
          // On league routes, only MY LEAGUES (and league bottom nav) own active state.
          const onLeagueRoute = location.pathname.startsWith("/l/");
          let active =
            !useLeague && onLeagueRoute
              ? false
              : isActivePath(location.pathname, to);
          return (
            <NavLink
              key={item.key}
              to={to}
              end={item.key === "home" || item.key === "leagues"}
              className={[btnClass, active ? "is-active" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={(event) => {
                if (!useLeague && hub.scope.kind === "league") {
                  event.preventDefault();
                  if (item.key === "home") {
                    hub.selectMainHub();
                    return;
                  }
                  hub.exitToMain(to);
                }
              }}
            >
              {item.icon}
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

      {retireOpen ? (
        <div
          className="site-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="retire-title"
        >
          <button
            type="button"
            className="site-modal-backdrop"
            aria-label="Close"
            onClick={() => (!retireBusy ? setRetireOpen(false) : undefined)}
          />
          <div className="site-modal-panel">
            <h2 id="retire-title">Retire from league?</h2>
            <p>
              Are you sure you want to retire from this league? Your team will
              become open.
            </p>
            {retireError ? (
              <p className="site-auth-error">{retireError}</p>
            ) : null}
            <div className="site-modal-actions">
              <button
                type="button"
                className="site-btn site-btn-ghost"
                disabled={retireBusy}
                onClick={() => setRetireOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="site-btn site-btn-primary"
                disabled={retireBusy}
                onClick={() => void confirmRetire()}
              >
                {retireBusy ? "Retiring..." : "Retire"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
