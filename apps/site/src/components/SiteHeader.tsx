import { NavLink, useNavigate } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import type { SiteLeagueSummary } from "../lib/site-api.js";
import { ProfileChip } from "./ProfileChip.js";
import { TeamLogo } from "@rec/hub-ui";
import { IconChevronDown } from "./icons.js";
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

/** Brand + account strip. ProfileChip is the one account control -- its drawer holds
 * notifications (top section) and account actions (My Account / Help / Sign Out) together. */
function HeaderRow1() {
  return (
    <div className="site-header-row1">
      <NavLink to="/home" className="site-header-brand" aria-label="REC Leagues home">
        <img src="/assets/rec-leagues-branding.png" alt="" className="site-header-brand-img" />
        <span className="site-header-brand-text">REC-Leagues.com</span>
      </NavLink>
      <div className="site-header-row1-end">
        <ProfileChip />
      </div>
    </div>
  );
}

/** Active league selector — universal switcher + exit to REC Home. Not duplicated in the footer. */
function HeaderRow2() {
  const hub = useHub();
  const navigate = useNavigate();
  const { triggerRef, open, setOpen, Panel } = useHeaderMenu<HTMLButtonElement>();
  const leagues = sortLeagues(hub.leagues);
  const selected = hub.selectedLeague;

  function chooseLeague(league: SiteLeagueSummary) {
    setOpen(false);
    hub.selectLeague(league.id);
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
                <TeamLogo abbreviation={selected.teamAbbr} logoUrl={selected.teamLogoUrl} alt="" className="site-header-row2-logo" />
                <strong className="site-header-row2-abbr">{selected.teamAbbr}</strong>
              </span>
            ) : null}
            <span className="site-header-row2-name">{selected.name}</span>
            {selected.seasonRecordText ? <span className="site-header-row2-detail">{selected.seasonRecordText}</span> : null}
            <span className="site-header-row2-detail">{selected.gameLabel}</span>
            <span className="site-header-row2-detail">{selected.seasonStageLabel}</span>
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
                  <TeamLogo abbreviation={league.teamAbbr} logoUrl={league.teamLogoUrl} alt="" className="site-header-league-row-logo" />
                  <strong>{league.teamAbbr}</strong>
                </span>
              ) : null}
              <span className="site-header-league-row-name">{league.name}</span>
              <span className="site-header-league-row-meta">
                {league.seasonRecordText ? `${league.seasonRecordText} · ` : ""}({league.gameLabel}) · {league.seasonStageLabel}
              </span>
            </button>
          ))}
        <button type="button" role="menuitem" className="site-header-league-row site-header-home-row" onClick={chooseHome}>Home</button>
      </Panel>
    </div>
  );
}

/** Global chrome header: brand, league selector, notifications, profile. Primary destinations live in the sticky footer. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <HeaderRow1 />
      <HeaderRow2 />
    </header>
  );
}
