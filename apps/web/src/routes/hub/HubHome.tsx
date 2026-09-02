import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { americanFromDecimal, CFB_POSITIONS, CONFERENCE_ORDER, DEFAULT_REC_GLOBAL_ECONOMY_CONFIG, REC_DEV_TIER_LABELS, coinsNumber, devTierOrderForGame, parlayOdds, potentialPayout, priceForPurchaseWithConfig, regularSeasonWeeks, type LeagueGame, type RecDevTier, type RecGlobalEconomyConfig, type RecPurchaseType } from "@rec/shared";
import { RosterPlayerSelect } from "../../components/hub/RosterPlayerSelect.js";
import { ArrowDown, ArrowLeftRight, ArrowUp, Award, ChevronLeft, ChevronRight, Coins, Eye, FileText, Heart, Landmark, Megaphone, Pencil, Play, RefreshCw, ScrollText, Send, ShoppingBag, SlidersHorizontal, Star, ThumbsDown, ThumbsUp, Trash2, TrendingUp, Trophy, UserPlus, UserRound, UsersRound, WalletCards, X } from "lucide-react";
import { AttributePurchaseBuilder } from "../../components/hub/AttributePurchaseBuilder.js";
import { CustomPlayerWizard } from "../../components/hub/CustomPlayerWizard.js";
import { InterviewMicIcon, ManageTeamIcon, RecruitingCapIcon, ScheduleIcon } from "../../components/hub/QuickActionIcons.js";
import { ManageFundsModal, WalletSavingsCard } from "../../components/hub/WalletSavingsCard.js";
import { HeroMatchupActions } from "../../components/hub/HeroMatchupActions.js";
import { HeroMatchupBreakdown } from "../../components/hub/HeroMatchupBreakdown.js";
import { GotwVotingCarousel } from "../../components/hub/GotwVotingCarousel.js";
import { HeroSchedulingStatus } from "../../components/hub/HeroSchedulingStatus.js";
import { ShareStreamModal } from "../../components/hub/ShareStreamModal.js";
import { RequestHelpSheet } from "../../components/matchups/RequestHelpSheet.js";
import { randomDefenseName } from "../../lib/defense-names.js";
import { LegendPurchasePanel } from "./LegendPurchasePanel.js";
import { LiveGamesCard } from "../../components/hub/LiveGamesCard.js";
import { PLAYER_STAT_CATEGORY_OPTIONS, PLAYER_STAT_FIELDS } from "../../lib/player-stat-fields.js";
import { useAuth, useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { GotwGuessingRecordsResponse, HubMatchupSchedule, HubReactionKey, HubResponse, LinkedTeamRow, MatchupPreview as MatchupPreviewData, MediaPortalResponse, MyEosPayoutProgress, MyWagersResponse, OpenTeam, PeerWagerBoardResponse, RosterPlayer, StoryComment, StorePurchaseContext, TeamScheduleManualState, WagerOptionsResponse, WatchedPlayer, WeekWagerLinesResponse } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { ErrorPopup } from "../../components/ui/ErrorPopup.js";
import { Button } from "../../components/ui/Button.js";
import { CoinAmount } from "../../components/ui/CoinAmount.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";
import { IconWell } from "../../components/design-system/IconWell.js";
import { StatusChip } from "../../components/design-system/StatusChip.js";
import { ExpandedArticleView } from "../../components/hub/ExpandedArticleView.js";
import { InterviewBody } from "../../components/hub/InterviewBody.js";
import { EosAwardVotingBlock } from "../../components/hub/EosAwardVotingBlock.js";
import { CommissionerPollsVotingBlock } from "../../components/hub/CommissionerPollsVotingBlock.js";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { UploadBoxScoreModal } from "../league-mgmt/manage-league/UploadBoxScoreModal.js";
import { LateSubmissionsModal } from "../../components/hub/LateSubmissionsModal.js";
import { HighlightUploadModal } from "../../components/hub/HighlightUploadModal.js";
import { RecruitingBoardModal } from "../../components/hub/RecruitingBoardModal.js";
import { EditRosterRequestModal } from "../../components/hub/EditRosterRequestModal.js";
import { RelocateTeamWizard } from "../../components/hub/RelocateTeamWizard.js";
import { AssignBoxScoreStatsModal } from "../../components/hub/AssignBoxScoreStatsModal.js";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";
import { ExpandableMatchupCard } from "../../components/matchups/ExpandableMatchupCard.js";
import { RosterHome } from "../roster/RosterHome.js";
import { TradeCenterHome } from "./TradeCenterHome.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { FantasyDraftCard } from "./FantasyDraftCard.js";

// Highlight reactions are exactly three: Like, POTY, and Dislike. POTY opens the category
// modal (AWARD_REACTIONS) where the user picks one Play-of-the-Year category and submits.
const AWARD_REACTIONS: Array<{ key: HubReactionKey; label: string }> = [
  { key: "TOTY", label: "Throw of the Year" }, { key: "COTY", label: "Catch of the Year" }, { key: "ROTY", label: "Run of the Year" },
  { key: "IOTY", label: "Interception of the Year" }, { key: "HOTY", label: "Hit of the Year" }, { key: "MVP_PLAY", label: "Most Valuable Play" },
];
const COMMUNITY_REACTION_KEYS: HubReactionKey[] = ["like", "dislike"];
const AWARD_KEYS = AWARD_REACTIONS.map((reaction) => reaction.key);
const STORE_PRODUCT_ICONS: Partial<Record<RecPurchaseType, typeof ShoppingBag>> = {
  age_reset: RefreshCw,
  dev_upgrade: TrendingUp,
  contract: ScrollText,
  attribute: SlidersHorizontal,
  legend: Star,
  custom_player: UserPlus,
};
type Story = HubResponse["headlines"][number];
type HubSection = "league" | "store" | "team" | "roster" | "openTeams" | "schedules" | "trades";
type LeagueSubTab = "buzz" | "news" | "matchups";
type MatchupView = "h2h" | "cpu" | "rankings";

const HUB_SECTIONS = new Set<HubSection>(["league", "store", "team", "roster", "openTeams", "schedules", "trades"]);

const LEAGUE_SUB_TABS = new Set<LeagueSubTab>(["buzz", "news", "matchups"]);

function parseHubSection(value: string | null): HubSection | null {
  if (value && HUB_SECTIONS.has(value as HubSection)) return value as HubSection;
  return null;
}

function parseLeagueSubTab(value: string | null): LeagueSubTab | null {
  // Legacy deep-link: Rankings used to be its own sub-tab; it now lives under Matchups.
  if (value === "rankings") return "matchups";
  if (value && LEAGUE_SUB_TABS.has(value as LeagueSubTab)) return value as LeagueSubTab;
  return null;
}
type WagerMode = "single" | "parlay" | "peer";
type WagerLeg = { gameId: string; label: string; options: WagerOptionsResponse; market: string; pick: string };
type WagerPanel = {
  game: HubMatchupSchedule["games"][number];
  gameId: string;
  label: string;
  options: WagerOptionsResponse | null;
  mode: WagerMode;
  tab: "slip" | "board";
  market: string;
  pick: string;
  /** Overrides the market's system-generated line — empty string means use the default line. */
  stake: string;
  parlay: WagerLeg[];
  challengeType: "open" | "direct";
  targetUserId: string;
  coaches: Array<{ userId: string; discordId: string | null; teamAbbr: string; conference: string }>;
  board: Array<{ id: string; gameId: string; gameLabel: string; challengeType: string; market: string; pick: string; line: number | null; odds: number; stake: number; potentialPayout: number; placedByDiscordId: string; isMine: boolean; canAccept: boolean; createdAt: string; status?: string; boardState?: "open" | "active" }>;
  notice: string | null;
  busy: boolean;
};

function WagerSlip({ panel }: { panel: WagerPanel }) {
  const legs = panel.mode === "parlay"
    ? panel.parlay
    : panel.market && panel.pick && panel.options
      ? [{ gameId: panel.gameId, label: panel.label, options: panel.options, market: panel.market, pick: panel.pick }]
      : [];
  const renderedLegs = legs.map((leg) => {
    const market = leg.options.markets.find((item) => item.market === leg.market);
    const side = market?.sides.find((item) => item.pick === leg.pick);
    const line = market?.line;
    const pickLabel = leg.pick === "over" || leg.pick === "under"
      ? `${leg.pick.toUpperCase()}${line == null ? "" : ` ${line}`}`
      : side?.label ?? displayLabel(leg.pick);
    return {
      key: `${leg.gameId}-${leg.market}`,
      game: leg.label,
      market: market?.label ?? displayLabel(leg.market),
      pickLabel,
      odds: side?.odds ?? 1,
    };
  });
  const decimalOdds = panel.mode === "parlay"
    ? parlayOdds(renderedLegs.map((leg) => leg.odds))
    : renderedLegs[0]?.odds ?? 1;
  const stake = Math.max(0, Number(panel.stake) || 0);
  const payout = potentialPayout(stake, decimalOdds);

  return <aside className="hub-bet-slip" aria-label="Current bet slip">
    <header className="hub-bet-slip-head">
      <span>REC League eSports</span>
      <strong>Bet Slip</strong>
      <small>{panel.mode === "parlay" ? `${renderedLegs.length}-leg parlay` : panel.mode === "peer" ? "User wager" : "House single"}</small>
    </header>
    <div className="hub-bet-slip-status"><span>{panel.label}</span><b>Draft</b></div>
    <div className="hub-bet-slip-legs">
      {renderedLegs.length ? renderedLegs.map((leg, index) => <article key={leg.key}>
        <span className="hub-bet-slip-number">{index + 1}</span>
        <div><strong>{leg.pickLabel}</strong><small>{leg.game} · {leg.market}</small></div>
        <b>{americanFromDecimal(leg.odds)}</b>
      </article>) : <p>Select a line to build your ticket.</p>}
    </div>
    <dl className="hub-bet-slip-total">
      <div><dt>Stake</dt><dd><CoinAmount amount={stake} /></dd></div>
      <div><dt>{panel.mode === "parlay" ? "Combined odds" : "Odds"}</dt><dd>{decimalOdds.toFixed(2)}x</dd></div>
      <div className="hub-bet-slip-win"><dt>To win</dt><dd><CoinAmount amount={Math.max(0, payout - stake)} /></dd></div>
    </dl>
  </aside>;
}

function displayLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function matchupWordmarkSize(name: string) {
  const length = name.replace(/\s+/g, "").length;
  return `clamp(${length > 16 ? 11 : length > 12 ? 13 : length > 9 ? 15 : 17}px, ${length > 16 ? 3.1 : length > 12 ? 3.8 : length > 9 ? 4.6 : 5.8}vw, ${length > 16 ? 28 : length > 12 ? 34 : length > 9 ? 42 : 56}px)`;
}

// Card preview only — the full body always reads in the article modal. Breaks on a
// word boundary so it never cuts mid-word.
function snippet(body: string | null | undefined, maxLen = 160): string {
  const text = (body ?? "").trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : maxLen)}…`;
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return <div className="hub-image-lightbox" onClick={onClose}>
    <button type="button" className="hub-image-lightbox-close" onClick={onClose} aria-label="Close image"><X size={22} /></button>
    <img src={src} alt="" onClick={(event) => event.stopPropagation()} />
  </div>;
}

function gameLabel(game: string | null | undefined) {
  return String(game ?? "League").replace(/_/g, " ").replace(/\bcfb\b/gi, "CFB").toUpperCase();
}

function ProfileStats({ values, hideBoxScoresUploaded }: { values: Record<string, unknown> | null | undefined; hideBoxScoresUploaded?: boolean }) {
  const hidden = new Set(["userId", "leagueId", "seasonNumber", ...(hideBoxScoresUploaded ? ["boxScoresUploaded"] : [])]);
  const rows = Object.entries(values ?? {}).filter(([key, value]) => !hidden.has(key) && value != null && typeof value !== "object");
  return rows.length ? <div className="hub-profile-stat-list">{rows.map(([key, value]) => <div key={key}><span>{displayLabel(key)}</span><strong>{typeof value === "number" ? value.toLocaleString() : String(value)}</strong></div>)}</div> : <p className="hub-empty">No stats recorded yet.</p>;
}

export function RankChange({ change }: { change: number | null | undefined }) {
  if (change == null) return <span className="hub-rank-change">New</span>;
  if (change === 0) return <span className="hub-rank-change">No change</span>;
  return change > 0
    ? <span className="hub-rank-change hub-rank-change-up"><ArrowUp size={12} />{change}</span>
    : <span className="hub-rank-change hub-rank-change-down"><ArrowDown size={12} />{Math.abs(change)}</span>;
}

// Shared search + pagination for the ranking-style lists (Power Rankings, User Ratings,
// SOS) — all three used to hard-truncate to the first 16 entries with no way to reach the
// rest on a league bigger than that. Self-contained per call site (own query/page state),
// so multiple independent instances on the same page don't share state.
function RankingListSearch<T>({
  items,
  getSearchText,
  renderItem,
  emptyLabel,
  pageSize = 16,
}: {
  items: T[];
  getSearchText: (item: T) => string;
  // Must return an already-keyed element (e.g. <article key={item.id}>...</article>) — these
  // render as direct children of the .hub-power-rankings CSS grid, so no wrapper element here.
  renderItem: (item: T) => ReactElement;
  emptyLabel: string;
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => getSearchText(item).toLowerCase().includes(q)) : items;
  }, [items, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);

  return <>
    {items.length > pageSize && (
      <input
        className="form-input hub-ranking-search"
        placeholder="Search by name..."
        value={query}
        onChange={(event) => { setQuery(event.target.value); setPage(0); }}
      />
    )}
    {pageItems.length ? (
      <div className="hub-power-rankings">{pageItems.map(renderItem)}</div>
    ) : <p className="hub-empty">{query.trim() ? "No matches." : emptyLabel}</p>}
    {totalPages > 1 && (
      <div className="hub-ranking-pager">
        <button type="button" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>‹ Prev</button>
        <span>Page {clampedPage + 1} of {totalPages} · {filtered.length} total</span>
        <button type="button" disabled={clampedPage >= totalPages - 1} onClick={() => setPage(clampedPage + 1)}>Next ›</button>
      </div>
    )}
  </>;
}

// Madden's My Team page: a 2x2 grid of cards, each holding four buttons that either jump to
// an existing section (Trade Center/Roster/Store/Wagers), open a modal (Schedule/Power
// Rankings/SOS/Bank/Financial Profile/Season+Career Stats), or navigate to a dedicated page
// (League Records/League History). Trade Center/Roster/League History dropped out of the top
// nav for Madden (see LeagueTopNav.tsx) — this grid is now the only path to them.
function MaddenMyTeamGrid({
  coachName, my, profile, heroRank, heroUserScore, selectSection, viewMySchedule,
  setMediaModal, mediaPortal, setPowerRankingsModalOpen, setBankModalOpen,
  setFinancialModalOpen, setCareerStatsModalOpen, onOpenWagers, leagueId, isRise, riseHubUnlocked,
}: {
  coachName: string;
  my: any;
  profile: any;
  heroRank: string;
  heroUserScore: string;
  selectSection: (next: HubSection) => void;
  viewMySchedule: () => void | Promise<void>;
  setMediaModal: (value: "interview" | "article" | null) => void;
  mediaPortal: MediaPortalResponse | null;
  setPowerRankingsModalOpen: (value: boolean) => void;
  setBankModalOpen: (value: boolean) => void;
  setFinancialModalOpen: (value: boolean) => void;
  setCareerStatsModalOpen: (value: boolean) => void;
  onOpenWagers: () => void;
  leagueId: string;
  isRise?: boolean;
  riseHubUnlocked?: boolean;
}) {
  return <>
    <div className="hub-stat-grid">
      <article><span>Coach</span><strong>{coachName}</strong></article>
      <article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "—"}</strong></article>
      <article><span>Point differential</span><strong>{Number(my.leagueSeasonPointDifferential ?? 0) >= 0 ? "+" : ""}{my.leagueSeasonPointDifferential ?? 0}</strong></article>
      <article><span>Current matchup</span><strong>{my.currentMatchupText ?? "None"}</strong></article>
      <article><span>Power rank / User score</span><strong>{heroRank}</strong><small>Score {heroUserScore}</small></article>
      <article><span>Wallet / Savings</span><strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong><small>Savings <CoinAmount amount={Number(my.savings ?? 0)} /></small></article>
    </div>
    <div className="hub-my-team-grid">
      <div className="hub-my-team-card">
        <p className="hub-eyebrow">Matchup Center</p>
        <div className="hub-my-team-card-buttons">
          <button type="button" className="hub-my-team-btn" onClick={() => void viewMySchedule()}><strong>Schedule</strong><span>Full season</span></button>
          <button type="button" className="hub-my-team-btn" onClick={() => setMediaModal("interview")}><strong>{isRise ? "Interview" : <>Interview/<wbr />Article</>}</strong><span>Media desk</span></button>
        </div>
      </div>
      <div className="hub-my-team-card">
        <p className="hub-eyebrow">Team</p>
        <div className="hub-my-team-card-buttons">
          {isRise ? (
            <Link className="hub-my-team-btn" to={`/l/${leagueId}/rise`}><strong>Origins</strong><span>Class &amp; builds</span></Link>
          ) : (
            <button type="button" className="hub-my-team-btn" onClick={() => selectSection("trades")}><strong>Trade Center</strong><span>Propose &amp; review</span></button>
          )}
          <button type="button" className="hub-my-team-btn" onClick={() => selectSection("roster")}><strong>Roster</strong><span>Manage players</span></button>
          <Link className="hub-my-team-btn" to={`/l/${leagueId}/stats`}><strong>League Stats</strong><span>By category &amp; leaders</span></Link>
          <button type="button" className="hub-my-team-btn" onClick={() => setCareerStatsModalOpen(true)}><strong>Career Stats</strong><span>League career</span></button>
        </div>
      </div>
      <div className="hub-my-team-card">
        <p className="hub-eyebrow">League</p>
        <div className="hub-my-team-card-buttons">
          <button type="button" className="hub-my-team-btn" onClick={() => setPowerRankingsModalOpen(true)}><strong>Power Rankings</strong><span>Full league</span></button>
          <Link className="hub-my-team-btn" to={`/l/${leagueId}/records`}><strong>League Records</strong><span>Statistical bests</span></Link>
          <Link className="hub-my-team-btn" to={`/l/${leagueId}/history`}><strong>League History</strong><span>Past seasons</span></Link>
        </div>
      </div>
      <div className="hub-my-team-card">
        <p className="hub-eyebrow">Finance</p>
        <div className="hub-my-team-card-buttons">
          {isRise ? (
            riseHubUnlocked ? <Link className="hub-my-team-btn" to={`/l/${leagueId}/team/upgrades`}><strong>Player XP</strong><span>Attribute upgrades</span></Link> : null
          ) : (
            <button type="button" className="hub-my-team-btn" onClick={() => selectSection("store")}><strong>Store</strong><span>Franchise marketplace</span></button>
          )}
          <button type="button" className="hub-my-team-btn" onClick={() => setBankModalOpen(true)}><strong>Bank</strong><span>Wallet &amp; transfers</span></button>
          {isRise ? null : (
            <button type="button" className="hub-my-team-btn" onClick={onOpenWagers}><strong>Wagers</strong><span>Sportsbook</span></button>
          )}
          <button type="button" className="hub-my-team-btn" onClick={() => setFinancialModalOpen(true)}><strong>Financial Profile</strong><span>Earnings &amp; ledger</span></button>
        </div>
      </div>
    </div>
  </>;
}

function DefenseNicknamePrompt() {
  const { guildId, discordId } = useReadyAuth();
  const [status, setStatus] = useState<{ teamId: string; nickname: string | null; needsName: boolean } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi.getDefenseNicknameStatus({ guildId, discordId }).then(setStatus).catch(() => setStatus(null));
  }, [guildId, discordId]);

  if (!status?.needsName) return null;

  async function save() {
    if (!status || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.setDefenseNickname({ guildId, discordId, teamId: status.teamId, nickname: value.trim() });
      setStatus({ ...status, nickname: result.nickname, needsName: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save nickname.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="hub-defense-nickname-prompt">
    <p><strong>Your defense earned "This Defense Needs a Name"!</strong> Give it a nickname — it'll show up in headlines about your defense until it stops qualifying.</p>
    <div className="hub-defense-nickname-form">
      <input className="form-input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. The Iron Curtain" maxLength={60} />
      <Button variant="secondary" disabled={busy} onClick={() => setValue(randomDefenseName(value))} title="Can't think of one? Roll the dice.">🎲 Randomize</Button>
      <Button variant="primary" disabled={busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Name It"}</Button>
    </div>
    {error && <p className="hub-schedule-missing">{error}</p>}
  </div>;
}

const EOS_PAYOUT_DESCRIPTIONS: Record<string, string> = {
  power_ranking_position: "Your global power ranking position. Pays a set amount per exact rank, independent of the tier ladder shown here.",
  team_ppg: "Team average points scored per game this season.",
  opp_ppg_allowed: "Opponent average points allowed per game — lower is better.",
  team_def_ints: "Team defensive interceptions per game.",
  team_def_yards_allowed: "Total yards allowed per game — lower is better.",
  turnover_diff: "Turnovers forced minus turnovers committed, per game.",
  team_total_offense: "Total offensive yards gained per game.",
  off_red_zone_td_rate: "Percent of red-zone trips that end in a touchdown.",
  def_red_zone_td_rate: "Percent of opponent red-zone trips that end in a touchdown allowed — lower is better.",
  time_of_possession: "Average time of possession per game.",
  well_disciplined: "Penalties committed per game — lower is better.",
  red_zone_finish_rate: "Percent of red-zone trips that end in a score (touchdown or field goal).",
  rb_workhorse: "Composite of rush attempts, yards per carry, and rushing TDs per game — rewards genuine bell-cow usage, not one big game.",
  madden_rb_workhorse: "Pays 1,000 coins per user-team rusher with 150+ carries, 1,000+ rush yards, 50+ broken tackles, 250+ yards after contact, and 10+ rush TDs. Import leagues only — box scores do not store those player fields.",
  king_of_the_swing: "Pays 500 coins per user-team kicker with at least two 50+ yard field-goal attempts, all made. Import leagues only.",
  defense_needs_a_name: "Composite of red-zone defense, takeaways forced, and 3rd/4th-down stop rates — an elite, identity-worthy defense.",
};

const TIER_OPERATOR_SYMBOL: Record<string, string> = {
  greater_or_equal: "≥",
  less_than: "<",
  less_or_equal: "≤",
};

function formatTierThreshold(key: string, threshold: number): string {
  if (key === "time_of_possession") {
    const minutes = Math.floor(threshold / 60);
    const seconds = Math.round(threshold % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return Number.isInteger(threshold) ? String(threshold) : threshold.toFixed(1);
}

function EosPayoutProgressPanel() {
  const { guildId, discordId } = useReadyAuth();
  const [progress, setProgress] = useState<MyEosPayoutProgress | null>(null);

  useEffect(() => {
    recApi.getMyEosPayoutProgress({ guildId, discordId }).then(setProgress).catch(() => setProgress(null));
  }, [guildId, discordId]);

  const cards = [...(progress?.ranking ? [progress.ranking] : []), ...(progress?.teamStats ?? [])];
  if (!progress || !cards.length) return <p className="hub-muted">No EOS payout categories are tracked for this league yet.</p>;

  return <div className="hub-eos-progress-grid">
    {cards.map((card) => {
      const tierLabel = card.progress.currentTier ? `Tier ${card.progress.currentTier} · ${coinsNumber(card.progress.currentAmount)}` : "No tier yet";
      const nextLabel = card.progress.nextTier ? `Next: Tier ${card.progress.nextTier.tier} (${coinsNumber(card.progress.nextTier.amount)})` : "Top tier reached";
      return <article key={card.key} className="hub-eos-progress-card" tabIndex={0}>
        <div className="hub-eos-progress-card-head">
          <strong>{card.label}</strong>
          <span>{"rank" in card && card.rank != null ? `Rank ${card.rank}` : card.currentValue}</span>
        </div>
        <div className="hub-eos-progress-bar"><div className="hub-eos-progress-bar-fill" style={{ width: `${card.progress.percent}%` }} /></div>
        <div className="hub-eos-progress-card-foot"><span>{tierLabel}</span><span>{nextLabel}</span></div>
        <div className="hub-eos-progress-tooltip">
          <p className="hub-eos-progress-tooltip-desc">{EOS_PAYOUT_DESCRIPTIONS[card.key] ?? "EOS payout category."}</p>
          <div className="hub-eos-progress-tiers">
            <table>
              <thead><tr><th>Tier</th><th>Threshold</th><th>Payout</th></tr></thead>
              <tbody>
                {card.tiers.map((tier) => (
                  <tr key={tier.tier} className={tier.tier === card.progress.currentTier ? "hub-eos-progress-tier-active" : undefined}>
                    <td>{tier.tier}</td>
                    <td>{TIER_OPERATOR_SYMBOL[tier.operator] ?? ""}{formatTierThreshold(card.key, tier.threshold)}</td>
                    <td>{coinsNumber(tier.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {card.triggerNote && <p className="hub-eos-progress-note">{card.triggerNote}</p>}
        </div>
      </article>;
    })}
  </div>;
}

export function FinancialLedger({ summary }: { summary: any }) {
  const last30 = summary?.last30Days;
  const league = summary?.league;
  const wagering = summary?.wagering;
  return <div className="hub-financial-ledger">
    {league && <div className="hub-profile-stat-list">
      <div><span>Total Earned</span><strong><CoinAmount amount={Number(league.totalEarned ?? 0)} /></strong></div>
      <div><span>Total Spent</span><strong><CoinAmount amount={Number(league.totalSpent ?? 0)} /></strong></div>
      <div><span>Profit / Deficit</span><strong><CoinAmount amount={Number(league.profitDeficit ?? 0)} signed /></strong></div>
    </div>}
    {wagering && <><h4>Lifetime Wagering</h4><div className="hub-profile-stat-list">
      <div><span>Coins Wagered</span><strong><CoinAmount amount={Number(wagering.lifetimeWagered ?? 0)} /></strong></div>
      <div><span>Gross Won</span><strong><CoinAmount amount={Number(wagering.grossWon ?? 0)} /></strong></div>
      <div><span>Lost Stakes</span><strong><CoinAmount amount={Number(wagering.lostStakes ?? 0)} /></strong></div>
      <div><span>Net</span><strong><CoinAmount amount={Number(wagering.net ?? 0)} signed /></strong></div>
      <div><span>Record / Win Rate</span><strong>{wagering.wins ?? 0}-{wagering.losses ?? 0} · {Number(wagering.winPercentage ?? 0).toFixed(1)}%</strong></div>
      <div><span>Average / Largest Stake</span><strong><CoinAmount amount={Number(wagering.averageStake ?? 0)} /> / <CoinAmount amount={Number(wagering.largestStake ?? 0)} /></strong></div>
      <div><span>Largest Win</span><strong><CoinAmount amount={Number(wagering.largestWin ?? 0)} /></strong></div>
      <div><span>House / Peer Wagers</span><strong>{wagering.houseWagers ?? 0} / {wagering.peerWagers ?? 0}</strong></div>
    </div></>}
    <h4>Last 30 Days</h4>
    {!last30 ? <p className="hub-empty">No recent activity.</p> : <>
      <div className="hub-profile-stat-list hub-ledger-summary">
        <div><span>Income</span><strong className="hub-ledger-positive"><CoinAmount amount={Number(last30.totalIncome ?? 0)} signed /></strong></div>
        <div><span>Expenses</span><strong className="hub-ledger-negative"><CoinAmount amount={-Number(last30.totalExpenses ?? 0)} signed /></strong></div>
        <div><span>Net Cash Flow</span><strong className={Number(last30.netCashFlow ?? 0) >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}><CoinAmount amount={Number(last30.netCashFlow ?? 0)} signed /></strong></div>
      </div>
      {!last30.transactions?.length ? <p className="hub-empty">No transactions in the last 30 days.</p> : <div className="hub-ledger-list">
        {last30.transactions.map((tx: any) => <div key={tx.id} className="hub-ledger-row">
          <div><strong>{tx.description ?? displayLabel(tx.transactionType ?? "transaction")}</strong><span className="hub-muted">{new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
          <strong className={tx.amount >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}><CoinAmount amount={tx.amount} signed /></strong>
        </div>)}
      </div>}
    </>}
  </div>;
}

function ScheduleWeekList({
  weeks,
  game,
  currentWeek,
  highlightCounts,
  onUploadBoxScore,
  onUploadHighlight,
}: {
  weeks: TeamScheduleManualState["weeks"];
  game?: LeagueGame;
  currentWeek?: number;
  highlightCounts?: Record<number, number>;
  onUploadBoxScore?: (week: TeamScheduleManualState["weeks"][number]) => void;
  onUploadHighlight?: (week: TeamScheduleManualState["weeks"][number]) => void;
}) {
  return <div className="hub-schedule-week-list">
    {weeks.map((week) => {
      const eligibleForActions =
        week.alreadyConfirmed && !week.isBye && Boolean(week.gameId) &&
        (currentWeek == null || week.weekNumber <= currentWeek);
      const highlightCount = highlightCounts?.[week.weekNumber] ?? 0;
      const missingBoxScore = eligibleForActions && !week.boxScoreSubmissionId;
      const missingHighlight = eligibleForActions && highlightCount < 2;
      const isPostseasonUndetermined = !week.alreadyConfirmed && !week.isBye && Boolean(game) && week.weekNumber > regularSeasonWeeks(game!);
      return <article key={week.weekNumber} className={`hub-schedule-week ${week.alreadyConfirmed ? (week.confirmedMatchupType ?? "cpu") : week.isBye ? "bye" : isPostseasonUndetermined ? "postseason-tbd" : "missing"}${week.matchupCard ? " has-card" : ""}`}>
      {week.matchupCard ? (
        <div className="hub-schedule-mini-card hub-schedule-week-info">
          <span className="hub-schedule-week-label">Week {week.weekNumber}</span>
          <MatchupCard game={week.matchupCard} showReactions={false} passive />
        </div>
      ) : (
      <div className="hub-schedule-week-info">
        <span className="hub-schedule-week-label">Week {week.weekNumber}</span>
        {week.isBye ? <strong>Bye Week</strong>
          : game && week.weekNumber > regularSeasonWeeks(game) ? <strong className="hub-schedule-postseason-tbd">Postseason — Not Yet Determined</strong>
          : <strong className="hub-schedule-missing">Missing Matchup</strong>}
      </div>
      )}
      <div className="hub-schedule-week-aside">
        {onUploadHighlight ? <span className="hub-schedule-highlight-chip">Highlights {highlightCount}/2</span> : null}
        {(onUploadBoxScore && missingBoxScore) || (onUploadHighlight && missingHighlight) ? (
          <div className="hub-schedule-week-actions">
            {onUploadBoxScore && missingBoxScore && (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => onUploadBoxScore(week)}>Box Score</button>
            )}
            {onUploadHighlight && missingHighlight && (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => onUploadHighlight(week)}>
                Upload
              </button>
            )}
          </div>
        ) : null}
      </div>
    </article>;
    })}
  </div>;
}
export function HubHome() {
  const auth = useAuth();
  const hubChrome = useHubChrome();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [economyValues, setEconomyValues] = useState<RecGlobalEconomyConfig>(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG);
  const storeProductPriceLabels = useMemo<Partial<Record<RecPurchaseType, string>>>(() => ({
    age_reset: coinsNumber(economyValues.store.ageReset),
    dev_upgrade: `${coinsNumber(economyValues.store.devUpgradeStep)}-${coinsNumber(economyValues.store.devUpgradeTopStep)}`,
    contract: coinsNumber(economyValues.store.contractReduction),
    attribute: `${coinsNumber(economyValues.store.nonCoreAttributePoint)}-${coinsNumber(economyValues.store.coreAttributePoint)}/pt`,
    legend: `${coinsNumber(economyValues.store.legend)}-${coinsNumber(economyValues.store.immortal)}`,
    custom_player: `${coinsNumber(economyValues.store.customPlayerTier1)}-${coinsNumber(economyValues.store.customPlayerTier5)}`,
  }), [economyValues]);
  const [error, setError] = useState<string | null>(null);
  const [setupAccess, setSetupAccess] = useState<{ leagueExists: boolean; canSetup: boolean } | null>(null);
  const [section, setSection] = useState<HubSection>(() => parseHubSection(searchParams.get("section")) ?? "league");
  const [subTab, setSubTab] = useState<LeagueSubTab>(() => parseLeagueSubTab(searchParams.get("subTab")) ?? "buzz");
  const [matchupWeek, setMatchupWeek] = useState<number | null>(null);
  const [matchupSchedule, setMatchupSchedule] = useState<HubMatchupSchedule | null>(null);
  const [matchupScheduleLoading, setMatchupScheduleLoading] = useState(false);
  const [matchupScheduleError, setMatchupScheduleError] = useState<string | null>(null);
  const [matchupReloadKey, setMatchupReloadKey] = useState(0);
  const [matchupView, setMatchupView] = useState<MatchupView>(() =>
    searchParams.get("subTab") === "rankings" || searchParams.get("matchupView") === "rankings"
      ? "rankings"
      : "h2h",
  );
  const [rankByConference, setRankByConference] = useState(false);
  const gotwGames = useMemo(() => (matchupSchedule?.games ?? []).filter((game) => Boolean(game.gotw)), [matchupSchedule]);
  const isCfbLeague = hub?.league.game === "cfb_27";
  const powerRankingsByConference = useMemo(() => {
    const teams = hub?.powerRankings?.teams ?? [];
    const groups = new Map<string, typeof teams>();
    for (const team of teams) {
      const key = team.conference ?? "Independents";
      const list = groups.get(key) ?? [];
      list.push(team);
      groups.set(key, list);
    }
    const conferenceSortKey = (conference: string) => {
      const idx = (CONFERENCE_ORDER as readonly string[]).indexOf(conference);
      return idx === -1 ? CONFERENCE_ORDER.length : idx;
    };
    return [...groups.entries()].sort(([a], [b]) => conferenceSortKey(a) - conferenceSortKey(b) || a.localeCompare(b));
  }, [hub?.powerRankings]);
  const [wagerPanel, setWagerPanel] = useState<WagerPanel | null>(null);
  const [wagersBoard, setWagersBoard] = useState<PeerWagerBoardResponse["wagers"] | null>(null);
  const [weekWagerLines] = useState<WeekWagerLinesResponse["lines"] | null>(null);
  const [myWagers, setMyWagers] = useState<MyWagersResponse["wagers"] | null>(null);
  const [wagersBoardBusy, setWagersBoardBusy] = useState(false);
  const [wagersBoardNotice, setWagersBoardNotice] = useState<string | null>(null);
  const [wagerBoardIndex, setWagerBoardIndex] = useState(0);
  const [announcementWeekIndex, setAnnouncementWeekIndex] = useState(0);
  const [heroPreview, setHeroPreview] = useState<MatchupPreviewData | null>(null);
  const [heroBreakdownExpanded, setHeroBreakdownExpanded] = useState(false);
  const [manageFundsOpen, setManageFundsOpen] = useState(false);
  const [announcementItemIndex, setAnnouncementItemIndex] = useState(0);
  const [conferenceIndex, setConferenceIndex] = useState(0);
  const [mediaPortal, setMediaPortal] = useState<MediaPortalResponse | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [mediaModal, setMediaModal] = useState<"article" | "interview" | null>(null);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaArticle, setMediaArticle] = useState({ title: "", body: "", imageUrl: "" });
  const mediaArticleBodyRef = useRef<HTMLTextAreaElement>(null);
  const [boxScoreUploadGame, setBoxScoreUploadGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [playerStatsGame, setPlayerStatsGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [shareStreamGame, setShareStreamGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [highlightUploadGame, setHighlightUploadGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [requestHelpGame, setRequestHelpGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [myWatchedPlayers, setMyWatchedPlayers] = useState<WatchedPlayer[] | null>(null);
  const [playerStatsDraft, setPlayerStatsDraft] = useState({ playerName: "", watchedPlayerId: "", category: "passing", values: {} as Record<string, string> });
  const [playerStatsNotice, setPlayerStatsNotice] = useState<string | null>(null);
  const [playerStatsBusy, setPlayerStatsBusy] = useState(false);
  const [lateSubmissionsOpen, setLateSubmissionsOpen] = useState(false);
  const [retireModalOpen, setRetireModalOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [interviewAnswers, setInterviewAnswers] = useState([
    { questionId: "", answer: "" },
    { questionId: "", answer: "" },
    { questionId: "", answer: "" },
  ]);
  const [tagOpponent, setTagOpponent] = useState(false);
  const [showMySchedule, setShowMySchedule] = useState(false);
  const [mySchedule, setMySchedule] = useState<TeamScheduleManualState | null>(null);
  const [myScheduleError, setMyScheduleError] = useState<string | null>(null);
  const [myHighlightCounts, setMyHighlightCounts] = useState<Record<number, number> | null>(null);
  const [scheduleBoxScoreWeek, setScheduleBoxScoreWeek] = useState<TeamScheduleManualState["weeks"][number] | null>(null);
  const [scheduleHighlightWeek, setScheduleHighlightWeek] = useState<TeamScheduleManualState["weeks"][number] | null>(null);
  const [lateSubmissionsFocus, setLateSubmissionsFocus] = useState<"boxScore" | "highlight" | null>(null);
  const [lateSubmissionsWeek, setLateSubmissionsWeek] = useState<number | undefined>(undefined);
  const [recruitingBoardOpen, setRecruitingBoardOpen] = useState(false);
  const [editRosterOpen, setEditRosterOpen] = useState(false);
  const [assignStatsSubmissionId, setAssignStatsSubmissionId] = useState<string | null>(null);
  const [linkedTeams, setLinkedTeams] = useState<LinkedTeamRow[] | null>(null);
  const [teamScheduleTeamId, setTeamScheduleTeamId] = useState<string | null>(null);
  const [teamSchedule, setTeamSchedule] = useState<TeamScheduleManualState | null>(null);
  const [teamScheduleError, setTeamScheduleError] = useState<string | null>(null);
  const [scheduleModalTab, setScheduleModalTab] = useState<"my" | "league">("my");
  const [relocateWizardOpen, setRelocateWizardOpen] = useState(false);
  const [relocateNotice, setRelocateNotice] = useState<string | null>(null);
  const [scheduleLeagueWeek, setScheduleLeagueWeek] = useState<number | null>(null);
  const [scheduleLeagueData, setScheduleLeagueData] = useState<HubMatchupSchedule | null>(null);
  const [scheduleLeagueError, setScheduleLeagueError] = useState<string | null>(null);
  const [scheduleLeagueLoading, setScheduleLeagueLoading] = useState(false);
  const [powerRankingsModalOpen, setPowerRankingsModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [financialModalOpen, setFinancialModalOpen] = useState(false);
  const [financialsTab, setFinancialsTab] = useState<"ledger" | "transfer">("ledger");

  // Bridge for SiteHeader's league-row-3 dropdown items (apps/site/src/components/LeagueRow3.tsx)
  // -- SiteHeader renders outside HubHome's component tree (a sibling in SiteShell, not a
  // descendant), so a header dropdown item can't call one of HubHome's local modal setters
  // directly. It navigates to the current page with ?openModal=<key> instead; this effect reads
  // that once, opens the matching modal, and strips the param so a refresh/back doesn't reopen it.
  useEffect(() => {
    const requested = searchParams.get("openModal");
    if (!requested) return;
    if (requested === "interview" || (requested === "article" && hub?.league.rosterType !== "rise_to_immortality")) setMediaModal(requested);
    else if (requested === "schedule" && (hub?.league.rosterType !== "rise_to_immortality" || hub?.league.riseHubUnlocked === true)) void viewMySchedule();
    else if (requested === "financials") setFinancialModalOpen(true);
    else if (requested === "wager" && hub?.league.rosterType !== "rise_to_immortality") openSportsbook();
    else if (requested === "retire") { setRetireError(null); setRetireModalOpen(true); }
    const next = new URLSearchParams(searchParams);
    next.delete("openModal");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [careerStatsModalOpen, setCareerStatsModalOpen] = useState(false);
  const [gotwGuessing, setGotwGuessing] = useState<GotwGuessingRecordsResponse | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [potyHighlightId, setPotyHighlightId] = useState<string | null>(null);
  const [potyCategory, setPotyCategory] = useState<HubReactionKey | "">("");
  const [headlineWeekIndex, setHeadlineWeekIndex] = useState(0);
  const [headlineItemIndex, setHeadlineItemIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [comments, setComments] = useState<StoryComment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [deadHighlightIds, setDeadHighlightIds] = useState<string[]>([]);
  const [purchaseType, setPurchaseType] = useState("");
  const [purchaseDetails, setPurchaseDetails] = useState<Record<string, string>>({});
  const [devUpgradePlayer, setDevUpgradePlayer] = useState<RosterPlayer | null>(null);
  const [devUpgradeTargetTier, setDevUpgradeTargetTier] = useState<RecDevTier | "">("");
  const [ageResetPlayer, setAgeResetPlayer] = useState<RosterPlayer | null>(null);
  const [contractPlayer, setContractPlayer] = useState<RosterPlayer | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [storeContext, setStoreContext] = useState<StorePurchaseContext | null>(null);
  const [openTeams, setOpenTeams] = useState<OpenTeam[] | null>(null);
  const [openTeamsError, setOpenTeamsError] = useState<string | null>(null);
  const viewedHighlights = useRef(new Set<string>());

  const highlightCount = (hub?.highlights ?? []).filter((item) => !deadHighlightIds.includes(item.id)).length;
  const activeHighlightIndex = highlightCount ? highlightIndex % highlightCount : 0;
  const highlightSwipe = useSwipeNavigation({ itemCount: highlightCount, onIndexChange: setHighlightIndex });
  useEffect(() => { highlightSwipe.setCurrentIndex(activeHighlightIndex); }, [activeHighlightIndex]);
  useEffect(() => { setDeadHighlightIds([]); setHighlightIndex(0); }, [hub?.league?.id]);
  // Advance highlight reel only when Cloudflare reports the clip ended — no wall-clock fallback
  // (a 90s timer was cutting longer clips short).
  useEffect(() => {
    if (subTab !== "buzz" || highlightCount <= 1) return;
    function onMessage(event: MessageEvent) {
      const origin = String(event.origin ?? "");
      if (!origin.includes("videodelivery.net") && !origin.includes("cloudflarestream.com")) return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          if (data === "ended") setHighlightIndex((current) => (current + 1) % highlightCount);
          return;
        }
      }
      const payload = data as { name?: string; eventName?: string; type?: string; event?: string } | null;
      const name = payload?.name ?? payload?.eventName ?? payload?.type ?? payload?.event;
      if (name === "ended" || name === "complete") {
        setHighlightIndex((current) => (current + 1) % highlightCount);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [subTab, highlightCount]);

  useEffect(() => {
    const nextSection = parseHubSection(searchParams.get("section"));
    const rawSub = searchParams.get("subTab");
    const nextSubTab = parseLeagueSubTab(rawSub);
    if (nextSection) setSection(nextSection);
    if (nextSubTab) setSubTab(nextSubTab);
    if (rawSub === "rankings" || searchParams.get("matchupView") === "rankings") {
      setMatchupView("rankings");
    }
    if (nextSection === "team" || nextSection === "store" || nextSection === "roster" || nextSection === "openTeams" || nextSection === "schedules" || nextSection === "trades") {
      setSection(nextSection);
    } else if (nextSection === "league" || nextSubTab) {
      setSection("league");
    }
  }, [searchParams]);

  // Deep link from the /highlights or /boxscore Discord commands: ?openHighlights=1 or
  // ?openBoxScore=1 (optionally [&week=N]) opens the same late-submissions flow the in-app
  // "Upload Highlight(s)"/"Upload Box Score" buttons use, pre-selecting the week if one was
  // named (still subject to the modal's own eligibility check — a week that's since been filled
  // or aged out just falls back to the picker). Consumed once, then stripped from the URL so it
  // doesn't reopen on back-navigation or a refresh.
  useEffect(() => {
    const openHighlights = searchParams.get("openHighlights") === "1";
    const openBoxScore = searchParams.get("openBoxScore") === "1";
    if (!openHighlights && !openBoxScore) return;
    const weekParam = searchParams.get("week");
    const week = weekParam ? Number(weekParam) : undefined;
    setLateSubmissionsFocus(openHighlights ? "highlight" : "boxScore");
    setLateSubmissionsWeek(Number.isFinite(week) ? week : undefined);
    setLateSubmissionsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openHighlights");
    next.delete("openBoxScore");
    next.delete("week");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function writeHubParams(nextSection: HubSection, nextSubTab?: LeagueSubTab) {
    const params = new URLSearchParams();
    params.set("section", nextSection);
    if (nextSection === "league") {
      params.set("subTab", nextSubTab ?? "buzz");
    }
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    const count = matchupSchedule?.usersByConference.length ?? 0;
    if (subTab !== "matchups" || count < 2) return;
    const timer = window.setInterval(() => setConferenceIndex((current) => (current + 1) % count), 6000);
    return () => window.clearInterval(timer);
  }, [subTab, matchupSchedule?.usersByConference.length]);

  useEffect(() => {
    const count = wagersBoard?.length ?? 0;
    if (section !== "league" || subTab !== "buzz" || count < 2) return;
    const timer = window.setInterval(() => setWagerBoardIndex((current) => (current + 1) % count), 6000);
    return () => window.clearInterval(timer);
  }, [section, subTab, wagersBoard?.length]);

  // Announcements are grouped by week (newest week first) so the carousel only auto-rotates
  // within the current week's posts; the arrows page between weeks instead of flattening
  // the whole season into one long rotation.
  const announcementWeekGroups = useMemo(() => {
    const announcements = hub?.announcements ?? [];
    const byWeek = new Map<number | null, typeof announcements>();
    for (const item of announcements) {
      const key = item.week_number ?? null;
      const group = byWeek.get(key) ?? [];
      group.push(item);
      byWeek.set(key, group);
    }
    return [...byWeek.entries()]
      .sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
      .map(([weekNumber, items]) => ({ weekNumber, items }));
  }, [hub?.announcements]);

  useEffect(() => {
    if (!announcementWeekGroups.length) return;
    const currentWeek = hub?.league?.weekNumber;
    const matchIndex = announcementWeekGroups.findIndex((group) => group.weekNumber === currentWeek);
    setAnnouncementWeekIndex(matchIndex >= 0 ? matchIndex : 0);
    setAnnouncementItemIndex(0);
  }, [announcementWeekGroups, hub?.league?.weekNumber]);

  const activeAnnouncementGroup = announcementWeekGroups[announcementWeekIndex] ?? null;

  // Announcement carousel timer — rotates only within the current/most-recent week's
  // announcements (index 0); paging back to an older week freezes rotation entirely while
  // it's being browsed. A week with a single announcement stays static regardless.
  useEffect(() => {
    const count = activeAnnouncementGroup?.items.length ?? 0;
    if (section !== "league" || subTab !== "buzz" || announcementWeekIndex !== 0 || count < 2) return;
    const timer = window.setInterval(() => setAnnouncementItemIndex((current) => (current + 1) % count), 8000);
    return () => window.clearInterval(timer);
  }, [section, subTab, announcementWeekIndex, activeAnnouncementGroup?.items.length]);

  // Headlines are grouped by week (newest week first), mirroring the announcements
  // carousel: auto-rotation only runs for the current/most-recent week's headlines (fully
  // paused once the user pages back to browse an older week), and the arrows/swipe page
  // between weeks instead of flattening the whole season into one long rotation.
  const headlineWeekGroups = useMemo(() => {
    const stories = hub?.headlines ?? [];
    const byWeek = new Map<number | null, Array<{ story: (typeof stories)[number]; flatIndex: number }>>();
    stories.forEach((story, flatIndex) => {
      const key = story.week ?? null;
      const group = byWeek.get(key) ?? [];
      group.push({ story, flatIndex });
      byWeek.set(key, group);
    });
    // Sort by each group's most recent story rather than by week number — offseason stories
    // (week === null, e.g. EOS awards, recruiting/portal recaps) are otherwise stuck sorting
    // after every real week even when they're the newest thing published.
    return [...byWeek.entries()]
      .map(([week, items]) => ({
        week,
        items,
        latestCreatedAt: items.reduce((latest, item) => Math.max(latest, new Date(item.story.created_at).getTime()), 0),
      }))
      .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)
      .map(({ week, items }) => ({ week, items }));
  }, [hub?.headlines]);

  useEffect(() => {
    if (!headlineWeekGroups.length) return;
    const currentWeek = hub?.league?.weekNumber;
    const matchIndex = headlineWeekGroups.findIndex((group) => group.week === currentWeek);
    setHeadlineWeekIndex(matchIndex >= 0 ? matchIndex : 0);
    setHeadlineItemIndex(0);
  }, [headlineWeekGroups, hub?.league?.weekNumber]);

  const activeHeadlineGroup = headlineWeekGroups[headlineWeekIndex] ?? null;
  const headlineWeekCount = headlineWeekGroups.length;

  const mobileStorySwipe = useSwipeNavigation({
    itemCount: headlineWeekCount,
    onIndexChange: (index) => { setHeadlineWeekIndex(index); setHeadlineItemIndex(0); },
  });
  useEffect(() => { mobileStorySwipe.setCurrentIndex(headlineWeekIndex); }, [headlineWeekIndex]);

  useEffect(() => {
    const count = activeHeadlineGroup?.items.length ?? 0;
    if (subTab !== "buzz" || headlineWeekIndex !== 0 || count < 2 || mobileStorySwipe.isDragging) return;
    const timer = window.setInterval(() => {
      setHeadlineItemIndex((current) => (current + 1) % count);
    }, 24_000);
    return () => window.clearInterval(timer);
  }, [subTab, headlineWeekIndex, activeHeadlineGroup?.items.length, mobileStorySwipe.isDragging]);

  const heroCurrentGameId: string | null = (hub?.myTeam?.display as any)?.currentGameId
    ?? matchupSchedule?.games.find((game) => game.involvesMe)?.gameId
    ?? null;
  useEffect(() => {
    if (auth.status !== "ready" || !heroCurrentGameId) {
      setHeroPreview(null);
      return;
    }
    recApi.getMatchupPreview({ guildId: auth.guildId, gameId: heroCurrentGameId }).catch(() => null).then(setHeroPreview);
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, heroCurrentGameId, matchupReloadKey]);

  async function load() {
    if (auth.status !== "ready") return;
    const guildId = auth.guildId;
    try {
      const hubP = recApi.getHub(guildId);
      const economyP = recApi.getGlobalEconomyValues().catch(() => DEFAULT_REC_GLOBAL_ECONOMY_CONFIG);
      const guessingP = recApi.getGotwGuessingRecords(guildId).catch(() => null);
      const hubResult = await hubP;
      setHub(hubResult);
      setError(null);
      setSetupAccess(null);
      const [economy, guessing] = await Promise.all([economyP, guessingP]);
      setEconomyValues(economy);
      setGotwGuessing(guessing);
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A 404 here means no league is linked to this Discord server yet — not a real
      // error. Check whether this viewer can run First-Time Setup instead of showing
      // a dead-end error screen.
      if (message.includes("404")) {
        try { setSetupAccess(await recApi.getHubBootstrapStatus(guildId)); }
        catch { setSetupAccess({ leagueExists: false, canSetup: false }); }
        setError(null);
      } else {
        setError(message);
      }
    }
  }
  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);
  useEffect(() => {
    if (section === "store") void loadStoreContext(true);
  }, [section, auth.status, auth.status === "ready" ? auth.guildId : null]);

  useEffect(() => {
    if (auth.status !== "ready" || section !== "league") return;
    setMatchupScheduleLoading(true);
    setMatchupScheduleError(null);
    recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupWeek })
      .then((schedule) => {
        setMatchupSchedule(schedule);
        setMatchupScheduleError(null);
      })
      .catch((cause) => {
        setMatchupSchedule(null);
        setMatchupScheduleError(cause instanceof Error ? cause.message : "Failed to load matchups.");
      })
      .finally(() => setMatchupScheduleLoading(false));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, subTab, section, matchupWeek, matchupReloadKey]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    // Buzz shows the wager board too — keep it loaded for both surfaces.
    if (!(section === "league" && subTab === "buzz")) return;
    const guildId = auth.guildId;
    const refresh = () => {
      recApi.getPeerWagerBoard(guildId).then((result) => setWagersBoard(result.wagers)).catch(() => undefined);
    };
    refresh();
    // A counterparty accepting/declining a wager is a change made by someone else's
    // session — poll while this surface is visible so it doesn't require a hard reload
    // to reflect that (there's no realtime channel for wagers yet).
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, section, subTab]);

  useEffect(() => {
    if (auth.status !== "ready" || !(section === "team" || section === "league") || mediaPortal) return;
    recApi.getHubMediaPortal(auth.guildId).then(setMediaPortal).catch(() => setMediaPortal(null));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, section, mediaPortal]);

  // Comments load once per story open — keyed on the index, not on `hub`, so an optimistic
  // reaction/comment update elsewhere doesn't re-trigger a comment refetch.
  useEffect(() => {
    if (activeStoryIndex == null || auth.status !== "ready" || !hub) return;
    const story = (hub.headlines ?? [])[activeStoryIndex];
    if (!story) return;
    setComments(null);
    recApi.listHubStoryComments({ guildId: auth.guildId, storyId: story.id }).then((result) => setComments(result.comments));
  }, [activeStoryIndex]);

  async function highlightReact(highlightId: string, reactionKey: HubReactionKey) {
    if (auth.status !== "ready") return;
    const mutuallyExclusive = COMMUNITY_REACTION_KEYS.includes(reactionKey) ? COMMUNITY_REACTION_KEYS : AWARD_KEYS;
    setHub((current) => current ? { ...current, highlights: (current.highlights ?? []).map((highlight) => {
      if (highlight.id !== highlightId) return highlight;
      const has = (highlight.myReactions ?? []).includes(reactionKey);
      const counts = { ...highlight.reactionCounts };
      let nextReactions = highlight.myReactions;
      if (has) {
        counts[reactionKey] = Math.max(0, counts[reactionKey] - 1);
        nextReactions = (highlight.myReactions ?? []).filter((key) => key !== reactionKey);
      } else {
        for (const key of mutuallyExclusive) if (key !== reactionKey && (highlight.myReactions ?? []).includes(key as HubReactionKey)) counts[key as HubReactionKey] = Math.max(0, counts[key as HubReactionKey] - 1);
        counts[reactionKey] = (counts[reactionKey] ?? 0) + 1;
        nextReactions = [...(highlight.myReactions ?? []).filter((key) => !mutuallyExclusive.includes(key)), reactionKey];
      }
      return { ...highlight, myReactions: nextReactions, reactionCounts: counts };
    }) } : current);
    try { await recApi.toggleHubHighlightReaction({ guildId: auth.guildId, highlightId, reactionKey }); }
    catch { await load(); }
  }
  async function storyReact(storyId: string, reactionKey: "like" | "dislike") {
    if (auth.status !== "ready") return;
    setHub((current) => current ? { ...current, headlines: (current.headlines ?? []).map((story) => {
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
  async function matchupGameReact(gameId: string, reactionKey: "love" | "like" | "goty" | "dislike" | "poop") {
    if (auth.status !== "ready") return;
    setMatchupSchedule((current) => current ? { ...current, games: current.games.map((game) => {
      if (game.gameId !== gameId) return game;
      const counts = { ...game.reactionCounts };
      const isSame = (game.myReactions ?? []).includes(reactionKey);
      if (isSame) {
        counts[reactionKey] = Math.max(0, counts[reactionKey] - 1);
        return { ...game, myReactions: (game.myReactions ?? []).filter((key) => key !== reactionKey), reactionCounts: counts };
      }
      let nextReactions = [...(game.myReactions ?? [])];
      if (reactionKey !== "goty") {
        for (const key of ["love", "like", "dislike", "poop"] as const) {
          if (nextReactions.includes(key)) counts[key] = Math.max(0, counts[key] - 1);
        }
        nextReactions = nextReactions.filter((key) => key === "goty");
      }
      counts[reactionKey] = (counts[reactionKey] ?? 0) + 1;
      return { ...game, myReactions: [...nextReactions, reactionKey], reactionCounts: counts };
    }) } : current);
    try { await recApi.toggleHubGameReaction({ guildId: auth.guildId, gameId, reactionKey }); }
    catch { if (matchupSchedule) setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupSchedule.selectedWeek })); }
  }
  async function recordView(highlightId: string) {
    if (auth.status !== "ready" || viewedHighlights.current.has(highlightId)) return;
    viewedHighlights.current.add(highlightId);
    try {
      const result = await recApi.recordHubHighlightView({ guildId: auth.guildId, highlightId });
      setHub((current) => current ? { ...current, highlights: (current.highlights ?? []).map((highlight) => highlight.id === highlightId ? { ...highlight, viewCount: result.viewCount } : highlight) } : current);
    } catch { viewedHighlights.current.delete(highlightId); }
  }

  async function recordStreamClick(streamLogId: string) {
    if (auth.status !== "ready") return;
    try {
      const result = await recApi.recordHubStreamView({ guildId: auth.guildId, streamLogId });
      setHub((current) => current ? {
        ...current,
        liveStreams: current.liveStreams.map((stream) => stream.id === streamLogId ? { ...stream, viewCount: result.viewCount } : stream),
      } : current);
      setMatchupSchedule((current) => current ? {
        ...current,
        games: current.games.map((game) => ({
          ...game,
          streams: game.streams.map((stream) => stream.streamLogId === streamLogId ? { ...stream, viewCount: result.viewCount } : stream),
        })),
      } : current);
    } catch {}
  }

  function openStory(index: number) { setActiveStoryIndex(index); }
  function closeStory() { setActiveStoryIndex(null); setComments(null); }
  function retryMatchups() {
    setMatchupSchedule(null);
    setMatchupScheduleError(null);
    setMatchupReloadKey((key) => key + 1);
  }
  function renderMatchupLoadState(label: string) {
    if (matchupScheduleError) {
      return <div className="hub-empty"><p>{matchupScheduleError}</p><Button variant="secondary" size="compact" onClick={retryMatchups}>Try again</Button></div>;
    }
    if (matchupScheduleLoading || !matchupSchedule) return <p className="hub-empty">{label}</p>;
    return null;
  }
  async function submitComment() {
    if (auth.status !== "ready" || activeStoryIndex == null || !hub) return;
    const story = (hub.headlines ?? [])[activeStoryIndex];
    const body = commentBody.trim();
    if (!story || !body) return;
    const tempId = `temp-${Date.now()}`;
    setComments((current) => [...(current ?? []), { id: tempId, body, authorName: "You", created_at: new Date().toISOString() }]);
    setCommentBody("");
    try {
      const result = await recApi.addHubStoryComment({ guildId: auth.guildId, storyId: story.id, body });
      setComments(result.comments);
      setHub((current) => current ? { ...current, headlines: (current.headlines ?? []).map((item) => item.id === story.id ? { ...item, commentCount: item.commentCount + 1 } : item) } : current);
    } catch {
      setComments((current) => (current ?? []).filter((comment) => comment.id !== tempId));
      setCommentBody(body);
    }
  }
  async function loadStoreContext(force = false) {
    if (auth.status !== "ready") return;
    if (storeContext && !force) return;
    try { setStoreContext(await recApi.getStorePurchaseContext(auth.guildId)); } catch { /* preview only — submit still works without it */ }
  }
  async function viewOpenTeams() {
    if (auth.status !== "ready") return;
    selectSection("openTeams");
    setOpenTeamsError(null);
    if (openTeams) return;
    try { setOpenTeams((await recApi.listOpenTeams(auth.guildId)).openTeams); }
    catch (cause) { setOpenTeamsError(cause instanceof Error ? cause.message : "Open teams could not be loaded."); }
  }
  async function viewMySchedule() {
    if (auth.status !== "ready") return;
    setShowMySchedule(true); setMyScheduleError(null);
    if (mySchedule) return;
    try {
      const [schedule, highlightCounts] = await Promise.all([
        recApi.getMyTeamSchedule(auth.guildId),
        recApi.getMyHighlightWeekCounts(auth.guildId).catch(() => ({ counts: {} })),
      ]);
      setMySchedule(schedule);
      setMyHighlightCounts(highlightCounts.counts);
    } catch (cause) {
      setMyScheduleError(cause instanceof Error ? cause.message : "Your schedule could not be loaded.");
    }
  }

  async function loadScheduleLeagueWeek(weekNumber?: number) {
    if (auth.status !== "ready") return;
    setScheduleLeagueLoading(true); setScheduleLeagueError(null);
    try {
      const schedule = await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber });
      setScheduleLeagueData(schedule);
      setScheduleLeagueWeek(schedule.selectedWeek);
    } catch (cause) {
      setScheduleLeagueError(cause instanceof Error ? cause.message : "The league schedule could not be loaded.");
    } finally {
      setScheduleLeagueLoading(false);
    }
  }

  function selectSection(next: HubSection) {
    setSection(next);
    writeHubParams(next, next === "league" ? subTab : undefined);
  }

  async function openTeamSchedulePicker() {
    if (auth.status !== "ready") return;
    setSection("schedules");
    writeHubParams("schedules");
    setTeamScheduleTeamId(null); setTeamSchedule(null); setTeamScheduleError(null);
    if (linkedTeams) return;
    try { setLinkedTeams((await recApi.listLinkedUsersTeams(auth.guildId)).linked); }
    catch { setLinkedTeams([]); }
  }

  async function loadTeamSchedule(teamId: string) {
    if (auth.status !== "ready") return;
    setTeamScheduleTeamId(teamId); setTeamSchedule(null); setTeamScheduleError(null);
    try { setTeamSchedule(await recApi.getTeamSchedule({ guildId: auth.guildId, teamId })); }
    catch (cause) { setTeamScheduleError(cause instanceof Error ? cause.message : "Schedule could not be loaded."); }
  }
  async function submitPurchase(overrideDetails?: Record<string, unknown>): Promise<boolean> {
    if (auth.status !== "ready" || !purchaseType) return false;
    setPurchaseBusy(true); setPurchaseStatus(null); setPurchaseError(null);
    try {
      const details: Record<string, unknown> = overrideDetails ?? { ...purchaseDetails };
      await recApi.createMyPurchase({ guildId: auth.guildId, purchaseType, details, idempotencyKey: crypto.randomUUID() });
      setPurchaseStatus("Purchase submitted. Funds were reserved and a commissioner has been notified for approval.");
      setPurchaseDetails({}); setStoreContext(null); await load();
      void loadStoreContext(true);
      return true;
    } catch (cause) { setPurchaseError(cause instanceof Error ? cause.message : "Purchase failed."); return false; }
    finally { setPurchaseBusy(false); }
  }

  async function uploadMediaImage(file: File | null) {
    if (auth.status !== "ready" || !file) return;
    setMediaBusy(true); setMediaNotice(null);
    try {
      const result = await recApi.uploadHubMediaImage(auth.guildId, file);
      setMediaArticle((current) => ({ ...current, imageUrl: result.url }));
      setMediaNotice("Image uploaded.");
    } catch (cause) { setMediaNotice(cause instanceof Error ? cause.message : "Image upload failed."); }
    finally { setMediaBusy(false); }
  }

  async function submitMediaArticle() {
    if (auth.status !== "ready") return;
    setMediaBusy(true); setMediaNotice(null);
    try {
      await recApi.submitHubMediaArticle({ guildId: auth.guildId, ...mediaArticle });
      setMediaArticle({ title: "", body: "", imageUrl: "" });
      setMediaPortal(null);
      setMediaNotice("Article submitted for commissioner review.");
    } catch (cause) { setMediaNotice(cause instanceof Error ? cause.message : "Article submission failed."); }
    finally { setMediaBusy(false); }
  }

  async function submitInterviewForm() {
    if (auth.status !== "ready" || !mediaPortal) return;
    const questionMap = new Map(mediaPortal.questions.map((question) => [question.id, question]));
    const answers = interviewAnswers.map((answer) => ({ questionId: answer.questionId, question: questionMap.get(answer.questionId)?.question ?? "", answer: answer.answer.trim() }));
    setMediaBusy(true); setMediaNotice(null);
    try {
      await recApi.submitHubInterview({ guildId: auth.guildId, tagOpponent, answers });
      setInterviewAnswers([{ questionId: "", answer: "" }, { questionId: "", answer: "" }, { questionId: "", answer: "" }]);
      setTagOpponent(false);
      setMediaPortal(null);
      setMediaNotice("Interview submitted for commissioner review.");
    } catch (cause) { setMediaNotice(cause instanceof Error ? cause.message : "Interview submission failed."); }
    finally { setMediaBusy(false); }
  }

  async function openPlayerStats(game: HubMatchupSchedule["games"][number]) {
    if (auth.status !== "ready") return;
    setPlayerStatsGame(game);
    setPlayerStatsNotice(null);
    setPlayerStatsDraft({ playerName: "", watchedPlayerId: "", category: "passing", values: {} });
    setMyWatchedPlayers(null);
    try { setMyWatchedPlayers((await recApi.listMyWatchedPlayers({ guildId: auth.guildId })).players); }
    catch (cause) { setPlayerStatsNotice(cause instanceof Error ? cause.message : "Could not load your players to watch."); setMyWatchedPlayers([]); }
  }

  async function submitPlayerStats() {
    if (auth.status !== "ready" || !playerStatsGame) return;
    const selectedPlayer = myWatchedPlayers?.find((player) => player.id === playerStatsDraft.watchedPlayerId);
    const playerName = selectedPlayer?.playerName ?? playerStatsDraft.playerName.trim();
    const statLines = (PLAYER_STAT_FIELDS[playerStatsDraft.category] ?? []).flatMap(([statKey, label]) => {
      const raw = playerStatsDraft.values[statKey]?.trim();
      if (!raw) return [];
      const value = Number(raw);
      return Number.isFinite(value) ? [{ statKey, label, value }] : [];
    });
    if (!playerName || !statLines.length) { setPlayerStatsNotice("Pick or enter a player and add at least one stat."); return; }
    setPlayerStatsBusy(true); setPlayerStatsNotice(null);
    try {
      await recApi.submitPlayerStatLine({ guildId: auth.guildId, playerName, category: playerStatsDraft.category, statLines });
      setPlayerStatsNotice("Player stats submitted.");
      setPlayerStatsDraft({ playerName: "", watchedPlayerId: "", category: playerStatsDraft.category, values: {} });
    } catch (cause) { setPlayerStatsNotice(cause instanceof Error ? cause.message : "Player stats submission failed."); }
    finally { setPlayerStatsBusy(false); }
  }

  async function voteGotw(pollId: string, selectedTeamId: string) {
    if (auth.status !== "ready" || !matchupSchedule) return;
    await recApi.voteGameOfWeek({ guildId: auth.guildId, pollId, selectedTeamId });
    setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupSchedule.selectedWeek }));
  }

  async function openWager(game: HubMatchupSchedule["games"][number], tab: WagerPanel["tab"] = "slip") {
    if (auth.status !== "ready") return;
    const label = `${game.awayTeamName} at ${game.homeTeamName}`;
    setWagerPanel({ game, gameId: game.gameId, label, options: null, mode: "single", tab, market: "", pick: "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: [], board: [], notice: null, busy: true });
    try {
      const [options, board, coaches] = await Promise.all([
        recApi.getWagerOptions({ guildId: auth.guildId, gameId: game.gameId }),
        recApi.getPeerWagerBoard(auth.guildId),
        recApi.listChallengeableCoaches(auth.guildId),
      ]);
      const firstMarket = options.markets[0];
      setWagerPanel({ game, gameId: game.gameId, label, options, mode: "single", tab, market: firstMarket?.market ?? "", pick: firstMarket?.sides[0]?.pick ?? "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: coaches.coaches, board: board.wagers, notice: null, busy: false });
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, notice: cause instanceof Error ? cause.message : "Lines unavailable.", busy: false } : current);
    }
  }

  function openSportsbook(tab: WagerPanel["tab"] = "slip") {
    const game = matchupSchedule?.games.find((item) => item.matchupType === "h2h" && !item.isFinal && !item.involvesMe && item.wageringOpen)
      ?? matchupSchedule?.games.find((item) => item.matchupType === "h2h" && !item.isFinal && item.wageringOpen)
      ?? matchupSchedule?.games[0];
    if (game) void openWager(game, tab);
  }

  function addParlayLeg() {
    if (!wagerPanel?.options || wagerPanel.parlay.length >= 3) return;
    setWagerPanel({ ...wagerPanel, parlay: [...wagerPanel.parlay.filter((leg) => leg.market !== wagerPanel.market), { gameId: wagerPanel.gameId, label: wagerPanel.label, options: wagerPanel.options, market: wagerPanel.market, pick: wagerPanel.pick }].slice(0, 3) });
  }

  async function placeWager() {
    if (auth.status !== "ready" || !wagerPanel) return;
    const stake = Number(wagerPanel.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      setWagerPanel({ ...wagerPanel, notice: "Enter a positive stake." });
      return;
    }
    setWagerPanel({ ...wagerPanel, busy: true, notice: null });
    try {
      let message = "Wager placed.";
      if (wagerPanel.mode === "parlay") {
        const legs = wagerPanel.parlay.length ? wagerPanel.parlay : [{ gameId: wagerPanel.gameId, label: wagerPanel.label, options: wagerPanel.options!, market: wagerPanel.market, pick: wagerPanel.pick }];
        const result = await recApi.placeParlay({ guildId: auth.guildId, stake: Math.floor(stake), legs: legs.map((leg) => ({ gameId: leg.gameId, market: leg.market, pick: leg.pick })) });
        message = `Parlay placed. Potential payout ${coinsNumber(result.payout)}.`;
      } else if (wagerPanel.mode === "peer") {
        const result = await recApi.placePeerWager({ guildId: auth.guildId, gameId: wagerPanel.gameId, market: wagerPanel.market, pick: wagerPanel.pick, stake: Math.floor(stake), challengeType: wagerPanel.challengeType, targetUserId: wagerPanel.challengeType === "direct" ? wagerPanel.targetUserId : null });
        message = `Peer wager posted. Pot payout ${coinsNumber(result.payout)}.`;
      } else {
        const result = await recApi.placeHouseWager({ guildId: auth.guildId, gameId: wagerPanel.gameId, market: wagerPanel.market, pick: wagerPanel.pick, stake: Math.floor(stake) });
        message = `House wager placed. Potential payout ${coinsNumber(result.payout)}.`;
      }
      const board = await recApi.getPeerWagerBoard(auth.guildId).catch(() => ({ wagers: wagerPanel.board }));
      setWagerPanel((current) => current ? { ...current, board: board.wagers, busy: false, notice: message } : current);
      await load();
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, busy: false, notice: cause instanceof Error ? cause.message : "Wager failed." } : current);
    }
  }

  async function acceptPeer(wagerId: string) {
    if (auth.status !== "ready" || !wagerPanel) return;
    setWagerPanel({ ...wagerPanel, busy: true, notice: null });
    try {
      await recApi.acceptPeerWager({ guildId: auth.guildId, wagerId });
      const board = await recApi.getPeerWagerBoard(auth.guildId);
      setWagerPanel((current) => current ? { ...current, board: board.wagers, busy: false, notice: "Peer wager accepted." } : current);
      await load();
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, busy: false, notice: cause instanceof Error ? cause.message : "Could not accept wager." } : current);
    }
  }

  async function acceptFromWagersBoard(wagerId: string) {
    if (auth.status !== "ready") return;
    setWagersBoardBusy(true); setWagersBoardNotice(null);
    try {
      await recApi.acceptPeerWager({ guildId: auth.guildId, wagerId });
      const board = await recApi.getPeerWagerBoard(auth.guildId);
      setWagersBoard(board.wagers);
      recApi.getMyWagers(auth.guildId).then((result) => setMyWagers(result.wagers)).catch(() => undefined);
      setWagersBoardNotice("Peer wager accepted.");
      await load();
    } catch (cause) {
      setWagersBoardNotice(cause instanceof Error ? cause.message : "Could not accept wager.");
    } finally {
      setWagersBoardBusy(false);
    }
  }

  async function removeWager(wagerId: string) {
    if (auth.status !== "ready") return;
    if (!window.confirm("Cancel this wager? Your held stake will be refunded.")) return;
    setWagersBoardBusy(true);
    try {
      await recApi.cancelMyWager({ guildId: auth.guildId, wagerId });
      setWagersBoard((current) => (current ?? []).filter((wager) => wager.id !== wagerId));
      setMyWagers((current) => (current ?? []).filter((wager) => wager.id !== wagerId));
      setWagersBoardNotice("Wager removed and the held stake was refunded.");
    } catch (cause) { setWagersBoardNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWagersBoardBusy(false); }
  }

  if (error) return <div className="hub-state"><h1>League Hub</h1><p>{error}</p><button className="btn btn-primary" onClick={() => void load()}>Try again</button></div>;
  if (setupAccess && !setupAccess.leagueExists) return <div className="hub-state">
    <h1>Welcome to REC League</h1>
    {setupAccess.canSetup ? <>
      <p>This Discord server doesn't have a league linked yet. Create or open the league on the REC website, then link this server during league setup.</p>
    </> : <p>This Discord server doesn't have a league linked yet. Ask the league owner to create and link it from the REC website.</p>}
  </div>;
  if (!hub) return <div className="hub-state"><h1>Loading League Hub…</h1></div>;
  if (!hub.league) {
    return (
      <div className="hub-state">
        <h1>League Hub</h1>
        <p>This server’s league data is incomplete. Ask a commissioner to finish its website setup and Discord linking, then refresh.</p>
        <button className="btn btn-primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  const readyGuildId = auth.status === "ready" ? auth.guildId : null;
  const boxScoreMode = hubChrome.currentLeague?.dataMode === "box_scores";
  const isRise = hub.league.rosterType === "rise_to_immortality";
  const riseHubUnlocked = !isRise || hub.league.riseHubUnlocked === true;
  const headlines = hub.headlines ?? [];
  const highlights = (hub.highlights ?? []).filter((item) => !deadHighlightIds.includes(item.id));
  const my = hub.myTeam?.display ?? {};
  const profile = hub.myTeam?.profile ?? {};
  const heroRank = profile.powerRank?.rank ? `#${profile.powerRank.rank}` : "Unranked";
  const coachName = my.siteUsername || my.displayName || profile.user?.username || my.discordUsername || profile.user?.display_name || "REC Member";
  const heroTeam = profile.teamName ?? my.teamName ?? "No team linked";
  const viewerUser = hub.userRatings?.users?.find((user) => user.userId === hub.userRatings?.viewerUserId);
  const heroUserScore = viewerUser
    ? (hub.userRatings?.displayAsGrade
      ? (viewerUser.grade ?? "—")
      : (typeof viewerUser.rating === "number" ? viewerUser.rating.toFixed(1) : "—"))
    : "—";
  const heroUserMeta = viewerUser
    ? `#${viewerUser.rank}${viewerUser.teamName ? ` · ${viewerUser.teamName}` : ""}`
    : "Pending";
  const heroMatchup = matchupSchedule?.games.find((game) => game.gameId === heroCurrentGameId)
    ?? matchupSchedule?.games.find((game) => game.involvesMe)
    ?? null;
  const activeHighlight = highlights[activeHighlightIndex] ?? null;
  const highlightOwnerId = (activeHighlight as { user_id?: string | null; userId?: string | null } | null)?.user_id
    ?? (activeHighlight as { userId?: string | null } | null)?.userId
    ?? null;
  const potyOwnHighlight =
    Boolean(highlightOwnerId) &&
    Boolean(hub.userRatings?.viewerUserId) &&
    String(highlightOwnerId) === String(hub.userRatings?.viewerUserId);
  const activeStory = activeStoryIndex != null ? headlines[activeStoryIndex] ?? null : null;
  const openTeamsByConference = (openTeams ?? []).reduce<Record<string, OpenTeam[]>>((groups, team) => {
    const conference = team.conference || "Other";
        (groups[conference] ??= []).push(team);
    return groups;
  }, {});
  const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;

  function toggleArticleStyle(marker: "**" | "*" | "__") {
    const textarea = mediaArticleBodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = mediaArticle.body.slice(start, end);
    const nextBody = `${mediaArticle.body.slice(0, start)}${marker}${selected}${marker}${mediaArticle.body.slice(end)}`;
    setMediaArticle((current) => ({ ...current, body: nextBody }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + marker.length, end + marker.length);
    });
  }

  return <div className="hub-page" data-bg={isRise ? "rise" : isCfbLeague ? "cfb" : "madden"}>
    <div className="hub-body">
      <main className="hub-content">
    {section === "openTeams" ? <section className="hub-section hub-open-teams-page"><div className="hub-section-heading"><div><p className="hub-eyebrow">Available programs</p><h2>Open Teams</h2><p>Unlinked members can request one of these programs from their Discord Hub link.</p></div></div>{openTeamsError ? <div className="hub-empty"><p>{openTeamsError}</p><Button variant="secondary" onClick={() => { setOpenTeams(null); void viewOpenTeams(); }}>Try again</Button></div> : openTeams === null ? <p className="hub-empty">Loading available teams...</p> : openTeams.length === 0 ? <p className="hub-empty">All teams are currently assigned.</p> : <div className="hub-open-team-conferences">{Object.entries(openTeamsByConference).map(([conference, teams]) => <section key={conference}><h3>{conference}</h3><div>{teams.map((team) => <article key={team.id}><UsersRound size={17} /><span><strong>{team.name}</strong>{team.division && team.division !== "Teams" ? <small>{team.division}</small> : null}</span></article>)}</div></section>)}</div>}</section> : section === "schedules" ? <section className="hub-section hub-team-schedules-page"><div className="hub-section-heading"><div><p className="hub-eyebrow">League calendar</p><h2>Team Schedules</h2><p>Select a linked team to view its complete season.</p></div></div><label className="form-field"><span className="form-label">Team</span><select className="form-input" value={teamScheduleTeamId ?? ""} onChange={(event) => { if (event.target.value) void loadTeamSchedule(event.target.value); }}><option value="">{linkedTeams === null ? "Loading teams..." : "Select a team"}</option>{(linkedTeams ?? []).filter((row) => row.team).map((row) => <option key={row.team!.id} value={row.team!.id}>{row.team!.name} · {row.user?.display_name ?? "Coach"}</option>)}</select></label>{teamScheduleError ? <div className="hub-empty"><p>{teamScheduleError}</p></div> : !teamScheduleTeamId ? <p className="hub-empty">Pick a linked team to view its season schedule.</p> : !teamSchedule ? <p className="hub-empty">Loading schedule...</p> : <ScheduleWeekList weeks={teamSchedule.weeks} />}</section> : section === "team" ? <section className="hub-section hub-my-team"><div className="hub-section-heading"><div><p className="hub-eyebrow">Full coach profile</p><h2>{my.teamName ?? profile.teamName ?? "No team linked"}</h2><p>{coachName}</p></div></div>
      {hub.league.game === "cfb_27" && <DefenseNicknamePrompt />}
      {hub.league.game === "cfb_27" ? <>
      <div className="hub-gameday-card hub-quick-actions-card hub-my-team-quick-actions">
        <p className="hub-eyebrow">Quick actions</p>
        <div className="hub-gameday-actions hub-quick-actions-row hub-quick-actions-row-compact">
          <button type="button" className="hub-shortcut-card hub-quick-action" onClick={() => void viewMySchedule()}><IconWell size="sm" icon={<ScheduleIcon size={16} />} /><div><strong>Schedule</strong><span>Full season</span></div></button>
          <button type="button" className="hub-shortcut-card hub-quick-action" onClick={() => setMediaModal("interview")}><IconWell size="sm" icon={<InterviewMicIcon size={16} />} /><div><strong>Interview/<wbr />Article</strong><span>Media desk</span></div></button>
          <button type="button" className="hub-shortcut-card hub-quick-action" onClick={() => openSportsbook()}><IconWell size="sm" icon={<Coins size={16} />} /><div><strong>Place a Wager</strong><span>Sportsbook</span></div></button>
          <button type="button" className="hub-shortcut-card hub-quick-action" onClick={() => setRecruitingBoardOpen(true)}><IconWell size="sm" icon={<RecruitingCapIcon size={16} />} /><div><strong>Recruiting</strong><span>Board &amp; commits</span></div></button>
          <button type="button" className="hub-shortcut-card hub-quick-action" onClick={() => selectSection("roster")}><IconWell size="sm" icon={<ManageTeamIcon size={16} />} /><div><strong>Manage Team</strong><span>Roster &amp; players</span></div></button>
        </div>
      </div>
      <div className="hub-stat-grid">
      <article><span>Coach</span><strong>{coachName}</strong></article><article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "—"}</strong></article><article><span>Point differential</span><strong>{Number(my.leagueSeasonPointDifferential ?? 0) >= 0 ? "+" : ""}{my.leagueSeasonPointDifferential ?? 0}</strong></article><article><span>Current matchup</span><strong>{my.currentMatchupText ?? "None"}</strong></article><article><span>Wallet</span><strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong></article><article><span>Savings</span><strong><CoinAmount amount={Number(my.savings ?? 0)} /></strong></article>
    </div><div className="hub-profile-sections">
      <details open><summary><WalletCards size={18} /> Funds &amp; Savings</summary><div className="hub-profile-panel"><WalletSavingsCard guildId={auth.status === "ready" ? auth.guildId : ""} wallet={Number(my.wallet ?? 0)} savings={Number(my.savings ?? 0)} onTransferred={load} /></div></details>
      <details open><summary><Trophy size={18} /> Records</summary><div className="hub-profile-panel hub-record-grid"><article><span>Current season</span><strong>{profile.seasonRecord?.text ?? my.leagueSeasonRecordText ?? "0-0-0"}</strong><small>Active streak {profile.seasonRecord?.activeStreak ?? "—"}</small></article><article><span>All-time (this league)</span><strong>{profile.leagueCareerRecord?.text ?? profile.seasonRecord?.text ?? "0-0-0"}</strong><small>Active streak {profile.leagueCareerRecord?.activeStreak ?? profile.careerStats?.activeStreak ?? "—"}</small></article><article><span>Power ranking</span><strong>{heroRank}</strong><small>{profile.powerRank?.rank ? `Score ${heroUserScore}` : "Pending"}</small></article></div></details>
      <details><summary><TrendingUp size={18} /> EOS Payout Progress</summary><div className="hub-profile-panel"><EosPayoutProgressPanel /></div></details>
      <details><summary><Landmark size={18} /> Current Season Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.seasonStats} /></div></details>
      <details><summary><Landmark size={18} /> All-Time Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.careerStats} /><p className="hub-muted">League career only — global totals live on My Account.</p></div></details>
      <details><summary><Award size={18} /> League Awards</summary><div className="hub-profile-panel">{(profile.leagueAwards ?? profile.globalAwards)?.length ? <div className="hub-badge-group"><div className="hub-badge-shelf">{(profile.leagueAwards ?? profile.globalAwards).map((award: any) => <article key={award.awardName} className="hub-badge-award"><Trophy size={18} /><div><strong>{award.awardName}</strong><span>Won {award.count}×</span></div></article>)}</div></div> : <p className="hub-muted">No league awards yet.</p>}</div></details>
      <details><summary><WalletCards size={18} /> Financial Profile</summary><div className="hub-profile-panel"><FinancialLedger summary={profile.financialSummary} /></div></details>
    </div></> : <MaddenMyTeamGrid
        coachName={coachName}
        my={my}
        profile={profile}
        heroRank={heroRank}
        heroUserScore={heroUserScore}
        selectSection={selectSection}
        viewMySchedule={viewMySchedule}
        setMediaModal={setMediaModal}
        mediaPortal={mediaPortal}
        setPowerRankingsModalOpen={setPowerRankingsModalOpen}
        setBankModalOpen={setBankModalOpen}
        setFinancialModalOpen={setFinancialModalOpen}
        setCareerStatsModalOpen={setCareerStatsModalOpen}
        onOpenWagers={() => openSportsbook("board")}
        leagueId={hub.league.id}
        isRise={isRise}
        riseHubUnlocked={riseHubUnlocked}
      />}
      {hub.league.game !== "cfb_27" && careerStatsModalOpen && <Modal title="Career Stats" onClose={() => setCareerStatsModalOpen(false)}>
        <ProfileStats values={profile.careerStats} hideBoxScoresUploaded />
        <p className="hub-muted">League career only — global totals live on My Account. Player-level career stats aren't tracked yet — League Stats has a per-player season breakdown.</p>
      </Modal>}
      {hub.league.game !== "cfb_27" && powerRankingsModalOpen && <Modal title="Power Rankings" onClose={() => setPowerRankingsModalOpen(false)}>
        {hub.powerRankings?.teams?.length ? <RankingListSearch
          items={hub.powerRankings.teams}
          getSearchText={(team) => team.teamName}
          emptyLabel="Power rankings will appear after the first completed slate."
          renderItem={(team) => <article key={team.teamId} className={team.isHuman ? "human" : ""}>
            <strong>#{team.rank}</strong><div><span>{team.teamName}</span><small><RankChange change={team.change} /> · Score {Number(team.score).toFixed(3)}</small></div>
          </article>}
        /> : <p className="hub-empty">Power rankings will appear after the first completed slate.</p>}
        {gotwGuessing?.records?.length ? (
          <div className="hub-gotw-guessing-section">
            <h3>GOTW Guessing Records</h3>
            {gotwGuessing.records.map((record) => (
              <article key={record.user_id} className="hub-gotw-guessing-row">
                <span>{record.displayName}</span>
                <small>{record.wins}-{record.losses}{record.ties ? `-${record.ties}` : ""}{record.current_streak > 1 ? ` · ${record.current_streak}-game streak` : ""}</small>
              </article>
            ))}
          </div>
        ) : null}
      </Modal>}
      {hub.league.game !== "cfb_27" && bankModalOpen && <Modal title="Bank" onClose={() => setBankModalOpen(false)}>
        <WalletSavingsCard guildId={auth.status === "ready" ? auth.guildId : ""} wallet={Number(my.wallet ?? 0)} savings={Number(my.savings ?? 0)} onTransferred={load} />
      </Modal>}
      {hub.league.game !== "cfb_27" && financialModalOpen && <Modal title="Financials" onClose={() => setFinancialModalOpen(false)}>
        <div className="hub-modal-pill-row">
          <button type="button" className={financialsTab === "ledger" ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => setFinancialsTab("ledger")}>Ledger</button>
          <button type="button" className={financialsTab === "transfer" ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => setFinancialsTab("transfer")}>Transfer</button>
        </div>
        {financialsTab === "ledger" ? (
          <FinancialLedger summary={profile.financialSummary} />
        ) : (
          <WalletSavingsCard guildId={auth.status === "ready" ? auth.guildId : ""} wallet={Number(my.wallet ?? 0)} savings={Number(my.savings ?? 0)} onTransferred={load} />
        )}
      </Modal>}
      {!hub.canManageLeague && <div className="hub-retire-league"><Button variant="danger" onClick={() => { setRetireError(null); setRetireModalOpen(true); }}>Retire from League</Button></div>}</section> : section === "store" ? <section className="hub-section hub-store"><div className="hub-section-heading"><div><p className="hub-eyebrow"><ShoppingBag size={14} /> Franchise marketplace</p><h2>REC Store</h2><p>Wallet balance: <strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong></p></div><Button variant="secondary" onClick={() => navigate(-1)}>Back</Button></div>
      {!hub.store.enabled ? <p className="hub-empty">The coin economy is not enabled for this league.</p> : <>
        {hub.store.cfbSeasonOneLocked && <div className="hub-store-lock"><strong>CFB Season 1 roster lock</strong><span>Custom recruits, Campus Legends, development upgrades, attributes, and traits unlock automatically when Season 2 starts.</span></div>}
        <div className="hub-store-products">{hub.store.products.map((product) => {
          const Icon = STORE_PRODUCT_ICONS[product.type] ?? ShoppingBag;
          const used = storeContext?.seasonActive[product.type] ?? 0;
          const cap = storeContext?.seasonCaps[product.type as keyof typeof storeContext.seasonCaps];
          // Attribute caps are per-code / pooled points — show those only after this product expands.
          const usageLabel = product.locked
            ? null
            : product.type === "attribute"
              ? "Caps shown after select"
              : cap != null && cap > 0
                ? `${used}/${cap} ${product.type === "legend" ? "on this team" : "purchased"}`
                : `${used} purchased · Unlimited`;
          return <button key={product.type} disabled={product.locked} className={`hub-store-card hub-store-card-${product.type}${purchaseType === product.type ? " active" : ""}`} onClick={() => { setPurchaseType(product.type); setPurchaseDetails({}); setDevUpgradePlayer(null); setDevUpgradeTargetTier(""); setAgeResetPlayer(null); setContractPlayer(null); setPurchaseStatus(null); void loadStoreContext(); }}>
            <Icon size={22} />
            <strong>{product.label}</strong>
            <span className="hub-store-card-price">{storeProductPriceLabels[product.type as RecPurchaseType] ?? ""}</span>
            {product.locked ? (
              <span className="hub-store-card-status">Available Season 2</span>
            ) : (
              <span className="hub-store-card-usage">{usageLabel}</span>
            )}
          </button>;
        })}</div>

        {purchaseType && !hub.store.products.find((product) => product.type === purchaseType)?.locked && <div className="hub-store-form"><h3>{hub.store.products.find((product) => product.type === purchaseType)?.label}</h3>

          {purchaseType === "attribute" && <AttributePurchaseBuilder guildId={auth.status === "ready" ? auth.guildId : ""} storeContext={storeContext} wallet={Number(my.wallet ?? 0)} busy={purchaseBusy} excludeDefault={isCfbLeague} corePointPrice={economyValues.store.coreAttributePoint} nonCorePointPrice={economyValues.store.nonCoreAttributePoint} onSubmit={(allocations, playerName, playerId) => submitPurchase({ playerId, playerName, allocations })} />}

          {purchaseType === "legend" && <LegendPurchasePanel legendPrice={economyValues.store.legend} immortalPrice={economyValues.store.immortal} onPurchased={() => { setStoreContext(null); void load(); void loadStoreContext(true); }} />}

          {purchaseType === "custom_player" && <CustomPlayerWizard guildId={auth.status === "ready" ? auth.guildId : ""} onPurchased={() => { setStoreContext(null); void load(); void loadStoreContext(true); }} />}

          {/* Removed obsolete Bronze/Silver/Gold custom-player form.
            <p className="form-hint">
              {hub.league.game === "cfb_27"
                ? "This Custom Recruit won't join your roster immediately — it replaces one of your committed recruits once next season starts."
                : "This Custom Player isn't added immediately — they're picked up in the annual draft rather than replacing anyone on your current roster."}
            </p>
            <label className="form-field"><span className="form-label">Package</span><select className="form-input" value={purchaseDetails.package ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, package: event.target.value }))}><option value="">Select package</option><option value="bronze">Bronze · {coinsNumber(REC_CUSTOM_PLAYER_PACKAGE_PRICE.bronze)} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.bronze} pts</option><option value="silver">Silver · {coinsNumber(REC_CUSTOM_PLAYER_PACKAGE_PRICE.silver)} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.silver} pts</option><option value="gold">Gold · {coinsNumber(REC_CUSTOM_PLAYER_PACKAGE_PRICE.gold)} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.gold} pts</option></select></label>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <label className="form-field"><span className="form-label">Position</span><input className="form-input" placeholder="QB, WR, CB…" value={purchaseDetails.position ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, position: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong><CoinAmount amount={purchaseDetails.package ? REC_CUSTOM_PLAYER_PACKAGE_PRICE[purchaseDetails.package as keyof typeof REC_CUSTOM_PLAYER_PACKAGE_PRICE] : 0} /></strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName || !purchaseDetails.package} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          */}

          {purchaseType === "dev_upgrade" && (() => {
            const game = hub.league.game;
            const order = devTierOrderForGame(game);
            const presentTier = ((devUpgradePlayer?.devTrait && order.includes(devUpgradePlayer.devTrait as RecDevTier)) ? devUpgradePlayer.devTrait : "normal") as RecDevTier;
            const availableTargets = order.filter((tier) => order.indexOf(tier) > order.indexOf(presentTier));
            const devPrice = devUpgradeTargetTier
              ? priceForPurchaseWithConfig("dev_upgrade", { fromTier: presentTier, toTier: devUpgradeTargetTier }, game, economyValues.store)
              : 0;
            return <>
              <label className="form-field"><span className="form-label">Player</span><RosterPlayerSelect
                guildId={auth.status === "ready" ? auth.guildId : ""}
                value={devUpgradePlayer}
                onChange={(player) => { setDevUpgradePlayer(player); setDevUpgradeTargetTier(""); }}
                excludeDefault={isCfbLeague}
                excludePlayer={(p) => {
                  const tier = (p.devTrait && order.includes(p.devTrait as RecDevTier)) ? p.devTrait : "normal";
                  return tier === order[order.length - 1];
                }}
                extraLabel={(p) => {
                  const tier = ((p.devTrait && order.includes(p.devTrait as RecDevTier)) ? p.devTrait : "normal") as RecDevTier;
                  return ` · ${REC_DEV_TIER_LABELS[tier]}`;
                }}
              /></label>
              {devUpgradePlayer && <p className="form-hint">Present tier: <strong>{REC_DEV_TIER_LABELS[presentTier]}</strong></p>}
              <label className="form-field"><span className="form-label">Purchasing tier</span><select className="form-input" value={devUpgradeTargetTier} disabled={!devUpgradePlayer} onChange={(event) => setDevUpgradeTargetTier(event.target.value as RecDevTier)}><option value="">Select tier</option>{availableTargets.map((tier) => <option key={tier} value={tier}>{REC_DEV_TIER_LABELS[tier]}</option>)}</select></label>
              <div className="hub-store-total"><span>Total: <strong><CoinAmount amount={devPrice} /></strong></span><Button variant="primary" disabled={purchaseBusy || !devUpgradePlayer || !devUpgradeTargetTier} onClick={() => void submitPurchase({ playerId: devUpgradePlayer!.id, playerName: devUpgradePlayer!.fullName, toTier: devUpgradeTargetTier })}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
            </>;
          })()}

          {purchaseType === "contract" && <>
            <label className="form-field"><span className="form-label">Contract change</span><select className="form-input" value={purchaseDetails.variant ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, variant: event.target.value }))}><option value="">Select option</option><option value="salary_bonus_reduction">50% Salary/Bonus Reduction · {coinsNumber(economyValues.store.contractReduction)}</option><option value="extension">1-Year Extension · {coinsNumber(economyValues.store.contractExtension)}</option></select></label>
            <label className="form-field"><span className="form-label">Player</span><RosterPlayerSelect guildId={auth.status === "ready" ? auth.guildId : ""} value={contractPlayer} onChange={setContractPlayer} excludeDefault={isCfbLeague} /></label>
            <div className="hub-store-total"><span>Total: <strong><CoinAmount amount={purchaseDetails.variant ? priceForPurchaseWithConfig("contract", { variant: purchaseDetails.variant }, hub.league.game, economyValues.store) : 0} /></strong></span><Button variant="primary" disabled={purchaseBusy || !contractPlayer || !purchaseDetails.variant} onClick={() => void submitPurchase({ playerId: contractPlayer!.id, playerName: contractPlayer!.fullName, variant: purchaseDetails.variant })}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "age_reset" && <>
            <p className="form-hint">All age resets set the selected player&apos;s in-game age to <strong>21</strong>.</p>
            <label className="form-field"><span className="form-label">Player</span><RosterPlayerSelect
              guildId={auth.status === "ready" ? auth.guildId : ""}
              value={ageResetPlayer}
              onChange={setAgeResetPlayer}
              excludeDefault={isCfbLeague}
              showAge
              excludePlayer={(p) => p.age != null && p.age >= 21 && p.age <= 24}
            /></label>
            {ageResetPlayer && (
              <p className="form-hint">
                {ageResetPlayer.fullName}: {ageResetPlayer.age != null ? `age ${ageResetPlayer.age}` : "age unknown"} → <strong>21</strong>
              </p>
            )}
            <div className="hub-store-total"><span>Total: <strong><CoinAmount amount={economyValues.store.ageReset} /></strong></span><Button variant="primary" disabled={purchaseBusy || !ageResetPlayer} onClick={() => void submitPurchase({ playerId: ageResetPlayer!.id, playerName: ageResetPlayer!.fullName })}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseStatus && <p className="hub-transfer-status">{purchaseStatus}</p>}
          {purchaseError && <ErrorPopup title="Purchase Failed" message={purchaseError} onClose={() => setPurchaseError(null)} />}
        </div>}
      </>}
    </section> : section === ("wagers" as never) ? <section className="hub-section hub-wagers-section"><div className="hub-section-heading"><div><p className="hub-eyebrow"><Coins size={14} /> Sportsbook</p><h2>Wagers</h2><p>Wallet balance: <strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong></p></div></div>
      <h3 className="hub-wagers-subhead">My Wagers</h3>
      {(() => {
        if (myWagers === null) return <p className="hub-empty">Loading your wagers...</p>;
        if (!myWagers.length) return <p className="hub-empty">You haven't placed a wager this season.</p>;
        const groups: Array<{ key: string; label: string; wagers: typeof myWagers }> = [
          { key: "open", label: "Open Challenges", wagers: myWagers.filter((w) => w.boardState === "open") },
          { key: "active", label: "Active (Accepted)", wagers: myWagers.filter((w) => w.boardState === "active") },
          { key: "settled", label: "Settled", wagers: myWagers.filter((w) => w.boardState === "settled") },
        ].filter((group) => group.wagers.length);
        return <div className="hub-my-wagers-list">{groups.map((group) => (
          <div key={group.key} className="hub-my-wagers-group">
            <h4>{group.label} <span>{group.wagers.length}</span></h4>
            {group.wagers.map((wager) => (
              <article key={wager.id} className={`hub-my-wager-row hub-my-wager-row--${wager.status}`}>
                <div>
                  <strong>{wager.gameLabel}</strong>
                  <span>{wager.wagerKind === "house" ? "House" : "Peer"} · {displayLabel(wager.market)} · {wager.pickLabel}</span>
                  <span className="hub-wager-parties">
                    {wager.wagerKind === "house" ? "vs House" : `${wager.isMine ? "You" : wager.placedByName} vs ${wager.acceptedByName ?? "open challenge"}`}
                  </span>
                </div>
                <div className="hub-my-wager-row-figures">
                  <b><CoinAmount amount={wager.stake} /> stake</b>
                  <small>{wager.status === "won" ? `Won ` : "Payout "}<CoinAmount amount={wager.potentialPayout} /></small>
                  <StatusChip status={wager.status === "won" ? "approved" : wager.status === "lost" ? "denied" : wager.status === "refunded" ? "info" : wager.boardState === "open" ? "pending" : "locked"} label={displayLabel(wager.status)} />
                </div>
                {wager.canEdit && (
                  <div className="hub-my-wager-row-actions">
                    {wager.wagerKind !== "house" && (
                      <button
                        className="hub-icon-action"
                        title="Edit wager terms"
                        aria-label="Edit wager terms"
                        disabled={wagersBoardBusy}
                        onClick={() => {
                          const game = matchupSchedule?.games.find((item) => item.gameId === wager.gameId);
                          if (game) void openWager(game);
                        }}
                      >
                        <Pencil size={17} />
                      </button>
                    )}
                    <button className="hub-icon-action danger" title="Cancel wager" aria-label="Cancel wager" disabled={wagersBoardBusy} onClick={() => void removeWager(wager.id)}><Trash2 size={17} /></button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ))}</div>;
      })()}

      <h3 className="hub-wagers-subhead">This Week's Games</h3>
      {(() => {
        const state = renderMatchupLoadState("Loading games...");
        if (state) return state;
        const schedule = matchupSchedule;
        if (!schedule) return null;
        if (schedule.isOffseason) return <p className="hub-empty">No games this week — the league is in the offseason ({schedule.offseasonStageLabel ?? "Offseason"}).</p>;
        return schedule.games.length ? <div className="hub-matchup-summary-list">{schedule.games.map((game) => {
          const lines = weekWagerLines?.find((l) => l.gameId === game.gameId) ?? null;
          return (
          <article key={game.gameId} className="hub-matchup-summary">
            <div><span>{game.isGameOfWeek ? "Game of the Week" : game.matchupType === "h2h" ? "H2H" : game.matchupType === "human_cpu" ? "vs CPU" : "CPU"}</span><strong>{game.awayTeamName} <em>at</em> {game.homeTeamName}</strong>
              {lines && (
                <div className="hub-matchup-lines">
                  {lines.moneyline && <span>ML {americanFromDecimal(lines.moneyline.awayOdds)}/{americanFromDecimal(lines.moneyline.homeOdds)}</span>}
                  {lines.spread && <span>Spread {game.homeTeamName} {lines.spread.line > 0 ? "+" : ""}{lines.spread.line} ({americanFromDecimal(lines.spread.odds)})</span>}
                  {lines.total && <span>O/U {lines.total.line} ({americanFromDecimal(lines.total.odds)})</span>}
                </div>
              )}
            </div>
            <div className="hub-matchup-actions">{game.involvesMe ? <StatusChip status="locked" label="Your game" /> : !game.isFinal && game.matchupType === "h2h" ? <Button variant="secondary" size="compact" onClick={() => void openWager(game)}>Build Wager</Button> : null}</div>
          </article>
          );
        })}</div> : <p className="hub-empty">No linked-user games are scheduled for Week {schedule.selectedWeek}.</p>;
      })()}

      <h3 className="hub-wagers-subhead">Peer Wager Board</h3>
      {wagersBoardNotice && <p className="hub-transfer-status">{wagersBoardNotice}</p>}
      <div className="hub-wager-carousel">{wagersBoard === null ? <p className="hub-empty">Loading peer wagers...</p> : wagersBoard.length ? <><button className="hub-highlight-arrow prev" aria-label="Previous wager" onClick={() => setWagerBoardIndex((wagerBoardIndex - 1 + wagersBoard.length) % wagersBoard.length)}><ChevronLeft /></button>{(() => { const wager = wagersBoard[wagerBoardIndex % wagersBoard.length]; const isActive = wager.boardState === "active" || wager.status === "pending"; return <article key={wager.id}><div><strong>{wager.gameLabel}</strong><span>{displayLabel(wager.market)} · {wager.pickLabel} · <CoinAmount amount={wager.stake} /></span><span className="hub-wager-parties">Placed by {wager.isMine ? "you" : wager.placedByName}{isActive && wager.acceptedByName ? ` · Accepted by ${wager.acceptedByName}` : ""}</span></div><div className="hub-wager-card-actions">{wager.canAccept && <Button variant="primary" size="compact" disabled={wagersBoardBusy} onClick={() => void acceptFromWagersBoard(wager.id)}>Accept</Button>}{wager.canEdit && <><button className="hub-icon-action" title="Edit wager terms" aria-label="Edit wager terms" onClick={() => { const game = matchupSchedule?.games.find((item) => item.gameId === wager.gameId); if (game) void openWager(game); }}><Pencil size={17} /></button><button className="hub-icon-action danger" title="Delete wager" aria-label="Delete wager" disabled={wagersBoardBusy} onClick={() => void removeWager(wager.id)}><Trash2 size={17} /></button></>}</div></article>; })()}<button className="hub-highlight-arrow next" aria-label="Next wager" onClick={() => setWagerBoardIndex((wagerBoardIndex + 1) % wagersBoard.length)}><ChevronRight /></button><p>{wagerBoardIndex % wagersBoard.length + 1} / {wagersBoard.length}</p></> : <p className="hub-empty">No open user wagers yet.</p>}</div>

    </section> : section === "roster" ? <>{hub.league.game !== "cfb_27" && <div className="hub-subpage-back"><Button variant="ghost" size="compact" onClick={() => selectSection("team")}><ChevronLeft size={16} /> Back to My Team</Button></div>}<RosterHome /></> : section === "trades" ? <>{hub.league.game !== "cfb_27" && <div className="hub-subpage-back"><Button variant="ghost" size="compact" onClick={() => selectSection("team")}><ChevronLeft size={16} /> Back to My Team</Button></div>}<TradeCenterHome /></> : <div className="hub-league-tab">
      {(subTab === "buzz" || subTab === "news") && <>
        {subTab === "buzz" && <>
        <div className="hub-buzz-top">
          <section className="hub-hero hub-hero-rebuilt">
            <header className="hub-hero-centered-header">
              <p className="hub-eyebrow">{gameLabel(hub.league.game)}</p>
              <h1><span>{hub.league.name}</span><em>–</em><span>{displayLabel(String(hub.league.seasonStage))}</span><em>–</em><span>Week {hub.league.weekNumber}</span></h1>
              {auth.status === "ready" && heroMatchup?.matchupType === "h2h" && <HeroSchedulingStatus guildId={auth.guildId} gameId={heroMatchup.gameId} reloadKey={matchupReloadKey} />}
            </header>

            {isRise && !riseHubUnlocked ? (
              <div className="hub-hero-no-matchup">
                <strong>Registration pool</strong>
                <span>Complete Origins on the Rise page. After the virtual rookie draft you are linked to a franchise on the site and Discord, and this hub switches to the full league UI. Unused teams stay CPU.</span>
                <Link className="hub-my-team-btn" to={`/l/${hub.league.id}/rise`} style={{ marginTop: 12, display: "inline-flex" }}><strong>Open Origins</strong><span>Create your class</span></Link>
              </div>
            ) : heroMatchup ? <div className="hub-hero-matchup-stack">
              {/* Not `passive` on the card itself -- this wrapper's onClick needs the click to
               * bubble up from the card; the reaction row below (reactionsBelow) is a separate
               * sibling, not inside this clickable area, so it's unaffected either way. */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={heroBreakdownExpanded}
                className="hub-expandable-matchup-trigger"
                onClick={() => setHeroBreakdownExpanded((value) => !value)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHeroBreakdownExpanded((value) => !value); } }}
              >
                <MatchupCard game={heroMatchup} showReactions reactionsBelow />
              </div>
              {heroBreakdownExpanded ? (
                <div className="hub-expandable-matchup-drawer">
                  {heroPreview?.gameId === heroMatchup.gameId ? <HeroMatchupBreakdown preview={heroPreview} /> : <p className="hub-empty">Loading matchup breakdown…</p>}
                </div>
              ) : null}
              {auth.status === "ready" && <HeroMatchupActions
                guildId={auth.guildId}
                matchup={heroMatchup}
                boxScoreMode={boxScoreMode}
                onChanged={() => setMatchupReloadKey((value) => value + 1)}
                onOpenBoxScore={() => setBoxScoreUploadGame(heroMatchup)}
                onOpenPlayerStats={() => void openPlayerStats(heroMatchup)}
                onOpenShareStream={() => setShareStreamGame(heroMatchup)}
                onUploadHighlight={() => setHighlightUploadGame(heroMatchup)}
                onOpenRequestHelp={heroMatchup.matchupType === "h2h" ? () => setRequestHelpGame(heroMatchup) : undefined}
              />}
            </div> : <div className="hub-hero-no-matchup"><strong>No matchup this week</strong><span>Your next game will appear here when the league schedule is ready.</span></div>}

            <section className="hub-season-snapshot">
              <header><span>Season Snapshot</span><small>{coachName} · {heroTeam}</small></header>
              <div className="hub-season-snapshot-grid">
                <article><span>User Score &amp; League Ranking</span><strong>{heroUserScore}</strong><small>{heroUserMeta}</small></article>
                <article><span>Wallet Balance</span><strong><CoinAmount amount={Number(my.wallet ?? 0)} /></strong><small>Available funds</small></article>
                <article><span>Savings Balance</span><strong><CoinAmount amount={Number(my.savings ?? 0)} /></strong><small>Banked funds</small></article>
              </div>
            </section>

            <div className="hub-gameday-card hub-quick-actions-card hub-hero-quick-actions">
              <p className="hub-eyebrow">Quick actions</p>
              <div className="hub-gameday-actions hub-quick-actions-row">
                {isRise ? (
                  <>
                    <button type="button" className="hub-my-team-btn" onClick={() => navigate(`/l/${hub.league.id}/rise`)}><strong>Origins</strong><span>Class &amp; builds</span></button>
                    {riseHubUnlocked ? <button type="button" className="hub-my-team-btn" onClick={() => navigate(`/l/${hub.league.id}/team/upgrades`)}><strong>Player XP</strong><span>Attribute upgrades</span></button> : null}
                    <button type="button" className="hub-my-team-btn" onClick={() => setMediaModal("interview")}><strong>Interview</strong><span>Media desk</span></button>
                    {riseHubUnlocked ? <button type="button" className="hub-my-team-btn" onClick={() => void viewMySchedule()}><strong>Schedule</strong><span>Full season</span></button> : null}
                    <button type="button" className="hub-my-team-btn" onClick={() => navigate(`/l/${hub.league.id}/rules`)}><strong>Rules</strong><span>League policies</span></button>
                    {riseHubUnlocked ? <button type="button" className="hub-my-team-btn" onClick={() => selectSection("roster")}><strong>Manage Team</strong><span>Roster &amp; players</span></button> : null}
                    {riseHubUnlocked ? <button type="button" className="hub-my-team-btn" onClick={() => setManageFundsOpen(true)}><strong>Manage Funds</strong><span>Transfer &amp; transactions</span></button> : null}
                  </>
                ) : (
                  <>
                <button type="button" className="hub-my-team-btn" onClick={() => void viewMySchedule()}><strong>Schedule</strong><span>Full season</span></button>
                <button type="button" className="hub-my-team-btn" onClick={() => setMediaModal("interview")}><strong>Interview/<wbr />Article</strong><span>Media desk</span></button>
                <button type="button" className="hub-my-team-btn" onClick={() => openSportsbook()}><strong>Place a Wager</strong><span>Sportsbook</span></button>
                <button type="button" className="hub-my-team-btn" onClick={() => navigate(`/l/${hub.league.id}/store`)}><strong>Store</strong><span>Franchise marketplace</span></button>
                <button type="button" className="hub-my-team-btn" onClick={() => navigate(`/l/${hub.league.id}/rules`)}><strong>Rules</strong><span>League policies</span></button>
                {hub.league.game === "cfb_27" && <button type="button" className="hub-my-team-btn" onClick={() => setRecruitingBoardOpen(true)}><strong>Recruiting</strong><span>Board &amp; commits</span></button>}
                {hub.league.game !== "cfb_27" && <button type="button" className="hub-my-team-btn" onClick={() => selectSection("trades")}><strong>Trade Center</strong><span>Propose &amp; review</span></button>}
                <button type="button" className="hub-my-team-btn" onClick={() => selectSection("roster")}><strong>Manage Team</strong><span>Roster &amp; players</span></button>
                <button type="button" className="hub-my-team-btn" onClick={() => setManageFundsOpen(true)}><strong>Manage Funds</strong><span>Transfer &amp; transactions</span></button>
                  </>
                )}
              </div>
            </div>
            <details className="hub-ways-paid">
              <summary><span>Ways To Get Paid</span><small><CoinAmount amount={hub.waysToGetPaid.weeklyEarned} /> earned of <CoinAmount amount={hub.waysToGetPaid.weeklyPotential} /> potential this week</small></summary>
              <div className="hub-ways-paid-body">
                <section><h3>Weekly</h3><div className="hub-ways-paid-list">{hub.waysToGetPaid.weeklyItems.map((item) => <p key={item.key}>{item.label} to earn <CoinAmount amount={item.amount} />{item.limit > 1 ? " per submission" : ""} — <strong>{item.current}/{item.limit}</strong> submitted this week.{item.note ? ` ${item.note}.` : ""}</p>)}</div><p className="hub-muted">{hub.waysToGetPaid.wagerHint}</p></section>
                {isRise ? null : <section><h3>Season Long</h3><p>Track your exact tier, threshold, current statistic, progress, and projected payout below.</p><EosPayoutProgressPanel /></section>}
              </div>
            </details>
          </section>
        </div>

        {manageFundsOpen && auth.status === "ready" && <ManageFundsModal guildId={auth.guildId} wallet={Number(my.wallet ?? 0)} savings={Number(my.savings ?? 0)} onTransferred={load} onClose={() => setManageFundsOpen(false)} />}

        {(hub.league.game === "madden_26" || hub.league.game === "madden_27") && (!isRise || riseHubUnlocked) && hub.league.fantasyDraftStatus && hub.league.fantasyDraftStatus !== "not_applicable" && hub.league.fantasyDraftStatus !== "concluded" && readyGuildId && (
          <FantasyDraftCard guildId={readyGuildId} leagueId={hub.league.id} compact />
        )}

        {auth.status === "ready" && riseHubUnlocked && gotwGames.length ? <GotwVotingCarousel
          guildId={auth.guildId}
          games={gotwGames}
          guessingRecord={gotwGuessing?.mine}
          onVote={voteGotw}
          onOpenWager={isRise ? undefined : (game) => void openWager(game)}
        /> : null}

        <LiveGamesCard liveStreams={hub.liveStreams} />

        <EosAwardVotingBlock />
        <CommissionerPollsVotingBlock />
        </>}
        {subTab === "news" && <>
        <SectionFrame eyebrow="Around the league" title={hub.league.game?.startsWith("madden") ? "League News" : "Campus Buzz"}>
          {(() => {
            const items = activeHeadlineGroup?.items ?? [];
            const active = items.length ? items[headlineItemIndex % items.length] : null;
            if (!active) return <p className="hub-empty">Headlines publish here after games or from League Publishing.</p>;
            const { story, flatIndex } = active;
            // Offseason-stage stories (end of season recap, transfer portal, etc.) reuse the
            // last real gameplay week_number for storage continuity (see advance-results
            // .service.ts) — that's a DB detail, not the story's actual context, so a non-
            // regular-season story must show its season_stage, not "Week N".
            const isRegularSeasonStory = !story.season_stage || story.season_stage === "regular_season";
            const weekLabel = isRegularSeasonStory && activeHeadlineGroup?.week != null
              ? `Week ${activeHeadlineGroup.week}`
              : story.season_stage ? displayLabel(story.season_stage) : "League Story";
            const itemPos = items.length > 1 ? `${(headlineItemIndex % items.length) + 1} of ${items.length}` : null;
            return isMobile ? (
              <div className="hub-story-mobile-swipe" style={{ position: "relative" }}>
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
                  {story.image_url && <img className="hub-story-image" src={story.image_url} alt="" onClick={(event) => { event.stopPropagation(); setLightboxImage(story.image_url!); }} />}
                  <button type="button" className="hub-story-open" onClick={() => openStory(flatIndex)}><time>{weekLabel}</time><h3>{story.headline ?? "League Story"}</h3><p>{snippet(story.body)}</p><span className="hub-read-article">{story.story_type !== "headline" ? "Open REC Network Roundtable" : "Read more"}</span></button>
                </article>
                <p className="hub-story-swipe-hint">
                  {headlineWeekCount > 1 ? (
                    <>
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineWeekIndex((headlineWeekIndex + 1) % headlineWeekCount)} aria-label="Older week">‹</button>
                      {` ${weekLabel} `}
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineWeekIndex((headlineWeekIndex - 1 + headlineWeekCount) % headlineWeekCount)} aria-label="Newer week">›</button>
                    </>
                  ) : weekLabel}
                  {itemPos ? (
                    <>
                      {" · "}
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineItemIndex((headlineItemIndex - 1 + items.length) % items.length)} aria-label="Previous article">‹</button>
                      {` ${itemPos} `}
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineItemIndex((headlineItemIndex + 1) % items.length)} aria-label="Next article">›</button>
                    </>
                  ) : null}
                </p>
              </div>
            ) : (
              <div className="hub-story-carousel">
                {/* The counter below ("N of M") steps through this week's articles, not
                    weeks — so, to match the Highlight Reel, these big arrows drive
                    headlineItemIndex (the dimension actually visible/relevant here), not
                    headlineWeekIndex. Week navigation is the small ‹/› pair in the hint line
                    below instead (mirrors the Announcements card's week arrows, which this
                    card never got even though the same headlineWeekIndex/headlineWeekGroups
                    state already existed to drive them). Week auto-selects to the current week
                    on load. */}
                {items.length > 1 ? <button type="button" className="hub-highlight-arrow previous" title="Previous article" onClick={() => setHeadlineItemIndex((headlineItemIndex - 1 + items.length) % items.length)}><ChevronLeft /></button> : null}
                <article className={story.story_type === "headline" ? "hub-story-card hub-story-feature" : "hub-story-card article hub-story-feature"} key={story.id}>
                  {story.image_url && <img className="hub-story-image" src={story.image_url} alt="" onClick={(event) => { event.stopPropagation(); setLightboxImage(story.image_url!); }} />}
                  <button type="button" className="hub-story-open" onClick={() => openStory(flatIndex)}><time>{weekLabel}</time><h3>{story.headline ?? "League Story"}</h3><p>{snippet(story.body)}</p><span className="hub-read-article">{story.story_type !== "headline" ? "Open REC Network Roundtable" : "Read more"}</span></button>
                </article>
                {items.length > 1 ? <button type="button" className="hub-highlight-arrow next" title="Next article" onClick={() => setHeadlineItemIndex((headlineItemIndex + 1) % items.length)}><ChevronRight /></button> : null}
                <p className="hub-story-swipe-hint">
                  {headlineWeekCount > 1 ? (
                    <>
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineWeekIndex((headlineWeekIndex + 1) % headlineWeekCount)} aria-label="Older week">‹</button>
                      {` ${weekLabel} `}
                      <button type="button" className="hub-story-item-nav" onClick={() => setHeadlineWeekIndex((headlineWeekIndex - 1 + headlineWeekCount) % headlineWeekCount)} aria-label="Newer week">›</button>
                    </>
                  ) : weekLabel}
                  {itemPos ? ` · Showing ${itemPos}` : null}
                </p>
              </div>
            );
          })()}
        </SectionFrame>
        <SectionFrame
          eyebrow="Community clips"
          title={`Weekly Recap - Season ${hub.league.seasonNumber}`}
          className="hub-highlight-section"
        >
          {activeHighlight ? <div className="hub-highlight-carousel">
            {highlightCount > 1 && <button className="hub-highlight-arrow previous" aria-label="Previous highlight" title="Previous highlight" onClick={() => setHighlightIndex((activeHighlightIndex - 1 + highlightCount) % highlightCount)}><ChevronLeft /></button>}
            <article
              className="hub-highlight hub-highlight-embed swipe-card-surface"
              style={{
                transform: highlightSwipe.isDragging ? `translateX(${highlightSwipe.dragOffsetPx}px)` : undefined,
                transition: highlightSwipe.isDragging || highlightSwipe.reducedMotion ? "none" : "transform var(--duration-standard) var(--ease-standard)",
              }}
              onPointerDown={highlightSwipe.handlers.onPointerDown}
              onPointerMove={highlightSwipe.handlers.onPointerMove}
              onPointerUp={highlightSwipe.handlers.onPointerUp}
              onPointerCancel={highlightSwipe.handlers.onPointerCancel}
            >
              <div className="hub-video-frame">{activeHighlight.iframeUrl || activeHighlight.streamUid ? <iframe key={activeHighlight.id} src={`${activeHighlight.iframeUrl ?? `https://iframe.videodelivery.net/${activeHighlight.streamUid}`}?autoplay=true&muted=true`} title="Highlight" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen onLoad={() => void recordView(activeHighlight.id)} /> : activeHighlight.videoUrl ? <video key={activeHighlight.id} src={activeHighlight.videoUrl} controls autoPlay muted playsInline preload="auto" onCanPlay={(event) => { event.currentTarget.muted = true; void event.currentTarget.play().catch(() => undefined); }} onPlay={() => void recordView(activeHighlight.id)} onEnded={() => { if (!highlightSwipe.isDragging && highlightCount > 1) setHighlightIndex((activeHighlightIndex + 1) % highlightCount); }} onError={() => { setDeadHighlightIds((ids) => ids.includes(activeHighlight.id) ? ids : [...ids, activeHighlight.id]); }} /> : <a href={activeHighlight.message_url ?? "#"} target="_blank" rel="noreferrer" onClick={() => void recordView(activeHighlight.id)}><Play size={36} /> Open highlight</a>}</div>
              <div className="hub-highlight-meta">
                <div className="hub-highlight-meta-title">
                  <strong>{activeHighlight.source === "weekly_recap" ? activeHighlight.title : (activeHighlight.matchupLabel ?? activeHighlight.team?.name ?? activeHighlight.user?.username ?? activeHighlight.user?.display_name ?? "REC Highlight")}</strong>
                  {activeHighlight.source !== "weekly_recap" && <small className="hub-highlight-participants">
                    {activeHighlight.matchupParticipants
                      ? `H2H: @${activeHighlight.matchupParticipants.away} VS @${activeHighlight.matchupParticipants.home}`
                      : `CPU: @${activeHighlight.user?.username ?? activeHighlight.user?.display_name ?? "REC Member"}`}
                  </small>}
                </div>
                <span>{activeHighlightIndex + 1} of {highlightCount}{" \u00B7 "}Season {activeHighlight.season_number}{" \u00B7 "}{activeHighlight.season_stage === "regular_season" ? `Week ${activeHighlight.week_number}` : displayLabel(activeHighlight.season_stage ?? `Week ${activeHighlight.week_number}`)}</span>
              </div><div className="hub-highlight-views"><Eye size={14} /> {activeHighlight.viewCount} views</div>
              <div className="hub-highlight-reactions">
                <button aria-label="Like" className={(activeHighlight.myReactions ?? []).includes("like") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "like")}><ThumbsUp size={18} /><b>Like</b><small>{activeHighlight.reactionCounts?.like || ""}</small></button>
                <button aria-label="Nominate for Play of the Year" className={`poty${AWARD_KEYS.some((key) => (activeHighlight.myReactions ?? []).includes(key)) ? " active" : ""}`} disabled={potyOwnHighlight} title={potyOwnHighlight ? "You can't nominate your own highlight" : "Nominate for Play of the Year"} onClick={() => { if (potyOwnHighlight) return; setPotyHighlightId(activeHighlight.id); setPotyCategory(AWARD_KEYS.find((key) => (activeHighlight.myReactions ?? []).includes(key)) ?? ""); }}><Award size={18} /><b>POTY</b><small>{AWARD_KEYS.reduce((sum, key) => sum + (activeHighlight.reactionCounts?.[key] ?? 0), 0) || ""}</small></button>
                <button aria-label="Dislike" className={(activeHighlight.myReactions ?? []).includes("dislike") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "dislike")}><ThumbsDown size={18} /><b>Dislike</b><small>{activeHighlight.reactionCounts?.dislike || ""}</small></button>
              </div>
            </article>{highlightCount > 1 && <button className="hub-highlight-arrow next" aria-label="Next highlight" title="Next highlight" onClick={() => setHighlightIndex((activeHighlightIndex + 1) % highlightCount)}><ChevronRight /></button>}</div> : <p className="hub-empty">Upload from a matchup or post in Discord — clips show up here.</p>}
        </SectionFrame>
        <SectionFrame eyebrow="Official updates" title="Announcements" className="hub-announce-panel">
          {activeAnnouncementGroup ? (
            <div className="hub-announce-carousel">
              {announcementWeekGroups.length > 1 ? <button type="button" className="hub-highlight-arrow previous" title="Older week" onClick={() => setAnnouncementWeekIndex((announcementWeekIndex + 1) % announcementWeekGroups.length)}><ChevronLeft /></button> : null}
              {(() => {
                const items = activeAnnouncementGroup.items;
                const item = items[announcementItemIndex % items.length];
                const weekLabel = activeAnnouncementGroup.weekNumber == null ? "" : `Week ${activeAnnouncementGroup.weekNumber} · `;
                return <article key={item.id}>
                  <time>{weekLabel}{new Date(item.published_at).toLocaleDateString()}</time>
                  <h3>{item.title}</h3>
                  <p className="hub-announcement-body">{item.body}</p>
                  {items.length > 1 ? <span className="hub-announce-pos">{(announcementItemIndex % items.length) + 1} / {items.length}</span> : null}
                </article>;
              })()}
              {announcementWeekGroups.length > 1 ? <button type="button" className="hub-highlight-arrow next" title="Newer week" onClick={() => setAnnouncementWeekIndex((announcementWeekIndex - 1 + announcementWeekGroups.length) % announcementWeekGroups.length)}><ChevronRight /></button> : null}
            </div>
          ) : <p className="hub-empty">League announcements will appear here.</p>}
        </SectionFrame>
        </>}
      </>}

      {subTab === "matchups" && (
        <>

          <div className="rec-matchup-tabs" role="tablist" aria-label="Matchups and rankings">
            <button type="button" role="tab" aria-selected={matchupView === "h2h"} className={matchupView === "h2h" ? "active" : ""} onClick={() => setMatchupView("h2h")}>H2H Matchups</button>
            <button type="button" role="tab" aria-selected={matchupView === "cpu"} className={matchupView === "cpu" ? "active" : ""} onClick={() => setMatchupView("cpu")}>Human vs CPU</button>
            {/* Madden has this same Power Rankings/User Ratings/SOS content available from My
                Team's League card now (modals), so the Rankings pill only makes sense for CFB,
                which has no My Team grid to relocate it to. */}
            {isCfbLeague && <button type="button" role="tab" aria-selected={matchupView === "rankings"} className={matchupView === "rankings" ? "active" : ""} onClick={() => setMatchupView("rankings")}>Rankings</button>}
          </div>

          {matchupView === "rankings" && isCfbLeague ? (
            <>
              <SectionFrame
                eyebrow="Updated on advance"
                title="Power Rankings"
                action={isCfbLeague && hub.powerRankings?.teams?.length ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setRankByConference((v) => !v)}>
                    {rankByConference ? "Show overall" : "Group by conference"}
                  </button>
                ) : undefined}
              >
                {hub.powerRankings?.teams?.length ? (
                  rankByConference && isCfbLeague ? (
                    <div className="hub-power-rankings-by-conference">
                      {powerRankingsByConference.map(([conference, teams]) => (
                        <div key={conference} className="hub-power-rankings-conference-group">
                          <h4>{conference}</h4>
                          <div className="hub-power-rankings">{teams.map((team) => <article key={team.teamId} className={team.isHuman ? "human" : ""}>
                            <strong>#{team.rank}</strong><div><span>{team.teamName}{team.ownerLabel ? ` — ${team.ownerLabel}` : ""}</span><small><RankChange change={team.change} /> · Score {Number(team.score).toFixed(3)}</small></div>
                          </article>)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <RankingListSearch
                      items={hub.powerRankings.teams}
                      getSearchText={(team) => `${team.teamName} ${team.ownerLabel ?? ""}`}
                      emptyLabel="Power rankings will appear after the first completed slate."
                      renderItem={(team) => <article key={team.teamId} className={team.isHuman ? "human" : ""}>
                        <strong>#{team.rank}</strong><div><span>{team.teamName}{team.ownerLabel ? ` — ${team.ownerLabel}` : ""}</span><small><RankChange change={team.change} /> · Score {Number(team.score).toFixed(3)}</small></div>
                      </article>}
                    />
                  )
                ) : <p className="hub-empty">Power rankings will appear after the first completed slate.</p>}
              </SectionFrame>

              <SectionFrame eyebrow="Win/performance signals, production, consistency" title="User Ratings">
                {hub.userRatings?.users?.length ? (
                  <div className="hub-coach-ratings">
                    <RankingListSearch
                      items={hub.userRatings.users}
                      getSearchText={(user) => user.displayName}
                      emptyLabel="User ratings will appear after the first completed slate."
                      renderItem={(user) => <article key={user.userId} className={user.userId === hub.userRatings?.viewerUserId ? "human" : ""}>
                        <strong>#{user.rank}</strong>
                        <div><span>{user.displayName}</span><small>{user.teamName ?? "Free agent"} · Win {user.winScore.toFixed(1)} · Stat {user.statScore.toFixed(1)} · Consistency {user.consistencyScore.toFixed(1)}</small></div>
                        <em className="hub-rating-badge">{hub.userRatings?.displayAsGrade ? user.grade : user.rating.toFixed(1)}</em>
                      </article>}
                    />
                  </div>
                ) : <p className="hub-empty">User ratings will appear after the first completed slate.</p>}
              </SectionFrame>

            </>
          ) : (
            <SectionFrame eyebrow="Current slate" title="Weekly Matchups" className="hub-matchup-section">
              {wagersBoardNotice && <p className="hub-transfer-status">{wagersBoardNotice}</p>}
              {(() => {
                const state = renderMatchupLoadState("Loading matchups...");
                if (state) return state;
                const schedule = matchupSchedule;
                if (!schedule) return null;
                if (schedule.isOffseason) return <p className="hub-empty">No games this week — the league is in the offseason ({schedule.offseasonStageLabel ?? "Offseason"}).</p>;
                return <>
                <div className="hub-week-picker">
                  <label className="hub-week-select"><span>Week</span><select className="form-input" value={schedule.selectedWeek} onChange={(event) => setMatchupWeek(Number(event.target.value))}>{schedule.weekNumbers.map((week) => <option key={week} value={week}>Week {week}{week === schedule.currentWeek ? " (Current)" : ""}</option>)}</select></label>
                </div>
                {(() => {
                  const visible = schedule.games.filter((game) => matchupView === "h2h" ? game.matchupType === "h2h" : game.matchupType === "human_cpu");
                  return visible.length ? <div className="rec-matchup-list">{visible.map((game, index) => <ExpandableMatchupCard key={game.gameId} game={game} featured={game.isGameOfWeek || game.involvesMe || index === 0} />)}</div> : <p className="hub-empty">No {matchupView === "h2h" ? "H2H" : "human vs CPU"} games are scheduled for Week {schedule.selectedWeek}.</p>;
                })()}
                {schedule.games.length ? <div className="hub-matchups hub-matchup-schedule">{schedule.games.map((game) => (<div className={`hub-matchup-stack${game.gotw ? " gotw" : ""}`} key={game.gameId}>
                  <article className={(game.matchupType === "h2h" ? "hub-matchup-card h2h" : "hub-matchup-card cpu") + (game.gotw ? " gotw" : "")}>
                    <div className="hub-matchup-card-head"><span aria-hidden="true" /><strong>Week {game.weekNumber}</strong><small>{game.gotw ? "Game of the Week" : [game.awayConference, game.homeConference].filter(Boolean).join(" vs ")}</small></div>
                    <div className="hub-matchup-board">
                      <div className="hub-team-side"><span>{game.awayTeamName}</span><div className="hub-team-wordmark" style={{ "--matchup-name-size": matchupWordmarkSize(game.awayTeamMascot) } as CSSProperties}>{game.awayTeamMascot}</div><small>{game.awayConference ?? "Visiting team"}</small></div>
                      <div className="hub-score-center"><span aria-hidden="true" />{game.isFinal && game.awayScore != null && game.homeScore != null ? <strong>{`${game.awayScore}–${game.homeScore}`}</strong> : null}</div>
                      <div className="hub-team-side"><span>{game.homeTeamName}</span><div className="hub-team-wordmark" style={{ "--matchup-name-size": matchupWordmarkSize(game.homeTeamMascot) } as CSSProperties}>{game.homeTeamMascot}</div><small>{game.homeConference ?? "Home team"}</small></div>
                    </div>
                    <div className="hub-matchup-rails">
                      {/* Madden's box-score/player-stats controls only make sense when the league is
                          actually entering box scores by hand -- an EA-import or manual-score league
                          has nothing for these buttons to do, so hide them entirely instead of
                          showing a permanently-disabled control. CFB is untouched (always box-score-driven). */}
                      {isCfbLeague || boxScoreMode ? (
                        game.matchupType === "human_cpu" ? <div className="hub-team-control-rail away"><button disabled={!boxScoreMode || game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button></div> : <div className="hub-team-control-rail away"><button disabled={!boxScoreMode || game.viewerSide !== "away" || game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button><button disabled={!boxScoreMode || game.viewerSide !== "away" || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div>
                      ) : <div className="hub-team-control-rail away" />}
                      <div className="hub-center-control-rail">{game.matchupType === "human_cpu" ? game.streams[0] ? <a className="btn btn-primary" href={`${apiBaseUrl}${game.streams[0].watchPath}`} target="_blank" rel="noreferrer">Stream</a> : <StatusChip status="info" label="Stream" /> : !game.isFinal && game.matchupType === "h2h" ? <Button variant="primary" size="compact" onClick={() => void openWager(game)}>Wager</Button> : game.streams.length ? <a className="btn btn-primary" href={`${apiBaseUrl}${game.streams[0].watchPath}`} target="_blank" rel="noreferrer">Stream</a> : game.isFinal ? <StatusChip status="info" label="Final" /> : null}</div>
                      {isCfbLeague || boxScoreMode ? (
                        game.matchupType === "human_cpu" ? <div className="hub-team-control-rail home"><button disabled={!boxScoreMode || game.isFinal || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div> : <div className="hub-team-control-rail home"><button disabled={!boxScoreMode || game.viewerSide !== "home" || game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button><button disabled={!boxScoreMode || game.viewerSide !== "home" || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div>
                      ) : <div className="hub-team-control-rail home" />}
                    </div>
                    {game.matchupType === "human_cpu" ? null : <>
                      {(() => {
                        const awayStream = game.streams.find((stream) => stream.side === "away");
                        const homeStream = game.streams.find((stream) => stream.side === "home");
                        const streamPanel = (stream: typeof game.streams[number]) => (
                          <div className={`hub-team-stream ${stream.side} live`} key={stream.streamLogId}>
                            <div className="hub-team-stream-head"><span>{stream.side} stream · live</span><a href={`${apiBaseUrl}${stream.watchPath}`} target="_blank" rel="noreferrer">Watch {stream.teamName}</a><small>{stream.viewCount} viewer{stream.viewCount === 1 ? "" : "s"}</small></div>
                          </div>
                        );
                        return <div className="hub-stream-sides">
                          {awayStream ? streamPanel(awayStream) : <div className="hub-team-stream away empty" aria-hidden="true" />}
                          {homeStream ? streamPanel(homeStream) : <div className="hub-team-stream home empty" aria-hidden="true" />}
                        </div>;
                      })()}
                      <div className="hub-game-reaction-bar" aria-label={`Reactions for ${game.awayTeamName} at ${game.homeTeamName}`}>
                        <button aria-label="Love" className={(game.myReactions ?? []).includes("love") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "love")}>{game.reactionCounts.love > 0 && <span>{game.reactionCounts.love}</span>}</button>
                        <button aria-label="Like" className={(game.myReactions ?? []).includes("like") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "like")}>{game.reactionCounts.like > 0 && <span>{game.reactionCounts.like}</span>}</button>
                        <button aria-label="Nominate for Game of the Year" className={`goty${(game.myReactions ?? []).includes("goty") ? " active" : ""}`} onClick={() => void matchupGameReact(game.gameId, "goty")}>{game.reactionCounts.goty > 0 && <span>{game.reactionCounts.goty}</span>}</button>
                        <button aria-label="Dislike" className={(game.myReactions ?? []).includes("dislike") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "dislike")}>{game.reactionCounts.dislike > 0 && <span>{game.reactionCounts.dislike}</span>}</button>
                        <button aria-label="Hate" className={(game.myReactions ?? []).includes("poop") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "poop")}>{game.reactionCounts.poop > 0 && <span>{game.reactionCounts.poop}</span>}</button>
                      </div>
                    </>}
                  </article>
                </div>))}</div> : <p className="hub-empty">No linked-user games are scheduled for Week {schedule.selectedWeek}.</p>}
                {schedule.usersByConference.length > 0 && (() => { const group = schedule.usersByConference[conferenceIndex % schedule.usersByConference.length]; return <div className="hub-conference-carousel"><button className="hub-highlight-arrow" aria-label="Previous conference" onClick={() => setConferenceIndex((conferenceIndex - 1 + schedule.usersByConference.length) % schedule.usersByConference.length)}><ChevronLeft /></button><article><h3>{group.conference}</h3><div>{group.users.map((user) => <span key={user.userId}><strong>{user.teamName}</strong><small>{user.displayName}</small></span>)}</div><p>{conferenceIndex % schedule.usersByConference.length + 1} / {schedule.usersByConference.length}</p></article><button className="hub-highlight-arrow" aria-label="Next conference" onClick={() => setConferenceIndex((conferenceIndex + 1) % schedule.usersByConference.length)}><ChevronRight /></button></div>; })()}
              </>;
              })()}
            </SectionFrame>
          )}
        </>
      )}

    </div>}
      </main>
    </div>

    {potyHighlightId && <Modal title="Play of the Year Nomination" onClose={() => { setPotyHighlightId(null); setPotyCategory(""); }}><div className="hub-poty-modal">
      <p>Select exactly one category. This submission is the only action that counts as a POTY nomination.</p>
      <div>{AWARD_REACTIONS.map((reaction) => <label key={reaction.key} className={potyCategory === reaction.key ? "active" : ""}><input type="radio" name="poty-category" value={reaction.key} checked={potyCategory === reaction.key} onChange={() => setPotyCategory(reaction.key)} /><span>{reaction.label}</span></label>)}</div>
      <Button variant="primary" disabled={!potyCategory} onClick={async () => { if (!potyCategory) return; await highlightReact(potyHighlightId, potyCategory); setPotyHighlightId(null); setPotyCategory(""); }}>Submit Nomination</Button>
    </div></Modal>}
    {activeStory ? (
      <ExpandedArticleView
        stories={headlines}
        activeIndex={activeStoryIndex ?? 0}
        onIndexChange={(index) => setActiveStoryIndex(index)}
        onClose={closeStory}
        comments={comments}
        commentBody={commentBody}
        onCommentBodyChange={setCommentBody}
        onSubmitComment={() => void submitComment()}
        onReact={(storyId, key) => void storyReact(storyId, key)}
        onImageClick={(src) => setLightboxImage(src)}
      />
    ) : null}
    {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    {boxScoreUploadGame && auth.status === "ready" && <UploadBoxScoreModal guildId={auth.guildId} discordId={auth.discordId} weekNumber={boxScoreUploadGame.weekNumber} seasonNumber={hub.league.seasonNumber} gameId={boxScoreUploadGame.gameId} commissionerSubmission={false} requireSecondImage onClose={() => setBoxScoreUploadGame(null)} onSubmitted={async (submissionId) => { const weekNumber = matchupSchedule?.selectedWeek ?? boxScoreUploadGame.weekNumber; setBoxScoreUploadGame(null); setAssignStatsSubmissionId(submissionId); setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber })); }} />}
    {scheduleBoxScoreWeek && scheduleBoxScoreWeek.gameId && auth.status === "ready" && mySchedule && <UploadBoxScoreModal guildId={auth.guildId} discordId={auth.discordId} weekNumber={scheduleBoxScoreWeek.weekNumber} seasonNumber={mySchedule.seasonNumber} gameId={scheduleBoxScoreWeek.gameId} commissionerSubmission={false} requireSecondImage onClose={() => setScheduleBoxScoreWeek(null)} onSubmitted={(submissionId) => { setScheduleBoxScoreWeek(null); setAssignStatsSubmissionId(submissionId); setMySchedule(null); void viewMySchedule(); }} />}
    {assignStatsSubmissionId && auth.status === "ready" && <AssignBoxScoreStatsModal guildId={auth.guildId} submissionId={assignStatsSubmissionId} onClose={() => setAssignStatsSubmissionId(null)} />}
    {shareStreamGame && auth.status === "ready" && <ShareStreamModal guildId={auth.guildId} gameId={shareStreamGame.gameId} onClose={() => setShareStreamGame(null)} onSubmitted={() => { setShareStreamGame(null); setMatchupReloadKey((value) => value + 1); }} />}
    {highlightUploadGame && auth.status === "ready" && <HighlightUploadModal guildId={auth.guildId} gameId={highlightUploadGame.gameId} onClose={() => setHighlightUploadGame(null)} onSubmitted={() => { setHighlightUploadGame(null); setMatchupReloadKey((value) => value + 1); }} />}
    {requestHelpGame && auth.status === "ready" && <RequestHelpSheet matchup={requestHelpGame} guildId={auth.guildId} onClose={() => setRequestHelpGame(null)} onSubmitted={() => setRequestHelpGame(null)} />}
    {scheduleHighlightWeek && scheduleHighlightWeek.gameId && auth.status === "ready" && <HighlightUploadModal guildId={auth.guildId} gameId={scheduleHighlightWeek.gameId} onClose={() => setScheduleHighlightWeek(null)} onSubmitted={() => { setScheduleHighlightWeek(null); setMySchedule(null); void viewMySchedule(); }} />}
    {recruitingBoardOpen && auth.status === "ready" && <RecruitingBoardModal guildId={auth.guildId} viewerUserId={hub.userRatings?.viewerUserId ?? null} canManageLeague={hub.canManageLeague} onClose={() => setRecruitingBoardOpen(false)} />}
    {editRosterOpen && auth.status === "ready" && <EditRosterRequestModal guildId={auth.guildId} onClose={() => setEditRosterOpen(false)} onDone={() => setEditRosterOpen(false)} />}
    {playerStatsGame && <Modal title="Players to Watch" onClose={() => setPlayerStatsGame(null)}><div className="hub-submission-modal">
      {playerStatsNotice && <p className="hub-transfer-status">{playerStatsNotice}</p>}<p className="hub-muted">{playerStatsGame.awayTeamName} at {playerStatsGame.homeTeamName}</p>
      <label className="form-field"><span className="form-label">Player</span><select className="form-input" value={playerStatsDraft.watchedPlayerId} onChange={(event) => { const player = myWatchedPlayers?.find((item) => item.id === event.target.value); setPlayerStatsDraft((current) => ({ ...current, watchedPlayerId: event.target.value, playerName: player?.playerName ?? "" })); }}><option value="">Enter a new player</option>{(myWatchedPlayers ?? []).map((player) => <option key={player.id} value={player.id}>{player.playerName} - {player.position}</option>)}</select></label>
      {!playerStatsDraft.watchedPlayerId && <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={playerStatsDraft.playerName} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, playerName: event.target.value }))} /></label>}
      <label className="form-field"><span className="form-label">Category</span><select className="form-input" value={playerStatsDraft.category} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, category: event.target.value, values: {} }))}>{PLAYER_STAT_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{displayLabel(category)}</option>)}</select></label>
      <div className="hub-submission-grid">{(PLAYER_STAT_FIELDS[playerStatsDraft.category] ?? []).map(([key, label]) => <label className="form-field" key={key}><span className="form-label">{label}</span><input className="form-input" type="number" min="0" value={playerStatsDraft.values[key] ?? ""} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, values: { ...current.values, [key]: event.target.value } }))} /></label>)}</div>
      <Button variant="primary" disabled={playerStatsBusy} onClick={() => void submitPlayerStats()}>{playerStatsBusy ? "Submitting..." : "Submit Player Stats"}</Button>
    </div></Modal>}
    {wagerPanel && <Modal title={`Sportsbook · ${wagerPanel.label}`} panelClassName="hub-wager-slip-modal" hideHeader onClose={() => setWagerPanel(null)}><div className="hub-wager-modal">
      <header className="hub-wager-modal-brand">
        <span>REC League eSports</span>
        <div className="hub-wager-matchup-title">
          <TeamLogo abbreviation={wagerPanel.game.awayTeamAbbr} logoUrl={wagerPanel.game.awayTeamLogoUrl} alt={wagerPanel.game.awayTeamMascot} />
          <strong>{wagerPanel.game.awayTeamAbbr ?? wagerPanel.game.awayTeamName} <em>at</em> {wagerPanel.game.homeTeamAbbr ?? wagerPanel.game.homeTeamName}</strong>
          <TeamLogo abbreviation={wagerPanel.game.homeTeamAbbr} logoUrl={wagerPanel.game.homeTeamLogoUrl} alt={wagerPanel.game.homeTeamMascot} />
        </div>
        <small>Sportsbook</small>
      </header>
      {!wagerPanel.options ? <p className="hub-empty">{wagerPanel.notice ?? "Loading lines..."}</p> : <>
        <label className="form-field hub-wager-game-picker"><span className="form-label">Game</span>
          <select className="form-select" value={wagerPanel.gameId} onChange={(event) => {
            const nextGame = matchupSchedule?.games.find((game) => game.gameId === event.target.value);
            if (nextGame) void openWager(nextGame, wagerPanel.tab);
          }}>
            {(matchupSchedule?.games ?? []).filter((game) => game.matchupType === "h2h" && !game.isFinal && !game.involvesMe && game.wageringOpen).map((game) => <option key={game.gameId} value={game.gameId}>{game.awayTeamName} at {game.homeTeamName}</option>)}
          </select>
        </label>
        <div className="hub-wager-modal-tabs" role="tablist" aria-label="Sportsbook views">
          <button type="button" role="tab" aria-selected={wagerPanel.tab === "slip"} className={wagerPanel.tab === "slip" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, tab: "slip" })}>Build Wager</button>
          <button type="button" role="tab" aria-selected={wagerPanel.tab === "board"} className={wagerPanel.tab === "board" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, tab: "board" })}>Open Wager Board</button>
        </div>
        {wagerPanel.tab === "slip" ? <>
        <div className="hub-wager-mode"><button className={wagerPanel.mode === "single" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "single" })}>House Single</button><button className={wagerPanel.mode === "parlay" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "parlay" })}>3-Pick Parlay</button><button className={wagerPanel.mode === "peer" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "peer" })}>User Wager</button></div>
        {wagerPanel.mode === "parlay" && <p className="hub-muted">Choose exactly three different stat-line Over/Under picks from this game. Each side is a separate selection.</p>}
        <div className="hub-wager-workbench">
          <div className="hub-wager-lines">{wagerPanel.options.markets.filter((market) => wagerPanel.mode !== "parlay" || (!["moneyline", "spread", "total_points"].includes(market.market))).map((market) => {
            const isSelectedMarket = wagerPanel.market === market.market;
            const effectiveLine = market.line;
            return <article key={market.market} className={isSelectedMarket ? "active" : ""}>
              <button onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: market.sides[0]?.pick ?? "" })}><strong>{market.label}</strong><span>{market.line != null ? `Stat line: ${market.line}` : "Pick a winner"}</span></button>
              <div>{market.sides.map((side) => <button key={side.pick} aria-label={`${market.label}: ${side.label}`} className={isSelectedMarket && wagerPanel.pick === side.pick ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: side.pick })}><b>{side.pick === "over" ? `OVER ${effectiveLine ?? ""}` : side.pick === "under" ? `UNDER ${effectiveLine ?? ""}` : side.label}</b><small>{side.label} · {americanFromDecimal(side.odds)}</small></button>)}</div>
            </article>;
          })}</div>
          <div className="hub-wager-ticket-column">
            <WagerSlip panel={wagerPanel} />
            {wagerPanel.mode === "parlay" && <Button variant="secondary" disabled={wagerPanel.parlay.length >= 3 || !wagerPanel.market || !wagerPanel.pick} onClick={addParlayLeg}>Add Selection to Slip · {wagerPanel.parlay.length}/3</Button>}
            {wagerPanel.mode === "peer" && <div className="hub-peer-controls"><select className="form-input" value={wagerPanel.challengeType} onChange={(event) => setWagerPanel({ ...wagerPanel, challengeType: event.target.value as "open" | "direct" })}><option value="open">Post to board</option><option value="direct">Direct challenge</option></select>{wagerPanel.challengeType === "direct" && <select className="form-input" value={wagerPanel.targetUserId} onChange={(event) => setWagerPanel({ ...wagerPanel, targetUserId: event.target.value })}><option value="">Select coach</option>{wagerPanel.coaches.map((coach) => <option key={coach.userId} value={coach.userId}>{coach.teamAbbr} · {coach.conference}</option>)}</select>}</div>}
            <div className="hub-wager-submit"><label className="form-field"><span className="form-label">Stake</span><input className="form-input" type="number" min="1" value={wagerPanel.stake} onChange={(event) => setWagerPanel({ ...wagerPanel, stake: event.target.value })} /></label><Button variant="primary" disabled={wagerPanel.busy || !wagerPanel.market || !wagerPanel.pick || (wagerPanel.mode === "peer" && wagerPanel.challengeType === "direct" && !wagerPanel.targetUserId) || (wagerPanel.mode === "parlay" && wagerPanel.parlay.length !== 3)} onClick={() => void placeWager()}>{wagerPanel.busy ? "Submitting..." : wagerPanel.mode === "peer" ? "Post User Wager" : wagerPanel.mode === "parlay" ? "Place 3-Pick Parlay" : "Place Bet"}</Button></div>
            {wagerPanel.notice && <p className="hub-transfer-status">{wagerPanel.notice}</p>}
          </div>
        </div>
        </> : <div className="hub-peer-board hub-peer-board-tab"><h3>Open Wager Board</h3>{wagerPanel.board.length ? wagerPanel.board.map((wager) => <article key={wager.id}><div><strong>{wager.gameLabel}</strong><span>{displayLabel(wager.market)} · <CoinAmount amount={wager.stake} /> · {displayLabel(wager.challengeType)}</span></div>{wager.canAccept ? <Button variant="secondary" size="compact" disabled={wagerPanel.busy} onClick={() => void acceptPeer(wager.id)}>Accept</Button> : <StatusChip status={wager.isMine ? "pending" : "locked"} label={wager.isMine ? "Your offer" : "Unavailable"} />}</article>) : <p className="hub-empty">No open user wagers yet.</p>}</div>}
      </>}
    </div></Modal>}
    {mediaModal && <Modal title={isRise ? "Interview" : "Interview/Article"} onClose={() => setMediaModal(null)}><div className="hub-media-modal">
      <div className="rec-matchup-tabs" role="tablist" aria-label="Media submission type">
        <button type="button" role="tab" aria-selected={mediaModal === "interview"} className={mediaModal === "interview" ? "active" : ""} onClick={() => { setMediaNotice(null); setMediaModal("interview"); }}>Interview</button>
        {isRise ? null : <button type="button" role="tab" aria-selected={mediaModal === "article"} className={mediaModal === "article" ? "active" : ""} onClick={() => { setMediaNotice(null); setMediaModal("article"); }}>Article</button>}
      </div>
      {mediaModal === "article" && <>
      {mediaNotice && <p className="hub-transfer-status">{mediaNotice}</p>}
      {!mediaPortal ? <p className="hub-empty">Loading media desk...</p> : <>
        <p className="hub-muted">{mediaPortal.limits.articleSubmitted ? `Already submitted this week (${mediaPortal.limits.articleStatus}).` : `Submit one custom article per week for commissioner review. Pays ${coinsNumber(100)} on approval.`}</p>
        <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={mediaArticle.title} disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => setMediaArticle({ ...mediaArticle, title: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Article body</label><div className="hub-rich-text-toolbar" aria-label="Article text formatting"><button type="button" onClick={() => toggleArticleStyle("**")} disabled={mediaPortal.limits.articleSubmitted} aria-label="Bold"><strong>B</strong></button><button type="button" onClick={() => toggleArticleStyle("*")} disabled={mediaPortal.limits.articleSubmitted} aria-label="Italic"><em>I</em></button><button type="button" onClick={() => toggleArticleStyle("__")} disabled={mediaPortal.limits.articleSubmitted} aria-label="Underline"><u>U</u></button></div><textarea ref={mediaArticleBodyRef} className="form-input" rows={7} value={mediaArticle.body} disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => setMediaArticle({ ...mediaArticle, body: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Image</label><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => void uploadMediaImage(event.target.files?.[0] ?? null)} />{mediaArticle.imageUrl && <img className="media-image-preview" src={mediaArticle.imageUrl} alt="" />}</div>
        <Button variant="primary" disabled={mediaBusy || mediaPortal.limits.articleSubmitted || !mediaArticle.title.trim() || !mediaArticle.body.trim()} onClick={() => void submitMediaArticle()}>{mediaBusy ? "Submitting..." : "Submit Article"}</Button>
      </>}
      </>}

      {mediaModal === "interview" && <>
      {mediaNotice && <p className="hub-transfer-status">{mediaNotice}</p>}
      {!mediaPortal ? <p className="hub-empty">Loading media desk...</p> : <>
        <p className="hub-muted">{mediaPortal.limits.interviewSubmitted ? `Already submitted this week (${mediaPortal.limits.interviewStatus}).` : `Pick 3 questions and answer them for commissioner review. Pays ${coinsNumber(50)} on approval.`}</p>
        {interviewAnswers.map((answer, index) => {
          const selectedTopic = answer.questionId ? mediaPortal.questions.find((question) => question.id === answer.questionId)?.topic ?? "" : "";
          const topics = [...new Set(mediaPortal.questions.map((question) => question.topic))];
          const questions = mediaPortal.questions.filter((question) => !selectedTopic || question.topic === selectedTopic);
          const selectedQuestionText = answer.questionId ? mediaPortal.questions.find((question) => question.id === answer.questionId)?.question ?? "" : "";
          return <div className="hub-interview-question" key={index}><strong>Question {index + 1}</strong>
            <select className="form-input" value={selectedTopic} disabled={mediaPortal.limits.interviewSubmitted} onChange={(event) => setInterviewAnswers((current) => current.map((item, i) => i === index ? { ...item, questionId: mediaPortal.questions.find((q) => q.topic === event.target.value)?.id ?? "" } : item))}><option value="">Topic</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select>
            <select className="form-input" value={answer.questionId} disabled={mediaPortal.limits.interviewSubmitted} onChange={(event) => setInterviewAnswers((current) => current.map((item, i) => i === index ? { ...item, questionId: event.target.value } : item))}><option value="">Question</option>{questions.map((question) => <option key={question.id} value={question.id}>{question.question}</option>)}</select>
            {selectedQuestionText && <p className="hub-interview-question-preview">{selectedQuestionText}</p>}
            <textarea className="form-input" rows={3} placeholder="Answer" value={answer.answer} disabled={mediaPortal.limits.interviewSubmitted} onChange={(event) => setInterviewAnswers((current) => current.map((item, i) => i === index ? { ...item, answer: event.target.value } : item))} />
          </div>;
        })}
        <label className="media-toggle"><input type="checkbox" checked={tagOpponent} disabled={!mediaPortal.opponent || mediaPortal.limits.interviewSubmitted} onChange={(event) => setTagOpponent(event.target.checked)} /> Tag weekly H2H opponent{mediaPortal.opponent ? ` (${mediaPortal.opponent.teamName})` : " (no H2H this week)"}</label>
        <Button variant="primary" disabled={mediaBusy || mediaPortal.limits.interviewSubmitted || interviewAnswers.some((answer) => !answer.questionId || !answer.answer.trim())} onClick={() => void submitInterviewForm()}>{mediaBusy ? "Submitting..." : "Submit Interview"}</Button>
      </>}
      </>}
    </div></Modal>}

    {showMySchedule && <Modal title="Full Season Schedule" onClose={() => setShowMySchedule(false)} panelClassName="hub-schedule-modal"><div className="hub-my-schedule">
      {!isCfbLeague && hub.myTeam && (
        <div className="hub-schedule-relocate-row">
          <Button variant="secondary" onClick={() => setRelocateWizardOpen(true)}>Relocate/Custom Team</Button>
        </div>
      )}
      {relocateNotice && <p className="hub-transfer-status">{relocateNotice}</p>}
      <div className="hub-modal-pill-row">
        <button type="button" className={scheduleModalTab === "my" ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => setScheduleModalTab("my")}>My Schedule</button>
        <button type="button" className={scheduleModalTab === "league" ? "hub-modal-pill is-active" : "hub-modal-pill"} onClick={() => { setScheduleModalTab("league"); if (!scheduleLeagueData) void loadScheduleLeagueWeek(); }}>League Schedule</button>
      </div>
      {scheduleModalTab === "my" ? (
        myScheduleError ? <div className="hub-empty"><p>{myScheduleError}</p><Button variant="secondary" onClick={() => { setMySchedule(null); void viewMySchedule(); }}>Try again</Button></div>
        : !mySchedule ? <p className="hub-empty">Loading your schedule...</p>
        // Box score upload is CFB-only (Madden results come from the EA import, not a manual
        // box-score screenshot) — but highlight posting is just video clips, unrelated to how
        // results get recorded, so it's available for both games.
        : <ScheduleWeekList
            weeks={mySchedule.weeks}
            game={mySchedule.game as LeagueGame}
            currentWeek={hub.league.weekNumber}
            highlightCounts={myHighlightCounts ?? undefined}
            onUploadBoxScore={isCfbLeague ? setScheduleBoxScoreWeek : undefined}
          />
      ) : (
        <div className="hub-schedule-league-week">
          <label className="form-field">
            <span className="form-label">Week</span>
            <select className="form-input" value={scheduleLeagueWeek ?? ""} onChange={(event) => void loadScheduleLeagueWeek(Number(event.target.value))} disabled={scheduleLeagueLoading || !scheduleLeagueData}>
              {(scheduleLeagueData?.weekNumbers ?? (scheduleLeagueWeek ? [scheduleLeagueWeek] : [])).map((week) => <option key={week} value={week}>Week {week}</option>)}
            </select>
          </label>
          {scheduleLeagueError ? <div className="hub-empty"><p>{scheduleLeagueError}</p><Button variant="secondary" onClick={() => void loadScheduleLeagueWeek(scheduleLeagueWeek ?? undefined)}>Try again</Button></div>
            : scheduleLeagueLoading || !scheduleLeagueData ? <p className="hub-empty">Loading league schedule...</p>
            : scheduleLeagueData.isOffseason ? <p className="hub-empty">No games this week — the league is in the offseason ({scheduleLeagueData.offseasonStageLabel ?? "Offseason"}).</p>
            : !scheduleLeagueData.games.length ? <p className="hub-empty">No games scheduled for Week {scheduleLeagueData.selectedWeek}.</p>
            : <div className="hub-schedule-week-list-cards">{scheduleLeagueData.games.map((game) => (
                <div key={game.gameId} className="hub-schedule-mini-card">
                  <MatchupCard game={game} showReactions={false} passive />
                  {game.displayStatus === "awaiting_result" && game.homeScore != null && game.awayScore != null ? (
                    <span className="hub-muted hub-score-unofficial">{game.awayScore}-{game.homeScore} (unofficial)</span>
                  ) : null}
                </div>
              ))}</div>}
        </div>
      )}
    </div></Modal>}
    {relocateWizardOpen && auth.status === "ready" && (
      <Modal title="Relocate / Custom Team" onClose={() => setRelocateWizardOpen(false)}>
        <RelocateTeamWizard
          guildId={auth.guildId}
          onApplied={(message) => {
            setRelocateNotice(message);
            setRelocateWizardOpen(false);
            void load();
          }}
        />
      </Modal>
    )}
    {retireModalOpen && <Modal title="Retire from League?" onClose={() => !retireBusy && setRetireModalOpen(false)}><div className="hub-retire-confirm">
      <p>Are you sure you want to retire from this league? Your team will become open, this league will be removed from your available leagues, and you will lose access to it.</p>
      {retireError && <p className="hub-transfer-status">{retireError}</p>}
      <div className="advance-modal-actions"><Button variant="ghost" disabled={retireBusy} onClick={() => setRetireModalOpen(false)}>Cancel</Button><Button variant="danger" disabled={retireBusy} onClick={async () => { setRetireBusy(true); setRetireError(null); try { await hubChrome.retireFromCurrentLeague(); setRetireModalOpen(false); } catch (error) { setRetireError(error instanceof Error ? error.message : "Failed to retire from this league."); } finally { setRetireBusy(false); } }}>{retireBusy ? "Retiring..." : "Confirm Retirement"}</Button></div>
    </div></Modal>}
    {lateSubmissionsOpen && auth.status === "ready" && <LateSubmissionsModal guildId={auth.guildId} currentWeek={hub.league.weekNumber} focus={lateSubmissionsFocus ?? undefined} initialWeek={lateSubmissionsWeek} onClose={() => { setLateSubmissionsOpen(false); setLateSubmissionsFocus(null); setLateSubmissionsWeek(undefined); }} />}
  </div>;
}
