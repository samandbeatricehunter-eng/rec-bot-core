import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CFB_POSITIONS, REC_AGE_RESET_PRICE, REC_CONTRACT_PRICE, REC_CUSTOM_PLAYER_PACKAGE_POINTS, REC_CUSTOM_PLAYER_PACKAGE_PRICE, REC_DEV_UPGRADE_PRICE, REC_LEGEND_PRICE, REC_PLAYER_TRAIT_PRICE, type RecPurchaseType } from "@rec/shared";
import { Award, CalendarDays, ChevronLeft, ChevronRight, Coins, Eye, FileText, GraduationCap, Heart, Landmark, MessageCircle, Mic, Megaphone, Pencil, Play, RefreshCw, ScrollText, ShoppingBag, Sparkles, SlidersHorizontal, Star, ThumbsDown, ThumbsUp, Trash2, TrendingUp, Trophy, UserPlus, UserRound, UsersRound, WalletCards, X } from "lucide-react";
import { AttributePurchaseBuilder } from "../../components/hub/AttributePurchaseBuilder.js";
import { useAuth, useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubMatchupSchedule, HubReactionKey, HubResponse, LinkedTeamRow, MediaPortalResponse, OpenTeam, PeerWagerBoardResponse, StoryComment, StorePurchaseContext, TeamScheduleManualState, WagerOptionsResponse, WatchedPlayer } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";
import { IconWell } from "../../components/design-system/IconWell.js";
import { StatusChip } from "../../components/design-system/StatusChip.js";
import { ExpandedArticleView } from "../../components/hub/ExpandedArticleView.js";
import { EosAwardVotingBlock } from "../../components/hub/EosAwardVotingBlock.js";
import { useSwipeNavigation } from "../../hooks/useSwipeNavigation.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { UploadBoxScoreModal } from "../league-mgmt/manage-league/UploadBoxScoreModal.js";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";

// Highlight reactions are exactly three: Like, Dislike, and POTY. POTY opens the category
// modal (AWARD_REACTIONS) where the user picks one Play-of-the-Year category and submits.
const AWARD_REACTIONS: Array<{ key: HubReactionKey; label: string }> = [
  { key: "TOTY", label: "Throw of the Year" }, { key: "COTY", label: "Catch of the Year" }, { key: "ROTY", label: "Run of the Year" },
  { key: "IOTY", label: "Interception of the Year" }, { key: "HOTY", label: "Hit of the Year" }, { key: "MVP_PLAY", label: "Most Valuable Play" },
];
const COMMUNITY_REACTION_KEYS: HubReactionKey[] = ["like", "dislike"];
const AWARD_KEYS = AWARD_REACTIONS.map((reaction) => reaction.key);
const PLAYER_STAT_FIELDS: Record<string, Array<[string, string]>> = {
  passing: [["completions", "Completions"], ["attempts", "Attempts"], ["yards", "Passing yards"], ["touchdowns", "Passing touchdowns"], ["interceptions", "Interceptions"]],
  rushing: [["carries", "Carries"], ["yards", "Rushing yards"], ["touchdowns", "Rushing touchdowns"], ["fumbles", "Fumbles"], ["longest", "Longest rush"]],
  receiving: [["receptions", "Receptions"], ["yards", "Receiving yards"], ["touchdowns", "Receiving touchdowns"], ["drops", "Drops"], ["longest", "Longest reception"]],
  defense: [["tackles", "Total tackles"], ["tfl", "Tackles for loss"], ["sacks", "Sacks"], ["interceptions", "Interceptions"], ["forced_fumbles", "Forced fumbles"]],
  kick_returns: [["returns", "Kick returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  punt_returns: [["returns", "Punt returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  kicking: [["fg_made", "Field goals made"], ["fg_attempted", "Field goals attempted"], ["longest", "Longest field goal"], ["xp_made", "Extra points made"], ["xp_attempted", "Extra points attempted"]],
  punting: [["punts", "Punts"], ["yards", "Punt yards"], ["average", "Average"], ["inside_20", "Inside the 20"], ["touchbacks", "Touchbacks"]],
};
const PLAYER_STAT_CATEGORY_OPTIONS = Object.keys(PLAYER_STAT_FIELDS);
const STORE_PRODUCT_ICONS: Partial<Record<RecPurchaseType, typeof ShoppingBag>> = {
  age_reset: RefreshCw,
  dev_upgrade: TrendingUp,
  contract: ScrollText,
  player_trait: Sparkles,
  attribute: SlidersHorizontal,
  legend: Star,
  custom_player: UserPlus,
};
const STORE_PRODUCT_PRICE_LABEL: Record<RecPurchaseType, string> = {
  age_reset: `$${REC_AGE_RESET_PRICE}`,
  dev_upgrade: `$${REC_DEV_UPGRADE_PRICE.star}–$${REC_DEV_UPGRADE_PRICE.xfactor}`,
  contract: `$${REC_CONTRACT_PRICE.salary_bonus_reduction}`,
  player_trait: `$${REC_PLAYER_TRAIT_PRICE}`,
  attribute: "$50–$100/pt",
  legend: `$${REC_LEGEND_PRICE}`,
  custom_player: `$${REC_CUSTOM_PLAYER_PACKAGE_PRICE.bronze}–$${REC_CUSTOM_PLAYER_PACKAGE_PRICE.gold}`,
};
type Story = HubResponse["headlines"][number];
type HubSection = "league" | "store" | "team" | "wagers" | "openTeams" | "schedules";
type LeagueSubTab = "buzz" | "matchups";
type MatchupView = "h2h" | "cpu" | "rankings";

const HUB_SECTIONS = new Set<HubSection>(["league", "store", "team", "wagers", "openTeams", "schedules"]);
const LEAGUE_SUB_TABS = new Set<LeagueSubTab>(["buzz", "matchups"]);

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
  gameId: string;
  label: string;
  options: WagerOptionsResponse | null;
  mode: WagerMode;
  market: string;
  pick: string;
  stake: string;
  parlay: WagerLeg[];
  challengeType: "open" | "direct";
  targetUserId: string;
  coaches: Array<{ userId: string; discordId: string | null; teamAbbr: string; conference: string }>;
  board: Array<{ id: string; gameId: string; gameLabel: string; challengeType: string; market: string; pick: string; line: number | null; odds: number; stake: number; potentialPayout: number; placedByDiscordId: string; isMine: boolean; canAccept: boolean; createdAt: string }>;
  notice: string | null;
  busy: boolean;
};

function displayLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const BAKED_BADGE_KEYS = new Set([
  "prolific_passer", "prolific_rusher", "balanced_season", "fourth_down_menace", "dawgin_em", "two_point_identity", "clock_bleeder",
  "perfect_regular_season", "winning_season", "return_threat", "veteran_coach", "fourth_down_legend", "red_zone_legend", "ground_and_pound_veteran",
  "air_raid_veteran", "playoff_winner", "dynasty_builder", "super_bowl_champion", "conf_champion", "div_champion", "national_champion", "bowl_winner",
]);
const BAKED_LADDER_KEYS = new Set(["wins_milestone", "games_milestone", "air_milestone", "ground_milestone", "earner", "spender", "saver", "attribute_purchase", "dev_upgrade_purchase"]);
const BAKED_NEGATIVE_KEYS = new Set([
  "turnover_trouble", "heartbreaker", "offensive_stall", "ground_game_missing", "chain_stalled", "third_down_drought_m", "red_zone_woes", "defensive_collapse",
  "yardage_flood", "blowout_victim_m", "pick_parade", "butterfingers", "completion_crisis", "failed_attempts", "third_down_drought", "fourth_down_futility",
  "ground_game_grounded", "passing_in_mud", "inefficient_attack", "flag_factory", "punt_party", "red_zone_waste", "touchdown_drought", "wasted_volume", "blowout_victim",
]);

function badgeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function bakedBadgeAsset(key: string, label: string, tier: string) {
  if (BAKED_BADGE_KEYS.has(key)) return `/assets/badges/baked/${badgeSlug(key)}.png`;
  if (BAKED_LADDER_KEYS.has(key)) return `/assets/badges/baked/label-${badgeSlug(label)}-${tier === "gold" || tier === "silver" ? tier : "bronze"}.png`;
  if (BAKED_NEGATIVE_KEYS.has(key)) return `/assets/badges/baked/label-${badgeSlug(label)}-negative.png`;
  return `/assets/badges/baked/label-${badgeSlug(label)}-positive.png`;
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
  return String(game ?? "League").replaceAll("_", " ").replace(/\bcfb\b/ig, "CFB").toUpperCase();
}

function leagueTimelineLabel(league: HubResponse["league"]) {
  const stage = String(league.seasonStage ?? "regular_season");
  const stageLabel = displayLabel(stage);
  const weekLabel = stage === "regular_season" ? `Week ${league.weekNumber}` : stageLabel;
  return `Season ${league.seasonNumber} · ${weekLabel}`;
}

function ProfileStats({ values }: { values: Record<string, unknown> | null | undefined }) {
  const hidden = new Set(["userId", "leagueId", "seasonNumber"]);
  const rows = Object.entries(values ?? {}).filter(([key, value]) => !hidden.has(key) && value != null && typeof value !== "object");
  return rows.length ? <div className="hub-profile-stat-list">{rows.map(([key, value]) => <div key={key}><span>{displayLabel(key)}</span><strong>{typeof value === "number" ? value.toLocaleString() : String(value)}</strong></div>)}</div> : <p className="hub-empty">No stats recorded yet.</p>;
}

function scheduleResultLabel(week: TeamScheduleManualState["weeks"][number]) {
  const result = week.result;
  if (!result || result.homeScore == null || result.awayScore == null) return null;
  const teamScore = week.confirmedHomeAway === "home" ? result.homeScore : result.awayScore;
  const opponentScore = week.confirmedHomeAway === "home" ? result.awayScore : result.homeScore;
  if (result.isTie || teamScore === opponentScore) return `Tie ${teamScore}-${opponentScore}`;
  return `${teamScore > opponentScore ? "W" : "L"} ${teamScore}-${opponentScore}`;
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
      <Button variant="primary" disabled={busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Name It"}</Button>
    </div>
    {error && <p className="hub-schedule-missing">{error}</p>}
  </div>;
}

function FinancialLedger({ summary }: { summary: any }) {
  const last30 = summary?.last30Days;
  const league = summary?.league;
  return <div className="hub-financial-ledger">
    {league && <div className="hub-profile-stat-list">
      <div><span>Total Earned</span><strong>${Number(league.totalEarned ?? 0).toLocaleString()}</strong></div>
      <div><span>Total Spent</span><strong>${Number(league.totalSpent ?? 0).toLocaleString()}</strong></div>
      <div><span>Profit / Deficit</span><strong>{Number(league.profitDeficit ?? 0) >= 0 ? "+" : "-"}${Math.abs(Number(league.profitDeficit ?? 0)).toLocaleString()}</strong></div>
    </div>}
    <h4>Last 30 Days</h4>
    {!last30 ? <p className="hub-empty">No recent activity.</p> : <>
      <div className="hub-profile-stat-list hub-ledger-summary">
        <div><span>Income</span><strong className="hub-ledger-positive">+${Number(last30.totalIncome ?? 0).toLocaleString()}</strong></div>
        <div><span>Expenses</span><strong className="hub-ledger-negative">-${Number(last30.totalExpenses ?? 0).toLocaleString()}</strong></div>
        <div><span>Net Cash Flow</span><strong className={Number(last30.netCashFlow ?? 0) >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}>{Number(last30.netCashFlow ?? 0) >= 0 ? "+" : "-"}${Math.abs(Number(last30.netCashFlow ?? 0)).toLocaleString()}</strong></div>
      </div>
      {!last30.transactions?.length ? <p className="hub-empty">No transactions in the last 30 days.</p> : <div className="hub-ledger-list">
        {last30.transactions.map((tx: any) => <div key={tx.id} className="hub-ledger-row">
          <div><strong>{tx.description ?? displayLabel(tx.transactionType ?? "transaction")}</strong><span className="hub-muted">{new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
          <strong className={tx.amount >= 0 ? "hub-ledger-positive" : "hub-ledger-negative"}>{tx.amount >= 0 ? "+" : "-"}${Math.abs(tx.amount).toLocaleString()}</strong>
        </div>)}
      </div>}
    </>}
  </div>;
}

function LegacyBadgeShelf({ title, badges }: { title: string; badges: any[] }) {
  return <div className="hub-badge-group"><h4>{title}</h4>{badges?.length ? <div className="hub-badge-shelf">{badges.map((badge) => { const seasonCount = Number(badge.season_earned_count ?? badge.earned_count ?? badge.earned_value ?? 0); const tooltipParts = [badge.badge_description ?? "Badge qualification met", `Earned this season: ${seasonCount}`, `Current league: ${Number(badge.league_earned_count ?? 0)}`]; if (badge.last_earned_week) tooltipParts.push(`Last earned Week ${badge.last_earned_week}`); const tooltip = tooltipParts.join(" · "); return <article key={badge.badge_key} className={`badge-key-${String(badge.badge_key).replaceAll("_", "-")} badge-tier-${String(badge.tier ?? "normal").replaceAll("_", "-")}`} data-tooltip={tooltip} aria-label={badge.badge_label ?? displayLabel(badge.badge_key ?? "Badge")} tabIndex={0} />; })}</div> : <p className="hub-empty">None earned yet.</p>}</div>;
}

function BadgeShelf({ title, badges }: { title: string; badges: any[] }) {
  return <div className="hub-badge-group"><h4>{title}</h4>{badges?.length ? <div className="hub-badge-shelf">{badges.map((badge) => {
    const key = String(badge.badge_key ?? "badge");
    const label = String(badge.badge_label ?? displayLabel(key));
    const tier = String(badge.tier ?? "normal").replaceAll("_", "-");
    const seasonCount = Number(badge.season_earned_count ?? badge.earned_count ?? badge.earned_value ?? 0);
    const tooltipParts = [badge.badge_description ?? "Badge qualification met", `Earned this season: ${seasonCount}`, `Current league: ${Number(badge.league_earned_count ?? 0)}`];
    if (badge.last_earned_week) tooltipParts.push(`Last earned Week ${badge.last_earned_week}`);
    const tooltip = tooltipParts.join(" Â· ");
    return <article key={`${key}-${tier}`} className={`badge-key-${key.replaceAll("_", "-")} badge-tier-${tier}`} style={{ backgroundImage: `url("${bakedBadgeAsset(key, label, tier)}")` }} data-badge-label={label} data-tooltip={tooltip} aria-label={label} tabIndex={0} />;
  })}</div> : <p className="hub-empty">None earned yet.</p>}</div>;
}

function ScheduleWeekList({ weeks }: { weeks: TeamScheduleManualState["weeks"] }) {
  return <div className="hub-schedule-week-list">
    {weeks.map((week) => {
      const resultLabel = scheduleResultLabel(week);
      return <article key={week.weekNumber} className={`hub-schedule-week ${week.alreadyConfirmed ? (week.confirmedMatchupType ?? "cpu") : week.isBye ? "bye" : "missing"}`}>
      <span className="hub-schedule-week-label">Week {week.weekNumber}</span>
      {week.alreadyConfirmed ? <>
        <strong>{week.confirmedHomeAway === "home" ? "vs" : "at"} {week.confirmedOpponentName}</strong>
        <StatusChip status={week.confirmedMatchupType === "h2h" ? "info" : "locked"} label={week.confirmedMatchupType === "h2h" ? "H2H" : "CPU"} />
        {resultLabel ? <b className="hub-final-score">{resultLabel}</b> : <span className="hub-muted">Not yet played</span>}
      </> : week.isBye ? <strong>Bye Week</strong> : <strong className="hub-schedule-missing">Missing Matchup</strong>}
    </article>;
    })}
  </div>;
}
export function HubHome() {
  const auth = useAuth();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hub, setHub] = useState<HubResponse | null>(null);
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
  const [wagerPanel, setWagerPanel] = useState<WagerPanel | null>(null);
  const [wagersBoard, setWagersBoard] = useState<PeerWagerBoardResponse["wagers"] | null>(null);
  const [wagersBoardBusy, setWagersBoardBusy] = useState(false);
  const [wagersBoardNotice, setWagersBoardNotice] = useState<string | null>(null);
  const [closeWagersOpen, setCloseWagersOpen] = useState(false);
  const [closeWagerGameIds, setCloseWagerGameIds] = useState<Set<string>>(new Set());
  const [wagerBoardIndex, setWagerBoardIndex] = useState(0);
  const [conferenceIndex, setConferenceIndex] = useState(0);
  const [mediaPortal, setMediaPortal] = useState<MediaPortalResponse | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [mediaModal, setMediaModal] = useState<"article" | "interview" | null>(null);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaArticle, setMediaArticle] = useState({ title: "", body: "", imageUrl: "" });
  const [boxScoreUploadGame, setBoxScoreUploadGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [playerStatsGame, setPlayerStatsGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [myWatchedPlayers, setMyWatchedPlayers] = useState<WatchedPlayer[] | null>(null);
  const [playerStatsDraft, setPlayerStatsDraft] = useState({ playerName: "", watchedPlayerId: "", category: "passing", values: {} as Record<string, string> });
  const [playerStatsNotice, setPlayerStatsNotice] = useState<string | null>(null);
  const [playerStatsBusy, setPlayerStatsBusy] = useState(false);
  const [recruitModalOpen, setRecruitModalOpen] = useState(false);
  const [recruitDraft, setRecruitDraft] = useState<{ playerName: string; position: string; starRating: string; homeCity: string; homeState: string }>({ playerName: "", position: CFB_POSITIONS[0] ?? "ATH", starRating: "3", homeCity: "", homeState: "" });
  const [recruitNotice, setRecruitNotice] = useState<string | null>(null);
  const [recruitBusy, setRecruitBusy] = useState(false);
  const [interviewAnswers, setInterviewAnswers] = useState([
    { questionId: "", answer: "" },
    { questionId: "", answer: "" },
    { questionId: "", answer: "" },
  ]);
  const [tagOpponent, setTagOpponent] = useState(false);
  const [showMySchedule, setShowMySchedule] = useState(false);
  const [mySchedule, setMySchedule] = useState<TeamScheduleManualState | null>(null);
  const [myScheduleError, setMyScheduleError] = useState<string | null>(null);
  const [linkedTeams, setLinkedTeams] = useState<LinkedTeamRow[] | null>(null);
  const [teamScheduleTeamId, setTeamScheduleTeamId] = useState<string | null>(null);
  const [teamSchedule, setTeamSchedule] = useState<TeamScheduleManualState | null>(null);
  const [teamScheduleError, setTeamScheduleError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [potyHighlightId, setPotyHighlightId] = useState<string | null>(null);
  const [potyCategory, setPotyCategory] = useState<HubReactionKey | "">("");
  const [storyCarouselIndex, setStoryCarouselIndex] = useState(0);
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
  const [storeContext, setStoreContext] = useState<StorePurchaseContext | null>(null);
  const [openTeams, setOpenTeams] = useState<OpenTeam[] | null>(null);
  const [openTeamsError, setOpenTeamsError] = useState<string | null>(null);
  const viewedHighlights = useRef(new Set<string>());

  const highlightCount = hub?.highlights.length ?? 0;
  const activeHighlightIndex = highlightCount ? highlightIndex % highlightCount : 0;
  const highlightSwipe = useSwipeNavigation({ itemCount: highlightCount, onIndexChange: setHighlightIndex });
  useEffect(() => { highlightSwipe.setCurrentIndex(activeHighlightIndex); }, [activeHighlightIndex]);

  useEffect(() => {
    const nextSection = parseHubSection(searchParams.get("section"));
    const rawSub = searchParams.get("subTab");
    const nextSubTab = parseLeagueSubTab(rawSub);
    if (nextSection) setSection(nextSection);
    if (nextSubTab) setSubTab(nextSubTab);
    if (rawSub === "rankings" || searchParams.get("matchupView") === "rankings") {
      setMatchupView("rankings");
    }
    if (nextSection === "team" || nextSection === "store" || nextSection === "wagers" || nextSection === "openTeams" || nextSection === "schedules") {
      setSection(nextSection);
    } else if (nextSection === "league" || nextSubTab) {
      setSection("league");
    }
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

  const headlineCount = hub?.headlines.length ?? 0;
  const currentWeekStoryIndexes = useMemo(() => {
    const stories = hub?.headlines ?? [];
    const currentWeek = hub?.league.weekNumber;
    const indexes = stories.map((story, index) => story.week === currentWeek ? index : -1).filter((index) => index >= 0);
    return indexes.length ? indexes : stories.map((_, index) => index);
  }, [hub?.headlines, hub?.league.weekNumber]);
  const mobileStorySwipe = useSwipeNavigation({ itemCount: headlineCount, onIndexChange: (index) => setStoryCarouselIndex(index) });
  useEffect(() => {
    if (!headlineCount) return;
    const firstCurrent = currentWeekStoryIndexes[0] ?? 0;
    setStoryCarouselIndex((current) => current < headlineCount ? current : firstCurrent);
  }, [headlineCount, currentWeekStoryIndexes]);
  useEffect(() => { mobileStorySwipe.setCurrentIndex(storyCarouselIndex); }, [storyCarouselIndex]);
  useEffect(() => {
    if (subTab !== "buzz" || headlineCount <= 1 || mobileStorySwipe.isDragging) return;
    const timer = window.setInterval(() => {
      setStoryCarouselIndex((current) => (current + 1) % headlineCount);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [subTab, headlineCount, mobileStorySwipe.isDragging]);

  async function load() {
    if (auth.status !== "ready") return;
    try { setHub(await recApi.getHub(auth.guildId)); setError(null); setSetupAccess(null); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A 404 here means no league is linked to this Discord server yet — not a real
      // error. Check whether this viewer can run First-Time Setup instead of showing
      // a dead-end error screen.
      if (message.includes("404")) {
        try { setSetupAccess(await recApi.getHubBootstrapStatus(auth.guildId)); }
        catch { setSetupAccess({ leagueExists: false, canSetup: false }); }
        setError(null);
      } else {
        setError(message);
      }
    }
  }
  useEffect(() => { void load(); }, [auth.status, auth.status === "ready" ? auth.guildId : null]);

  useEffect(() => {
    if (auth.status !== "ready" || (subTab !== "matchups" && section !== "wagers")) return;
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
    if (auth.status !== "ready" || section !== "wagers") return;
    recApi.getPeerWagerBoard(auth.guildId).then((result) => setWagersBoard(result.wagers)).catch(() => setWagersBoard([]));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, section]);

  useEffect(() => {
    if (auth.status !== "ready" || section !== "team" || mediaPortal) return;
    recApi.getHubMediaPortal(auth.guildId).then(setMediaPortal).catch(() => setMediaPortal(null));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, section, mediaPortal]);

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
    const mutuallyExclusive = COMMUNITY_REACTION_KEYS.includes(reactionKey) ? COMMUNITY_REACTION_KEYS : AWARD_KEYS;
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
  async function matchupGameReact(gameId: string, reactionKey: "love" | "like" | "goty" | "dislike" | "poop") {
    if (auth.status !== "ready") return;
    setMatchupSchedule((current) => current ? { ...current, games: current.games.map((game) => {
      if (game.gameId !== gameId) return game;
      const counts = { ...game.reactionCounts };
      const isSame = game.myReactions.includes(reactionKey);
      if (isSame) {
        counts[reactionKey] = Math.max(0, counts[reactionKey] - 1);
        return { ...game, myReactions: game.myReactions.filter((key) => key !== reactionKey), reactionCounts: counts };
      }
      let nextReactions = [...game.myReactions];
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
      setHub((current) => current ? { ...current, highlights: current.highlights.map((highlight) => highlight.id === highlightId ? { ...highlight, viewCount: result.viewCount } : highlight) } : current);
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
  async function loadStoreContext() {
    if (auth.status !== "ready" || storeContext) return;
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
    try { setMySchedule(await recApi.getMyTeamSchedule(auth.guildId)); }
    catch (cause) { setMyScheduleError(cause instanceof Error ? cause.message : "Your schedule could not be loaded."); }
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
  async function submitPurchase(overrideDetails?: Record<string, unknown>) {
    if (auth.status !== "ready" || !purchaseType) return;
    setPurchaseBusy(true); setPurchaseStatus(null);
    try {
      const details: Record<string, unknown> = overrideDetails ?? { ...purchaseDetails };
      if (purchaseType === "legend") {
        await recApi.purchaseHubLegend({ guildId: auth.guildId, legendId: purchaseDetails.legendId, replacePlayerRequest: purchaseDetails.replacePlayerRequest });
      } else {
        await recApi.createMyPurchase({ guildId: auth.guildId, purchaseType, details });
      }
      setPurchaseStatus("Purchase submitted. Funds were reserved and a commissioner has been notified for approval.");
      setPurchaseDetails({}); setStoreContext(null); await load();
    } catch (cause) { setPurchaseStatus(cause instanceof Error ? cause.message : "Purchase failed."); }
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

  async function submitRecruitCommit() {
    if (auth.status !== "ready") return;
    setRecruitBusy(true); setRecruitNotice(null);
    try {
      await recApi.submitRecruitCommit({ guildId: auth.guildId, playerName: recruitDraft.playerName.trim(), position: recruitDraft.position, starRating: Number(recruitDraft.starRating), homeCity: recruitDraft.homeCity.trim(), homeState: recruitDraft.homeState.trim() });
      setRecruitDraft({ playerName: "", position: CFB_POSITIONS[0] ?? "ATH", starRating: "3", homeCity: "", homeState: "" });
      setRecruitNotice("Recruit commit submitted.");
    } catch (cause) { setRecruitNotice(cause instanceof Error ? cause.message : "Recruit commit failed."); }
    finally { setRecruitBusy(false); }
  }

  async function voteGotw(selectedTeamId: string) {
    if (auth.status !== "ready" || !matchupSchedule?.gotw) return;
    await recApi.voteGameOfWeek({ guildId: auth.guildId, pollId: matchupSchedule.gotw.pollId, selectedTeamId });
    setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupSchedule.selectedWeek }));
  }

  async function closeGotw() {
    if (auth.status !== "ready" || !matchupSchedule?.gotw) return;
    await recApi.closeGameOfWeekVoting({ guildId: auth.guildId, pollId: matchupSchedule.gotw.pollId });
    setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: matchupSchedule.selectedWeek }));
  }

  async function openWager(game: HubMatchupSchedule["games"][number]) {
    if (auth.status !== "ready") return;
    const label = `${game.awayTeamName} at ${game.homeTeamName}`;
    setWagerPanel({ gameId: game.gameId, label, options: null, mode: "single", market: "", pick: "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: [], board: [], notice: null, busy: true });
    try {
      const [options, board, coaches] = await Promise.all([
        recApi.getWagerOptions({ guildId: auth.guildId, gameId: game.gameId }),
        recApi.getPeerWagerBoard(auth.guildId),
        recApi.listChallengeableCoaches(auth.guildId),
      ]);
      const firstMarket = options.markets[0];
      setWagerPanel({ gameId: game.gameId, label, options, mode: "single", market: firstMarket?.market ?? "", pick: firstMarket?.sides[0]?.pick ?? "", stake: "25", parlay: [], challengeType: "open", targetUserId: "", coaches: coaches.coaches, board: board.wagers, notice: null, busy: false });
    } catch (cause) {
      setWagerPanel((current) => current ? { ...current, notice: cause instanceof Error ? cause.message : "Lines unavailable.", busy: false } : current);
    }
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
        message = `Parlay placed. Potential payout $${Number(result.payout ?? 0).toLocaleString()}.`;
      } else if (wagerPanel.mode === "peer") {
        const result = await recApi.placePeerWager({ guildId: auth.guildId, gameId: wagerPanel.gameId, market: wagerPanel.market, pick: wagerPanel.pick, stake: Math.floor(stake), challengeType: wagerPanel.challengeType, targetUserId: wagerPanel.challengeType === "direct" ? wagerPanel.targetUserId : null });
        message = `Peer wager posted. Pot payout $${Number(result.payout ?? 0).toLocaleString()}.`;
      } else {
        const result = await recApi.placeHouseWager({ guildId: auth.guildId, gameId: wagerPanel.gameId, market: wagerPanel.market, pick: wagerPanel.pick, stake: Math.floor(stake) });
        message = `House wager placed. Potential payout $${Number(result.payout ?? 0).toLocaleString()}.`;
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
    setWagersBoardBusy(true);
    try {
      await recApi.cancelMyWager({ guildId: auth.guildId, wagerId });
      setWagersBoard((current) => (current ?? []).filter((wager) => wager.id !== wagerId));
      setWagersBoardNotice("Wager removed and the held stake was refunded.");
    } catch (cause) { setWagersBoardNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWagersBoardBusy(false); }
  }

  async function closeGameWagers(gameId: string) {
    if (auth.status !== "ready") return;
    setWagersBoardBusy(true);
    try {
      const result = await recApi.closeGameWagering({ guildId: auth.guildId, gameId });
      setWagersBoard((current) => (current ?? []).filter((wager) => wager.gameId !== gameId));
      setWagersBoardNotice(`Wagering closed${result.refundedCount ? `; ${result.refundedCount} open offer(s) refunded` : ""}.`);
    } catch (cause) { setWagersBoardNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWagersBoardBusy(false); }
  }

  function openCloseWagersModal() {
    setCloseWagerGameIds(new Set((matchupSchedule?.games ?? []).filter((game) => game.matchupType === "h2h" && !game.wageringOpen).map((game) => game.gameId)));
    setCloseWagersOpen(true);
  }

  async function submitClosedWagers() {
    const games = (matchupSchedule?.games ?? []).filter((game) => game.matchupType === "h2h" && game.wageringOpen && closeWagerGameIds.has(game.gameId));
    for (const game of games) await closeGameWagers(game.gameId);
    setCloseWagersOpen(false);
    setMatchupReloadKey((value) => value + 1);
  }

  if (error) return <div className="hub-state"><h1>League Hub</h1><p>{error}</p><button className="btn btn-primary" onClick={() => void load()}>Try again</button></div>;
  if (setupAccess && !setupAccess.leagueExists) return <div className="hub-state">
    <h1>Welcome to REC League</h1>
    {setupAccess.canSetup ? <>
      <p>This Discord server doesn't have a league set up yet. Run First-Time Setup to create one — once it's done, this page becomes your league's normal Hub.</p>
      <Link className="btn btn-primary" to="/league-mgmt/first-time-setup">First Time Setup</Link>
    </> : <p>This Discord server doesn't have a league set up yet. Ask a server admin or commissioner to run First-Time Setup.</p>}
  </div>;
  if (!hub) return <div className="hub-state"><h1>Loading League Hub…</h1></div>;
  const my = hub.myTeam?.display ?? {};
  const profile = hub.myTeam?.profile ?? {};
  const heroRank = profile.powerRank?.rank ? `#${profile.powerRank.rank}` : "Unranked";
  const powerRankScore = profile.powerRank?.score != null ? `Score ${Number(profile.powerRank.score).toFixed(3)}` : "Pending";
  const powerRankSos = profile.powerRank?.sosScore != null ? `SOS ${Number(profile.powerRank.sosScore).toFixed(3)}` : "SOS --";
  const heroRecord = profile.seasonRecord?.text ?? my.leagueSeasonRecordText ?? "0-0-0";
  const heroStreak = profile.seasonRecord?.activeStreak ?? "—";
  const heroDifferential = Number(my.leagueSeasonPointDifferential ?? profile.seasonRecord?.pointDifferential ?? 0);
  const heroGotw = my.gotwStatus && !["No", "Not GOTW"].includes(String(my.gotwStatus)) ? String(my.gotwStatus) : "";
  const heroTeam = profile.teamName ?? my.teamName ?? "No team linked";
  const heroSchool = my.schoolName ?? profile.schoolName ?? my.teamName ?? profile.teamName ?? "School unavailable";
  const viewerCoach = hub.coachRatings?.teams?.find((team) => team.teamId === hub.coachRatings?.viewerTeamId);
  const viewerUser = hub.userRatings?.users?.find((user) => user.userId === hub.userRatings?.viewerUserId);
  const heroCoachScore = viewerCoach
    ? (hub.coachRatings?.displayAsGrade ? viewerCoach.grade : viewerCoach.rating.toFixed(1))
    : "—";
  const heroUserScore = viewerUser
    ? (hub.userRatings?.displayAsGrade ? viewerUser.grade : viewerUser.rating.toFixed(1))
    : "—";
  const heroCoachMeta = viewerCoach ? `#${viewerCoach.rank} · ${viewerCoach.record}` : "Pending";
  const heroUserMeta = viewerUser
    ? `#${viewerUser.rank}${viewerUser.teamName ? ` · ${viewerUser.teamName}` : ""}`
    : "Pending";
  const activeHighlight = hub.highlights[activeHighlightIndex] ?? null;
  const activeStory = activeStoryIndex != null ? hub.headlines[activeStoryIndex] ?? null : null;
  const openTeamsByConference = (openTeams ?? []).reduce<Record<string, OpenTeam[]>>((groups, team) => {
    const conference = team.conference || "Other";
        (groups[conference] ??= []).push(team);
    return groups;
  }, {});
  const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;

  return <div className="hub-page">
    <section className="hub-hero">
      <div className="hub-hero-main"><p className="hub-eyebrow">{leagueTimelineLabel(hub.league)}</p><h1>{hub.league.name}</h1><p>{gameLabel(hub.league.game)} · {displayLabel(String(hub.league.seasonStage))}</p></div>
      <aside className="hub-hero-snapshot">
        <div className="hub-hero-matchup"><span>This week</span><strong>{my.currentMatchupText ?? "No matchup"}</strong>{heroGotw && <small>{heroGotw}</small>}</div>
        <div className="hub-hero-team"><span>Team</span><strong>{heroTeam}</strong><small>School: {heroSchool}</small></div>
        <div className="hub-hero-metrics">
          <article><span>Record</span><strong>{heroRecord}</strong><small>{heroDifferential >= 0 ? "+" : ""}{heroDifferential} diff</small></article>
          <article><span>Streak</span><strong>{heroStreak}</strong><small>Current W/L</small></article>
          <article><span>Power Rank</span><strong>{heroRank}</strong><small>{profile.powerRank?.rank ? `${powerRankScore} · ${powerRankSos}` : "Pending"}</small></article>
          <article><span>Coach Score</span><strong>{heroCoachScore}</strong><small>{heroCoachMeta}</small></article>
          <article><span>User Score</span><strong>{heroUserScore}</strong><small>{heroUserMeta}</small></article>
          <article><span>Wallet</span><strong>${Number(my.wallet ?? 0).toLocaleString()}</strong><small>Savings ${Number(my.savings ?? 0).toLocaleString()}</small></article>
        </div>
      </aside>
    </section>
    <div className="hub-body">
      <main className="hub-content">
    {section === "openTeams" ? <section className="hub-section hub-open-teams-page"><div className="hub-section-heading"><div><p className="hub-eyebrow">Available programs</p><h2>Open Teams</h2><p>Unlinked members can request one of these programs from their Discord Hub link.</p></div></div>{openTeamsError ? <div className="hub-empty"><p>{openTeamsError}</p><Button variant="secondary" onClick={() => { setOpenTeams(null); void viewOpenTeams(); }}>Try again</Button></div> : openTeams === null ? <p className="hub-empty">Loading available teams...</p> : openTeams.length === 0 ? <p className="hub-empty">All teams are currently assigned.</p> : <div className="hub-open-team-conferences">{Object.entries(openTeamsByConference).map(([conference, teams]) => <section key={conference}><h3>{conference}</h3><div>{teams.map((team) => <article key={team.id}><UsersRound size={17} /><span><strong>{team.name}</strong>{team.division && team.division !== "Teams" ? <small>{team.division}</small> : null}</span></article>)}</div></section>)}</div>}</section> : section === "schedules" ? <section className="hub-section hub-team-schedules-page"><div className="hub-section-heading"><div><p className="hub-eyebrow">League calendar</p><h2>Team Schedules</h2><p>Select a linked team to view its complete season.</p></div></div><label className="form-field"><span className="form-label">Team</span><select className="form-input" value={teamScheduleTeamId ?? ""} onChange={(event) => { if (event.target.value) void loadTeamSchedule(event.target.value); }}><option value="">{linkedTeams === null ? "Loading teams..." : "Select a team"}</option>{(linkedTeams ?? []).filter((row) => row.team).map((row) => <option key={row.team!.id} value={row.team!.id}>{row.team!.name} · {row.user?.display_name ?? "Coach"}</option>)}</select></label>{teamScheduleError ? <div className="hub-empty"><p>{teamScheduleError}</p></div> : !teamScheduleTeamId ? <p className="hub-empty">Pick a linked team to view its season schedule.</p> : !teamSchedule ? <p className="hub-empty">Loading schedule...</p> : <ScheduleWeekList weeks={teamSchedule.weeks} />}</section> : section === "team" ? <section className="hub-section hub-my-team"><div className="hub-section-heading"><div><p className="hub-eyebrow">Full coach profile</p><h2>{my.teamName ?? profile.teamName ?? "No team linked"}</h2><p>{my.discordUsername ?? profile.user?.display_name ?? "REC Member"}</p></div></div>
      {hub.league.game === "cfb_27" && <DefenseNicknamePrompt />}
      <div className="hub-my-team-shortcuts">
        <button className="hub-shortcut-card" onClick={() => setMediaModal("article")}><IconWell size="sm" icon={<FileText size={18} />} /><div><strong>Submit Article</strong><span>{mediaPortal?.limits.articleSubmitted ? `Submitted (${mediaPortal.limits.articleStatus})` : "$100 on approval"}</span></div></button>
        <button className="hub-shortcut-card" onClick={() => setMediaModal("interview")}><IconWell size="sm" icon={<Mic size={18} />} /><div><strong>Coach Interview</strong><span>{mediaPortal?.limits.interviewSubmitted ? `Submitted (${mediaPortal.limits.interviewStatus})` : "$50 on approval"}</span></div></button>
        {hub.league.game === "cfb_27" && <button className="hub-shortcut-card" onClick={() => setRecruitModalOpen(true)}><IconWell size="sm" icon={<GraduationCap size={18} />} /><div><strong>Confirmed Commit</strong><span>Log a recruit to your school</span></div></button>}
        <button className="hub-shortcut-card" onClick={() => void viewMySchedule()}><IconWell size="sm" icon={<CalendarDays size={18} />} /><div><strong>Full Season Schedule</strong><span>Results &amp; upcoming games</span></div></button>
      </div>
      <div className="hub-stat-grid">
      <article><span>Coach</span><strong>{my.discordUsername ?? "REC Member"}</strong></article><article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "—"}</strong></article><article><span>Point differential</span><strong>{Number(my.leagueSeasonPointDifferential ?? 0) >= 0 ? "+" : ""}{my.leagueSeasonPointDifferential ?? 0}</strong></article><article><span>Current matchup</span><strong>{my.currentMatchupText ?? "None"}</strong></article><article><span>Wallet</span><strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></article><article><span>Savings</span><strong>${Number(my.savings ?? 0).toLocaleString()}</strong></article>
    </div><div className="hub-profile-sections">
      <details open><summary><WalletCards size={18} /> Funds &amp; Savings</summary><div className="hub-profile-panel"><p>Projected next-advance interest: <strong>${Number(my.projectedInterest ?? 0).toLocaleString()}</strong></p><p className="hub-muted">Savings interest continues to accrue when the league advances.</p><div className="hub-transfer-form"><select className="form-input" value={transferDirection} onChange={(event) => setTransferDirection(event.target.value as typeof transferDirection)}><option value="to_savings">Wallet → Savings</option><option value="from_savings">Savings → Wallet</option></select><input className="form-input" type="number" min="0.01" step="0.01" placeholder="Amount" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} /><Button variant="primary" disabled={transferBusy || !transferAmount} onClick={() => void transferFunds()}>{transferBusy ? "Transferring…" : "Transfer Funds"}</Button></div>{transferStatus && <p className="hub-transfer-status">{transferStatus}</p>}</div></details>
      <details open><summary><Trophy size={18} /> Records</summary><div className="hub-profile-panel hub-record-grid"><article><span>Current season</span><strong>{profile.seasonRecord?.text ?? my.leagueSeasonRecordText ?? "0-0-0"}</strong><small>Active streak {profile.seasonRecord?.activeStreak ?? "—"}</small></article><article><span>All-time REC</span><strong>{profile.globalRecord?.text ?? my.globalRecordText ?? "0-0-0"}</strong><small>Playoffs {profile.globalRecord?.playoffText ?? "0-0"} · Championships {profile.globalRecord?.superbowlWins ?? 0}</small></article>{profile.gameGlobalRecord && <article><span>{profile.gameGlobalRecord.label}</span><strong>{profile.gameGlobalRecord.text}</strong><small>Playoffs {profile.gameGlobalRecord.playoffText} · Championships {profile.gameGlobalRecord.superbowlWins ?? 0}</small></article>}<article><span>Power ranking</span><strong>{heroRank}</strong><small>{profile.powerRank?.rank ? powerRankSos : "Pending"}</small></article></div></details>
      <details><summary><Landmark size={18} /> Current Season Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.seasonStats} /></div></details>
      <details><summary><Landmark size={18} /> All-Time Stats</summary><div className="hub-profile-panel"><ProfileStats values={profile.careerStats} /></div></details>
      <details><summary><Award size={18} /> Badges &amp; Awards</summary><div className="hub-profile-panel"><BadgeShelf title="Badges" badges={profile.badges ?? [...(profile.weeklyBadges ?? []), ...(profile.seasonBadges ?? []), ...(profile.globalBadges ?? [])]} />{profile.globalAwards?.length ? <div className="hub-badge-group"><h4>Awards</h4><div className="hub-badge-shelf">{profile.globalAwards.map((award: any) => <article key={award.awardName} className="hub-badge-award"><Trophy size={18} /><div><strong>{award.awardName}</strong><span>Won {award.count}×</span></div></article>)}</div></div> : null}</div></details>
      <details><summary><WalletCards size={18} /> Financial Profile</summary><div className="hub-profile-panel"><FinancialLedger summary={profile.financialSummary} /></div></details>
    </div></section> : section === "store" ? <section className="hub-section hub-store"><div className="hub-section-heading"><div><p className="hub-eyebrow"><ShoppingBag size={14} /> Franchise marketplace</p><h2>REC Store</h2><p>Wallet balance: <strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></p></div></div>
      {!hub.store.enabled ? <p className="hub-empty">The coin economy is not enabled for this league.</p> : <>
        {hub.store.cfbSeasonOneLocked && <div className="hub-store-lock"><strong>CFB Season 1 roster lock</strong><span>Custom recruits, Campus Legends, development upgrades, attributes, and traits unlock automatically when Season 2 starts.</span></div>}
        <div className="hub-store-products">{hub.store.products.map((product) => {
          const Icon = STORE_PRODUCT_ICONS[product.type] ?? ShoppingBag;
          const used = storeContext?.seasonActive[product.type];
          const cap = storeContext?.seasonCaps[product.type as keyof typeof storeContext.seasonCaps];
          return <button key={product.type} disabled={product.locked} className={`hub-store-card hub-store-card-${product.type}${purchaseType === product.type ? " active" : ""}`} onClick={() => { setPurchaseType(product.type); setPurchaseDetails({}); setPurchaseStatus(null); if (product.type === "legend") void loadLegends(); void loadStoreContext(); }}>
            <Icon size={22} />
            <strong>{product.label}</strong>
            <span className="hub-store-card-price">{STORE_PRODUCT_PRICE_LABEL[product.type as RecPurchaseType] ?? ""}</span>
            <span className="hub-store-card-status">{product.locked ? "Available Season 2" : used ? `${used} this season${cap ? ` / ${cap} cap` : ""}` : "Open purchase flow"}</span>
          </button>;
        })}</div>

        {purchaseType && !hub.store.products.find((product) => product.type === purchaseType)?.locked && <div className="hub-store-form"><h3>{hub.store.products.find((product) => product.type === purchaseType)?.label}</h3>

          {purchaseType === "attribute" && <AttributePurchaseBuilder storeContext={storeContext} wallet={Number(my.wallet ?? 0)} busy={purchaseBusy} onSubmit={(allocations, playerName) => void submitPurchase({ playerName, allocations })} />}

          {purchaseType === "legend" && <><label className="form-field"><span className="form-label">Available legend</span><select className="form-input" value={purchaseDetails.legendId ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, legendId: event.target.value }))}><option value="">Select a legend</option>{(legends ?? []).filter((legend) => !soldLegendIds.includes(legend.id)).map((legend) => <option key={legend.id} value={legend.id}>{legend.name} · {legend.position} · {legend.est_ovr ?? "?"} OVR</option>)}</select></label><label className="form-field"><span className="form-label">Player to replace (optional)</span><input className="form-input" value={purchaseDetails.replacePlayerRequest ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, replacePlayerRequest: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${REC_LEGEND_PRICE}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.legendId} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "custom_player" && <>
            <label className="form-field"><span className="form-label">Package</span><select className="form-input" value={purchaseDetails.package ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, package: event.target.value }))}><option value="">Select package</option><option value="bronze">Bronze · ${REC_CUSTOM_PLAYER_PACKAGE_PRICE.bronze} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.bronze} pts</option><option value="silver">Silver · ${REC_CUSTOM_PLAYER_PACKAGE_PRICE.silver} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.silver} pts</option><option value="gold">Gold · ${REC_CUSTOM_PLAYER_PACKAGE_PRICE.gold} · {REC_CUSTOM_PLAYER_PACKAGE_POINTS.gold} pts</option></select></label>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <label className="form-field"><span className="form-label">Position</span><input className="form-input" placeholder="QB, WR, CB…" value={purchaseDetails.position ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, position: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${purchaseDetails.package ? REC_CUSTOM_PLAYER_PACKAGE_PRICE[purchaseDetails.package as keyof typeof REC_CUSTOM_PLAYER_PACKAGE_PRICE] : 0}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName || !purchaseDetails.package} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "dev_upgrade" && <>
            <label className="form-field"><span className="form-label">Upgrade to</span><select className="form-input" value={purchaseDetails.targetTier ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, targetTier: event.target.value }))}><option value="">Select tier</option><option value="star">Star · ${REC_DEV_UPGRADE_PRICE.star}</option><option value="superstar">Superstar · ${REC_DEV_UPGRADE_PRICE.superstar}</option><option value="xfactor">X-Factor · ${REC_DEV_UPGRADE_PRICE.xfactor}</option></select></label>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${purchaseDetails.targetTier ? REC_DEV_UPGRADE_PRICE[purchaseDetails.targetTier as keyof typeof REC_DEV_UPGRADE_PRICE] : 0}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName || !purchaseDetails.targetTier} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "contract" && <>
            <label className="form-field"><span className="form-label">Contract change</span><select className="form-input" value={purchaseDetails.variant ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, variant: event.target.value }))}><option value="">Select option</option><option value="salary_bonus_reduction">50% Salary/Bonus Reduction · ${REC_CONTRACT_PRICE.salary_bonus_reduction}</option><option value="extension">1-Year Extension · ${REC_CONTRACT_PRICE.extension}</option></select></label>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${purchaseDetails.variant ? REC_CONTRACT_PRICE[purchaseDetails.variant as keyof typeof REC_CONTRACT_PRICE] : 0}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName || !purchaseDetails.variant} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "player_trait" && <>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <label className="form-field"><span className="form-label">Requested trait</span><input className="form-input" value={purchaseDetails.requestedTrait ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, requestedTrait: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${REC_PLAYER_TRAIT_PRICE}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseType === "age_reset" && <>
            <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={purchaseDetails.playerName ?? ""} onChange={(event) => setPurchaseDetails((current) => ({ ...current, playerName: event.target.value }))} /></label>
            <div className="hub-store-total"><span>Total: <strong>${REC_AGE_RESET_PRICE}</strong></span><Button variant="primary" disabled={purchaseBusy || !purchaseDetails.playerName} onClick={() => void submitPurchase()}>{purchaseBusy ? "Submitting…" : "Submit Purchase"}</Button></div>
          </>}

          {purchaseStatus && <p className="hub-transfer-status">{purchaseStatus}</p>}
        </div>}
      </>}
    </section> : section === "wagers" ? <section className="hub-section hub-wagers-section"><div className="hub-section-heading"><div><p className="hub-eyebrow"><Coins size={14} /> Sportsbook</p><h2>Wagers</h2><p>Wallet balance: <strong>${Number(my.wallet ?? 0).toLocaleString()}</strong></p></div></div>
      <h3 className="hub-wagers-subhead">This Week's Games</h3>
      {(() => {
        const state = renderMatchupLoadState("Loading games...");
        if (state) return state;
        const schedule = matchupSchedule;
        if (!schedule) return null;
        return schedule.games.length ? <div className="hub-matchup-summary-list">{schedule.games.map((game) => (
          <article key={game.gameId} className="hub-matchup-summary">
            <div><span>{game.isGameOfWeek ? "Game of the Week" : game.matchupType === "h2h" ? "H2H" : game.matchupType === "human_cpu" ? "vs CPU" : "CPU"}</span><strong>{game.awayTeamName} <em>at</em> {game.homeTeamName}</strong></div>
            <div className="hub-matchup-actions">{game.involvesMe ? <StatusChip status="locked" label="Your game" /> : game.matchupType === "h2h" ? <Button variant="secondary" size="compact" onClick={() => void openWager(game)}>Build Wager</Button> : null}</div>
          </article>
        ))}</div> : <p className="hub-empty">No linked-user games are scheduled for Week {schedule.selectedWeek}.</p>;
      })()}

      <h3 className="hub-wagers-subhead">Peer Wager Board</h3>
      {wagersBoardNotice && <p className="hub-transfer-status">{wagersBoardNotice}</p>}
      <div className="hub-wager-carousel">{wagersBoard === null ? <p className="hub-empty">Loading peer wagers...</p> : wagersBoard.length ? <><button className="hub-highlight-arrow prev" aria-label="Previous wager" onClick={() => setWagerBoardIndex((wagerBoardIndex - 1 + wagersBoard.length) % wagersBoard.length)}><ChevronLeft /></button>{(() => { const wager = wagersBoard[wagerBoardIndex % wagersBoard.length]; return <article key={wager.id}><div><strong>{wager.gameLabel}</strong><span>{wager.market} · ${wager.stake.toLocaleString()} · {wager.challengeType}</span></div><div className="hub-wager-card-actions">{wager.canAccept && <Button variant="primary" size="compact" disabled={wagersBoardBusy} onClick={() => void acceptFromWagersBoard(wager.id)}>Accept</Button>}{wager.isMine && <><button className="hub-icon-action" title="Edit wager terms" aria-label="Edit wager terms" onClick={() => { const game = matchupSchedule?.games.find((item) => item.gameId === wager.gameId); if (game) void openWager(game); }}><Pencil size={17} /></button><button className="hub-icon-action danger" title="Delete wager" aria-label="Delete wager" disabled={wagersBoardBusy} onClick={() => void removeWager(wager.id)}><Trash2 size={17} /></button></>}</div></article>; })()}<button className="hub-highlight-arrow next" aria-label="Next wager" onClick={() => setWagerBoardIndex((wagerBoardIndex + 1) % wagersBoard.length)}><ChevronRight /></button><p>{wagerBoardIndex % wagersBoard.length + 1} / {wagersBoard.length}</p></> : <p className="hub-empty">No open user wagers yet.</p>}</div>
    </section> : <div className="hub-league-tab">
      {subTab === "buzz" && <>
        <EosAwardVotingBlock />
        <SectionFrame eyebrow="Around the league" title={hub.league.game?.startsWith("madden") ? "Breaking News" : "Campus Buzz"}>
          {hub.headlines.length ? (
            isMobile ? (
              <div className="hub-story-mobile-swipe" style={{ position: "relative" }}>
                {(() => {
                  const index = Math.min(storyCarouselIndex, headlineCount - 1);
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
                      {story.image_url && <img className="hub-story-image" src={story.image_url} alt="" onClick={(event) => { event.stopPropagation(); setLightboxImage(story.image_url!); }} />}
                      <button type="button" className="hub-story-open" onClick={() => openStory(index)}><time>Week {story.week}</time><h3>{story.headline ?? "League Story"}</h3><p>{snippet(story.body)}</p><span className="hub-read-article">{story.story_type !== "headline" ? "Open REC Network Roundtable →" : "Read more →"}</span></button>
                    </article>
                  );
                })()}
                <p className="hub-story-swipe-hint">Swipe for more · {storyCarouselIndex + 1} of {headlineCount}</p>
              </div>
            ) : (
              <div className="hub-story-carousel">
                {headlineCount > 1 && <button type="button" className="hub-highlight-arrow previous" onClick={() => setStoryCarouselIndex((storyCarouselIndex - 1 + headlineCount) % headlineCount)}><ChevronLeft /></button>}
                {(() => {
                  const index = Math.min(storyCarouselIndex, headlineCount - 1);
                  const story = hub.headlines[index];
                  if (!story) return null;
                  return <article className={story.story_type === "headline" ? "hub-story-card hub-story-feature" : "hub-story-card article hub-story-feature"} key={story.id}>
                    {story.image_url && <img className="hub-story-image" src={story.image_url} alt="" onClick={(event) => { event.stopPropagation(); setLightboxImage(story.image_url!); }} />}
                    <button type="button" className="hub-story-open" onClick={() => openStory(index)}><time>Week {story.week}</time><h3>{story.headline ?? "League Story"}</h3><p>{snippet(story.body)}</p><span className="hub-read-article">{story.story_type !== "headline" ? "Open REC Network Roundtable →" : "Read more →"}</span></button>
                  </article>;
                })()}
                {headlineCount > 1 && <button type="button" className="hub-highlight-arrow next" onClick={() => setStoryCarouselIndex((storyCarouselIndex + 1) % headlineCount)}><ChevronRight /></button>}
                <p className="hub-story-swipe-hint">Showing {storyCarouselIndex + 1} of {headlineCount}</p>
              </div>
            )
          ) : <p className="hub-empty">Headlines publish here after games or from League Publishing.</p>}
        </SectionFrame>
        <SectionFrame eyebrow="Community clips" title="Highlight Reel" className="hub-highlight-section">
          {activeHighlight ? <div className="hub-highlight-carousel">
            {highlightCount > 1 && <button className="hub-highlight-arrow previous" onClick={() => setHighlightIndex((activeHighlightIndex - 1 + highlightCount) % highlightCount)}><ChevronLeft /></button>}
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
              <div className="hub-video-frame">{activeHighlight.iframeUrl || activeHighlight.streamUid ? <iframe key={activeHighlight.id} src={`${activeHighlight.iframeUrl ?? `https://iframe.videodelivery.net/${activeHighlight.streamUid}`}?autoplay=true&muted=true`} title="Highlight" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen onLoad={() => void recordView(activeHighlight.id)} /> : activeHighlight.videoUrl ? <video key={activeHighlight.id} src={activeHighlight.videoUrl} controls autoPlay muted playsInline preload="auto" onCanPlay={(event) => { event.currentTarget.muted = true; void event.currentTarget.play().catch(() => undefined); }} onPlay={() => void recordView(activeHighlight.id)} onEnded={() => { if (!highlightSwipe.isDragging && highlightCount > 1) setHighlightIndex((activeHighlightIndex + 1) % highlightCount); }} /> : <a href={activeHighlight.message_url ?? "#"} target="_blank" rel="noreferrer" onClick={() => void recordView(activeHighlight.id)}><Play size={36} /> Open highlight</a>}</div>
              <div className="hub-highlight-meta"><strong>{activeHighlight.team?.name ?? activeHighlight.user?.display_name ?? "REC Highlight"}</strong><span>{activeHighlightIndex + 1} of {highlightCount} · Season {activeHighlight.season_number} · {activeHighlight.season_stage === "regular_season" ? `Week ${activeHighlight.week_number}` : displayLabel(activeHighlight.season_stage ?? `Week ${activeHighlight.week_number}`)}</span></div><div className="hub-highlight-views"><Eye size={14} /> {activeHighlight.viewCount} views</div>
              <div className="hub-highlight-reactions">
                <button aria-label="Like" className={activeHighlight.myReactions.includes("like") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "like")}><ThumbsUp size={18} /><b>Like</b><small>{activeHighlight.reactionCounts.like || ""}</small></button>
                <button aria-label="Dislike" className={activeHighlight.myReactions.includes("dislike") ? "active" : ""} onClick={() => void highlightReact(activeHighlight.id, "dislike")}><ThumbsDown size={18} /><b>Dislike</b><small>{activeHighlight.reactionCounts.dislike || ""}</small></button>
                <button aria-label="Nominate for Play of the Year" className={`poty${AWARD_KEYS.some((key) => activeHighlight.myReactions.includes(key)) ? " active" : ""}`} onClick={() => { setPotyHighlightId(activeHighlight.id); setPotyCategory(AWARD_KEYS.find((key) => activeHighlight.myReactions.includes(key)) ?? ""); }}><Award size={18} /><b>POTY</b><small>{AWARD_KEYS.reduce((sum, key) => sum + activeHighlight.reactionCounts[key], 0) || ""}</small></button>
              </div>
            </article>{highlightCount > 1 && <button className="hub-highlight-arrow next" onClick={() => setHighlightIndex((activeHighlightIndex + 1) % highlightCount)}><ChevronRight /></button>}</div> : <p className="hub-empty">Upload from a matchup or post in Discord — clips show up here.</p>}
        </SectionFrame>

        <SectionFrame eyebrow="Live market" title="Wager Board">
          {wagersBoardNotice && <p className="hub-transfer-status">{wagersBoardNotice}</p>}
          <div className="hub-wager-board-feature">{wagersBoard === null ? <p className="hub-empty">Loading open wagers...</p> : wagersBoard.length ? <>
            <button className="hub-wager-arrow" aria-label="Previous wager" onClick={() => setWagerBoardIndex((wagerBoardIndex - 1 + wagersBoard.length) % wagersBoard.length)}><ChevronLeft /></button>
            {(() => { const wager = wagersBoard[wagerBoardIndex % wagersBoard.length]; return <article key={wager.id}><span className="hub-wager-kicker">Open Challenge</span><strong>{wager.gameLabel}</strong><p>{displayLabel(wager.market)} · {wager.pick}</p><div><b>${wager.stake.toLocaleString()} stake</b><small>Potential payout ${wager.potentialPayout.toLocaleString()}</small></div>{wager.canAccept && <Button variant="primary" size="compact" disabled={wagersBoardBusy} onClick={() => void acceptFromWagersBoard(wager.id)}>Accept Wager</Button>}</article>; })()}
            <button className="hub-wager-arrow" aria-label="Next wager" onClick={() => setWagerBoardIndex((wagerBoardIndex + 1) % wagersBoard.length)}><ChevronRight /></button>
            <span className="hub-wager-position">{wagerBoardIndex % wagersBoard.length + 1} / {wagersBoard.length}</span>
          </> : <div className="hub-wager-empty"><Coins size={30} /><strong>No Open Wagers</strong><p>New user challenges will appear here automatically.</p></div>}</div>
        </SectionFrame>

        <SectionFrame eyebrow="Official updates" title="Announcements">
          {hub.announcements.length ? <div className="hub-feed-list">{hub.announcements.map((item) => <article key={item.id}><time>{new Date(item.published_at).toLocaleDateString()}</time><h3>{item.title}</h3><p>{item.body}</p></article>)}</div> : <p className="hub-empty">League announcements will appear here.</p>}
        </SectionFrame>
      </>}

      {subTab === "matchups" && (
        <>
          <div className="rec-matchup-tabs" role="tablist" aria-label="Matchups and rankings">
            <button type="button" role="tab" aria-selected={matchupView === "h2h"} className={matchupView === "h2h" ? "active" : ""} onClick={() => setMatchupView("h2h")}>H2H Matchups</button>
            <button type="button" role="tab" aria-selected={matchupView === "cpu"} className={matchupView === "cpu" ? "active" : ""} onClick={() => setMatchupView("cpu")}>Human vs CPU</button>
            <button type="button" role="tab" aria-selected={matchupView === "rankings"} className={matchupView === "rankings" ? "active" : ""} onClick={() => setMatchupView("rankings")}>Rankings</button>
          </div>

          {matchupView === "rankings" ? (
            <>
              <SectionFrame eyebrow="Updated on advance" title="Power Rankings">
                {hub.powerRankings?.teams?.length ? <div className="hub-power-rankings">{hub.powerRankings.teams.slice(0, 16).map((team) => <article key={team.teamId} className={team.isHuman ? "human" : ""}>
                  <strong>#{team.rank}</strong><div><span>{team.teamName}</span><small>{team.change == null ? "New" : team.change > 0 ? `Up ${team.change}` : team.change < 0 ? `Down ${Math.abs(team.change)}` : "No change"} · Score {Number(team.score).toFixed(3)}</small></div>
                </article>)}</div> : <p className="hub-empty">Power rankings will appear after the first completed slate.</p>}
              </SectionFrame>

              <SectionFrame eyebrow="Win%, point diff, schedule strength, playoff success" title="Coach Ratings">
                {hub.coachRatings?.teams?.length ? <div className="hub-power-rankings hub-coach-ratings">{hub.coachRatings.teams.slice(0, 16).map((team) => <article key={team.teamId} className={team.teamId === hub.coachRatings?.viewerTeamId ? "human" : ""}>
                  <strong>#{team.rank}</strong>
                  <div><span>{team.teamName}</span><small>{team.record} · SOS {team.sos.toFixed(2)}{team.madePlayoffs ? " · Made playoffs" : ""}</small></div>
                  <em className="hub-rating-badge">{hub.coachRatings?.displayAsGrade ? team.grade : team.rating.toFixed(1)}</em>
                </article>)}</div> : <p className="hub-empty">Coach ratings will appear after the first completed slate.</p>}
              </SectionFrame>

              <SectionFrame eyebrow="Individual skill, separate from win/loss record" title="User Ratings">
                {hub.userRatings?.users?.length ? <div className="hub-power-rankings hub-coach-ratings">{hub.userRatings.users.slice(0, 16).map((user) => <article key={user.userId} className={user.userId === hub.userRatings?.viewerUserId ? "human" : ""}>
                  <strong>#{user.rank}</strong>
                  <div><span>{user.displayName}</span><small>{user.teamName ?? "Free agent"} · Stat {user.statScore.toFixed(1)} · Badges {user.badgeScore >= 0 ? "+" : ""}{user.badgeScore.toFixed(1)}</small></div>
                  <em className="hub-rating-badge">{hub.userRatings?.displayAsGrade ? user.grade : user.rating.toFixed(1)}</em>
                </article>)}</div> : <p className="hub-empty">User ratings will appear after the first completed slate.</p>}
              </SectionFrame>

              <SectionFrame eyebrow="Toughest schedules this season" title="Strength of Schedule">
                {hub.sos?.teams?.length ? <div className="hub-power-rankings hub-sos-rankings">{hub.sos.teams.slice(0, 16).map((team) => <article key={team.teamId} className={team.teamId === hub.sos?.viewerTeamId ? "human" : ""}>
                  <strong>#{team.rank}</strong>
                  <div><span>{team.teamName}</span><small>{team.humanCount}H/{team.cpuCount}C · Opponent record {(team.oppRecord * 100).toFixed(0)}%</small></div>
                  <em className="hub-rating-badge">{team.sosFull.toFixed(2)}</em>
                </article>)}</div> : <p className="hub-empty">Strength of schedule will appear once the season's slate is logged.</p>}
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
                return <>
                <div className="hub-week-picker">
                  <label className="hub-week-select"><span>Week</span><select className="form-input" value={schedule.selectedWeek} onChange={(event) => setMatchupWeek(Number(event.target.value))}>{schedule.weekNumbers.map((week) => <option key={week} value={week}>Week {week}{week === schedule.currentWeek ? " (Current)" : ""}</option>)}</select></label>
                </div>
                {(() => {
                  const visible = schedule.games.filter((game) => matchupView === "h2h" ? game.matchupType === "h2h" : game.matchupType === "human_cpu");
                  return visible.length ? <div className="rec-matchup-list">{visible.map((game, index) => <MatchupCard key={game.gameId} game={game} featured={game.isGameOfWeek || game.involvesMe || index === 0} />)}</div> : <p className="hub-empty">No {matchupView === "h2h" ? "H2H" : "human vs CPU"} games are scheduled for Week {schedule.selectedWeek}.</p>;
                })()}
                {schedule.games.length ? <div className="hub-matchups hub-matchup-schedule">{schedule.games.map((game) => (<div className={`hub-matchup-stack${(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) ? " gotw" : ""}`} key={game.gameId}>
                  <article className={(game.matchupType === "h2h" ? "hub-matchup-card h2h" : "hub-matchup-card cpu") + ((game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) ? " gotw" : "")}>
                    <div className="hub-matchup-card-head"><span aria-hidden="true" /><strong>Week {game.weekNumber}</strong><small>{(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) && schedule.gotw ? (schedule.gotw.status === "open" ? "Vote now" : "Voting closed") : [game.awayConference, game.homeConference].filter(Boolean).join(" vs ")}</small></div>
                    <div className="hub-matchup-board">
                      {(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) && schedule.gotw ? <button type="button" className={`hub-team-side hub-team-side-vote away${schedule.gotw.myVote === schedule.gotw.awayTeamId ? " active" : ""}`} disabled={schedule.gotw.status !== "open"} onClick={() => void voteGotw(schedule.gotw!.awayTeamId)} aria-label={`Vote for ${game.awayTeamName}`}><span>Away</span><b style={{ "--matchup-name-size": matchupWordmarkSize(game.awayTeamName) } as CSSProperties}>{game.awayTeamName}</b><small>{schedule.gotw.awayVotes} vote{schedule.gotw.awayVotes === 1 ? "" : "s"}</small><em>{game.awayConference ?? "Visiting team"}</em></button> : <div className="hub-team-side"><span>Away</span><div className="hub-team-wordmark" style={{ "--matchup-name-size": matchupWordmarkSize(game.awayTeamName) } as CSSProperties}>{game.awayTeamName}</div><small>{game.awayConference ?? "Visiting team"}</small></div>}
                      <div className="hub-score-center"><span aria-hidden="true" />{game.isFinal && game.awayScore != null && game.homeScore != null ? <strong>{`${game.awayScore}–${game.homeScore}`}</strong> : null}</div>
                      {(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) && schedule.gotw ? <button type="button" className={`hub-team-side hub-team-side-vote home${schedule.gotw.myVote === schedule.gotw.homeTeamId ? " active" : ""}`} disabled={schedule.gotw.status !== "open"} onClick={() => void voteGotw(schedule.gotw!.homeTeamId)} aria-label={`Vote for ${game.homeTeamName}`}><span>Home</span><b style={{ "--matchup-name-size": matchupWordmarkSize(game.homeTeamName) } as CSSProperties}>{game.homeTeamName}</b><small>{schedule.gotw.homeVotes} vote{schedule.gotw.homeVotes === 1 ? "" : "s"}</small><em>{game.homeConference ?? "Home team"}</em></button> : <div className="hub-team-side"><span>Home</span><div className="hub-team-wordmark" style={{ "--matchup-name-size": matchupWordmarkSize(game.homeTeamName) } as CSSProperties}>{game.homeTeamName}</div><small>{game.homeConference ?? "Home team"}</small></div>}
                    </div>
                    <div className="hub-matchup-rails">
                      {game.matchupType === "human_cpu" ? <div className="hub-team-control-rail away"><button disabled={game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button></div> : <div className="hub-team-control-rail away"><button disabled={game.viewerSide !== "away" || game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button><button disabled={game.viewerSide !== "away" || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div>}
                      <div className="hub-center-control-rail">{game.matchupType === "human_cpu" ? game.streams[0] ? <a className="btn btn-primary" href={`${apiBaseUrl}${game.streams[0].watchPath}`} target="_blank" rel="noreferrer">Stream</a> : <StatusChip status="info" label="Stream" /> : !game.isFinal && game.matchupType === "h2h" ? <Button variant="primary" size="compact" onClick={() => void openWager(game)}>Wager</Button> : game.streams.length ? <a className="btn btn-primary" href={`${apiBaseUrl}${game.streams[0].watchPath}`} target="_blank" rel="noreferrer">Stream</a> : game.isFinal ? <StatusChip status="info" label="Final" /> : null}</div>
                      {game.matchupType === "human_cpu" ? <div className="hub-team-control-rail home"><button disabled={game.isFinal || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div> : <div className="hub-team-control-rail home"><button disabled={game.viewerSide !== "home" || game.isFinal || Boolean(game.boxScoreSubmissionId)} onClick={() => setBoxScoreUploadGame(game)}>Box Score</button><button disabled={game.viewerSide !== "home" || !game.boxScoreSubmissionId} onClick={() => void openPlayerStats(game)}>Player Stats</button></div>}
                    </div>
                    {(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) && schedule.gotw && hub.canManageLeague && schedule.gotw.status === "open" && <div className="hub-matchup-admin-slot"><Button variant="tactical" size="compact" onClick={() => void closeGotw()}>Close Voting</Button></div>}
                    {(game.isGameOfWeek || schedule.gotw?.gameId === game.gameId) && schedule.gotw && (() => { const total = schedule.gotw.awayVotes + schedule.gotw.homeVotes; const away = total ? Math.round(schedule.gotw.awayVotes / total * 100) : 50; return <div className="hub-gotw-meter-edge" style={{ "--away-share": `${away}%` } as CSSProperties}><div className="hub-gotw-meter-side away"><strong>{away}%</strong><small>{schedule.gotw.awayVotes} vote{schedule.gotw.awayVotes === 1 ? "" : "s"}</small></div><i /><div className="hub-gotw-meter-side home"><strong>{100 - away}%</strong><small>{schedule.gotw.homeVotes} vote{schedule.gotw.homeVotes === 1 ? "" : "s"}</small></div></div>; })()}
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
                        <button aria-label="Love" className={game.myReactions.includes("love") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "love")}>{game.reactionCounts.love > 0 && <span>{game.reactionCounts.love}</span>}</button>
                        <button aria-label="Like" className={game.myReactions.includes("like") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "like")}>{game.reactionCounts.like > 0 && <span>{game.reactionCounts.like}</span>}</button>
                        <button aria-label="Nominate for Game of the Year" className={`goty${game.myReactions.includes("goty") ? " active" : ""}`} onClick={() => void matchupGameReact(game.gameId, "goty")}>{game.reactionCounts.goty > 0 && <span>{game.reactionCounts.goty}</span>}</button>
                        <button aria-label="Dislike" className={game.myReactions.includes("dislike") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "dislike")}>{game.reactionCounts.dislike > 0 && <span>{game.reactionCounts.dislike}</span>}</button>
                        <button aria-label="Hate" className={game.myReactions.includes("poop") ? "active" : ""} onClick={() => void matchupGameReact(game.gameId, "poop")}>{game.reactionCounts.poop > 0 && <span>{game.reactionCounts.poop}</span>}</button>
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
        onImageClick={(src) => setLightboxImage(src)}
      />
    ) : (
      <Modal title={activeStory.headline ?? "League Story"} onClose={closeStory} panelClassName="hub-article-modal"><div className="roundtable-story">
        {activeStory.image_url && <img className="expanded-article-image" src={activeStory.image_url} alt="" onClick={() => setLightboxImage(activeStory.image_url!)} />}
        <p className="roundtable-lede">{activeStory.body}</p>{activeStory.roundtable?.length ? <div className="roundtable-panel"><div className="roundtable-banner">REC NETWORK · LEAGUE ROUNDTABLE</div>{activeStory.roundtable.map((panelist) => <article key={`${panelist.speaker}-${panelist.role}`}><div className="roundtable-avatar">{panelist.speaker.split(" ").map((part) => part[0]).join("")}</div><div><strong>{panelist.speaker}</strong><span>{panelist.role}</span><p>{panelist.take}</p></div></article>)}</div> : null}
        <div className="hub-social-actions"><button type="button" className={activeStory.myReaction === "like" ? "active" : ""} onClick={() => void storyReact(activeStory.id, "like")}><ThumbsUp size={15} /> {activeStory.reactionCounts.like}</button><button type="button" className={activeStory.myReaction === "dislike" ? "active" : ""} onClick={() => void storyReact(activeStory.id, "dislike")}><ThumbsDown size={15} /> {activeStory.reactionCounts.dislike}</button></div>
        <div className="story-comments"><h3><MessageCircle size={18} /> Comments</h3>{comments === null ? <p>Loading comments…</p> : comments.length ? comments.map((comment) => <article key={comment.id}><strong>{comment.authorName}</strong><time>{new Date(comment.created_at).toLocaleString()}</time><p>{comment.body}</p></article>) : <p className="hub-empty">No comments yet.</p>}<textarea className="form-input" rows={3} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add to the discussion…" /><Button variant="primary" disabled={!commentBody.trim()} onClick={() => void submitComment()}>Post Comment</Button></div>
      </div></Modal>
    ))}
    {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    {boxScoreUploadGame && auth.status === "ready" && <UploadBoxScoreModal guildId={auth.guildId} discordId={auth.discordId} weekNumber={boxScoreUploadGame.weekNumber} seasonNumber={hub.league.seasonNumber} gameId={boxScoreUploadGame.gameId} commissionerSubmission={false} requireSecondImage onClose={() => setBoxScoreUploadGame(null)} onSubmitted={async () => { const weekNumber = matchupSchedule?.selectedWeek ?? boxScoreUploadGame.weekNumber; setBoxScoreUploadGame(null); setMatchupSchedule(await recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber })); }} />}
    {playerStatsGame && <Modal title="Players to Watch" onClose={() => setPlayerStatsGame(null)}><div className="hub-submission-modal">
      {playerStatsNotice && <p className="hub-transfer-status">{playerStatsNotice}</p>}<p className="hub-muted">{playerStatsGame.awayTeamName} at {playerStatsGame.homeTeamName}</p>
      <label className="form-field"><span className="form-label">Player</span><select className="form-input" value={playerStatsDraft.watchedPlayerId} onChange={(event) => { const player = myWatchedPlayers?.find((item) => item.id === event.target.value); setPlayerStatsDraft((current) => ({ ...current, watchedPlayerId: event.target.value, playerName: player?.playerName ?? "" })); }}><option value="">Enter a new player</option>{(myWatchedPlayers ?? []).map((player) => <option key={player.id} value={player.id}>{player.playerName} - {player.position}</option>)}</select></label>
      {!playerStatsDraft.watchedPlayerId && <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={playerStatsDraft.playerName} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, playerName: event.target.value }))} /></label>}
      <label className="form-field"><span className="form-label">Category</span><select className="form-input" value={playerStatsDraft.category} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, category: event.target.value, values: {} }))}>{PLAYER_STAT_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{displayLabel(category)}</option>)}</select></label>
      <div className="hub-submission-grid">{(PLAYER_STAT_FIELDS[playerStatsDraft.category] ?? []).map(([key, label]) => <label className="form-field" key={key}><span className="form-label">{label}</span><input className="form-input" type="number" min="0" value={playerStatsDraft.values[key] ?? ""} onChange={(event) => setPlayerStatsDraft((current) => ({ ...current, values: { ...current.values, [key]: event.target.value } }))} /></label>)}</div>
      <Button variant="primary" disabled={playerStatsBusy} onClick={() => void submitPlayerStats()}>{playerStatsBusy ? "Submitting..." : "Submit Player Stats"}</Button>
    </div></Modal>}
    {recruitModalOpen && <Modal title="Confirmed Commit" onClose={() => setRecruitModalOpen(false)}><div className="hub-submission-modal">
      {recruitNotice && <p className="hub-transfer-status">{recruitNotice}</p>}<label className="form-field"><span className="form-label">Recruit name</span><input className="form-input" value={recruitDraft.playerName} onChange={(event) => setRecruitDraft((current) => ({ ...current, playerName: event.target.value }))} /></label>
      <div className="hub-submission-grid"><label className="form-field"><span className="form-label">Position</span><select className="form-input" value={recruitDraft.position} onChange={(event) => setRecruitDraft((current) => ({ ...current, position: event.target.value }))}>{CFB_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}</select></label><label className="form-field"><span className="form-label">Stars</span><select className="form-input" value={recruitDraft.starRating} onChange={(event) => setRecruitDraft((current) => ({ ...current, starRating: event.target.value }))}>{[1, 2, 3, 4, 5].map((stars) => <option key={stars} value={stars}>{stars}</option>)}</select></label></div>
      <div className="hub-submission-grid"><label className="form-field"><span className="form-label">City</span><input className="form-input" value={recruitDraft.homeCity} onChange={(event) => setRecruitDraft((current) => ({ ...current, homeCity: event.target.value }))} /></label><label className="form-field"><span className="form-label">State</span><input className="form-input" value={recruitDraft.homeState} onChange={(event) => setRecruitDraft((current) => ({ ...current, homeState: event.target.value }))} /></label></div>
      <Button variant="primary" disabled={recruitBusy || !recruitDraft.playerName.trim() || !recruitDraft.homeCity.trim() || !recruitDraft.homeState.trim()} onClick={() => void submitRecruitCommit()}>{recruitBusy ? "Submitting..." : "Submit Commit"}</Button>
    </div></Modal>}
    {hub.canManageLeague && (section === "wagers" || subTab === "matchups") && <button className="hub-close-wagers-corner" onClick={openCloseWagersModal}>Close Wagers</button>}
    {closeWagersOpen && <Modal title="Manage Wagering" onClose={() => setCloseWagersOpen(false)}><div className="hub-close-wagers-list">{(matchupSchedule?.games ?? []).filter((game) => game.matchupType === "h2h" && !game.isFinal).map((game) => <label key={game.gameId}><span>{game.awayTeamName} at {game.homeTeamName}</span><input type="checkbox" checked={closeWagerGameIds.has(game.gameId)} disabled={!game.wageringOpen} onChange={(event) => setCloseWagerGameIds((current) => { const next = new Set(current); event.target.checked ? next.add(game.gameId) : next.delete(game.gameId); return next; })} /><b>{closeWagerGameIds.has(game.gameId) ? "Closed" : "Open"}</b></label>)}<Button variant="primary" disabled={wagersBoardBusy} onClick={() => void submitClosedWagers()}>Apply Changes</Button></div></Modal>}
    {wagerPanel && <Modal title={`Sportsbook · ${wagerPanel.label}`} onClose={() => setWagerPanel(null)}><div className="hub-wager-modal">
      {!wagerPanel.options ? <p className="hub-empty">{wagerPanel.notice ?? "Loading lines..."}</p> : <>
        <div className="hub-wager-mode"><button className={wagerPanel.mode === "single" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "single" })}>House Single</button><button className={wagerPanel.mode === "parlay" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "parlay" })}>3-Pick Parlay</button><button className={wagerPanel.mode === "peer" ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, mode: "peer" })}>User Wager</button></div>
        {wagerPanel.mode === "parlay" && <p className="hub-muted">Choose exactly three different stat-line Over/Under picks from this game. Each side is a separate selection.</p>}
        <div className="hub-wager-lines">{wagerPanel.options.markets.filter((market) => wagerPanel.mode !== "parlay" || (!["moneyline", "spread", "total_points"].includes(market.market))).map((market) => <article key={market.market} className={wagerPanel.market === market.market ? "active" : ""}><button onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: market.sides[0]?.pick ?? "" })}><strong>{market.label}</strong><span>{market.line != null ? `Stat line: ${market.line}` : "Pick a winner"}</span></button><div>{market.sides.map((side) => <button key={side.pick} aria-label={`${market.label}: ${side.label}`} className={wagerPanel.market === market.market && wagerPanel.pick === side.pick ? "active" : ""} onClick={() => setWagerPanel({ ...wagerPanel, market: market.market, pick: side.pick })}><b>{side.pick === "over" ? `OVER ${market.line ?? ""}` : side.pick === "under" ? `UNDER ${market.line ?? ""}` : side.label}</b><small>{side.label} · odds {side.odds > 0 ? "+" : ""}{side.odds}</small></button>)}</div></article>)}</div>
        {wagerPanel.mode === "parlay" && <div className="hub-parlay-slip"><div><strong>Parlay slip</strong><span>{wagerPanel.parlay.length}/3 picks</span></div><Button variant="secondary" size="compact" disabled={wagerPanel.parlay.length >= 3} onClick={addParlayLeg}>Add Pick</Button>{wagerPanel.parlay.map((leg) => <p key={`${leg.gameId}-${leg.market}`}>{leg.label}: {leg.market}</p>)}</div>}
        {wagerPanel.mode === "peer" && <div className="hub-peer-controls"><select className="form-input" value={wagerPanel.challengeType} onChange={(event) => setWagerPanel({ ...wagerPanel, challengeType: event.target.value as "open" | "direct" })}><option value="open">Post to board</option><option value="direct">Direct challenge</option></select>{wagerPanel.challengeType === "direct" && <select className="form-input" value={wagerPanel.targetUserId} onChange={(event) => setWagerPanel({ ...wagerPanel, targetUserId: event.target.value })}><option value="">Select coach</option>{wagerPanel.coaches.map((coach) => <option key={coach.userId} value={coach.userId}>{coach.teamAbbr} · {coach.conference}</option>)}</select>}</div>}
        <div className="hub-wager-submit"><label className="form-field"><span className="form-label">Stake</span><input className="form-input" type="number" min="1" value={wagerPanel.stake} onChange={(event) => setWagerPanel({ ...wagerPanel, stake: event.target.value })} /></label><Button variant="primary" disabled={wagerPanel.busy || !wagerPanel.market || !wagerPanel.pick || (wagerPanel.mode === "peer" && wagerPanel.challengeType === "direct" && !wagerPanel.targetUserId) || (wagerPanel.mode === "parlay" && wagerPanel.parlay.length !== 3)} onClick={() => void placeWager()}>{wagerPanel.busy ? "Submitting..." : wagerPanel.mode === "peer" ? "Post User Wager" : wagerPanel.mode === "parlay" ? "Place 3-Pick Parlay" : "Bet House"}</Button></div>
        {wagerPanel.notice && <p className="hub-transfer-status">{wagerPanel.notice}</p>}
        <div className="hub-peer-board"><h3>Peer Wager Board</h3>{wagerPanel.board.length ? wagerPanel.board.map((wager) => <article key={wager.id}><div><strong>{wager.gameLabel}</strong><span>{wager.market} · ${wager.stake.toLocaleString()} · {wager.challengeType}</span></div>{wager.canAccept ? <Button variant="secondary" size="compact" disabled={wagerPanel.busy} onClick={() => void acceptPeer(wager.id)}>Accept</Button> : <StatusChip status={wager.isMine ? "pending" : "locked"} label={wager.isMine ? "Your offer" : "Unavailable"} />}</article>) : <p className="hub-empty">No open user wagers yet.</p>}</div>
      </>}
    </div></Modal>}
    {mediaModal === "article" && <Modal title="Submit Article" onClose={() => setMediaModal(null)}><div className="hub-media-modal">
      {mediaNotice && <p className="hub-transfer-status">{mediaNotice}</p>}
      {!mediaPortal ? <p className="hub-empty">Loading media desk...</p> : <>
        <p className="hub-muted">{mediaPortal.limits.articleSubmitted ? `Already submitted this week (${mediaPortal.limits.articleStatus}).` : "Submit one custom article per week for commissioner review. Pays $100 on approval."}</p>
        <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={mediaArticle.title} disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => setMediaArticle({ ...mediaArticle, title: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Article body</label><textarea className="form-input" rows={7} value={mediaArticle.body} disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => setMediaArticle({ ...mediaArticle, body: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Image</label><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={mediaPortal.limits.articleSubmitted} onChange={(event) => void uploadMediaImage(event.target.files?.[0] ?? null)} />{mediaArticle.imageUrl && <img className="media-image-preview" src={mediaArticle.imageUrl} alt="" />}</div>
        <Button variant="primary" disabled={mediaBusy || mediaPortal.limits.articleSubmitted || !mediaArticle.title.trim() || !mediaArticle.body.trim()} onClick={() => void submitMediaArticle()}>{mediaBusy ? "Submitting..." : "Submit Article"}</Button>
      </>}
    </div></Modal>}

    {mediaModal === "interview" && <Modal title="Coach Interview" onClose={() => setMediaModal(null)}><div className="hub-media-modal">
      {mediaNotice && <p className="hub-transfer-status">{mediaNotice}</p>}
      {!mediaPortal ? <p className="hub-empty">Loading media desk...</p> : <>
        <p className="hub-muted">{mediaPortal.limits.interviewSubmitted ? `Already submitted this week (${mediaPortal.limits.interviewStatus}).` : "Pick 3 questions and answer them for commissioner review. Pays $50 on approval."}</p>
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
    </div></Modal>}

    {showMySchedule && <Modal title="Full Season Schedule" onClose={() => setShowMySchedule(false)}><div className="hub-my-schedule">
      {myScheduleError ? <div className="hub-empty"><p>{myScheduleError}</p><Button variant="secondary" onClick={() => { setMySchedule(null); void viewMySchedule(); }}>Try again</Button></div> : !mySchedule ? <p className="hub-empty">Loading your schedule...</p> : <ScheduleWeekList weeks={mySchedule.weeks} />}
    </div></Modal>}
  </div>;
}


