import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { siteApi, type DemoPhase } from "../lib/site-api.js";
import { SiteFooter } from "../components/SiteFooter.js";

type DemoLeague = { id: string; name: string; game: string; seasonNumber: number; phases: Array<{ value: DemoPhase; label: string }> };
type DemoTeam = { id: string; name: string; abbr: string | null; conference: string | null; coachName: string };

type NewsState = { posts: Array<{ id: string; title: string; body: string; createdAt: string }>; demo: boolean; phaseLabel?: string } | null;
type MatchupState = {
  weekNumber: number | null;
  matchup: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; note?: string } | null;
  draftBoard?: Array<{ round: number; pick: number; team: string; note: string }>;
  demo: boolean;
  phaseLabel?: string;
} | null;
type StandingsState =
  | { demo: false; standings: Array<{ teamId: string; teamName: string; wins: number; losses: number; ties: number }> }
  | { demo: true; phaseLabel: string; standings: Array<{ team: string; wins: number; losses: number; ties: number }> }
  | null;

// Unauthenticated "try before you sign up" preview. Curated pages only (Campus Buzz, Matchup,
// Roster, Standings) and a user-team-only perspective picker — deliberately not the full hub.
export function Demo() {
  const [leagues, setLeagues] = useState<DemoLeague[]>([]);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teams, setTeams] = useState<DemoTeam[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [phase, setPhase] = useState<DemoPhase>("live");
  const [news, setNews] = useState<NewsState>(null);
  const [matchup, setMatchup] = useState<MatchupState>(null);
  const [standings, setStandings] = useState<StandingsState>(null);
  const [roster, setRoster] = useState<Array<{ id: string; name: string; position: string; overallRating: number | null; devTrait: string | null }>>([]);
  const [tab, setTab] = useState<"buzz" | "matchup" | "roster" | "standings">("buzz");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    siteApi.listDemoLeagues()
      .then((res) => { setLeagues(res.leagues); setLeagueId(res.leagues[0]?.id ?? null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load demo leagues."));
  }, []);

  const league = useMemo(() => leagues.find((l) => l.id === leagueId) ?? null, [leagues, leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    setPhase("live");
    siteApi.listDemoTeams(leagueId)
      .then((res) => { setTeams(res.teams); setTeamId(res.teams[0]?.id ?? null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [leagueId]);

  // Draft phase has no team-scoped matchup/roster — fall back to the buzz tab so the picker
  // doesn't sit on a blank pane.
  useEffect(() => {
    if (phase === "draft" && (tab === "matchup" || tab === "roster")) setTab("buzz");
  }, [phase, tab]);

  useEffect(() => {
    if (!leagueId) return;
    siteApi.getDemoNewsFeed(leagueId, phase).then(setNews).catch(() => setNews(null));
    siteApi.getDemoStandings(leagueId, phase).then(setStandings).catch(() => setStandings(null));
  }, [leagueId, phase]);

  useEffect(() => {
    if (!leagueId || !teamId) return;
    siteApi.getDemoTeamMatchup(leagueId, teamId, phase).then(setMatchup).catch(() => setMatchup(null));
    siteApi.getDemoTeamRoster(leagueId, teamId).then((res) => setRoster(res.players)).catch(() => setRoster([]));
  }, [leagueId, teamId, phase]);

  const activeTeam = teams.find((t) => t.id === teamId) ?? null;
  const phaseTabs = league?.phases ?? [];

  return (
    <div className="site-page site-landing">
      <header className="site-nav site-landing-nav">
        <Link to="/" className="site-landing-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="site-landing-logo" />
          <span className="site-wordmark">REC Leagues eSports</span>
        </Link>
        <nav>
          <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
          <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
        </nav>
      </header>

      <main className="site-legal-page site-public-league">
        <h1>Try REC Leagues</h1>
        <p className="site-muted">
          Browse two real, live leagues in a read-only preview — nothing here is saved or triggers any action. Pick a
          league, a team's seat, and a point in the season to look around.
        </p>
        {error && <p className="site-muted">{error}</p>}

        {leagues.length > 0 && (
          <div className="site-public-league-season-tabs" role="tablist" aria-label="Demo league">
            {leagues.map((l) => (
              <button key={l.id} type="button" className={l.id === leagueId ? "active" : ""} onClick={() => setLeagueId(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {phaseTabs.length > 0 && (
          <div className="site-public-league-season-tabs" role="tablist" aria-label="Season point">
            {phaseTabs.map((p) => (
              <button key={p.value} type="button" className={p.value === phase ? "active" : ""} onClick={() => setPhase(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
        )}

        {teams.length > 0 && (
          <section className="site-public-league-section">
            <h2>View As</h2>
            <select
              className="site-input"
              value={teamId ?? ""}
              onChange={(event) => setTeamId(event.target.value)}
              aria-label="Team perspective"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.coachName ? ` — ${t.coachName}` : ""}</option>
              ))}
            </select>
          </section>
        )}

        <div className="site-public-league-season-tabs" role="tablist" aria-label="Demo sections">
          {([
            { id: "buzz", label: "Campus Buzz" },
            { id: "matchup", label: phase === "draft" ? "Draft Board" : "Matchup", hide: phase === "draft" && !activeTeam },
            { id: "roster", label: "Roster", hide: phase === "draft" },
            { id: "standings", label: "Standings" },
          ] as const).filter((t) => !("hide" in t && t.hide)).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "buzz" && (
          <section className="site-public-league-section">
            <h2>Campus Buzz{news?.phaseLabel ? ` — ${news.phaseLabel}` : ""}</h2>
            {!news || news.posts.length === 0 ? (
              <p className="site-muted">No posts yet.</p>
            ) : (
              <ul className="site-public-league-list" style={{ flexDirection: "column", alignItems: "stretch", gap: "1rem" }}>
                {news.posts.map((post) => (
                  <li key={post.id} style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <strong>{post.title}</strong>
                    <span className="site-muted">{post.body}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "matchup" && (
          <section className="site-public-league-section">
            <h2>{phase === "draft" ? "Draft Board" : "This Team's Matchup"}{matchup?.phaseLabel ? ` — ${matchup.phaseLabel}` : ""}</h2>
            {phase === "draft" ? (
              matchup?.draftBoard && matchup.draftBoard.length > 0 ? (
                <ul className="site-public-league-list">
                  {matchup.draftBoard.map((pick, i) => (
                    <li key={i}><span>Round {pick.round}, Pick {pick.pick} — {pick.team}</span><strong>{pick.note}</strong></li>
                  ))}
                </ul>
              ) : <p className="site-muted">Draft board not available.</p>
            ) : matchup?.matchup ? (
              <ul className="site-public-league-list">
                <li>
                  <span>{matchup.matchup.awayTeam} @ {matchup.matchup.homeTeam}{matchup.matchup.note ? ` · ${matchup.matchup.note}` : ""}</span>
                  <strong>
                    {matchup.matchup.homeScore != null && matchup.matchup.awayScore != null
                      ? `${matchup.matchup.awayScore} - ${matchup.matchup.homeScore}`
                      : matchup.matchup.status}
                  </strong>
                </li>
              </ul>
            ) : <p className="site-muted">No matchup scheduled for this view.</p>}
          </section>
        )}

        {tab === "roster" && (
          <section className="site-public-league-section">
            <h2>{activeTeam?.name ?? "Roster"}</h2>
            {roster.length === 0 ? (
              <p className="site-muted">No roster data.</p>
            ) : (
              <table className="site-public-league-table">
                <thead><tr><th>Player</th><th>Pos</th><th>OVR</th><th>Dev</th></tr></thead>
                <tbody>
                  {roster.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{p.position}</td><td>{p.overallRating ?? "—"}</td><td>{p.devTrait ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === "standings" && (
          <section className="site-public-league-section">
            <h2>Standings{standings?.demo ? ` — ${standings.phaseLabel}` : ""}</h2>
            {!standings || standings.standings.length === 0 ? (
              <p className="site-muted">No standings yet.</p>
            ) : (
              <table className="site-public-league-table">
                <thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead>
                <tbody>
                  {standings.demo
                    ? standings.standings.map((s, i) => (
                        <tr key={i}><td>{s.team}</td><td>{s.wins}</td><td>{s.losses}</td><td>{s.ties}</td></tr>
                      ))
                    : standings.standings.map((s) => (
                        <tr key={s.teamId}><td>{s.teamName}</td><td>{s.wins}</td><td>{s.losses}</td><td>{s.ties}</td></tr>
                      ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section className="site-public-league-section">
          <p className="site-muted">Like what you see? Create a free account to join a real league.</p>
          <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
