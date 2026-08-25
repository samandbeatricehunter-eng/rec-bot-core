import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { useHub } from "../lib/hub-context.js";
import type { SiteLeagueSummary } from "../lib/site-api.js";
import { NotificationsBell } from "./NotificationsBell.js";
import { ProfileChip } from "./ProfileChip.js";
import { TeamLogo } from "@rec/hub-ui";
import { IconChevronDown, IconGear, IconHome, IconLeagues, IconComp } from "./icons.js";
import { LeagueRow3 } from "./LeagueRow3.js";
import { useHeaderMenu } from "./HeaderMenu.js";

function sortLeagues(leagues: SiteLeagueSummary[]) {
  const rank = (league: SiteLeagueSummary) => {
    const role = league.commissionerRole ?? (league.isCommissioner ? "co" : "member");
    if (role === "head") return 0;
    if (role === "co") return 1;
    return 2;
  };
  return [...leagues].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

/** Row 1: brand, username, inbox bell, account gear. Global, identical on every page. */
function HeaderRow1() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { triggerRef, open: gearOpen, setOpen: setGearOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const [signOutBusy, setSignOutBusy] = useState(false);

  async function handleSignOut() {
    setSignOutBusy(true);
    try {
      await auth.signOut();
    } finally {
      setSignOutBusy(false);
      setGearOpen(false);
    }
  }

  return (
    <div className="site-header-row1">
      <NavLink to="/home" className="site-header-brand">REC-Leagues.com</NavLink>
      <div className="site-header-row1-end">
        <ProfileChip />
        <NotificationsBell />
        <div className="site-header-gear">
          <button ref={triggerRef} type="button" className="site-header-icon-btn" aria-label="Settings" aria-expanded={gearOpen} onClick={() => setGearOpen((v) => !v)}>
            <IconGear />
          </button>
          <Panel className="site-header-dropdown-panel" role="menu">
            <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setGearOpen(false); navigate("/account"); }}>My Account</button>
            <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { setGearOpen(false); navigate("/help"); }}>Help / FAQ</button>
            <button type="button" role="menuitem" className="site-account-menu-item is-danger" disabled={signOutBusy} onClick={() => void handleSignOut()}>
              {signOutBusy ? "Signing out…" : "Sign Out"}
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Row 2: "My Leagues" switcher. Reads/writes hub scope -- no local duplicate state. */
function HeaderRow2() {
  const hub = useHub();
  const navigate = useNavigate();
  const location = useLocation();
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const leagues = sortLeagues(hub.leagues);
  const selected = hub.selectedLeague;

  function chooseLeague(league: SiteLeagueSummary) {
    setOpen(false);
    hub.selectLeague(league.id);
    if (!location.pathname.startsWith(`/l/${league.id}`)) navigate(`/l/${league.id}/buzz`);
  }

  function chooseHome() {
    setOpen(false);
    hub.exitToMain("/home");
    navigate("/home");
  }

  return (
    <div className="site-header-row2">
      <button ref={triggerRef} type="button" className="site-header-row2-trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {selected ? (
          <span className="site-header-row2-active">
            {selected.teamAbbr ? (
              <span className="site-header-row2-team">
                <TeamLogo abbreviation={selected.teamAbbr} alt="" className="site-header-row2-logo" />
                <strong className="site-header-row2-abbr">{selected.teamAbbr}</strong>
              </span>
            ) : null}
            <span className="site-header-row2-name">{selected.name}</span>
            {selected.seasonRecordText ? <span className="site-header-row2-detail">{selected.seasonRecordText}</span> : null}
            <span className="site-header-row2-detail">{selected.gameLabel}</span>
            <span className="site-header-row2-detail">{selected.currentWeek != null ? `Week ${selected.currentWeek}` : selected.seasonStageLabel}</span>
          </span>
        ) : (
          <span className="site-header-row2-active">My Leagues</span>
        )}
        <IconChevronDown className="site-header-caret" />
      </button>
      <Panel className="site-header-dropdown-panel site-header-row2-panel" role="menu">
        {hub.leaguesLoading ? <p className="site-muted">Loading leagues…</p>
          : leagues.length === 0 ? <p className="site-muted">No leagues linked yet.</p>
          : leagues.map((league) => (
            <button key={league.id} type="button" role="menuitem" className={["site-header-league-row", selected?.id === league.id ? "is-active" : ""].filter(Boolean).join(" ")} onClick={() => chooseLeague(league)}>
              {league.teamAbbr ? (
                <span className="site-header-league-row-team">
                  <TeamLogo abbreviation={league.teamAbbr} alt="" className="site-header-league-row-logo" />
                  <strong>{league.teamAbbr}</strong>
                </span>
              ) : null}
              <span className="site-header-league-row-name">{league.name}</span>
              <span className="site-header-league-row-meta">
                {league.seasonRecordText ? `${league.seasonRecordText} · ` : ""}({league.gameLabel}) · {league.currentWeek != null ? `Week ${league.currentWeek}` : league.seasonStageLabel}
              </span>
            </button>
          ))}
        <button type="button" role="menuitem" className="site-header-league-row site-header-home-row" onClick={chooseHome}>Home</button>
      </Panel>
    </div>
  );
}

const HOME_ROW3_ITEMS = [
  { key: "home", label: "Home", to: "/home", icon: <IconHome /> },
  { key: "leagues", label: "Leagues", to: "/leagues", icon: <IconLeagues /> },
  { key: "tournaments", label: "Tournaments", to: "/tournaments", icon: <IconComp /> },
];

function isActivePath(pathname: string, to: string) {
  if (to === "/home") return pathname === "/home" || pathname === "/";
  if (to === "/tournaments") return pathname === "/tournaments" || pathname.startsWith("/tournaments/");
  return pathname === to || pathname.startsWith(`${to}/`);
}

function HomeRow3() {
  const location = useLocation();
  return (
    <nav className="site-header-row3 site-header-row3-home" aria-label="Site">
      {HOME_ROW3_ITEMS.map((item) => (
        <NavLink key={item.key} to={item.to} className={["site-header-row3-btn", isActivePath(location.pathname, item.to) ? "is-active" : ""].filter(Boolean).join(" ")}>
          {item.icon}<span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Single global chrome header: 3 rows, one component, CSS breakpoints handle desktop vs mobile. */
export function SiteHeader() {
  const hub = useHub();
  const isLeague = hub.scope.kind === "league";
  return (
    <header className="site-header">
      <HeaderRow1 />
      <HeaderRow2 />
      {isLeague && hub.selectedLeague ? <LeagueRow3 leagueId={hub.selectedLeague.id} isCommissioner={hub.selectedLeague.isCommissioner} /> : <HomeRow3 />}
    </header>
  );
}
