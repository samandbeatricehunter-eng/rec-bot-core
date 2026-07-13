import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Megaphone, Newspaper, Play, ShieldCheck, ThumbsDown, ThumbsUp, Trophy, UserRound } from "lucide-react";
import { useAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubReactionKey, HubResponse } from "../../types/api.js";

const AWARD_REACTIONS: Array<{ key: HubReactionKey; label: string }> = [
  { key: "TOTY", label: "Throw" }, { key: "COTY", label: "Catch" }, { key: "ROTY", label: "Run" },
  { key: "IOTY", label: "INT" }, { key: "HOTY", label: "Hit" },
];

export function HubHome() {
  const auth = useAuth();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"league" | "team">("league");
  const [highlightIndex, setHighlightIndex] = useState(0);

  async function load() {
    if (auth.status !== "ready") return;
    try { setHub(await recApi.getHub(auth.guildId)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  async function react(highlightId: string, reactionKey: HubReactionKey) {
    if (auth.status !== "ready") return;
    await recApi.toggleHubHighlightReaction({ guildId: auth.guildId, highlightId, reactionKey });
    await load();
  }

  if (error) return <div className="hub-state"><h1>League Hub</h1><p>{error}</p><button className="btn btn-primary" onClick={() => void load()}>Try again</button></div>;
  if (!hub) return <div className="hub-state"><h1>Loading League Hub…</h1></div>;

  const my = hub.myTeam?.display ?? {};
  const games: any[] = hub.matchups?.games ?? [];
  const activeHighlightIndex = hub.highlights.length ? highlightIndex % hub.highlights.length : 0;
  const activeHighlight = hub.highlights.length ? hub.highlights[activeHighlightIndex] : null;
  return (
    <div className="hub-page">
      <section className="hub-hero">
        <div>
          <p className="hub-eyebrow">Season {hub.league.seasonNumber} · Week {hub.league.weekNumber}</p>
          <h1>{hub.league.name}</h1>
          <p>{String(hub.league.game ?? "League").replaceAll("_", " ")} · {String(hub.league.seasonStage).replaceAll("_", " ")}</p>
        </div>
        {hub.canManageLeague && <Link className="btn btn-primary hub-manage-button" to="/league-mgmt"><ShieldCheck size={18} /> League Management</Link>}
      </section>

      <nav className="hub-tabs" aria-label="Hub view">
        <button className={tab === "league" ? "active" : ""} onClick={() => setTab("league")}><Trophy size={18} /> League</button>
        <button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}><UserRound size={18} /> My Team</button>
      </nav>

      {tab === "team" ? (
        <section className="hub-section hub-my-team">
          <div className="hub-section-heading"><div><p className="hub-eyebrow">Personal dashboard</p><h2>{my.teamName ?? "No team linked"}</h2></div></div>
          <div className="hub-stat-grid">
            <article><span>Coach</span><strong>{my.discordUsername ?? "REC Member"}</strong></article>
            <article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "—"}</strong></article>
            <article><span>Point differential</span><strong>{Number(my.leagueSeasonPointDifferential ?? 0) >= 0 ? "+" : ""}{my.leagueSeasonPointDifferential ?? 0}</strong></article>
            <article><span>Current matchup</span><strong>{my.currentMatchupText ?? "None"}</strong></article>
            <article><span>Wallet</span><strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></article>
            <article><span>Savings</span><strong>${Number(my.savings ?? 0).toLocaleString()}</strong></article>
          </div>
        </section>
      ) : <>
        <section className="hub-section hub-announcements">
          <div className="hub-section-heading"><div><p className="hub-eyebrow"><Megaphone size={14} /> Official updates</p><h2>Announcements</h2></div></div>
          {hub.announcements.length ? <div className="hub-feed-list">{hub.announcements.map(item => <article key={item.id}><time>{new Date(item.published_at).toLocaleDateString()}</time><h3>{item.title}</h3><p>{item.body}</p></article>)}</div> : <p className="hub-empty">League announcements will appear here.</p>}
        </section>

        <div className="hub-two-column">
          <section className="hub-section">
            <div className="hub-section-heading"><div><p className="hub-eyebrow"><Newspaper size={14} /> Around the league</p><h2>Headlines</h2></div></div>
            {hub.headlines.length ? <div className="hub-feed-list">{hub.headlines.slice(0, 8).map(item => <article key={item.id}><time>Week {item.week}</time><h3>{item.headline ?? "Game Story"}</h3><p>{item.body}</p></article>)}</div> : <p className="hub-empty">Headlines publish here after games are advanced.</p>}
          </section>
          <section className="hub-section">
            <div className="hub-section-heading"><div><p className="hub-eyebrow"><CalendarDays size={14} /> Current slate</p><h2>Weekly H2H Matchups</h2></div></div>
            {games.length ? <div className="hub-matchups">{games.map((game, index) => <article key={game.id ?? index}><div><strong>{game.awayTeamName ?? game.away_team_name ?? "Away"}</strong><span>at</span><strong>{game.homeTeamName ?? game.home_team_name ?? "Home"}</strong></div><span className="badge badge-info">{game.status ?? "Scheduled"}</span></article>)}</div> : <p className="hub-empty">No H2H games are scheduled for this week.</p>}
          </section>
        </div>

        <section className="hub-section">
          <div className="hub-section-heading"><div><p className="hub-eyebrow"><Play size={14} /> Community clips</p><h2>Highlight Reel</h2></div></div>
          {activeHighlight ? <div className="hub-highlight-carousel">
            {hub.highlights.length > 1 && <button className="hub-highlight-arrow previous" aria-label="Previous highlight" onClick={() => setHighlightIndex((activeHighlightIndex - 1 + hub.highlights.length) % hub.highlights.length)}><ChevronLeft size={26} /></button>}
            <article className="hub-highlight" key={activeHighlight.id}>
            <div className="hub-video-frame">{activeHighlight.videoUrl ? <video src={activeHighlight.videoUrl} controls autoPlay muted loop playsInline preload="metadata" /> : <a href={activeHighlight.message_url ?? "#"} target="_blank" rel="noreferrer"><Play size={36} /> Open highlight</a>}</div>
            <div className="hub-highlight-meta"><strong>{activeHighlight.team?.name ?? activeHighlight.user?.display_name ?? "REC Highlight"}</strong><span>{activeHighlightIndex + 1} of {hub.highlights.length} · Season {activeHighlight.season_number} · Week {activeHighlight.week_number}</span></div>
            <div className="hub-reactions">
              <button className={activeHighlight.myReactions.includes("like") ? "active" : ""} onClick={() => void react(activeHighlight.id, "like")} title="Like (does not count toward Play of the Year)"><ThumbsUp size={16} /> {activeHighlight.reactionCounts.like}</button>
              <button className={activeHighlight.myReactions.includes("dislike") ? "active" : ""} onClick={() => void react(activeHighlight.id, "dislike")} title="Dislike (does not count toward Play of the Year)"><ThumbsDown size={16} /> {activeHighlight.reactionCounts.dislike}</button>
              {AWARD_REACTIONS.map(reaction => <button key={reaction.key} className={activeHighlight.myReactions.includes(reaction.key) ? "active award" : "award"} onClick={() => void react(activeHighlight.id, reaction.key)}>{reaction.label} {activeHighlight.reactionCounts[reaction.key]}</button>)}
            </div>
          </article>
          {hub.highlights.length > 1 && <button className="hub-highlight-arrow next" aria-label="Next highlight" onClick={() => setHighlightIndex((activeHighlightIndex + 1) % hub.highlights.length)}><ChevronRight size={26} /></button>}
          </div> : <p className="hub-empty">Videos posted in the Discord highlights channel will roll in here.</p>}
        </section>

        <section className="hub-section hub-interview">
          <div><p className="hub-eyebrow">Coming soon</p><h2>REC Interview Room</h2><p>Coach interviews, rivalry features, and league stories will live here.</p></div><ChevronRight size={28} />
        </section>
      </>}
    </div>
  );
}
