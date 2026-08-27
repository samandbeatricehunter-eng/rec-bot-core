import { type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  IconBuzz, IconHeadlines, IconMatchups, IconStats, IconBracket, IconTeam, IconMgmt,
  IconWager, IconRules, IconRetire, IconChevronDown,
} from "./icons.js";
import { useHeaderMenu } from "./HeaderMenu.js";

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Navigates to the league's buzz page with ?openModal=<key> -- HubHomeBridge (LeagueHub.tsx)
 *  reads this param on mount and calls the matching modal setter already inside HubHome, then
 *  strips it. SiteHeader/LeagueRow3 render outside HubHome's component tree (they're siblings
 *  in SiteShell, not descendants), so this query-param bridge is how a header dropdown item
 *  triggers a modal that lives as local state deep inside HubHome -- same technique
 *  HubHomeBridge already uses to sync path <-> section/subTab. */
function openModalHref(leagueId: string, modal: string) {
  return `/l/${leagueId}/buzz?openModal=${modal}`;
}

function Dropdown({ label, ariaLabel, icon, active, children }: { label: string; ariaLabel?: string; icon: ReactNode; active: boolean; children: (close: () => void) => ReactNode }) {
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const close = () => setOpen(false);

  return (
    <div className="site-header-row3-dropdown">
      <button ref={triggerRef} type="button" className={["site-header-row3-btn", active ? "is-active" : ""].filter(Boolean).join(" ")} aria-expanded={open} aria-label={label ? undefined : ariaLabel} onClick={() => setOpen((v) => !v)}>
        {icon}<span>{label}</span><IconChevronDown className="site-header-caret" />
      </button>
      <Panel className="site-header-dropdown-panel site-header-row3-panel" role="menu" ariaLabel={ariaLabel ?? label}>{children(close)}</Panel>
    </div>
  );
}

export function LeagueRow3({ leagueId, isCommissioner }: { leagueId: string; isCommissioner: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const base = `/l/${leagueId}`;

  return (
    <nav className="site-header-row3" aria-label="League">
      <NavLink to={`${base}/buzz`} className={["site-header-row3-btn", isActive(path, `${base}/buzz`) ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconBuzz /><span>Overview</span>
      </NavLink>

      <Dropdown label="News" icon={<IconHeadlines />} active={isActive(path, `${base}/news`)}>
        {(close) => <>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/news`); }}>News Room</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(openModalHref(leagueId, "interview")); }}>Submit an Interview</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(openModalHref(leagueId, "article")); }}>Post an Article</button>
        </>}
      </Dropdown>

      <NavLink to={`${base}/matchups`} className={["site-header-row3-btn", isActive(path, `${base}/matchups`) ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconMatchups /><span>Matchups</span>
      </NavLink>

      <NavLink to={`${base}/standings`} className={["site-header-row3-btn", isActive(path, `${base}/standings`) ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconBracket /><span>Standings</span>
      </NavLink>

      <Dropdown label="Stats" icon={<IconStats />} active={isActive(path, `${base}/stats`) || isActive(path, `${base}/career-stats`) || isActive(path, `${base}/records`) || isActive(path, `${base}/history`)}>
        {(close) => <>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/stats`); }}>Season Stats</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/career-stats`); }}>Career Stats</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/records`); }}>League Records</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/history`); }}>League History</button>
        </>}
      </Dropdown>

      <Dropdown label="My Team" icon={<IconTeam />} active={isActive(path, `${base}/team`) || isActive(path, `${base}/roster`) || isActive(path, `${base}/trades`) || isActive(path, `${base}/store`)}>
        {(close) => <>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(openModalHref(leagueId, "schedule")); }}>Schedule</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/roster`); }}>Rosters</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/trades`); }}>Trade Center</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(`${base}/store`); }}>Store</button>
          <button type="button" role="menuitem" className="site-account-menu-item" onClick={() => { close(); navigate(openModalHref(leagueId, "financials")); }}>Financials</button>
        </>}
      </Dropdown>

      <button type="button" className="site-header-row3-btn" onClick={() => navigate(openModalHref(leagueId, "wager"))}>
        <IconWager /><span>Wagers</span>
      </button>

      <NavLink to={`${base}/rules`} className={["site-header-row3-btn", isActive(path, `${base}/rules`) ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconRules /><span>Rules</span>
      </NavLink>

      {isCommissioner ? (
        <NavLink to={`${base}/mgmt`} className={["site-header-row3-btn", isActive(path, `${base}/mgmt`) ? "is-active" : ""].filter(Boolean).join(" ")}>
          <IconMgmt /><span>League Mgmt</span>
        </NavLink>
      ) : (
        <button type="button" className="site-header-row3-btn is-danger" onClick={() => navigate(openModalHref(leagueId, "retire"))}>
          <IconRetire /><span>Retire</span>
        </button>
      )}
    </nav>
  );
}
