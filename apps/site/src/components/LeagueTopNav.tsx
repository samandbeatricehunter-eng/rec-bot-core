import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import {
  IconBuzz,
  IconMatchups,
  IconMenu,
  IconMgmt,
  IconRetire,
  IconRoster,
  IconStore,
  IconTeam,
  IconWager,
} from "./icons.js";

function buzzLabelForGame(game: string | null | undefined): string {
  if (game && game.startsWith("madden")) return "Breaking News";
  return "Campus Buzz";
}

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

// In-page, league-scoped navigation. Sits at the top of the page body on league routes so the
// global bottom nav (Home/Leagues/Comp/Messages/More) can stay constant everywhere — this is
// what used to swap onto the bottom bar itself.
export function LeagueTopNav({ leagueId }: { leagueId: string }) {
  const hub = useHub();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);

  const isCommissioner = hub.selectedLeague?.isCommissioner ?? false;
  const game = hub.selectedLeague?.game;

  const items = [
    { key: "buzz", label: buzzLabelForGame(game), to: `/l/${leagueId}/buzz`, icon: <IconBuzz /> },
    { key: "matchups", label: "Matchups", to: `/l/${leagueId}/matchups`, icon: <IconMatchups /> },
    { key: "team", label: "My team", to: `/l/${leagueId}/team`, icon: <IconTeam /> },
    { key: "store", label: "Store", to: `/l/${leagueId}/store`, icon: <IconStore /> },
    { key: "wagers", label: "Wagers", to: `/l/${leagueId}/wagers`, icon: <IconWager /> },
    { key: "roster", label: "Roster", to: `/l/${leagueId}/roster`, icon: <IconRoster /> },
  ];

  async function confirmRetire() {
    setRetireBusy(true);
    setRetireError(null);
    try {
      await hub.retireFromLeague(leagueId);
      setRetireOpen(false);
      setMenuOpen(false);
    } catch (error) {
      setRetireError(error instanceof Error ? error.message : "Failed to retire.");
    } finally {
      setRetireBusy(false);
    }
  }

  return (
    <>
      <nav className="site-league-top-nav" aria-label="League">
        {items.map((item) => {
          const active = isActive(location.pathname, item.to);
          return (
            <NavLink
              key={item.key}
              to={item.to}
              className={["site-league-top-nav-btn", active ? "is-active" : ""].filter(Boolean).join(" ")}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={["site-league-top-nav-btn", "site-league-top-nav-menu", menuOpen ? "is-active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-expanded={menuOpen}
          aria-label="League menu"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <IconMenu />
          <span>League</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="site-league-menu" role="dialog" aria-modal="true" aria-label="League menu">
          <button
            type="button"
            className="site-league-menu-backdrop"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="site-league-menu-panel">
            {isCommissioner ? (
              <NavLink
                to={`/l/${leagueId}/mgmt`}
                role="menuitem"
                className="site-account-menu-item"
                onClick={() => setMenuOpen(false)}
              >
                <IconMgmt /> League Mgmt
              </NavLink>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="site-account-menu-item"
                onClick={() => {
                  setRetireError(null);
                  setRetireOpen(true);
                }}
              >
                <IconRetire /> Retire from league
              </button>
            )}
          </div>
        </div>
      ) : null}

      {retireOpen ? (
        <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="retire-title">
          <button
            type="button"
            className="site-modal-backdrop"
            aria-label="Close"
            onClick={() => (!retireBusy ? setRetireOpen(false) : undefined)}
          />
          <div className="site-modal-panel">
            <h2 id="retire-title">Retire from league?</h2>
            <p>Are you sure you want to retire from this league? Your team will become open.</p>
            {retireError ? <p className="site-auth-error">{retireError}</p> : null}
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
