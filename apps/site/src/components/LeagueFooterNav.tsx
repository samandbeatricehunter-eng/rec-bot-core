import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  IconComp,
  IconHome,
  IconLeagues,
  IconMatchups,
  IconMgmt,
  IconMore,
  IconRetire,
  IconRules,
  IconStats,
  IconTeam,
  IconWager,
} from "./icons.js";
import { useHeaderMenu } from "./HeaderMenu.js";

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Opens a HubHome modal via query bridge (footer lives outside HubHome). */
function openModalHref(leagueId: string, modal: string) {
  return `/l/${leagueId}/buzz?openModal=${modal}`;
}

export function LeagueFooterNav({
  leagueId,
  isCommissioner,
  rosterType,
  riseHubUnlocked,
  rtiOriginsComplete,
}: {
  leagueId: string;
  isCommissioner: boolean;
  rosterType?: string | null;
  riseHubUnlocked?: boolean;
  rtiOriginsComplete?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const base = `/l/${leagueId}`;
  const isRise = rosterType === "rise_to_immortality";
  const hubUnlocked = !isRise || riseHubUnlocked === true;
  const risePreLaunch = isRise && !hubUnlocked;
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>({ anchor: "above" });

  const homeTo = risePreLaunch || (isRise && !rtiOriginsComplete) ? `${base}/rise` : `${base}/buzz`;
  const teamTo = hubUnlocked ? `${base}/team` : `${base}/rise`;
  const statsTo = `${base}/stats`;
  const gameDayTo = `${base}/matchups`;

  const homeActive =
    isActive(path, `${base}/buzz`) ||
    isActive(path, `${base}/news`) ||
    (isRise && isActive(path, `${base}/rise`) && !isActive(path, `${base}/team`));
  const gameDayActive = isActive(path, `${base}/matchups`);
  const statsActive =
    isActive(path, `${base}/stats`) ||
    isActive(path, `${base}/standings`) ||
    isActive(path, `${base}/career-stats`) ||
    isActive(path, `${base}/records`) ||
    isActive(path, `${base}/history`) ||
    isActive(path, `${base}/playoff-bracket`);
  const teamActive =
    isActive(path, `${base}/roster`) ||
    isActive(path, `${base}/trades`) ||
    isActive(path, `${base}/store`) ||
    isActive(path, `${base}/team`);
  const moreActive = isActive(path, `${base}/rules`) || isActive(path, `${base}/mgmt`);

  if (risePreLaunch) {
    return (
      <nav className="site-footer-nav" aria-label="League">
        <NavLink to={`${base}/rise`} className={["site-footer-nav-btn", isActive(path, `${base}/rise`) ? "is-active" : ""].filter(Boolean).join(" ")}>
          <IconTeam />
          <span>Origins</span>
        </NavLink>
        {isCommissioner ? (
          <NavLink to={`${base}/mgmt`} className={["site-footer-nav-btn", isActive(path, `${base}/mgmt`) ? "is-active" : ""].filter(Boolean).join(" ")}>
            <IconMgmt />
            <span>Mgmt</span>
          </NavLink>
        ) : null}
      </nav>
    );
  }

  return (
    <nav className="site-footer-nav" aria-label="League">
      <NavLink to={homeTo} className={["site-footer-nav-btn", homeActive ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconHome />
        <span>Home</span>
      </NavLink>

      {hubUnlocked ? (
        <NavLink to={gameDayTo} className={["site-footer-nav-btn", gameDayActive ? "is-active" : ""].filter(Boolean).join(" ")}>
          <IconMatchups />
          <span>Game Day</span>
        </NavLink>
      ) : null}

      {hubUnlocked ? (
        <NavLink to={statsTo} className={["site-footer-nav-btn", statsActive ? "is-active" : ""].filter(Boolean).join(" ")}>
          <IconStats />
          <span>Stats</span>
        </NavLink>
      ) : null}

      <NavLink to={teamTo} className={["site-footer-nav-btn", teamActive ? "is-active" : ""].filter(Boolean).join(" ")}>
        <IconTeam />
        <span>Team</span>
      </NavLink>

      <div className="site-footer-nav-more">
        <button
          ref={triggerRef}
          type="button"
          className={["site-footer-nav-btn", moreActive || open ? "is-active" : ""].filter(Boolean).join(" ")}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
        >
          <IconMore />
          <span>More</span>
        </button>
        <Panel className="site-header-dropdown-panel site-footer-more-panel" role="menu" ariaLabel="More">
          {isRise ? null : (
            <button
              type="button"
              role="menuitem"
              className="site-account-menu-item"
              onClick={() => {
                setOpen(false);
                navigate(openModalHref(leagueId, "wager"));
              }}
            >
              <IconWager /> Wagers
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="site-account-menu-item"
            onClick={() => {
              setOpen(false);
              navigate(`${base}/rules`);
            }}
          >
            <IconRules /> Rules
          </button>
          {isCommissioner ? (
            <button
              type="button"
              role="menuitem"
              className="site-account-menu-item"
              onClick={() => {
                setOpen(false);
                navigate(`${base}/mgmt`);
              }}
            >
              <IconMgmt /> League Management
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="site-account-menu-item is-danger"
            onClick={() => {
              setOpen(false);
              navigate(openModalHref(leagueId, "retire"));
            }}
          >
            <IconRetire /> Retire
          </button>
        </Panel>
      </div>
    </nav>
  );
}

export function HomeFooterNav() {
  const location = useLocation();
  const items = [
    { key: "home", label: "Home", to: "/home", icon: <IconHome /> },
    { key: "leagues", label: "Leagues", to: "/leagues", icon: <IconLeagues /> },
    { key: "tournaments", label: "Tournaments", to: "/tournaments", icon: <IconComp /> },
  ] as const;

  function active(to: string) {
    if (to === "/home") return location.pathname === "/home" || location.pathname === "/";
    if (to === "/tournaments") return location.pathname === "/tournaments" || location.pathname.startsWith("/tournaments/");
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <nav className="site-footer-nav" aria-label="Site">
      {items.map((item) => (
        <NavLink key={item.key} to={item.to} className={["site-footer-nav-btn", active(item.to) ? "is-active" : ""].filter(Boolean).join(" ")}>
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
