import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CalendarDays, Globe2, Home, Menu, MessageSquare, Search, Shield, Trophy, UserRound, Users } from "lucide-react";
import { formatStatValue, getStatLabel, statCategoriesForPosition, statKeysForCategories } from "@rec/shared";
import { siteApi, type DemoPhase } from "../lib/site-api.js";

type DemoLeague = { id: string; name: string; game: string; seasonNumber: number; phases: Array<{ value: DemoPhase; label: string }> };
type DemoTeam = { id: string; name: string; abbr: string | null; conference: string | null; coachName: string };
type DemoTab = "buzz" | "matchup" | "team" | "trades" | "wagers" | "roster" | "standings" | "stats";
type DemoStatsResponse = Awaited<ReturnType<typeof siteApi.getDemoLeagueStats>>;
type NewsState = { posts: Array<{ id: string; title: string; body: string; createdAt: string }>; demo: boolean; phaseLabel?: string } | null;
type MatchupState = { weekNumber: number | null; matchup: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; note?: string } | null; draftBoard?: Array<{ round: number; pick: number; team: string; note: string }>; demo: boolean; phaseLabel?: string } | null;
type StandingsState = { demo: boolean; phaseLabel?: string; standings: Array<{ teamId?: string; teamName?: string; team?: string; wins: number; losses: number; ties: number }> } | null;
type DraftPlayer = { id: string; name: string; position: string; jerseyNumber: number | null; overallRating: number; photoUrl: string | null; devTrait: string | null; attributes: Record<string, number | null> };

const mainLinks = [
  [Home, "Home"], [Globe2, "Leagues"], [Trophy, "Tournaments"], [MessageSquare, "Messages"], [UserRound, "My Account"],
] as const;

const draftColumns = ["SPD", "ACC", "STR", "AGI", "AWR", "JMP", "INJ", "STA", "TOU", "THP", "TUP", "SAC", "MAC", "DAC", "CAT", "CIT", "SPC", "CAR", "BTK", "COD", "TKL", "POW", "BSH", "MCV", "ZCV", "PBK", "RBK"];

function DemoFantasyDraftBoard({ players }: { players: DraftPlayer[] }) {
  const [position, setPosition] = useState("All");
  const [query, setQuery] = useState("");
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const [draftedIds, setDraftedIds] = useState<string[]>([]);
  const draftTeams = ["Cleveland Browns", "Atlanta Falcons", "New Orleans Saints", "Los Angeles Rams", "New York Giants", "Tennessee Titans"];
  const positions = [...new Set(players.map((player) => player.position))].sort();
  const filtered = players.filter((player) => !draftedIds.includes(player.id) && (position === "All" || player.position === position) && player.name.toLowerCase().includes(query.trim().toLowerCase()));
  const board = boardIds.map((id) => players.find((player) => player.id === id)).filter((player): player is DraftPlayer => Boolean(player) && !draftedIds.includes(player!.id));
  const pickNumber = draftedIds.length + 1;
  const onTheClock = draftTeams[(pickNumber - 1) % draftTeams.length];
  function toggleBoard(id: string) { setBoardIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function moveBoard(id: string, direction: -1 | 1) {
    setBoardIds((current) => { const from = current.indexOf(id); const to = from + direction; if (from < 0 || to < 0 || to >= current.length) return current; const next = [...current]; [next[from], next[to]] = [next[to], next[from]]; return next; });
  }
  function makePick(player: DraftPlayer) { setDraftedIds((current) => [...current, player.id]); setBoardIds((current) => current.filter((id) => id !== player.id)); }
  return (
    <section className="demo-draft-room">
      <div className="demo-draft-heading"><div><small>FANTASY DRAFT</small><h1>Draft Tracker</h1><p>Build your personal board from the complete pre-seeded Madden roster.</p></div><span>READ-ONLY DEMO</span></div>
      <div className="demo-draft-status"><strong>Draft is live</strong><span>Round 1 · Pick {pickNumber} · {onTheClock} on the clock</span></div>
      <div className="demo-draft-toolbar">
        <label><span>POSITION</span><select value={position} onChange={(event) => setPosition(event.target.value)}><option value="All">All positions</option>{positions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="demo-draft-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players…" /></label>
        <button type="button">Attribute filters</button>
      </div>
      <div className="demo-draft-table-wrap">
        <table className="demo-draft-table"><thead><tr><th>PLAYER</th><th>OVR ▼</th>{draftColumns.map((key) => <th key={key}>{key}</th>)}<th>ACTIONS</th></tr></thead><tbody>{filtered.map((player) => <tr key={player.id}><td><div className="demo-draft-player">{player.photoUrl ? <img src={player.photoUrl} alt="" loading="lazy" /> : <span>{player.position}</span>}<div><strong>{player.name}</strong><small>{player.position}{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}{player.devTrait ? ` · ${player.devTrait.replaceAll("_", " ")}` : ""}</small></div></div></td><td><b>{player.overallRating}</b></td>{draftColumns.map((key) => <td key={key}>{player.attributes[key] ?? "—"}</td>)}<td className="demo-draft-row-actions"><button type="button" onClick={() => toggleBoard(player.id)}>{boardIds.includes(player.id) ? "Remove" : "+ Board"}</button><button type="button" onClick={() => makePick(player)}>Mark pick</button></td></tr>)}</tbody></table>
      </div>
      <div className="demo-personal-board"><header><div><small>PERSONAL DRAFT BOARD</small><h2>Your Rankings</h2></div><span>Demo changes reset when you leave</span></header>{board.length === 0 ? <p>Add players from the pool above to build and adjust your board.</p> : <ol>{board.map((player, index) => <li key={player.id}><b>{index + 1}</b>{player.photoUrl ? <img src={player.photoUrl} alt="" /> : <span className="demo-board-pos">{player.position}</span>}<div><strong>{player.name}</strong><small>{player.position} · {player.overallRating} OVR</small></div><button type="button" disabled={index === 0} onClick={() => moveBoard(player.id, -1)}>↑</button><button type="button" disabled={index === board.length - 1} onClick={() => moveBoard(player.id, 1)}>↓</button><button type="button" onClick={() => toggleBoard(player.id)}>Remove</button><button type="button" onClick={() => makePick(player)}>Mark pick</button></li>)}</ol>}</div>
      <div className="demo-draft-footer"><button type="button" disabled title="Saving is disabled in the public demo">Save Draft Board</button><button type="button" disabled title="Loading saved boards is disabled in the public demo">Load Draft Board</button><label><span>SORT BY</span><select><option>My custom rank</option><option>OVR</option></select></label><strong>{draftedIds.length ? `${draftedIds.length} demo pick${draftedIds.length === 1 ? "" : "s"} logged` : "No picks logged yet."}</strong></div>
    </section>
  );
}

function DemoStatsView({ leagueId }: { leagueId: string }) {
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("");
  const [data, setData] = useState<DemoStatsResponse | null>(null);

  useEffect(() => {
    setData(null);
    void siteApi.getDemoLeagueStats(leagueId, teamId || null, position || null).then(setData).catch(() => setData(null));
  }, [leagueId, teamId, position]);

  const columns = position
    ? (() => { const keys = statKeysForCategories(statCategoriesForPosition(position)); return keys.length ? keys : []; })()
    : statKeysForCategories(["passing", "rushing", "receiving", "defense", "kicking", "punting"]);

  if (!data) return <p className="demo-muted">Loading stats…</p>;

  return (
    <>
      <div className="demo-roster-toolbar">
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">All teams</option>
          {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <select value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="">All positions</option>
          {data.positions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="demo-table-card">
        <table>
          <thead><tr><th>Player</th><th>Team</th><th>Pos</th>{columns.map((key) => <th key={key}>{getStatLabel(key)}</th>)}</tr></thead>
          <tbody>
            {data.players.map((player) => (
              <tr key={player.id}>
                <td><strong>{player.fullName}</strong>{player.jerseyNumber != null ? ` #${player.jerseyNumber}` : ""}</td>
                <td>{player.teamAbbreviation ?? player.teamName ?? "FA"}</td>
                <td>{player.position ?? "—"}</td>
                {columns.map((key) => <td key={key}>{formatStatValue(key, player.stats[key] ?? 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.players.length && <p className="demo-muted">No players match these filters.</p>}
      </div>
    </>
  );
}

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
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayer[]>([]);
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
  useEffect(() => {
    if (!leagueId || phase !== "draft") return;
    void siteApi.getDemoFantasyDraftPool(leagueId).then((result) => setDraftPlayers(result.players)).catch(() => setDraftPlayers([]));
  }, [leagueId, phase]);

  const activeTeam = teams.find((item) => item.id === teamId) ?? null;
  const isMadden = league?.game.startsWith("madden") ?? false;
  const nav = [
    ["buzz", isMadden ? "League News" : "Campus Buzz", Globe2], ["matchup", phase === "draft" ? "Draft Board" : "Matchups", CalendarDays],
    ["team", "My team", Users], ["trades", isMadden ? "Trade Center" : "Store", Shield], ["wagers", "Wagers", Trophy],
    ["roster", "Roster", Users], ["stats", "Stats", Trophy], ["standings", "League", Menu],
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
          <div className="demo-phase-tabs"><span>Season point</span><div>{league?.phases.map((item) => <button type="button" key={item.value} className={phase === item.value ? "active" : ""} onClick={() => { setPhase(item.value); if (item.value === "draft") setTab("matchup"); }}>{item.label}</button>)}</div></div>
          <p><strong>LIVE READ-ONLY PREVIEW</strong> Explore the same layout members use. No action here is saved.</p>
        </section>
        {error ? <p className="site-auth-error">{error}</p> : null}

        <div className="demo-content">
          {tab === "buzz" ? <><header><span>AROUND THE LEAGUE</span><h1>{isMadden ? "League News" : "Campus Buzz"}</h1><p>{news?.phaseLabel ?? "Current season"} · news, media, and weekly league activity</p></header><div className="demo-news-grid">{news?.posts.length ? news.posts.map((post, index) => <article key={post.id} className={index === 0 ? "featured" : ""}><small>{index === 0 ? "FEATURED STORY" : "LEAGUE HEADLINE"}</small><h2>{post.title}</h2><p>{post.body}</p><button type="button">Read article</button></article>) : <article><h2>No posts yet</h2><p>This live league has no posts for the selected point.</p></article>}</div></> : null}

          {tab === "matchup" ? phase === "draft" ? <DemoFantasyDraftBoard players={draftPlayers} /> : <><header><span>THIS WEEK</span><h1>Matchups</h1></header><article className="demo-matchup-card"><small>WEEK {matchup?.weekNumber ?? "—"}</small><div><strong>{matchup?.matchup?.awayTeam ?? "Away team"}</strong><b>{matchup?.matchup?.awayScore ?? "—"}</b><span>AT</span><b>{matchup?.matchup?.homeScore ?? "—"}</b><strong>{matchup?.matchup?.homeTeam ?? "Home team"}</strong></div><p>{matchup?.matchup?.note ?? matchup?.matchup?.status ?? "No matchup scheduled for this view."}</p></article></> : null}

          {tab === "team" ? <><header><span>FULL COACH PROFILE</span><h1>{activeTeam?.name ?? "My Team"}</h1><p>{activeTeam?.coachName || "Demo coach"}</p></header><div className="demo-stat-grid"><article><small>SEASON RECORD</small><strong>{standings?.standings.find((s) => (s.teamId ?? "") === teamId)?.wins ?? 0}-{standings?.standings.find((s) => (s.teamId ?? "") === teamId)?.losses ?? 0}</strong></article><article><small>ROSTER SIZE</small><strong>{roster.length}</strong></article><article><small>CURRENT MATCHUP</small><strong>{matchup?.matchup ? `${matchup.matchup.awayTeam} @ ${matchup.matchup.homeTeam}` : "BYE WEEK"}</strong></article></div></> : null}

          {tab === "roster" ? <><header><span>TEAM MANAGEMENT</span><h1>{activeTeam?.name ?? "Team"} Roster</h1><p>Search, filter, compare, and manage the full roster in the member experience.</p></header><div className="demo-roster-toolbar"><select><option>All positions</option></select><label><Search /><input placeholder="Search players…" /></label></div><div className="demo-table-card"><table><thead><tr><th>Player</th><th>Position</th><th>OVR</th><th>Development</th></tr></thead><tbody>{roster.map((player) => <tr key={player.id}><td><strong>{player.name}</strong></td><td>{player.position}</td><td>{player.overallRating ?? "—"}</td><td>{player.devTrait ?? "—"}</td></tr>)}</tbody></table></div></> : null}

          {tab === "stats" && leagueId ? <><header><span>PRODUCTION</span><h1>League Stats</h1><p>Player season totals for the current point in the season.</p></header><DemoStatsView leagueId={leagueId} /></> : null}

          {tab === "standings" ? <><header><span>LEAGUE</span><h1>Standings</h1></header><div className="demo-table-card"><table><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th></tr></thead><tbody>{standings?.standings.map((item, i) => <tr key={item.teamId ?? i}><td><strong>{item.teamName ?? item.team}</strong></td><td>{item.wins}</td><td>{item.losses}</td><td>{item.ties}</td></tr>)}</tbody></table></div></> : null}

          {(tab === "trades" || tab === "wagers") ? <><header><span>{tab === "trades" ? "TRANSACTIONS" : "SPORTSBOOK"}</span><h1>{tab === "trades" ? (isMadden ? "Trade Center" : "Store") : "Wagers"}</h1></header><div className="demo-empty"><Shield /><h2>Explore safely</h2><p>This is the real league-page layout. Purchases, trades, wagers, messages, and commissioner actions stay disabled in the public preview.</p><Link to="/signup">Create an account</Link></div></> : null}
        </div>
      </main>
    </div>
  );
}
