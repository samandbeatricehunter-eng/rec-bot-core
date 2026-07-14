import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Award, CalendarDays, ChevronLeft, ChevronRight, Eye, Landmark, MessageCircle, Megaphone, Newspaper, Play, ShieldCheck, ShoppingBag, ThumbsDown, ThumbsUp, Trophy, UserRound, UsersRound, WalletCards } from "lucide-react";
import { useAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubReactionKey, HubResponse, OpenTeam, StoryComment } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";
import { IconWell } from "../../components/design-system/IconWell.js";
import { StatusChip } from "../../components/design-system/StatusChip.js";
import { MatchupPlate } from "../../components/design-system/MatchupPlate.js";
import { MobileBottomNav } from "../../components/design-system/MobileBottomNav.js";
import { ExpandedArticleView } from "../../components/hub/ExpandedArticleView.js";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

const AWARD_REACTIONS: Array<{ key: HubReactionKey; label: string }> = [
  { key: "TOTY", label: "Throw of the Year" }, { key: "COTY", label: "Catch of the Year" }, { key: "ROTY", label: "Run of the Year" },
  { key: "IOTY", label: "Interception of the Year" }, { key: "HOTY", label: "Hit of the Year" },
];
const HIGHLIGHT_REACTION_KEYS: HubReactionKey[] = ["like", "dislike", "TOTY", "COTY", "ROTY", "IOTY", "HOTY"];
const AWARD_KEYS = AWARD_REACTIONS.map((reaction) => reaction.key);
type Story = HubResponse["headlines"][number];
type LeagueSubTab = "feed" | "highlights" | "matchups";

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
  const isMobile = useIsMobile();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"league" | "store" | "team">("league");
  const [subTab, setSubTab] = useState<LeagueSubTab>("feed");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
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

  const highlightCount = hub?.highlights.length ?? 0;
  const activeHighlightIndex = highlightCount ? highlightIndex % highlightCount : 0;
  const highlightSwipe = useSwipeNavigation({ itemCount: highlightCount, onIndexChange: setHighlightIndex });
  useEffect(() => { highlightSwipe.setCurrentIndex(activeHighlightIndex); }, [activeHighlightIndex]);

  const headlineCount = hub?.headlines.length ?? 0;
  const mobileStorySwipe = useSwipeNavigation({ itemCount: headlineCount, onIndexChange: (index) => setActiveStoryIndex(index) });

  async function load() {
    if (auth.status !== "ready") return;
    try { setHub(await recApi.getHub(auth.guildId)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  // Comments load once per story open — keyed on the index, not on `hub`, so an optimistic
  // reaction/comment update elsewhere doesn't re-trigger a comment refetch.
  useEffect(() => {
    if (activeStoryIndex == null || auth.status !== "ready" || !hub) return;
    const story = hub.headlines[activeStoryIndex];
    if (!story) return;
    setComments(null);
    recApi.listHubStoryComments({ guildId: auth.guildId, storyId: story.id }).then((result) => setComments(result.comments));
  }, [activeStoryIndex]);

  async function highlightReact(highlightId: string, reactionKey: HubReactionKey) {
    if (auth.status !== "ready") return;
    const mutuallyExclusive = reactionKey === "like" || reactionKey === "dislike" ? ["like", "dislike"] : AWARD_KEYS;
    setHub((current) => current ? { ...current, highlights: current.highlights.map((highlight) => {
      if (highlight.id !== highlightId) return highlight;
      const has = highlight.myReactions.includes(reactionKey);
      const counts = { ...highlight.reactionCounts };
      let nextReactions = highlight.myReactions;
      if (has) {
        counts[reactionKey] = Math.max(0, counts[reactionKey] - 1);
        nextReactions = highlight.myReactions.filter((key) => key !== reactionKey);
      } else {
        for (const key of mutuallyExclusive) if (key !== reactionKey && highlight.myReactions.includes(key as HubReactionKey)) counts[key as HubReactionKey] = Math.max(0, counts[key as HubReactionKey] - 1);
        counts[reactionKey] = (counts[reactionKey] ?? 0) + 1;
        nextReactions = [...highlight.myReactions.filter((key) => !mutuallyExclusive.includes(key)), reactionKey];
      }
      return { ...highlight, myReactions: nextReactions, reactionCounts: counts };
    }) } : current);
    try { await recApi.toggleHubHighlightReaction({ guildId: auth.guildId, highlightId, reactionKey }); }
    catch { await load(); }
  }
  async function storyReact(storyId: string, reactionKey: "like" | "dislike") {
    if (auth.status !== "ready") return;
    setHub((current) => current ? { ...current, headlines: current.headlines.map((story) => {
      if (story.id !== storyId) return story;
      const counts = { ...story.reactionCounts };
      const isSame = story.myReaction === reactionKey;
      if (story.myReaction) counts[story.myReaction] = Math.max(0, counts[story.myReaction] - 1);
      if (!isSame) counts[reactionKey] = (counts[reactionKey] ?? 0) + 1;
      return { ...story, myReaction: isSame ? null : reactionKey, reactionCounts: counts };
    }) } : current);
    try { await recApi.toggleHubStoryReaction({ guildId: auth.guildId, storyId, reactionKey }); }
    catch { await load(); }
  }
  async function gameReact(gameId: string, reactionKey: "like" | "dislike") {
    if (auth.status !== "ready") return;
    setHub((current) => current ? { ...current, matchups: { ...current.matchups, games: current.matchups.games.map((game: any) => {
      if (game.gameId !== gameId) return game;
      const counts = { ...game.reactionCounts };
      const isSame = game.myReaction === reactionKey;
      if (game.myReaction) counts[game.myReaction] = Math.max(0, counts[game.myReaction] - 1);
      if (!isSame) counts[reactionKey] = (counts[reactionKey] ?? 0) + 1;
      return { ...game, myReaction: isSame ? null : reactionKey, reactionCounts: counts };
    }) } } : current);
    try { await recApi.toggleHubGameReaction({ guildId: auth.guildId, gameId, reactionKey }); }
    catch { await load(); }
  }
  async function recordView(highlightId: string) {
    if (auth.status !== "ready" || viewedHighlights.current.has(highlightId)) return;
    viewedHighlights.current.add(highlightId);
    try {
      const result = await recApi.recordHubHighlightView({ guildId: auth.guildId, highlightId });
      setHub((current) => current ? { ...current, highlights: current.highlights.map((highlight) => highlight.id === highlightId ? { ...highlight, viewCount: result.viewCount } : highlight) } : current);
    } catch { viewedHighlights.current.delete(highlightId); }
  }
  function openStory(index: number) { setActiveStoryIndex(index); }
  function closeStory() { setActiveStoryIndex(null); setComments(null); }
  async function submitComment() {
    if (auth.status !== "ready" || activeStoryIndex == null || !hub) return;
    const story = hub.headlines[activeStoryIndex];
    const body = commentBody.trim();
    if (!story || !body) return;
    const tempId = `temp-${Date.now()}`;
    setComments((current) => [...(current ?? []), { id: tempId, body, authorName: "You", created_at: new Date().toISOString() }]);
    setCommentBody("");
    try {
      const result = await recApi.addHubStoryComment({ guildId: auth.guildId, storyId: story.id, body });
      setComments(result.comments);
      setHub((current) => current ? { ...current, headlines: current.headlines.map((item) => item.id === story.id ? { ...item, commentCount: item.commentCount + 1 } : item) } : current);
    } catch {
      setComments((current) => (current ?? []).filter((comment) => comment.id !== tempId));
      setCommentBody(body);
    }
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
  const activeHighlight = hub.highlights[activeHighlightIndex] ?? null;
  const activeStory = activeStoryIndex != null ? hub.headlines[activeStoryIndex] ?? null : null;
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
    </section> : <div className="hub-league-tab">
      <nav className="hub-subtabs">
        <button className={subTab === "feed" ? "active" : ""} onClick={() => setSubTab("feed")}><Newspaper size={16} /> Feed</button>
        <button className={subTab === "highlights" ? "active" : ""} onClick={() => setSubTab("highlights")}><Play size={16} /> Highlights</button>
        <button className={subTab === "matchups" ? "active" : ""} onClick={() => setSubTab("matchups")}><CalendarDays size={16} /> Matchups</button>
      </nav>

      {subTab === "highlights" && (
        <SectionFrame eyebrow="Community clips" title="Highlight Reel">
          {activeHighlight ? <div className="hub-highlight-carousel">
            {highlightCount > 1 && <button className="hub-highlight-arrow previous" onClick={() => setHighlightIndex((activeHighlightIndex - 1 + highlightCount) % highlightCount)}><ChevronLeft /></button>}
            <article
              className="hub-highlight hub-highlight-feature swipe-card-surface"
              style={{
                transform: highlightSwipe.isDragging ? `translateX(${highlightSwipe.dragOffsetPx}px)` : undefined,
                transition: highlightSwipe.isDragging || highlightSwipe.reducedMotion ? "none" : "transform var(--duration-standard) var(--ease-standard)",
              }}
              onPointerDown={highlightSwipe.handlers.onPointerDown}
              onPointerMove={highlightSwipe.handlers.onPointerMove}
              onPointerUp={highlightSwipe.handlers.onPointerUp}
              onPointerCancel={highlightSwipe.handlers.onPointerCancel}
            >
              <div className="hub-video-frame">{activeHighlight.videoUrl ? <video src={activeHighlight.videoUrl} controls autoPlay muted loop playsInline preload="metadata" onPlay={() => void recordView(activeHighlight.id)} /> : <a href={activeHighlight.message_url ?? "#"} target="_blank" rel="noreferrer" onClick={() => void recordView(activeHighlight.id)}><Play size={36} /> Open highlight</a>}</div>
              <div className="hub-highlight-meta"><strong>{activeHighlight.team?.name ?? activeHighlight.user?.display_name ?? "REC Highlight"}</strong><span>{activeHighlightIndex + 1} of {highlightCount} · Season {activeHighlight.season_number} · {activeHighlight.season_stage === "regular_season" ? `Week ${activeHighlight.week_number}` : displayLabel(activeHighlight.season_stage ?? `Week ${activeHighlight.week_number}`)}</span></div><div className="hub-highlight-views"><Eye size={14} /> {activeHighlight.viewCount} views</div>
              <div className="hub-reaction-groups"><div className="hub-reaction-group"><span className="hub-reaction-label">Community reactions</span><div className="hub-reactions"><button className={activeHighlight.myReactions.includes("like") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "like")}><ThumbsUp size={16} /> Like {activeHighlight.reactionCounts.like}</button><button className={activeHighlight.myReactions.includes("dislike") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "dislike")}><ThumbsDown size={16} /> Dislike {activeHighlight.reactionCounts.dislike}</button></div></div>
                <div className="hub-reaction-group hub-poty-reactions"><span className="hub-reaction-label">Play of the Year nominations</span><div className="hub-reactions">{AWARD_REACTIONS.map((reaction) => <button key={reaction.key} className={activeHighlight.myReactions.includes(reaction.key) ? "active award" : "award"} onClick={() => void highlightReact(activeHighlight.id, reaction.key)}>{reaction.label} {activeHighlight.reactionCounts[reaction.key]}</button>)}</div></div></div>
            </article>{highlightCount > 1 && <button className="hub-highlight-arrow next" onClick={() => setHighlightIndex((activeHighlightIndex + 1) % highlightCount)}><ChevronRight /></button>}</div> : <p className="hub-empty">Videos posted in Discord will roll in here.</p>}
        </SectionFrame>
      )}

      {subTab === "feed" && <>
        <SectionFrame eyebrow="Official updates" title="Announcements">
          {hub.announcements.length ? <div className="hub-feed-list">{hub.announcements.map((item) => <article key={item.id}><time>{new Date(item.published_at).toLocaleDateString()}</time><h3>{item.title}</h3><p>{item.body}</p></article>)}</div> : <p className="hub-empty">League announcements will appear here.</p>}
        </SectionFrame>

        <SectionFrame eyebrow="Around the league" title="Headlines & Articles">
          {hub.headlines.length ? (
            isMobile ? (
              <div className="hub-story-mobile-swipe" style={{ position: "relative" }}>
                {(() => {
                  const index = Math.min(activeStoryIndex ?? 0, headlineCount - 1);
                  const story = hub.headlines[index];
                  if (!story) return null;
                  return (
                    <article
                      className={(story.story_type === "headline" ? "hub-story-card" : "hub-story-card article") + " swipe-card-surface"}
                      style={{
                        transform: mobileStorySwipe.isDragging ? `translateX(${mobileStorySwipe.dragOffsetPx}px)` : undefined,
                        transition: mobileStorySwipe.isDragging || mobileStorySwipe.reducedMotion ? "none" : "transform var(--duration-standard) var(--ease-standard)",
                      }}
                      onPointerDown={mobileStorySwipe.handlers.onPointerDown}
                      onPointerMove={mobileStorySwipe.handlers.onPointerMove}
                      onPointerUp={mobileStorySwipe.handlers.onPointerUp}
                      onPointerCancel={mobileStorySwipe.handlers.onPointerCancel}
                    >
                      <button className="hub-story-open" onClick={() => openStory(index)}><time>Week {story.week}</time><h3>{story.headline ?? "League Story"}</h3><p>{story.body}</p>{story.story_type !== "headline" && <span className="hub-read-article">Open REC Network Roundtable →</span>}</button>
                      <div className="hub-social-actions"><button className={story.myReaction === "like" ? "active" : ""} onClick={() => void storyReact(story.id, "like")}><ThumbsUp size={15} /> {story.reactionCounts.like}</button><button className={story.myReaction === "dislike" ? "active" : ""} onClick={() => void storyReact(story.id, "dislike")}><ThumbsDown size={15} /> {story.reactionCounts.dislike}</button><button onClick={() => openStory(index)}><MessageCircle size={15} /> {story.commentCount}</button></div>
                    </article>
                  );
                })()}
                <p className="hub-story-swipe-hint">Swipe for more · {(activeStoryIndex ?? 0) + 1} of {headlineCount}</p>
              </div>
            ) : (
              <div className="hub-story-grid">{hub.headlines.slice(0, 12).map((story, index) => <article className={story.story_type === "headline" ? "hub-story-card" : "hub-story-card article"} key={story.id}>
                <button className="hub-story-open" onClick={() => openStory(index)}><time>Week {story.week}</time><h3>{story.headline ?? "League Story"}</h3><p>{story.body}</p>{story.story_type !== "headline" && <span className="hub-read-article">Open REC Network Roundtable →</span>}</button>
                <div className="hub-social-actions"><button className={story.myReaction === "like" ? "active" : ""} onClick={() => void storyReact(story.id, "like")}><ThumbsUp size={15} /> {story.reactionCounts.like}</button><button className={story.myReaction === "dislike" ? "active" : ""} onClick={() => void storyReact(story.id, "dislike")}><ThumbsDown size={15} /> {story.reactionCounts.dislike}</button><button onClick={() => openStory(index)}><MessageCircle size={15} /> {story.commentCount}</button></div>
              </article>)}</div>
            )
          ) : <p className="hub-empty">Headlines publish here after games or from League Publishing.</p>}
        </SectionFrame>
      </>}

      {subTab === "matchups" && (
        <SectionFrame eyebrow="Current slate" title="Weekly H2H Matchups">
          {games.length ? <div className="hub-matchups">{games.map((game: any) => (
            <MatchupPlate
              key={game.gameId}
              homeTeam={game.homeTeamName}
              awayTeam={game.awayTeamName}
              reactionSlot={<>
                <StatusChip status="info" label={game.status} />
                <div className="hub-social-actions"><button className={game.myReaction === "like" ? "active" : ""} onClick={() => void gameReact(game.gameId, "like")}><ThumbsUp size={15} /> {game.reactionCounts.like}</button><button className={game.myReaction === "dislike" ? "active" : ""} onClick={() => void gameReact(game.gameId, "dislike")}><ThumbsDown size={15} /> {game.reactionCounts.dislike}</button></div>
              </>}
            />
          ))}</div> : <p className="hub-empty">No H2H games are scheduled for this week.</p>}
        </SectionFrame>
      )}

      {isMobile && (
        <MobileBottomNav
          tabs={[
            { key: "feed", label: "Feed", icon: <IconWell size="sm" icon={<Newspaper size={14} />} /> },
            { key: "highlights", label: "Highlights", icon: <IconWell size="sm" icon={<Play size={14} />} /> },
            { key: "matchups", label: "Matchups", icon: <IconWell size="sm" icon={<CalendarDays size={14} />} /> },
          ]}
          active={subTab}
          onChange={setSubTab}
        />
      )}
    </div>}

    {activeStory && (isMobile ? (
      <ExpandedArticleView
        stories={hub.headlines}
        activeIndex={activeStoryIndex ?? 0}
        onIndexChange={(index) => setActiveStoryIndex(index)}
        onClose={closeStory}
        comments={comments}
        commentBody={commentBody}
        onCommentBodyChange={setCommentBody}
        onSubmitComment={() => void submitComment()}
        onReact={(storyId, key) => void storyReact(storyId, key)}
      />
    ) : (
      <Modal title={activeStory.headline ?? "League Story"} onClose={closeStory}><div className="roundtable-story"><p className="roundtable-lede">{activeStory.body}</p>{activeStory.roundtable?.length ? <div className="roundtable-panel"><div className="roundtable-banner">REC NETWORK · LEAGUE ROUNDTABLE</div>{activeStory.roundtable.map((panelist) => <article key={`${panelist.speaker}-${panelist.role}`}><div className="roundtable-avatar">{panelist.speaker.split(" ").map((part) => part[0]).join("")}</div><div><strong>{panelist.speaker}</strong><span>{panelist.role}</span><p>{panelist.take}</p></div></article>)}</div> : null}
        <div className="story-comments"><h3><MessageCircle size={18} /> Comments</h3>{comments === null ? <p>Loading comments…</p> : comments.length ? comments.map((comment) => <article key={comment.id}><strong>{comment.authorName}</strong><time>{new Date(comment.created_at).toLocaleString()}</time><p>{comment.body}</p></article>) : <p className="hub-empty">No comments yet.</p>}<textarea className="form-input" rows={3} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add to the discussion…" /><Button variant="primary" disabled={!commentBody.trim()} onClick={() => void submitComment()}>Post Comment</Button></div>
      </div></Modal>
    ))}
    {showOpenTeams && <Modal title="Open Teams" onClose={() => setShowOpenTeams(false)}><div className="hub-open-teams"><p>These teams are currently available in {hub.league.name}. Unlinked members can run <strong>/hub</strong> in Discord and select <strong>Request Team</strong>.</p>{openTeamsError ? <div className="hub-empty"><p>{openTeamsError}</p><Button variant="secondary" onClick={() => { setOpenTeams(null); void viewOpenTeams(); }}>Try again</Button></div> : openTeams === null ? <p className="hub-empty">Loading available teams...</p> : openTeams.length === 0 ? <p className="hub-empty">All teams are currently assigned.</p> : <div className="hub-open-team-conferences">{Object.entries(openTeamsByConference).map(([conference, teams]) => <section key={conference}><h3>{conference}</h3><div>{teams.map((team) => <article key={team.id}><UsersRound size={17} /><span><strong>{team.name}</strong><small>{team.division || "Conference team"}</small></span></article>)}</div></section>)}</div>}</div></Modal>}
  </div>;
}
