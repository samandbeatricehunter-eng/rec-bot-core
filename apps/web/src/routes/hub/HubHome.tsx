import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Award, CalendarDays, ChevronLeft, ChevronRight, Eye, Landmark, MessageCircle, Megaphone, Newspaper, Play, ShieldCheck, ShoppingBag, ThumbsDown, ThumbsUp, Trophy, UserRound, UsersRound, WalletCards } from "lucide-react";
import { useAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubReactionKey, HubResponse, OpenTeam, StoryComment } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";

const AWARD_REACTIONS: Array<{ key: HubReactionKey; label: string }> = [
  { key: "TOTY", label: "Throw of the Year" }, { key: "COTY", label: "Catch of the Year" }, { key: "ROTY", label: "Run of the Year" },
  { key: "IOTY", label: "Interception of the Year" }, { key: "HOTY", label: "Hit of the Year" },
];
type Story = HubResponse["headlines"][number];

function displayLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ProfileStats({ values }: { values: Record<string, unknown> | null | undefined }) {
  const hidden = new Set(["userId", "leagueId", "seasonNumber"]);
  const rows = Object.entries(values ?? {}).filter(([key, value]) => !hidden.has(key) && value != null && typeof value !== "object");
  return rows.length ? <div className="hub-profile-stat-list">{rows.map(([key, value]) => <div key={key}><span>{displayLabel(key)}</span><strong>{typeof value === "number" ? value.toLocaleString() : String(value)}</strong></div>)}</div> : <p className="hub-empty">No stats recorded yet.</p>;
}

function BadgeShelf({ title, badges }: { title: string; badges: any[] }) {
  return <div className="hub-badge-group"><h4>{title}</h4>{badges?.length ? <div className="hub-badge-shelf">{badges.map((badge) => <article key={`${badge.badge_key}-${badge.tier}-${badge.season_number}`} title={badge.badge_description ?? ""}><Award size={18} /><div><strong>{badge.badge_label ?? displayLabel(badge.badge_key ?? "Badge")}</strong><span>{badge.tier ? `${String(badge.tier).toUpperCase()} · ` : ""}Earned {badge.earned_count ?? badge.earned_value ?? 1}×</span></div></article>)}</div> : <p className="hub-empty">None earned yet.</p>}</div>;
}

export function HubHome() {
  const auth = useAuth();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"league" | "store" | "team">("league");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [comments, setComments] = useState<StoryComment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDirection, setTransferDirection] = useState<"to_savings" | "from_savings">("to_savings");
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [purchaseType, setPurchaseType] = useState("");
  const [purchaseDetails, setPurchaseDetails] = useState<Record<string, string>>({});
  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [legends, setLegends] = useState<any[] | null>(null);
  const [soldLegendIds, setSoldLegendIds] = useState<string[]>([]);
  const [showOpenTeams, setShowOpenTeams] = useState(false);
  const [openTeams, setOpenTeams] = useState<OpenTeam[] | null>(null);
  const [openTeamsError, setOpenTeamsError] = useState<string | null>(null);
  const viewedHighlights = useRef(new Set<string>());

  async function load() {
    if (auth.status !== "ready") return;
    try { setHub(await recApi.getHub(auth.guildId)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  async function highlightReact(highlightId: string, reactionKey: HubReactionKey) {
    if (auth.status !== "ready") return;
    await recApi.toggleHubHighlightReaction({ guildId: auth.guildId, highlightId, reactionKey }); await load();
  }
  async function storyReact(storyId: string, reactionKey: "like" | "dislike") {
    if (auth.status !== "ready") return;
    await recApi.toggleHubStoryReaction({ guildId: auth.guildId, storyId, reactionKey }); await load();
  }
  async function gameReact(gameId: string, reactionKey: "like" | "dislike") {
    if (auth.status !== "ready") return;
    await recApi.toggleHubGameReaction({ guildId: auth.guildId, gameId, reactionKey }); await load();
  }
  async function recordView(highlightId: string) {
    if (auth.status !== "ready" || viewedHighlights.current.has(highlightId)) return;
    viewedHighlights.current.add(highlightId);
    try {
      const result = await recApi.recordHubHighlightView({ guildId: auth.guildId, highlightId });
      setHub((current) => current ? { ...current, highlights: current.highlights.map((highlight) => highlight.id === highlightId ? { ...highlight, viewCount: result.viewCount } : highlight) } : current);
    } catch { viewedHighlights.current.delete(highlightId); }
  }
  async function openComments(story: Story) {
    if (auth.status !== "ready") return;
    setActiveStory(story); setComments(null);
    const result = await recApi.listHubStoryComments({ guildId: auth.guildId, storyId: story.id });
    setComments(result.comments);
  }
  async function submitComment() {
    if (auth.status !== "ready" || !activeStory || !commentBody.trim()) return;
    const result = await recApi.addHubStoryComment({ guildId: auth.guildId, storyId: activeStory.id, body: commentBody });
    setComments(result.comments); setCommentBody(""); await load();
  }
  async function transferFunds() {
    if (auth.status !== "ready") return;
    const amount = Number(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setTransferStatus("Enter a positive amount."); return; }
    setTransferBusy(true); setTransferStatus(null);
    try {
      const result = await recApi.transferMyFunds({ guildId: auth.guildId, amount, direction: transferDirection });
      setTransferStatus(`Transfer complete. Wallet $${Number(result.wallet_balance).toLocaleString()} · Savings $${Number(result.savings_balance).toLocaleString()}`);
      setTransferAmount(""); await load();
    } catch (cause) { setTransferStatus(cause instanceof Error ? cause.message : "Transfer failed."); }
    finally { setTransferBusy(false); }
  }
  async function loadLegends() {
    if (auth.status !== "ready" || legends) return;
    const [catalog, availability] = await Promise.all([recApi.listHubLegends(auth.guildId), recApi.listHubLegendAvailability(auth.guildId)]);
    setLegends(catalog.legends); setSoldLegendIds(availability.soldLegendIds);
  }
  async function viewOpenTeams() {
    if (auth.status !== "ready") return;
    setShowOpenTeams(true); setOpenTeamsError(null);
    if (openTeams) return;
    try { setOpenTeams((await recApi.listOpenTeams(auth.guildId)).openTeams); }
    catch (cause) { setOpenTeamsError(cause instanceof Error ? cause.message : "Open teams could not be loaded."); }
  }
  async function submitPurchase() {
    if (auth.status !== "ready" || !purchaseType) return;
    setPurchaseBusy(true); setPurchaseStatus(null);
    try {
      let details: Record<string, unknown> = { ...purchaseDetails };
      if (purchaseType === "attribute") details = { playerName: purchaseDetails.playerName, allocations: [{ code: purchaseDetails.attributeCode?.toUpperCase(), points: Number(purchaseDetails.points) }] };
      if (purchaseType === "legend") {
        await recApi.purchaseHubLegend({ guildId: auth.guildId, legendId: purchaseDetails.legendId, replacePlayerRequest: purchaseDetails.replacePlayerRequest });
      } else {
        await recApi.createMyPurchase({ guildId: auth.guildId, purchaseType, details });
      }
      setPurchaseStatus("Purchase submitted. Funds were reserved and a commissioner has been notified for approval.");
      setPurchaseDetails({}); await load();
    } catch (cause) { setPurchaseStatus(cause instanceof Error ? cause.message : "Purchase failed."); }
    finally { setPurchaseBusy(false); }
  }

  if (error) return <div className="hub-state"><h1>League Hub</h1><p>{error}</p><button className="btn btn-primary" onClick={() => void load()}>Try again</button></div>;
  if (!hub) return <div className="hub-state"><h1>Loading League Hub…</h1></div>;
  const my = hub.myTeam?.display ?? {};
  const profile = hub.myTeam?.profile ?? {};
  const games = hub.matchups?.games ?? [];
  const activeHighlightIndex = hub.highlights.length ? highlightIndex % hub.highlights.length : 0;
  const activeHighlight = hub.highlights[activeHighlightIndex] ?? null;
  const openTeamsByConference = (openTeams ?? []).reduce<Record<string, OpenTeam[]>>((groups, team) => {
    const conference = team.conference || "Other";
    (groups[conference] ??= []).push(team);
    return groups;
  }, {});

  return <div className="hub-page">
    <section className="hub-hero"><div><p className="hub-eyebrow">Season {hub.league.seasonNumber} · Week {hub.league.weekNumber}</p><h1>{hub.league.name}</h1><p>{String(hub.league.game ?? "League").replaceAll("_", " ")} · {String(hub.league.seasonStage).replaceAll("_", " ")}</p></div>{hub.canManageLeague && <Link className="btn btn-primary hub-manage-button" to="/league-mgmt"><ShieldCheck size={18} /> League Management</Link>}</section>
    <nav className="hub-tabs"><button className={tab === "league" ? "active" : ""} onClick={() => setTab("league")}><Trophy size={18} /> League</button><button onClick={() => void viewOpenTeams()}><UsersRound size={18} /> Open Teams</button><button className={tab === "store" ? "active" : ""} onClick={() => setTab("store")}><ShoppingBag size={18} /> Store</button><button className={tab === "team" ? "active" : ""} onClick={() => setTab("team")}><UserRound size={18} /> My Team</button></nav>

    {tab === "team" ? <section className="hub-section hub-my-team"><div className="hub-section-heading"><div><p className="hub-eyebrow">Full coach profile</p><h2>{my.teamName ?? profile.teamName ?? "No team linked"}</h2><p>{my.discordUsername ?? profile.user?.display_name ?? "REC Member"}</p></div></div><div className="hub-stat-grid">
      <article><span>Coach</span><strong>{my.discordUsername ?? "REC Member"}</strong></article><article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "—"}</strong></article><article><span>Point differential</span><strong>{Number(my.leagueSeasonPointDifferential ?? 0) >= 0 ? "+" : ""}{my.leagueSeasonPointDifferential ?? 0}</strong></article><article><span>Current matchup</span><strong>{my.currentMatchupText ?? "None"}</strong></article><article><span>Wallet</span><strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></article><article><span>Savings</span><strong>${Number(my.savings ?? 0).toLocaleString()}</strong></article>
    </div><div className="hub-profile-sections">
      <details open><summary><WalletCards size={18} /> Funds &amp; Savings</summary><div className="hub-profile-panel"><p>Projected next-advance interest: <strong>${Number(my.projectedInterest ?? 0).toLocaleString()}</strong></p><p className="hub-muted">Savings interest continues to accrue when the league advances.</p><div className="hub-transfer-form"><select className="form-input" value={transferDirection} onChange={(event) => setTransferDirection(event.target.value as typeof transferDirection)}><option value="to_savings">Wallet → Savings</option><option value="from_savings">Savings → Wallet</option></select><input className="form-input" type="number" min="0.01" step="0.01" placeholder="Amount" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} /><Button variant="primary" disabled={transferBusy || !transferAmount} onClick={() => void transferFunds()}>{transferBusy ? "Transferring…" : "Transfer Funds"}</Button></div>{transferStatus && <p className="hub-transfer-status">{transferStatus}</p>}</div></details>
      <details open><summary><Trophy size={18} /> Records</summary><div className="hub-profile-panel hub-record-grid"><article><span>Current season</span><strong>{profile.seasonRecord?.text ?? my.leagueSeasonRecordText ?? "0-0-0"}</strong><small>Active streak {profile.seasonRecord?.activeStreak ?? "—"}</small></article><article><span>All-time REC</span><strong>{profile.globalRecord?.text ?? my.globalRecordText ?? "0-0-0"}</strong><small>Playoffs {profile.globalRecord?.playoffText ?? "0-0"} · Championships {profile.globalRecord?.superbowlWins ?? 0}</small></article>{profile.gameGlobalRecord && <article><span>{profile.gameGlobalRecord.label}</span><strong>{profile.gameGlobalRecord.text}</strong><small>Playoffs {profile.gameGlobalRecord.playoffText} · Championships {profile.gameGlobalRecord.superbowlWins ?? 0}</small></article>}<article><span>Power ranking</span><strong>{profile.powerRank?.rank ? `#${profile.powerRank.rank}` : "Unranked"}</strong><small>SOS {profile.powerRank?.sosScore ?? "—"}</small></article></div></details>
      <details><summary><Landmark size={18} /> Current Season Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.seasonStats} /></div></details>
      <details><summary><Landmark size={18} /> All-Time Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.careerStats} /></div></details>
      <details><summary><Award size={18} /> Badges &amp; Awards</summary><div className="hub-profile-panel"><BadgeShelf title="Weekly Badges" badges={profile.weeklyBadges ?? []} /><BadgeShelf title="Season Badges" badges={profile.seasonBadges ?? []} /><BadgeShelf title="Career Badges" badges={profile.globalBadges ?? []} />{profile.globalAwards?.length ? <div className="hub-badge-group"><h4>Awards</h4><div className="hub-badge-shelf">{profile.globalAwards.map((award: any) => <article key={award.awardName}><Trophy size={18} /><div><strong>{award.awardName}</strong><span>Won {award.count}×</span></div></article>)}</div></div> : null}</div></details>
      <details><summary><WalletCards size={18} /> Financial Profile</summary><div className="hub-profile-panel"><ProfileStats values={profile.financialSummary} /></div></details>
    </div></section> : tab === "store" ? <section className="hub-section hub-store"><div className="hub-section-heading"><div><p className="hub-eyebrow"><ShoppingBag size={14} /> Franchise marketplace</p><h2>REC Store</h2><p>Wallet balance: <strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></p></div></div>
      {!hub.store.enabled ? <p className="hub-empty">The coin economy is not enabled for this league.</p> : <>
        {hub.store.cfbSeasonOneLocked && <div className="hub-store-lock"><strong>CFB Season 1 roster lock</strong><span>Custom recruits, Campus Legends, development upgrades, attributes, and traits unlock automatically when Season 2 starts.</span></div>}
        <div className="hub-store-products">{hub.store.products.map((product) => <button key={product.type} disabled={product.locked} className={purchaseType === product.type ? "active" : ""} onClick={() => { setPurchaseType(product.type); setPurchaseDetails({}); setPurchaseStatus(null); if (product.type === "legend") void loadLegends(); }}><ShoppingBag size={19} /><strong>{product.label}</strong><span>{product.locked ? "Available Season 2" : "Open purchase form"}</span></button>)}</div>
        {purchaseType && !hub.store.products.find((product) => product.type === purchaseType)?.locked && <div className="hub-store-form"><h3>{hub.store.products.find((product) => product.type === purchaseType)?.label}</h3>
          {purchaseType === "legend" ? <><label className="form-field"><span className="form-label">Available legend</span><select className="form-input" value={purchaseDetails.legendId ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, legendId: event.target.value }))}><option value="">Select a legend</option>{(legends ?? []).filter((legend) => !soldLegendIds.includes(legend.id)).map((legend) => <option key={legend.id} value={legend.id}>{legend.name} · {legend.position} · {legend.est_ovr ?? "?"} OVR</option>)}</select></label><label className="form-field"><span className="form-label">Player to replace (optional)</span><input className="form-input" value={purchaseDetails.replacePlayerRequest ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, replacePlayerRequest: event.target.value }))} /></label></> : <>
            {purchaseType === "custom_player" && <label className="form-field"><span className="form-label">Package</span><select className="form-input" value={purchaseDetails.package ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, package: event.target.value }))}><option value="">Select package</option><option value="bronze">Bronze · $250</option><option value="silver">Silver · $750</option><option value="gold">Gold · $1,000</option></select></label>}
            {purchaseType === "dev_upgrade" && <label className="form-field"><span className="form-label">Upgrade to</span><select className="form-input" value={purchaseDetails.targetTier ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, targetTier: event.target.value }))}><option value="">Select tier</option><option value="star">Star · $250</option><option value="superstar">Superstar · $750</option><option value="xfactor">X-Factor · $1,000</option></select></label>}
            {purchaseType === "contract" && <label className="form-field"><span className="form-label">Contract change</span><select className="form-input" value={purchaseDetails.variant ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, variant: event.target.value }))}><option value="">Select option</option><option value="salary_bonus_reduction">50% Salary/Bonus Reduction · $500</option><option value="extension">1-Year Extension · $500</option></select></label>}
            {purchaseType === "attribute" && <div className="hub-store-row"><label className="form-field"><span className="form-label">Attribute code</span><input className="form-input" placeholder="SPD" value={purchaseDetails.attributeCode ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, attributeCode: event.target.value }))} /></label><label className="form-field"><span className="form-label">Points</span><input className="form-input" type="number" min="1" value={purchaseDetails.points ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, points: event.target.value }))} /></label></div>}
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            {purchaseType === "custom_player" && <label className="form-field"><span className="form-label">Position</span><input className="form-input" placeholder="QB, WR, CB…" value={purchaseDetails.position ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, position: event.target.value }))} /></label>}
            {purchaseType === "player_trait" && <label className="form-field"><span className="form-label">Requested trait</span><input className="form-input" value={purchaseDetails.requestedTrait ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, requestedTrait: event.target.value }))} /></label>}
          </>}
          <Button variant="primary" disabled={purchaseBusy || (purchaseType === "legend" ? !purchaseDetails.legendId : !purchaseDetails.playerName)} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button>{purchaseStatus && <p className="hub-transfer-status">{purchaseStatus}</p>}
        </div>}
      </>}
    </section> : <>
      <section className="hub-section hub-highlight-feature"><div className="hub-section-heading"><div><p className="hub-eyebrow"><Play size={14} /> Community clips</p><h2>Highlight Reel</h2></div></div>
        {activeHighlight ? <div className="hub-highlight-carousel">{hub.highlights.length > 1 && <button className="hub-highlight-arrow previous" onClick={() => setHighlightIndex((activeHighlightIndex - 1 + hub.highlights.length) % hub.highlights.length)}><ChevronLeft /></button>}<article className="hub-highlight">
          <div className="hub-video-frame">{activeHighlight.videoUrl ? <video src={activeHighlight.videoUrl} controls autoPlay muted loop playsInline preload="metadata" onPlay={() => void recordView(activeHighlight.id)} /> : <a href={activeHighlight.message_url ?? "#"} target="_blank" rel="noreferrer" onClick={() => void recordView(activeHighlight.id)}><Play size={36} /> Open highlight</a>}</div>
          <div className="hub-highlight-meta"><strong>{activeHighlight.team?.name ?? activeHighlight.user?.display_name ?? "REC Highlight"}</strong><span>{activeHighlightIndex + 1} of {hub.highlights.length} · Season {activeHighlight.season_number} · {activeHighlight.season_stage === "regular_season" ? `Week ${activeHighlight.week_number}` : displayLabel(activeHighlight.season_stage ?? `Week ${activeHighlight.week_number}`)}</span></div><div className="hub-highlight-views"><Eye size={14} /> {activeHighlight.viewCount} views</div>
          <div className="hub-reaction-groups"><div className="hub-reaction-group"><span className="hub-reaction-label">Community reactions</span><div className="hub-reactions"><button className={activeHighlight.myReactions.includes("like") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "like")}><ThumbsUp size={16} /> Like {activeHighlight.reactionCounts.like}</button><button className={activeHighlight.myReactions.includes("dislike") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "dislike")}><ThumbsDown size={16} /> Dislike {activeHighlight.reactionCounts.dislike}</button></div></div>
            <div className="hub-reaction-group hub-poty-reactions"><span className="hub-reaction-label">Play of the Year nominations</span><div className="hub-reactions">{AWARD_REACTIONS.map((reaction) => <button key={reaction.key} className={activeHighlight.myReactions.includes(reaction.key) ? "active award" : "award"} onClick={() => void highlightReact(activeHighlight.id, reaction.key)}>{reaction.label} {activeHighlight.reactionCounts[reaction.key]}</button>)}</div></div></div>
        </article>{hub.highlights.length > 1 && <button className="hub-highlight-arrow next" onClick={() => setHighlightIndex((activeHighlightIndex + 1) % hub.highlights.length)}><ChevronRight /></button>}</div> : <p className="hub-empty">Videos posted in Discord will roll in here.</p>}
      </section>

      <section className="hub-section hub-announcements"><div className="hub-section-heading"><div><p className="hub-eyebrow"><Megaphone size={14} /> Official updates</p><h2>Announcements</h2></div></div>{hub.announcements.length ? <div className="hub-feed-list">{hub.announcements.map((item) => <article key={item.id}><time>{new Date(item.published_at).toLocaleDateString()}</time><h3>{item.title}</h3><p>{item.body}</p></article>)}</div> : <p className="hub-empty">League announcements will appear here.</p>}</section>

      <section className="hub-section"><div className="hub-section-heading"><div><p className="hub-eyebrow"><Newspaper size={14} /> Around the league</p><h2>Headlines &amp; Articles</h2></div></div>{hub.headlines.length ? <div className="hub-story-grid">{hub.headlines.slice(0, 12).map((story) => <article className={story.story_type === "headline" ? "hub-story-card" : "hub-story-card article"} key={story.id}>
        <button className="hub-story-open" onClick={() => void openComments(story)}><time>Week {story.week}</time><h3>{story.headline ?? "League Story"}</h3><p>{story.body}</p>{story.story_type !== "headline" && <span className="hub-read-article">Open REC Network Roundtable →</span>}</button>
        <div className="hub-social-actions"><button className={story.myReaction === "like" ? "active" : ""} onClick={() => void storyReact(story.id, "like")}><ThumbsUp size={15} /> {story.reactionCounts.like}</button><button className={story.myReaction === "dislike" ? "active" : ""} onClick={() => void storyReact(story.id, "dislike")}><ThumbsDown size={15} /> {story.reactionCounts.dislike}</button><button onClick={() => void openComments(story)}><MessageCircle size={15} /> {story.commentCount}</button></div>
      </article>)}</div> : <p className="hub-empty">Headlines publish here after games or from League Publishing.</p>}</section>

      <section className="hub-section"><div className="hub-section-heading"><div><p className="hub-eyebrow"><CalendarDays size={14} /> Current slate</p><h2>Weekly H2H Matchups</h2></div></div>{games.length ? <div className="hub-matchups">{games.map((game) => <article key={game.gameId}><div><strong>{game.awayTeamName}</strong><span>at</span><strong>{game.homeTeamName}</strong></div><span className="badge badge-info">{game.status}</span><div className="hub-social-actions"><button className={game.myReaction === "like" ? "active" : ""} onClick={() => void gameReact(game.gameId, "like")}><ThumbsUp size={15} /> {game.reactionCounts.like}</button><button className={game.myReaction === "dislike" ? "active" : ""} onClick={() => void gameReact(game.gameId, "dislike")}><ThumbsDown size={15} /> {game.reactionCounts.dislike}</button></div></article>)}</div> : <p className="hub-empty">No H2H games are scheduled for this week.</p>}</section>
    </>}

    {activeStory && <Modal title={activeStory.headline ?? "League Story"} onClose={() => { setActiveStory(null); setComments(null); }}><div className="roundtable-story"><p className="roundtable-lede">{activeStory.body}</p>{activeStory.roundtable?.length ? <div className="roundtable-panel"><div className="roundtable-banner">REC NETWORK · LEAGUE ROUNDTABLE</div>{activeStory.roundtable.map((panelist) => <article key={`${panelist.speaker}-${panelist.role}`}><div className="roundtable-avatar">{panelist.speaker.split(" ").map((part) => part[0]).join("")}</div><div><strong>{panelist.speaker}</strong><span>{panelist.role}</span><p>{panelist.take}</p></div></article>)}</div> : null}
      <div className="story-comments"><h3><MessageCircle size={18} /> Comments</h3>{comments === null ? <p>Loading comments…</p> : comments.length ? comments.map((comment) => <article key={comment.id}><strong>{comment.authorName}</strong><time>{new Date(comment.created_at).toLocaleString()}</time><p>{comment.body}</p></article>) : <p className="hub-empty">No comments yet.</p>}<textarea className="form-input" rows={3} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add to the discussion…" /><Button variant="primary" disabled={!commentBody.trim()} onClick={() => void submitComment()}>Post Comment</Button></div>
    </div></Modal>}
    {showOpenTeams && <Modal title="Open Teams" onClose={() => setShowOpenTeams(false)}><div className="hub-open-teams"><p>These teams are currently available in {hub.league.name}. Unlinked members can run <strong>/hub</strong> in Discord and select <strong>Request Team</strong>.</p>{openTeamsError ? <div className="hub-empty"><p>{openTeamsError}</p><Button variant="secondary" onClick={() => { setOpenTeams(null); void viewOpenTeams(); }}>Try again</Button></div> : openTeams === null ? <p className="hub-empty">Loading available teams...</p> : openTeams.length === 0 ? <p className="hub-empty">All teams are currently assigned.</p> : <div className="hub-open-team-conferences">{Object.entries(openTeamsByConference).map(([conference, teams]) => <section key={conference}><h3>{conference}</h3><div>{teams.map((team) => <article key={team.id}><UsersRound size={17} /><span><strong>{team.name}</strong><small>{team.division || "Conference team"}</small></span></article>)}</div></section>)}</div>}</div></Modal>}
  </div>;
}
