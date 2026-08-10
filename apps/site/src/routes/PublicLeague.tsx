import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type PublicLeagueSnapshot } from "../lib/site-api.js";
import { SiteFooter } from "../components/SiteFooter.js";

// Unauthenticated — /viewleague on Discord links here. No REC account or Discord login
// required to view: status, this week's matchups, linked teams, season standings only.
export function PublicLeague() {
  const auth = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicLeagueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTeamsExpanded, setOpenTeamsExpanded] = useState(false);

  useEffect(() => {
    if (!slug) return;
    // Old links shared before the slug URL existed used the raw Discord guild ID (a 17-20
    // digit snowflake) — keep those working instead of breaking anything already bookmarked.
    const lookup = /^\d{17,20}$/.test(slug) ? siteApi.getPublicLeagueSnapshot(slug) : siteApi.getPublicLeagueSnapshotBySlug(slug);
    lookup.then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load this league."));
  }, [slug]);

  return (
    <div className="site-page site-landing">
      <header className="site-nav site-landing-nav">
        <Link to="/" className="site-landing-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="site-landing-logo" />
          <span className="site-wordmark">REC Leagues eSports</span>
        </Link>
        <nav>
          {auth.status === "signed-in"
            ? <Link className="site-btn site-btn-primary" to="/home">Go to Home</Link>
            : <>
                <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
                <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
              </>}
        </nav>
      </header>

      <main className="site-legal-page site-public-league">
        {error && <p className="site-muted">{error}</p>}
        {!error && !data && <p className="site-muted">Loading league…</p>}
        {data && (
          <>
            <h1>{data.league.name}</h1>
            <p className="site-muted">{data.league.statusLabel}</p>

            <section className="site-public-league-section">
              <h2>This Week's Matchups</h2>
              {data.matchups.length === 0 ? (
                <p className="site-muted">No games scheduled this week.</p>
              ) : (
                <ul className="site-public-league-list">
                  {data.matchups.map((m, i) => (
                    <li key={i}>
                      <span>{m.awayTeam} @ {m.homeTeam}</span>
                      {m.status === "completed" && <strong>{m.awayScore} - {m.homeScore}</strong>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="site-public-league-section">
              <h2>Season Standings</h2>
              <table className="site-public-league-table">
                <thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead>
                <tbody>
                  {data.standings.map((s) => (
                    <tr key={s.teamId}><td>{s.teamName}</td><td>{s.wins}</td><td>{s.losses}</td><td>{s.ties}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="site-public-league-section">
              <h2>Linked Teams</h2>
              <ul className="site-public-league-list">
                {data.linkedTeams.map((t) => (
                  <li key={t.teamId}><span>{t.teamName}</span><strong>{t.coachName}</strong></li>
                ))}
              </ul>
            </section>

            {data.openTeams.length > 0 && (
              <section className="site-public-league-section">
                <button
                  type="button"
                  className="site-public-league-collapse-toggle"
                  aria-expanded={openTeamsExpanded}
                  onClick={() => setOpenTeamsExpanded((value) => !value)}
                >
                  <h2>Open Teams ({data.openTeams.reduce((sum, g) => sum + g.teams.length, 0)})</h2>
                  <span>{openTeamsExpanded ? "Hide" : "Show"}</span>
                </button>
                {openTeamsExpanded && (
                  <div className="site-public-league-open-groups">
                    {data.openTeams.map((group) => (
                      <div key={group.conference} className="site-public-league-open-group">
                        <h3>{group.conference}</h3>
                        <ul className="site-public-league-list">
                          {group.teams.map((t) => (
                            <li key={t.teamId}><span>{t.teamName}</span></li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
