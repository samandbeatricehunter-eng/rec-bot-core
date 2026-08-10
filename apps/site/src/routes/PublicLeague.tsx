import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type PublicLeagueHistory, type PublicLeagueHistorySeason, type PublicLeagueSnapshot } from "../lib/site-api.js";
import { SiteFooter } from "../components/SiteFooter.js";

function isCfbGame(game: string | null) {
  return (game ?? "").startsWith("cfb");
}

function shiftLabel(delta: number | null): string {
  if (delta == null) return "new";
  if (delta === 0) return "—";
  return delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
}

function PublicWeeklyResults({ weeklyResults }: { weeklyResults: PublicLeagueHistorySeason["weeklyResults"] }) {
  const [activeWeek, setActiveWeek] = useState<number | null>(weeklyResults[0]?.weekNumber ?? null);
  const week = weeklyResults.find((w) => w.weekNumber === activeWeek) ?? null;
  if (weeklyResults.length === 0) return <p className="site-muted">No weekly results recorded this season.</p>;
  return (
    <>
      <div className="site-public-league-season-tabs">
        {weeklyResults.map((w) => (
          <button key={w.weekNumber} type="button" className={w.weekNumber === activeWeek ? "active" : ""} onClick={() => setActiveWeek(w.weekNumber)}>
            Week {w.weekNumber}
          </button>
        ))}
      </div>
      {week && (
        <>
          <table className="site-public-league-table">
            <thead><tr><th>Away</th><th>Home</th><th>Result</th></tr></thead>
            <tbody>
              {week.matchups.map((m, i) => (
                <tr key={i}>
                  <td>{m.awayTeam}{m.isTie ? "" : m.winner === m.awayTeam ? " ✓" : ""}</td>
                  <td>{m.homeTeam}{m.isTie ? "" : m.winner === m.homeTeam ? " ✓" : ""}</td>
                  <td>{m.awayScore ?? "—"}-{m.homeScore ?? "—"}{m.isTie ? " (T)" : ""}{m.isPlayoff ? " · Playoff" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {week.powerRankingShifts.length > 0 && (
            <ul className="site-public-league-list">
              {week.powerRankingShifts.map((s) => (
                <li key={s.teamName}><span>#{s.newRank} {s.teamName}{s.previousRank != null ? ` (was #${s.previousRank})` : ""}</span><strong>{shiftLabel(s.delta)}</strong></li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function PublicSeasonHistory({ season, game }: { season: PublicLeagueHistorySeason; game: string | null }) {
  const cfb = isCfbGame(game);
  const championshipLabel = cfb ? "National Championship" : "Super Bowl";
  return (
    <>
      <section className="site-public-league-section">
        <h3>Weekly Results</h3>
        <PublicWeeklyResults weeklyResults={season.weeklyResults} />
      </section>

      <section className="site-public-league-section">
        <h3>Team Records</h3>
        <table className="site-public-league-table">
          <thead><tr><th>Coach</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th></tr></thead>
          <tbody>
            {season.teamRecords.map((row) => (
              <tr key={row.userId}>
                <td>{row.coachName}</td>
                <td>{row.teamName}{row.abbr ? ` (${row.abbr})` : ""}</td>
                <td>{row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`}</td>
                <td>{row.pointsFor}</td>
                <td>{row.pointsAgainst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {season.championship && (
        <section className="site-public-league-section">
          <h3>{championshipLabel}</h3>
          <p className="site-muted"><strong>{season.championship.winner ?? "—"}</strong> defeated <strong>{season.championship.runnerUp ?? "—"}</strong>{season.championship.score ? ` (${season.championship.score})` : ""}</p>
        </section>
      )}

      {cfb && season.bowlWinners.length > 0 && (
        <section className="site-public-league-section">
          <h3>Bowl Winners</h3>
          <ul className="site-public-league-list">
            {season.bowlWinners.map((bowl, i) => (
              <li key={`${bowl.bowlName}-${i}`}><span>{bowl.bowlName ?? "Bowl Game"}</span><strong>{bowl.winner ?? "—"} def. {bowl.loser ?? "—"}{bowl.score ? ` (${bowl.score})` : ""}</strong></li>
            ))}
          </ul>
        </section>
      )}

      {season.postseasonGames.length > 0 && (
        <section className="site-public-league-section">
          <h3>Postseason Results</h3>
          <ul className="site-public-league-list">
            {season.postseasonGames.map((g, i) => (
              <li key={i}>
                <span>{g.weekNumber != null ? `Week ${g.weekNumber}` : "—"}{g.bowlName ? ` · ${g.bowlName}` : g.postseasonRound ? ` · ${g.postseasonRound}` : ""}</span>
                <strong>{g.awayTeam} {g.awayScore ?? "—"} @ {g.homeTeam} {g.homeScore ?? "—"}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cfb && season.finalTop25.length > 0 && (
        <section className="site-public-league-section">
          <h3>Final Top 25</h3>
          <ul className="site-public-league-list">
            {season.finalTop25.map((row) => (
              <li key={row.rank}><span>#{row.rank} {row.teamName}</span>{row.conferenceChampion && <strong>Conf. Champion</strong>}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="site-public-league-section">
        <h3>Power Rankings</h3>
        <div className="site-public-league-rankings-grid">
          {([
            { label: season.powerRankings.startWeek != null ? `Week ${season.powerRankings.startWeek}` : "Start", rows: season.powerRankings.start },
            { label: season.powerRankings.midWeek != null ? `Week ${season.powerRankings.midWeek}` : "Midseason", rows: season.powerRankings.mid },
            { label: season.powerRankings.endWeek != null ? `Week ${season.powerRankings.endWeek}` : "Final", rows: season.powerRankings.end },
          ] as const).map((col) => (
            <div key={col.label}>
              <h4>{col.label}</h4>
              <ul className="site-public-league-list">
                {col.rows.slice(0, 10).map((row) => (
                  <li key={row.rank}><span>#{row.rank} {row.teamName}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

type PublicLeagueTab = "this-week" | "linked" | "open" | "history";

// Unauthenticated — /viewleague on Discord links here. No REC account or Discord login
// required to view: status, this week's matchups, linked teams, season standings only.
export function PublicLeague() {
  const auth = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicLeagueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PublicLeagueHistory | null>(null);
  const [activeSeason, setActiveSeason] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PublicLeagueTab>("this-week");

  useEffect(() => {
    if (!slug) return;
    // Old links shared before the slug URL existed used the raw Discord guild ID (a 17-20
    // digit snowflake) — keep those working instead of breaking anything already bookmarked.
    const isRawGuildId = /^\d{17,20}$/.test(slug);
    const lookup = isRawGuildId ? siteApi.getPublicLeagueSnapshot(slug) : siteApi.getPublicLeagueSnapshotBySlug(slug);
    lookup.then(setData).catch((err) => setError(err instanceof Error ? err.message : "Failed to load this league."));
    const historyLookup = isRawGuildId ? siteApi.getPublicLeagueHistory(slug) : siteApi.getPublicLeagueHistoryBySlug(slug);
    historyLookup.then((res) => { setHistory(res); setActiveSeason(res.seasons[0]?.seasonNumber ?? null); }).catch(() => undefined);
  }, [slug]);

  const hasOpenTeams = (data?.openTeams.length ?? 0) > 0;
  const hasHistory = (history?.seasons.length ?? 0) > 0;
  const tabs: Array<{ id: PublicLeagueTab; label: string; show: boolean }> = [
    { id: "this-week", label: "This Week", show: true },
    { id: "linked", label: "Linked Teams", show: true },
    { id: "open", label: "Open Teams", show: hasOpenTeams },
    { id: "history", label: "History", show: hasHistory },
  ];

  useEffect(() => {
    if (activeTab === "open" && !hasOpenTeams) setActiveTab("this-week");
    if (activeTab === "history" && !hasHistory) setActiveTab("this-week");
  }, [activeTab, hasOpenTeams, hasHistory]);

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

            <div className="site-public-league-season-tabs" role="tablist" aria-label="League sections">
              {tabs.filter((tab) => tab.show).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === "open"
                    ? ` (${data.openTeams.reduce((sum, g) => sum + g.teams.length, 0)})`
                    : ""}
                </button>
              ))}
            </div>

            {activeTab === "this-week" && (
              <>
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
              </>
            )}

            {activeTab === "linked" && (
              <section className="site-public-league-section">
                <h2>Linked Teams</h2>
                {data.linkedTeams.length === 0 ? (
                  <p className="site-muted">No linked teams yet.</p>
                ) : (
                  <ul className="site-public-league-list">
                    {data.linkedTeams.map((t) => (
                      <li key={t.teamId}><span>{t.teamName}</span><strong>{t.coachName}</strong></li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {activeTab === "open" && hasOpenTeams && (
              <section className="site-public-league-section">
                <h2>Open Teams</h2>
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
              </section>
            )}

            {activeTab === "history" && history && hasHistory && (
              <section className="site-public-league-section">
                <h2>League History</h2>
                <div className="site-public-league-season-tabs">
                  {history.seasons.map((s) => (
                    <button
                      key={s.seasonNumber}
                      type="button"
                      className={s.seasonNumber === activeSeason ? "active" : ""}
                      onClick={() => setActiveSeason(s.seasonNumber)}
                    >
                      Season {s.seasonNumber}
                    </button>
                  ))}
                </div>
                {(() => {
                  const season = history.seasons.find((s) => s.seasonNumber === activeSeason);
                  return season ? <PublicSeasonHistory season={season} game={history.league.game} /> : null;
                })()}
              </section>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
