import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import {
  Home,
  Layers,
  Newspaper,
  Trophy,
  UserRound,
  CalendarDays,
  ShoppingBag,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useHubChrome } from "../../lib/hub-chrome-context.js";

type NavItem = {
  key: string;
  label: string;
  to?: string;
  icon: ReactNode;
  action?: "retire";
  match?: (pathname: string, search: string) => boolean;
};

export type BottomNavVariant = "auto" | "global" | "league";
export type BottomNavLayout = "bottom" | "sidebar";

function isActivePath(pathname: string, to: string) {
  const pathOnly = to.split("?")[0] ?? to;
  if (pathOnly === "/home" || pathOnly === "/") {
    return pathname === "/home" || pathname === "/";
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function globalItems(): NavItem[] {
  return [
    { key: "home", label: "Home", to: "/home", icon: <Home size={22} /> },
    { key: "leagues", label: "Leagues", to: "/leagues", icon: <Layers size={22} /> },
    {
      key: "headlines",
      label: "Headlines",
      to: "/headlines",
      icon: <Newspaper size={22} />,
    },
    { key: "comp", label: "Comp", to: "/comp", icon: <Trophy size={22} /> },
    {
      key: "account",
      label: "My Account",
      to: "/account",
      icon: <UserRound size={22} />,
    },
  ];
}

function buzzLabelForGame(_game: string | null | undefined): string {
  return "Campus Buzz";
}

function leagueItems(isCommissioner: boolean, game?: string | null): NavItem[] {
  return [
    {
      key: "buzz",
      label: buzzLabelForGame(game),
      to: "/?section=league&subTab=buzz",
      icon: <Newspaper size={22} />,
      match: (pathname, search) =>
        (pathname === "/" || pathname === "/home") &&
        (new URLSearchParams(search).get("subTab") === "buzz" ||
          ((!new URLSearchParams(search).get("section") ||
            new URLSearchParams(search).get("section") === "league") &&
            !new URLSearchParams(search).get("subTab"))),
    },
    {
      key: "matchups",
      label: "Matchups",
      to: "/?section=league&subTab=matchups",
      icon: <CalendarDays size={22} />,
      match: (pathname, search) =>
        (pathname === "/" || pathname === "/home") &&
        new URLSearchParams(search).get("subTab") === "matchups",
    },
    {
      key: "team",
      label: "My Team",
      to: "/?section=team",
      icon: <UserRound size={22} />,
      match: (pathname, search) =>
        (pathname === "/" || pathname === "/home") &&
        new URLSearchParams(search).get("section") === "team",
    },
    {
      key: "store",
      label: "Store",
      to: "/?section=store",
      icon: <ShoppingBag size={22} />,
      match: (pathname, search) =>
        (pathname === "/" || pathname === "/home") &&
        new URLSearchParams(search).get("section") === "store",
    },
    isCommissioner
      ? {
          key: "mgmt",
          label: "League Mgmt",
          to: "/league-mgmt",
          icon: <ShieldCheck size={22} />,
        }
      : {
          key: "retire",
          label: "Retire",
          icon: <LogOut size={22} />,
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
  const hub = useHubChrome();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);

  const inLeague = hub.scope.kind === "league";
  const isCommissioner = hub.currentLeague?.isCommissioner ?? false;
  const section = searchParams.get("section");
  const subTab = searchParams.get("subTab");

  const useLeague =
    variant === "league" || (variant === "auto" && inLeague);
  const items: NavItem[] = useLeague
    ? leagueItems(isCommissioner, hub.currentLeague?.game)
    : globalItems();

  const showLabelsAlways = layout === "sidebar";
  const navClass =
    layout === "sidebar" ? "hub-chrome-sidebar-nav" : "hub-chrome-bottom-nav";
  const btnClass =
    layout === "sidebar"
      ? "hub-chrome-sidebar-nav-btn"
      : "hub-chrome-bottom-nav-btn";

  // On league-mgmt routes, force League Mgmt tab active when in league scope.
  const onLeagueMgmt = location.pathname.startsWith("/league-mgmt");

  async function confirmRetire() {
    setRetireBusy(true);
    setRetireError(null);
    try {
      await hub.retireFromCurrentLeague();
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
          const search = location.search.startsWith("?")
            ? location.search.slice(1)
            : location.search;
          let active = item.match
            ? item.match(location.pathname, search)
            : isActivePath(location.pathname, to.split("?")[0] ?? to);
          if (item.key === "mgmt" && onLeagueMgmt) active = true;
          if (item.key === "buzz" && onLeagueMgmt) active = false;
          // Keep buzz default when on hub with no params and league scope
          if (
            item.key === "buzz" &&
            (location.pathname === "/" || location.pathname === "/home") &&
            !section &&
            !subTab &&
            !onLeagueMgmt
          ) {
            active = true;
          }
          // In league scope, only the league under MY LEAGUES is active — not Home/Leagues.
          if (
            !useLeague &&
            hub.scope.kind === "league" &&
            (item.key === "home" || item.key === "leagues")
          ) {
            active = false;
          }
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

      {retireOpen ? (
        <div
          className="hub-chrome-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="retire-title"
        >
          <button
            type="button"
            className="hub-chrome-modal-backdrop"
            aria-label="Close"
            onClick={() => (!retireBusy ? setRetireOpen(false) : undefined)}
          />
          <div className="hub-chrome-modal-panel">
            <h2 id="retire-title">Retire from league?</h2>
            <p>
              Are you sure you want to retire from this league? Your team will
              become open.
            </p>
            {retireError ? (
              <p className="hub-chrome-modal-error">{retireError}</p>
            ) : null}
            <div className="hub-chrome-modal-actions">
              <button
                type="button"
                className="hub-chrome-btn hub-chrome-btn-ghost"
                disabled={retireBusy}
                onClick={() => setRetireOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hub-chrome-btn hub-chrome-btn-primary"
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
