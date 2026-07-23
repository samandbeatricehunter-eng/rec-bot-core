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
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
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
      <div className="site-sidebar-brand">REC Leagues eSports</div>
      <BottomNav variant="global" layout="sidebar" />
      <div className="site-sidebar-leagues">
        <div className="site-sidebar-section-label">MY LEAGUES</div>
        {hub.leaguesLoading ? (
          <p className="site-sidebar-league-meta">Loading leagues…</p>
        ) : hub.leaguesError ? (
          <p className="site-sidebar-league-meta">{hub.leaguesError}</p>
        ) : leagues.length === 0 ? (
          <p className="site-sidebar-league-meta">No leagues linked yet. Finish Account linking.</p>
        ) : (
          <ul>
            {leagues.map((league) => {
              const active = selectedId === league.id;
              const buzzPath = `/l/${league.id}/buzz`;
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
        )}
      </div>
    </aside>
  );
}
