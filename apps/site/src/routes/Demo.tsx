import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CalendarDays, Globe2, Home, Menu, MessageSquare, Search, Shield, Trophy, UserRound, Users } from "lucide-react";
import { siteApi, type DemoPhase } from "../lib/site-api.js";

type DemoLeague = { id: string; name: string; game: string; seasonNumber: number; phases: Array<{ value: DemoPhase; label: string }> };
type DemoTeam = { id: string; name: string; abbr: string | null; conference: string | null; coachName: string };
type DemoTab = "buzz" | "matchup" | "team" | "trades" | "wagers" | "roster" | "standings";
type NewsState = { posts: Array<{ id: string; title: string; body: string; createdAt: string }>; demo: boolean; phaseLabel?: string } | null;
type MatchupState = { weekNumber: number | null; matchup: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; note?: string } | null; draftBoard?: Array<{ round: number; pick: number; team: string; note: string }>; demo: boolean; phaseLabel?: string } | null;
type StandingsState = { demo: boolean; phaseLabel?: string; standings: Array<{ teamId?: string; teamName?: string; team?: string; wins: number; losses: number; ties: number }> } | null;

const mainLinks = [
  [Home, "Home"], [Globe2, "Leagues"], [Trophy, "Comp (BETA)"], [MessageSquare, "Messages"], [UserRound, "My Account"],
] as const;

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
  const [tab, setTab] = useState<DemoTab>("buzz");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void siteApi.listDemoLeagues().then((r) => { setLeagues(r.leagues); setLeagueId(r.leagues[0]?.id ?? null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load demo leagues.")); }, []);
  const league = useMemo(() => leagues.find((item) => item.id === leagueId) ?? null, [leagues, leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    setPhase("live");
    void siteApi.listDemoTeams(leagueId).then((r) => { setTeams(r.teams); setTeamId(r.teams[0]?.id ?? null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load teams."));
  }, [leagueId]);
  useEffect(() => {
    if (!leagueId) return;
    void Promise.all([siteApi.getDemoNewsFeed(leagueId, phase), siteApi.getDemoStandings(leagueId, phase)])
      .then(([nextNews, nextStandings]) => { setNews(nextNews); setStandings(nextStandings as StandingsState); })
      .catch(() => { setNews(null); setStandings(null); });
  }, [leagueId, phase]);
  useEffect(() => {
    if (!leagueId || !teamId) return;
    void Promise.all([siteApi.getDemoTeamMatchup(leagueId, teamId, phase), siteApi.getDemoTeamRoster(leagueId, teamId)])
      .then(([nextMatchup, nextRoster]) => { setMatchup(nextMatchup); setRoster(nextRoster.players); })
      .catch(() => { setMatchup(null); setRoster([]); });
  }, [leagueId, teamId, phase]);

  const activeTeam = teams.find((item) => item.id === teamId) ?? null;
  const isMadden = league?.game.startsWith("madden") ?? false;
  const nav = [
    ["buzz", isMadden ? "League News" : "Campus Buzz", Globe2], ["matchup", phase === "draft" ? "Draft Board" : "Matchups", CalendarDays],
    ["team", "My team", Users], ["trades", isMadden ? "Trade Center" : "Store", Shield], ["wagers", "Wagers", Trophy], ["roster", "Roster", Users], ["standings", "League", Menu],
  ] as const;

  return (
    <div className="demo-shell">
      <header className="demo-topbar">
        <Link to="/" className="demo-brand"><img src="/icons/icon-192.png" alt="REC" /> <span>REC League</span></Link>
        <div className="demo-league-title"><strong>{league?.name ?? "REC League Preview"}</strong><span>{league?.game?.replace("madden", "Madden ").replace("cfb", "CFB ").toUpperCase() ?? "Loading"}</span></div>
        <div className="demo-account"><Search /><Bell /><span className="demo-avatar">D</span><span><strong>Demo Coach</strong><small>Read-only preview</small></span></div>
      </header>

      <aside className="demo-sidebar">
        <div className="demo-sidebar-wordmark">REC<small>LEAGUES</small></div>
        <nav>{mainLinks.map(([Icon, label]) => <span key={label}><Icon />{label}</span>)}</nav>
        <div className="demo-sidebar-leagues"><small>MY LEAGUES</small>{leagues.map((item) => <button type="button" key={item.id} className={item.id === leagueId ? "active" : ""} onClick={() => setLeagueId(item.id)}><b>{item.name.slice(0, 1)}</b><span><strong>{item.name}</strong><small>{item.game.toUpperCase()} · Demo</small></span></button>)}</div>
        <Link className="demo-signup" to="/signup">Create free account</Link>
      </aside>

      <main className="demo-main">
        <nav className="demo-league-nav">{nav.map(([id, label, Icon]) => <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}</nav>
        <section className="demo-controlbar">
          <div><span>League</span><select value={leagueId ?? ""} onChange={(e) => setLeagueId(e.target.value)}>{leagues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div><span>View as</span><select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)}>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}{item.coachName ? ` — ${item.coachName}` : ""}</option>)}</select></div>
          <div className="demo-phase-tabs"><span>Season point</span><div>{league?.phases.map((item) => <button type="button" key={item.value} className={phase === item.value ? "active" : ""} onClick={() => setPhase(item.value)}>{item.label}</button>)}</div></div>
          <p><strong>LIVE READ-ONLY PREVIEW</strong> Explore the same layout members use. No action here is saved.</p>
        </section>
        {error ? <p className="site-auth-error">{error}</p> : null}

        <div className="demo-content">
          {tab === "buzz" ? <><header><span>AROUND THE LEAGUE</span><h1>{isMadden ? "League News" : "Campus Buzz"}</h1><p>{news?.phaseLabel ?? "Current season"} · news, media, and weekly league activity</p></header><div className="demo-news-grid">{news?.posts.length ? news.posts.map((post, index) => <article key={post.id} className={index === 0 ? "featured" : ""}><small>{index === 0 ? "FEATURED STORY" : "LEAGUE HEADLINE"}</small><h2>{post.title}</h2><p>{post.body}</p><button type="button">Read article</button></article>) : <article><h2>No posts yet</h2><p>This live league has no posts for the selected point.</p></article>}</div></> : null}

          {tab === "matchup" ? <><header><span>{phase === "draft" ? "DRAFT NIGHT" : "THIS WEEK"}</span><h1>{phase === "draft" ? "Draft Board" : "Matchups"}</h1></header>{phase === "draft" ? <div className="demo-table-card"><table><thead><tr><th>Pick</th><th>Team</th><th>Status</th></tr></thead><tbody>{matchup?.draftBoard?.map((pick) => <tr key={`${pick.round}-${pick.pick}`}><td>R{pick.round} · #{pick.pick}</td><td>{pick.team}</td><td>{pick.note}</td></tr>)}</tbody></table></div> : <article className="demo-matchup-card"><small>WEEK {matchup?.weekNumber ?? "—"}</small><div><strong>{matchup?.matchup?.awayTeam ?? "Away team"}</strong><b>{matchup?.matchup?.awayScore ?? "—"}</b><span>AT</span><b>{matchup?.matchup?.homeScore ?? "—"}</b><strong>{matchup?.matchup?.homeTeam ?? "Home team"}</strong></div><p>{matchup?.matchup?.note ?? matchup?.matchup?.status ?? "No matchup scheduled for this view."}</p></article>}</> : null}

          {tab === "team" ? <><header><span>FULL COACH PROFILE</span><h1>{activeTeam?.name ?? "My Team"}</h1><p>{activeTeam?.coachName || "Demo coach"}</p></header><div className="demo-stat-grid"><article><small>SEASON RECORD</small><strong>{standings?.standings.find((s) => (s.teamId ?? "") === teamId)?.wins ?? 0}-{standings?.standings.find((s) => (s.teamId ?? "") === teamId)?.losses ?? 0}</strong></article><article><small>ROSTER SIZE</small><strong>{roster.length}</strong></article><article><small>CURRENT MATCHUP</small><strong>{matchup?.matchup ? `${matchup.matchup.awayTeam} @ ${matchup.matchup.homeTeam}` : "BYE WEEK"}</strong></article></div></> : null}

          {tab === "roster" ? <><header><span>TEAM MANAGEMENT</span><h1>{activeTeam?.name ?? "Team"} Roster</h1><p>Search, filter, compare, and manage the full roster in the member experience.</p></header><div className="demo-roster-toolbar"><select><option>All positions</option></select><label><Search /><input placeholder="Search players…" /></label></div><div className="demo-table-card"><table><thead><tr><th>Player</th><th>Position</th><th>OVR</th><th>Development</th></tr></thead><tbody>{roster.map((player) => <tr key={player.id}><td><strong>{player.name}</strong></td><td>{player.position}</td><td>{player.overallRating ?? "—"}</td><td>{player.devTrait ?? "—"}</td></tr>)}</tbody></table></div></> : null}

          {tab === "standings" ? <><header><span>LEAGUE</span><h1>Standings</h1></header><div className="demo-table-card"><table><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead><tbody>{standings?.standings.map((item, i) => <tr key={item.teamId ?? i}><td><strong>{item.teamName ?? item.team}</strong></td><td>{item.wins}</td><td>{item.losses}</td><td>{item.ties}</td></tr>)}</tbody></table></div></> : null}

          {(tab === "trades" || tab === "wagers") ? <><header><span>{tab === "trades" ? "TRANSACTIONS" : "SPORTSBOOK"}</span><h1>{tab === "trades" ? (isMadden ? "Trade Center" : "Store") : "Wagers"}</h1></header><div className="demo-empty"><Shield /><h2>Explore safely</h2><p>This is the real league-page layout. Purchases, trades, wagers, messages, and commissioner actions stay disabled in the public preview.</p><Link to="/signup">Create an account</Link></div></> : null}
        </div>
      </main>
    </div>
  );
}
