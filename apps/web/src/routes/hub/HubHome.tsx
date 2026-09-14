import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { americanFromDecimal, CONFERENCE_ORDER, DEFAULT_REC_GLOBAL_ECONOMY_CONFIG, coinsNumber, parlayOdds, potentialPayout, regularSeasonWeeks, stageForWeek, stageHasScheduledGames, stageLabel, type LeagueGame, type RecDevTier, type RecGlobalEconomyConfig, type RecPurchaseType } from "@rec/shared";
import { ArrowDown, ArrowUp, ChevronLeft, RefreshCw, ScrollText, ShoppingBag, SlidersHorizontal, Star, TrendingUp, UserPlus, UsersRound } from "lucide-react";
import { WalletSavingsCard } from "../../components/hub/WalletSavingsCard.js";
import { writeStandingsBoardCache, type StandingsBoardResponse } from "../../lib/standings-board-cache.js";
import { HeroMatchupActions } from "../../components/hub/HeroMatchupActions.js";
import { HeroMatchupBreakdown } from "../../components/hub/HeroMatchupBreakdown.js";
import { GotwVotingCarousel } from "../../components/hub/GotwVotingCarousel.js";
import { GameDayMiniNav, type GameDayNavId } from "../../components/hub/GameDayMiniNav.js";
import { GameDayEmpty, byeWeekEmptyCopy, noGotwEmptyCopy, noScheduleEmptyCopy, offseasonEmptyCopy } from "../../components/hub/GameDayEmpty.js";
import { MatchupGameMedia } from "../../components/hub/MatchupGameMedia.js";
import { MatchupTeamLeaders } from "../../components/hub/MatchupTeamLeaders.js";
import { HeroSchedulingStatus } from "../../components/hub/HeroSchedulingStatus.js";
import { ShareStreamModal } from "../../components/hub/ShareStreamModal.js";
import { RequestHelpSheet } from "../../components/matchups/RequestHelpSheet.js";
import { useAuth, useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { GotwGuessingRecordsResponse, HubMatchupSchedule, HubResponse, LinkedTeamRow, MatchupPreview as MatchupPreviewData, MyEosPayoutProgress, OpenTeam, RosterPlayer, StorePurchaseContext, TeamScheduleManualState, WagerOptionsResponse } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { ErrorPopup } from "../../components/ui/ErrorPopup.js";
import { Button } from "../../components/ui/Button.js";
import { CoinAmount } from "../../components/ui/CoinAmount.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";
import { SectionFrame } from "../../components/design-system/SectionFrame.js";
import { StatusChip } from "../../components/design-system/StatusChip.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { LateSubmissionsModal } from "../../components/hub/LateSubmissionsModal.js";
import { HighlightUploadModal } from "../../components/hub/HighlightUploadModal.js";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";
import { ExpandableMatchupCard } from "../../components/matchups/ExpandableMatchupCard.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";

type HubSection = "league" | "store" | "team" | "roster" | "openTeams" | "schedules" | "trades";
type LeagueSubTab = "matchups";
type MatchupView = "h2h" | "cpu" | "rankings";

const HUB_SECTIONS = new Set<HubSection>(["league", "store", "team", "roster", "openTeams", "schedules", "trades"]);

const LEAGUE_SUB_TABS = new Set<LeagueSubTab>(["matchups"]);

function parseHubSection(value: string | null): HubSection | null {
  if (value && HUB_SECTIONS.has(value as HubSection)) return value as HubSection;
  return null;
}

function parseLeagueSubTab(value: string | null): LeagueSubTab | null {
  // Legacy deep-links: rankings / buzz / news all collapse to matchups (buzz/news retired).
  if (value === "rankings" || value === "buzz" || value === "news") return "matchups";
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

/** My Team page's read-only records row: season / current-season postseason / career (global,
 * all-time) / career postseason (global, all-time). Not buttons -- just info, per the redesign
 * spec. Season and career come from fields already returned by the hub response; postseason
 * (both scopes) reads playoff_wins/playoff_losses columns the API only recently started
 * exposing (leagueSeasonPlayoffText on `my`, globalRecord.playoffText on `profile`). */
function MyTeamRecordRow({ my, profile }: { my: any; profile: any }) {
  return (
    <div className="hub-my-team-record-row">
      <article><span>Season record</span><strong>{my.leagueSeasonRecordText ?? "0-0-0"}</strong></article>
      <article><span>Post-season record</span><strong>{my.leagueSeasonPlayoffText ?? "0-0"}</strong></article>
      <article><span>Career record</span><strong>{profile.globalRecord?.text ?? "0-0-0"}</strong></article>
      <article><span>Career post-season record</span><strong>{profile.globalRecord?.playoffText ?? "0-0"}</strong></article>
    </div>
  );
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
  onUploadHighlight,
}: {
  weeks: TeamScheduleManualState["weeks"];
  game?: LeagueGame;
  currentWeek?: number;
  highlightCounts?: Record<number, number>;
  onUploadHighlight?: (week: TeamScheduleManualState["weeks"][number]) => void;
}) {
  return <div className="hub-schedule-week-list">
    {weeks.map((week) => {
      const eligibleForActions =
        week.alreadyConfirmed && !week.isBye && Boolean(week.gameId) &&
        (currentWeek == null || week.weekNumber <= currentWeek);
      const highlightCount = highlightCounts?.[week.weekNumber] ?? 0;
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
        {onUploadHighlight && missingHighlight ? (
          <div className="hub-schedule-week-actions">
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
/** Game Day only — team/home/store bodies live in apps/site features/league. */
export function GameDayHome({ showGameDayNav = true }: { showGameDayNav?: boolean } = {}) {
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
    legend: (() => {
      // Tier prices are independently configurable per league -- don't assume which tier is
      // cheapest/priciest, derive the displayed range from the actual configured values.
      const tierPrices = [
        economyValues.store.bust, economyValues.store.hometownHero,
        economyValues.store.legend, economyValues.store.celebsCouldveBeens, economyValues.store.immortal,
      ];
      return `${coinsNumber(Math.min(...tierPrices))}-${coinsNumber(Math.max(...tierPrices))}`;
    })(),
    custom_player: `${coinsNumber(economyValues.store.customPlayerTier1)}-${coinsNumber(economyValues.store.customPlayerTier5)}`,
  }), [economyValues]);
  const [error, setError] = useState<string | null>(null);
  const [setupAccess, setSetupAccess] = useState<{ leagueExists: boolean; canSetup: boolean } | null>(null);
  const [section, setSection] = useState<HubSection>("league");
  const [subTab, setSubTab] = useState<LeagueSubTab>(() => parseLeagueSubTab(searchParams.get("subTab")) ?? "matchups");
  const [matchupWeek, setMatchupWeek] = useState<number | null>(null);
  const [matchupSeason, setMatchupSeason] = useState<number | null>(null);
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
  const gameDayView: GameDayNavId = (() => {
    const raw = searchParams.get("view");
    if (raw === "gotw" || raw === "schedule" || raw === "myschedule") return raw;
    return "mine";
  })();
  // CFB support has been removed; this is permanently false now, left as a variable (rather
  // than hand-editing every conditional below) so every existing isCfbLeague branch still
  // resolves correctly to its non-CFB path with zero behavior change. Every direct
  // `hub.league.game === "cfb_27"` check below was folded into this same variable (previously
  // some read live league data directly instead of this constant -- harmless today since no
  // CFB league exists, but it meant those specific spots wouldn't have degraded gracefully if a
  // CFB league somehow existed, e.g. after a restore).
  const isCfbLeague = false;
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
  const [heroPreview, setHeroPreview] = useState<MatchupPreviewData | null>(null);
  const [heroBreakdownExpanded, setHeroBreakdownExpanded] = useState(false);
  const [shareStreamGame, setShareStreamGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [highlightUploadGame, setHighlightUploadGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [requestHelpGame, setRequestHelpGame] = useState<HubMatchupSchedule["games"][number] | null>(null);
  const [lateSubmissionsOpen, setLateSubmissionsOpen] = useState(false);
  const [retireModalOpen, setRetireModalOpen] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retireNickname, setRetireNickname] = useState("");
  const [retireStep, setRetireStep] = useState<1 | 2>(1);
  const [mySchedule, setMySchedule] = useState<TeamScheduleManualState | null>(null);
  const [myScheduleError, setMyScheduleError] = useState<string | null>(null);
  const [myHighlightCounts, setMyHighlightCounts] = useState<Record<number, number> | null>(null);
  const [scheduleHighlightWeek, setScheduleHighlightWeek] = useState<TeamScheduleManualState["weeks"][number] | null>(null);
  const [lateSubmissionsFocus, setLateSubmissionsFocus] = useState<"highlight" | null>(null);
  const [lateSubmissionsWeek, setLateSubmissionsWeek] = useState<number | undefined>(undefined);
  const [editRosterOpen, setEditRosterOpen] = useState(false);
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

  // Game Day deep links only — retire/financials are handled on League Home / Team Home.
  useEffect(() => {
    const requested = searchParams.get("openModal");
    if (!requested) return;
    const next = new URLSearchParams(searchParams);
    next.delete("openModal");
    if (requested === "schedule" && (hub?.league.rosterType !== "rise_to_immortality" || hub?.league.riseHubUnlocked === true)) {
      next.set("view", "myschedule");
      void viewMySchedule();
    } else if (requested === "wager" && hub?.league.rosterType !== "rise_to_immortality") {
      openSportsbook();
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [careerStatsModalOpen, setCareerStatsModalOpen] = useState(false);
  const [divisionModalOpen, setDivisionModalOpen] = useState(false);
  const [gotwGuessing, setGotwGuessing] = useState<GotwGuessingRecordsResponse | null>(null);
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
  // ?openHighlights=1 (optionally [&week=N]) opens the same late-submissions flow the in-app
  // "Upload Highlight(s)" button uses, pre-selecting the week if one was named (still subject
  // to the modal's own eligibility check — a week that's since been filled or aged out just
  // falls back to the picker). Consumed once, then stripped from the URL so it doesn't reopen
  // on back-navigation or a refresh.
  useEffect(() => {
    const openHighlights = searchParams.get("openHighlights") === "1";
    if (!openHighlights) return;
    const weekParam = searchParams.get("week");
    const week = weekParam ? Number(weekParam) : undefined;
    setLateSubmissionsFocus("highlight");
    setLateSubmissionsWeek(Number.isFinite(week) ? week : undefined);
    setLateSubmissionsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openHighlights");
    next.delete("week");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function writeHubParams(nextSection: HubSection, nextSubTab?: LeagueSubTab) {
    const params = new URLSearchParams();
    params.set("section", nextSection);
    if (nextSection === "league") {
      params.set("subTab", nextSubTab ?? "matchups");
    }
    setSearchParams(params, { replace: true });
  }

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
      // Fire-and-forget: the "Season record"/"Point differential" boxes on this page jump
      // straight into Standings. Prefetching here warms both the client cache (so the jump
      // paints instantly even on a first-ever visit this browser) and the server's own
      // withComputeCache for this guild, so it's warm even if the fetch below loses the race.
      void recApi.getStandingsBoard(guildId).then((board) => writeStandingsBoardCache(guildId, board)).catch(() => undefined);
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
    const requestedWeek = gameDayView === "schedule" ? matchupWeek : null;
    recApi.getHubMatchupSchedule({ guildId: auth.guildId, weekNumber: requestedWeek, seasonNumber: matchupSeason })
      .then((schedule) => {
        setMatchupSchedule(schedule);
        setMatchupScheduleError(null);
        if (matchupSeason == null) setMatchupSeason(schedule.seasonNumber);
        // Do not turn the offseason pipeline's internal counter into a Week 1 selection.
        // Leaving the week unset preserves the API's current-offseason empty-state guard.
        if (matchupWeek == null && !schedule.isOffseason) setMatchupWeek(schedule.selectedWeek);
      })
      .catch((cause) => {
        setMatchupSchedule(null);
        setMatchupScheduleError(cause instanceof Error ? cause.message : "Failed to load matchups.");
      })
      .finally(() => setMatchupScheduleLoading(false));
  }, [auth.status, auth.status === "ready" ? auth.guildId : null, subTab, section, gameDayView, matchupWeek, matchupSeason, matchupReloadKey]);

  useEffect(() => {
    if (gameDayView === "schedule" || !hub) return;
    if (!stageHasScheduledGames(hub.league.seasonStage, hub.league.game as LeagueGame)) {
      setMatchupWeek(null);
    }
  }, [gameDayView, hub?.league.seasonStage, hub?.league.game]);

  function retryMatchups() {
    setMatchupSchedule(null);
    setMatchupScheduleError(null);
    setMatchupReloadKey((key) => key + 1);
  }
  function renderMatchupLoadState(label: string) {
    if (matchupScheduleError) {
      return (
        <div className="hub-gameday-empty">
          <strong>{matchupScheduleError}</strong>
          <Button variant="secondary" size="compact" onClick={retryMatchups}>Try again</Button>
        </div>
      );
    }
    if (matchupScheduleLoading || !matchupSchedule) return <GameDayEmpty title={label} />;
    return null;
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
    setMyScheduleError(null);
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
  useEffect(() => {
    if (gameDayView === "myschedule") void viewMySchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameDayView, auth.status === "ready" ? auth.guildId : null]);

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
    // Used to return here with zero feedback -- from the user's side, clicking Submit Purchase
    // did nothing at all (no error, no confirmation), which read as "I submitted it and it just
    // vanished." Surface why instead of failing silently.
    if (auth.status !== "ready") {
      setPurchaseError("Your session isn't ready yet. Please reload the page and try again.");
      return false;
    }
    if (!purchaseType) {
      setPurchaseError("Select what you'd like to purchase first.");
      return false;
    }
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
  const isRise = hub.league.rosterType === "rise_to_immortality";
  const riseHubUnlocked = !isRise || hub.league.riseHubUnlocked === true;
  const rtiGates = hub.league.rtiGates ?? null;
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
  // The active season's record remains the display record throughout the offseason. The
  // season record tables reset when the league advances into the next regular-season Week 1.
  const heroSeasonRecord = my.leagueSeasonRecordText ?? profile.seasonRecord?.text ?? "0-0";
  const heroMatchup = stageHasScheduledGames(hub.league.seasonStage, hub.league.game as LeagueGame)
    ? (matchupSchedule?.games.find((game) => game.gameId === heroCurrentGameId)
      ?? matchupSchedule?.games.find((game) => game.involvesMe)
      ?? null)
    : null;
  const heroOpponent = heroMatchup
    ? heroMatchup.viewerSide === "home"
      ? { abbreviation: heroMatchup.awayTeamAbbr, logoUrl: heroMatchup.awayTeamLogoUrl, name: heroMatchup.awayTeamName }
      : { abbreviation: heroMatchup.homeTeamAbbr, logoUrl: heroMatchup.homeTeamLogoUrl, name: heroMatchup.homeTeamName }
    : null;
  const playerXpTotal = Number(rtiGates?.playerXpTotal ?? my.progressionSummary?.playerXpTotal ?? rtiGates?.playerSnapshots?.reduce((total, player) => total + Number(player.playerXpTotal ?? 0), 0) ?? 0);
  const teamXpTotal = Number(rtiGates?.teamXpTotal ?? my.progressionSummary?.teamXpTotal ?? 0);
  // Real progress toward the next steel shield (FPP remainder mod 6000, computed server-side) --
  // previously this clamped the whole-shield COUNT itself into 0-100, which only looked right
  // by coincidence while teamXpTotal happened to stay under 100.
  const teamXpProgress = Math.max(0, Math.min(100, Number(my.progressionSummary?.teamXpProgressPct ?? 0)));
  // Player XP uses the same 6000-per-point conversion as Team XP (see progressionSummary on the
  // server) -- playerXpProgressPct only applies to the non-RTI aggregate card below; RTI leagues
  // show per-player progress separately via rtiGates.playerSnapshots.
  const playerXpProgress = Math.max(0, Math.min(100, Number(my.progressionSummary?.playerXpProgressPct ?? 0)));
  const recentForm = (my.recentForm ?? []) as Array<{ result: "W" | "L" | "T"; opponentName: string; opponentAbbr: string | null; opponentLogoUrl: string | null }>;
  const openTeamsByConference = (openTeams ?? []).reduce<Record<string, OpenTeam[]>>((groups, team) => {
    const conference = team.conference || "Other";
        (groups[conference] ??= []).push(team);
    return groups;
  }, {});
  const apiBaseUrl = import.meta.env.VITE_REC_CORE_API_URL;


  return <div className="hub-page" data-bg={isRise ? "rise" : isCfbLeague ? "cfb" : "madden"}>
    <div className="hub-body">
      <main className="hub-content">
    <div className="hub-league-tab">
          {showGameDayNav ? <GameDayMiniNav active={gameDayView} leagueId={hub.league.id} /> : null}

          {gameDayView === "mine" ? (
            <SectionFrame eyebrow="This week" title="My Matchup" className="hub-matchup-section">
              {isRise && !riseHubUnlocked ? (
                <div className="hub-hero-no-matchup">
                  <strong>Registration pool</strong>
                  <span>Complete Origins before Game Day unlocks your weekly matchup.</span>
                </div>
              ) : heroMatchup ? (
                <div className="hub-hero-matchup-stack">
                  {auth.status === "ready" && heroMatchup.matchupType === "h2h" && <HeroSchedulingStatus guildId={auth.guildId} gameId={heroMatchup.gameId} reloadKey={matchupReloadKey} />}
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
                      {heroPreview?.gameId === heroMatchup.gameId ? <HeroMatchupBreakdown preview={heroPreview} /> : <GameDayEmpty title="Loading matchup breakdown…" />}
                    </div>
                  ) : null}
                  {auth.status === "ready" && <HeroMatchupActions
                    guildId={auth.guildId}
                    matchup={heroMatchup}
                    onChanged={() => setMatchupReloadKey((value) => value + 1)}
                    onOpenShareStream={() => setShareStreamGame(heroMatchup)}
                    onUploadHighlight={() => setHighlightUploadGame(heroMatchup)}
                    onOpenRequestHelp={heroMatchup.matchupType === "h2h" ? () => setRequestHelpGame(heroMatchup) : undefined}
                  />}
                  <MatchupGameMedia game={heroMatchup} />
                  {auth.status === "ready" ? (
                    <MatchupTeamLeaders
                      guildId={auth.guildId}
                      awayTeamId={heroMatchup.awayTeamId}
                      homeTeamId={heroMatchup.homeTeamId}
                      awayTeamName={heroMatchup.awayTeamName}
                      homeTeamName={heroMatchup.homeTeamName}
                    />
                  ) : null}
                  {isRise && rtiGates?.weeklyChallenges?.length ? (
                    <div className="hub-rti-challenges">
                      <header className="hub-matchup-challenges-head">
                        <span>Weekly challenges</span>
                        <small>Visible only to you</small>
                      </header>
                      {rtiGates.weeklyChallenges.map((player) => (
                        <article key={player.prospectId}>
                          <strong>{player.name || player.position} · {player.position}</strong>
                          <ul>
                            {player.challenges.map((challenge) => (
                              <li key={challenge.id} className={challenge.complete ? "is-complete" : undefined}>
                                <span>{challenge.tier}</span> {challenge.label}
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (() => {
                const empty = matchupSchedule?.isOffseason
                  ? offseasonEmptyCopy(matchupSchedule.offseasonStageLabel)
                  : byeWeekEmptyCopy();
                return <GameDayEmpty title={empty.title} detail={empty.detail} />;
              })()}
            </SectionFrame>
          ) : null}

          {gameDayView === "gotw" ? (
            <section className="hub-matchup-section hub-gotw-page">
              {auth.status === "ready" && gotwGames.length ? (
                <GotwVotingCarousel
                  guildId={auth.guildId}
                  games={gotwGames}
                  guessingRecord={gotwGuessing?.mine}
                  onVote={voteGotw}
                  onOpenWager={isRise ? undefined : (game) => void openWager(game)}
                />
              ) : (() => {
                const empty = matchupSchedule?.isOffseason
                  ? offseasonEmptyCopy(matchupSchedule.offseasonStageLabel)
                  : noGotwEmptyCopy();
                return <GameDayEmpty title={empty.title} detail={empty.detail} />;
              })()}
            </section>
          ) : null}

          {gameDayView === "schedule" ? (
            <SectionFrame eyebrow="Archive & slate" title="League Schedule" className="hub-matchup-section">
              {(() => {
                const state = renderMatchupLoadState("Loading matchups...");
                if (state) return state;
                const schedule = matchupSchedule;
                if (!schedule) return null;
                const leagueGame = hub.league.game as LeagueGame;
                const weekLabelFor = (week: number) => stageLabel(stageForWeek(week, leagueGame), week, leagueGame);
                const selectedWeekLabel = weekLabelFor(schedule.selectedWeek);
                if (schedule.isOffseason && !(schedule.seasonNumbers?.length > 1)) {
                  const empty = offseasonEmptyCopy(schedule.offseasonStageLabel);
                  return <GameDayEmpty title={empty.title} detail={empty.detail} />;
                }
                const h2hGames = schedule.games.filter((game) => game.matchupType === "h2h");
                const cpuGames = schedule.games.filter((game) => game.matchupType === "human_cpu" || game.matchupType === "cpu");
                return <>
                  <div className="hub-schedule-pickers">
                    <label className="hub-week-select">
                      <span>Season</span>
                      <select
                        className="form-input"
                        value={schedule.seasonNumber}
                        onChange={(event) => {
                          setMatchupSeason(Number(event.target.value));
                          setMatchupWeek(null);
                        }}
                      >
                        {(schedule.seasonNumbers?.length ? schedule.seasonNumbers : [schedule.seasonNumber]).map((season) => (
                          <option key={season} value={season}>
                            Season {season}{season === schedule.currentSeasonNumber ? " (Current)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="hub-week-select">
                      <span>Week</span>
                      <select
                        className="form-input"
                        value={schedule.selectedWeek}
                        onChange={(event) => setMatchupWeek(Number(event.target.value))}
                        disabled={!schedule.weekNumbers.length}
                      >
                        {schedule.weekNumbers.map((week) => (
                          <option key={week} value={week}>
                            {weekLabelFor(week)}{week === schedule.currentWeek && schedule.seasonNumber === schedule.currentSeasonNumber ? " (Current)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {!schedule.games.length ? (
                    <GameDayEmpty {...noScheduleEmptyCopy(selectedWeekLabel)} />
                  ) : (
                    <div className="hub-schedule-stack">
                      <section className="hub-schedule-group">
                        <h3>H2H Matchups</h3>
                        {h2hGames.length ? (
                          <div className="rec-matchup-list">
                            {h2hGames.map((game, index) => (
                              <ExpandableMatchupCard key={game.gameId} game={game} featured={game.isGameOfWeek || game.involvesMe || index === 0} />
                            ))}
                          </div>
                        ) : (
                          <GameDayEmpty title="No H2H matchups for this week." detail="Human vs CPU games are listed below when available." />
                        )}
                      </section>
                      <section className="hub-schedule-group">
                        <h3>Human vs CPU</h3>
                        {cpuGames.length ? (
                          <div className="rec-matchup-list">
                            {cpuGames.map((game, index) => (
                              <ExpandableMatchupCard key={game.gameId} game={game} featured={index === 0} />
                            ))}
                          </div>
                        ) : (
                          <GameDayEmpty title="No CPU matchups for this week." />
                        )}
                      </section>
                    </div>
                  )}
                </>;
              })()}
            </SectionFrame>
          ) : null}
          {gameDayView === "myschedule" ? (
            <SectionFrame eyebrow="Full season" title="My Schedule" className="hub-matchup-section">
              {myScheduleError ? <div className="hub-empty"><p>{myScheduleError}</p><Button variant="secondary" onClick={() => { setMySchedule(null); void viewMySchedule(); }}>Try again</Button></div>
                : !mySchedule ? <p className="hub-empty">Loading your schedule...</p>
                : <ScheduleWeekList
                    weeks={mySchedule.weeks}
                    game={mySchedule.game as LeagueGame}
                    currentWeek={hub.league.weekNumber}
                    highlightCounts={myHighlightCounts ?? undefined}
                  />}
            </SectionFrame>
          ) : null}

    </div>
      </main>
    </div>

    {shareStreamGame && auth.status === "ready" && <ShareStreamModal guildId={auth.guildId} gameId={shareStreamGame.gameId} onClose={() => setShareStreamGame(null)} onSubmitted={() => { setShareStreamGame(null); setMatchupReloadKey((value) => value + 1); }} />}
    {highlightUploadGame && auth.status === "ready" && <HighlightUploadModal guildId={auth.guildId} gameId={highlightUploadGame.gameId} onClose={() => setHighlightUploadGame(null)} onSubmitted={() => { setHighlightUploadGame(null); setMatchupReloadKey((value) => value + 1); }} />}
    {requestHelpGame && auth.status === "ready" && <RequestHelpSheet matchup={requestHelpGame} guildId={auth.guildId} onClose={() => setRequestHelpGame(null)} onSubmitted={() => setRequestHelpGame(null)} />}
    {scheduleHighlightWeek && scheduleHighlightWeek.gameId && auth.status === "ready" && <HighlightUploadModal guildId={auth.guildId} gameId={scheduleHighlightWeek.gameId} onClose={() => setScheduleHighlightWeek(null)} onSubmitted={() => { setScheduleHighlightWeek(null); setMySchedule(null); void viewMySchedule(); }} />}
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
    {lateSubmissionsOpen && auth.status === "ready" && <LateSubmissionsModal guildId={auth.guildId} currentWeek={hub.league.weekNumber} initialWeek={lateSubmissionsWeek} onClose={() => { setLateSubmissionsOpen(false); setLateSubmissionsFocus(null); setLateSubmissionsWeek(undefined); }} />}
  </div>;
}

/** @deprecated Use GameDayHome — HubHome is Game Day only now. */
export const HubHome = GameDayHome;
