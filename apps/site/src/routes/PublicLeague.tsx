import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type PublicLeagueSnapshot } from "../lib/site-api.js";
import { SiteFooter } from "../components/SiteFooter.js";

// Unauthenticated — /viewleague on Discord links here. No REC account or Discord login
// required to view: status, this week's matchups, linked teams, season standings only.
export function PublicLeague() {
  const auth = useAuth();
  const { guildId } = useParams<{ guildId: string }>();
  const [data, setData] = useState<PublicLeagueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guildId) return;
    siteApi.getPublicLeagueSnapshot(guildId).then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load this league."));
  }, [guildId]);

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
                  <li key={t.teamId}><span>{t.teamName}</span><strong>{t.coachName ?? "Open"}</strong></li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
