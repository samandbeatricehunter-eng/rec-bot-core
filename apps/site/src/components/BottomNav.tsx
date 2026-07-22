import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import {
  IconAccount,
  IconBuzz,
  IconComp,
  IconHeadlines,
  IconHome,
  IconLeagues,
  IconMatchups,
  IconMgmt,
  IconRetire,
  IconStore,
  IconTeam,
} from "./icons.js";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: ReactNode;
  action?: "retire";
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
    {
      key: "headlines",
      label: "Headlines",
      to: "/headlines",
      icon: <IconHeadlines />,
    },
    { key: "comp", label: "Comp", to: "/comp", icon: <IconComp /> },
    {
      key: "account",
      label: "My Account",
      to: "/account",
      icon: <IconAccount />,
    },
  ];
}

function leagueItems(leagueId: string, isCommissioner: boolean): NavItem[] {
  return [
    {
      key: "buzz",
      label: "Campus Buzz",
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
  const location = useLocation();
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);

  const leagueId =
    hub.scope.kind === "league" ? hub.scope.leagueId : null;
  const isCommissioner = hub.selectedLeague?.isCommissioner ?? false;

  const useLeague =
    variant === "league" ||
    (variant === "auto" && leagueId != null);
  const items: NavItem[] =
    useLeague && leagueId != null
      ? leagueItems(leagueId, isCommissioner)
      : globalItems();

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
          const active = isActivePath(location.pathname, to);
          return (
            <NavLink
              key={item.key}
              to={to}
              className={({ isActive }) =>
                [btnClass, isActive || active ? "is-active" : ""]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              {item.icon}
              {showLabelsAlways || active ? <span>{item.label}</span> : null}
            </NavLink>
          );
        })}
      </nav>

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
