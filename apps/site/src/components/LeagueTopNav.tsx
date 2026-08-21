import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { IconBuzz, IconHeadlines, IconMatchups, IconMgmt, IconRetire, IconStats } from "./icons.js";

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function LeagueTopNav({ leagueId }: { leagueId: string }) {
  const hub = useHub();
  const location = useLocation();
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const isCommissioner = hub.selectedLeague?.isCommissioner ?? false;
  const items = [
    { key: "home", label: "League Home", to: `/l/${leagueId}/buzz`, icon: <IconBuzz /> },
    { key: "news", label: "REC News", to: `/l/${leagueId}/news`, icon: <IconHeadlines /> },
    { key: "matchups", label: "Matchups", to: `/l/${leagueId}/matchups`, icon: <IconMatchups /> },
    { key: "stats", label: "Stats", to: `/l/${leagueId}/stats`, icon: <IconStats /> },
  ];

  async function confirmRetire() {
    setRetireBusy(true); setRetireError(null);
    try { await hub.retireFromLeague(leagueId); setRetireOpen(false); }
    catch (error) { setRetireError(error instanceof Error ? error.message : "Failed to retire."); }
    finally { setRetireBusy(false); }
  }

  return <>
    <nav className="site-league-top-nav" aria-label="League">
      {items.map((item) => <NavLink key={item.key} to={item.to} className={["site-league-top-nav-btn", isActive(location.pathname, item.to) ? "is-active" : ""].filter(Boolean).join(" ")}>{item.icon}<span>{item.label}</span></NavLink>)}
      {isCommissioner ? <NavLink to={`/l/${leagueId}/mgmt`} className={["site-league-top-nav-btn", isActive(location.pathname, `/l/${leagueId}/mgmt`) ? "is-active" : ""].filter(Boolean).join(" ")}><IconMgmt /><span>League Management</span></NavLink>
        : <button type="button" className="site-league-top-nav-btn" onClick={() => { setRetireError(null); setRetireOpen(true); }}><IconRetire /><span>Retire</span></button>}
    </nav>
    {retireOpen ? <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="retire-title">
      <button type="button" className="site-modal-backdrop" aria-label="Close" onClick={() => (!retireBusy ? setRetireOpen(false) : undefined)} />
      <div className="site-modal-panel"><h2 id="retire-title">Retire from league?</h2><p>Are you sure you want to retire from this league? Your team will become open.</p>{retireError ? <p className="site-auth-error">{retireError}</p> : null}<div className="site-modal-actions"><button type="button" className="site-btn site-btn-ghost" disabled={retireBusy} onClick={() => setRetireOpen(false)}>Cancel</button><button type="button" className="site-btn site-btn-primary" disabled={retireBusy} onClick={() => void confirmRetire()}>{retireBusy ? "Retiring..." : "Retire"}</button></div></div>
    </div> : null}
  </>;
}
