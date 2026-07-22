import { useLocation, useNavigate } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import type { SiteLeagueSummary } from "../lib/site-api.js";
import { BottomNav } from "./BottomNav.js";

function roleLabel(league: SiteLeagueSummary) {
  const role = league.commissionerRole ?? (league.isCommissioner ? "co" : "member");
  if (role === "head") return "Head Commish";
  if (role === "co") return "Co-Commish";
  return "Member";
}

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
    return a.name.localeCompare(b.name);
  });
}

export function DesktopSidebar() {
  const hub = useHub();
  const navigate = useNavigate();
  const location = useLocation();
  const leagues = sortLeagues(hub.leagues);
  const selectedId = hub.scope.kind === "league" ? hub.scope.leagueId : null;

  return (
    <aside className="site-desktop-sidebar" aria-label="Global navigation">
      <div className="site-sidebar-brand">REC LEAGUES</div>
      <BottomNav variant="global" layout="sidebar" />
      {leagues.length ? (
        <div className="site-sidebar-leagues">
          <div className="site-sidebar-section-label">MY LEAGUES</div>
          <ul>
            {leagues.map((league) => {
              const active = selectedId === league.id;
              const buzzPath = league.game?.startsWith("madden")
                ? `/l/${league.id}/buzz`
                : `/l/${league.id}/buzz`;
              return (
                <li key={league.id}>
                  <button
                    type="button"
                    className={["site-sidebar-league-btn", active ? "is-active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      hub.selectLeague(league.id);
                      if (!location.pathname.startsWith(`/l/${league.id}`)) {
                        navigate(buzzPath);
                      }
                    }}
                  >
                    <span className="site-sidebar-league-name">{league.name}</span>
                    <span className="site-sidebar-league-meta">
                      {league.gameLabel} · {roleLabel(league)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hub.scope.kind === "league" ? (
            <button
              type="button"
              className="site-sidebar-league-btn site-sidebar-main-hub"
              onClick={() => {
                hub.selectMainHub();
                navigate("/home");
              }}
            >
              <span className="site-sidebar-league-name">Main Hub</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
