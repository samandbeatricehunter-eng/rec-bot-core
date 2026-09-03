import {
  RISE_TO_IMMORTALITY_GAME,
  RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  RISE_TO_IMMORTALITY_TEMPLATE_ID,
  isRiseToImmortalityLeagueType,
  isRiseToImmortalityTemplateId,
} from "./types.js";

/**
 * Store purchases that exist in standard Madden leagues. Rise to Immortality replaces all of
 * these with Player XP attribute upgrades (and later Team XP). None of these flags may be on.
 */
export const RISE_TO_IMMORTALITY_FORBIDDEN_PURCHASES = [
  "custom_player",
  "legend",
  "dev_upgrade",
  "age_reset",
  "attribute",
  "contract",
  "player_trait",
] as const;

export type RiseToImmortalityForbiddenPurchase = (typeof RISE_TO_IMMORTALITY_FORBIDDEN_PURCHASES)[number];

export const RISE_TO_IMMORTALITY_HIGHLIGHT_PAYOUT = 100;
export const RISE_TO_IMMORTALITY_HIGHLIGHT_WEEKLY_LIMIT = 2;
export const RISE_TO_IMMORTALITY_INTERVIEW_PAYOUT = 100;
export const RISE_TO_IMMORTALITY_ARTICLE_PAYOUT = 100;
/** Paid once per week when a prospect completes that week's full Media Day slate (all 3
 * questions) -- distinct from RISE_TO_IMMORTALITY_INTERVIEW_PAYOUT, which is the older, manually
 * submitted interview type, not the weekly Matchup Interview / Media Day system. */
export const RISE_TO_IMMORTALITY_MEDIA_DAY_PAYOUT = 100;

export const RISE_TO_IMMORTALITY_TEAM_POOLS = ["default_nfl", "custom_32"] as const;
export type RiseToImmortalityTeamPool = (typeof RISE_TO_IMMORTALITY_TEAM_POOLS)[number];

/**
 * Standard coin sources that stay off in this mode. Allowed credits are listed separately:
 * annual contracts, two weekly highlights, GOTW guessing, and interviews.
 */
export const RISE_TO_IMMORTALITY_BLOCKED_COIN_SOURCES = [
  "eos_payout",
  "eos_award",
  "stream",
  "player_of_week",
  "article",
  "scheduling_bonus",
  "box_score",
  "badge",
  "wager",
] as const;

export const RISE_TO_IMMORTALITY_ALLOWED_COIN_SOURCES = [
  "immortality_contract",
  "highlight",
  "gotw",
  "interview",
  "media_day",
] as const;

export const RISE_TO_IMMORTALITY_LOCKED_SETTINGS = {
  game: RISE_TO_IMMORTALITY_GAME,
  leagueType: RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  templateId: RISE_TO_IMMORTALITY_TEMPLATE_ID,
  // Wallets exist so annual REC contracts can pay coins. Standard store + EOS/weekly coin
  // payouts are independently blocked.
  coinEconomyEnabled: true,
  customPlayersEnabled: false,
  customPlayersSeasonCap: 0,
  legendsEnabled: false,
  legendsSeasonCap: 0,
  devUpgradesEnabled: false,
  devUpgradesSeasonCap: 0,
  devUpgradesPlayerCap: 0,
  ageResetsEnabled: false,
  ageResetsSeasonCap: 0,
  // Standard coin attribute purchases stay off. Attribute growth is Player XP only.
  attributePurchasesEnabled: false,
  coreAttributePurchasesSeasonCap: 0,
  nonCoreAttributePurchasesSeasonCap: 0,
  playerTraitPurchasesEnabled: false,
  contractAdjustmentPurchasesEnabled: false,
  contractPurchasesSeasonCap: 0,
  salaryCapEnabled: false,
  tradeDeadlineEnabled: false,
  cpuTradingPolicy: "not_allowed" as const,
  cpuTradingAllowed: false,
  cpuTradesSeasonCap: 0,
  tradeApprovalPolicy: "no_approval_required" as const,
  injuryPolicy: "off" as const,
  wearAndTearEnabled: true,
  abilitiesEnabled: true,
  playerLock: false,
} as const;

export type RiseToImmortalityLockedSettings = typeof RISE_TO_IMMORTALITY_LOCKED_SETTINGS;

export function shouldApplyRiseToImmortality(input: {
  game?: string | null;
  leagueType?: string | null;
  templateId?: string | null;
  rosterType?: string | null;
}): boolean {
  if (isRiseToImmortalityLeagueType(input.leagueType) || isRiseToImmortalityLeagueType(input.rosterType)) {
    return true;
  }
  return isRiseToImmortalityTemplateId(input.templateId) && input.game === RISE_TO_IMMORTALITY_GAME;
}

export function applyRiseToImmortalityLockedSettings<T extends Record<string, unknown>>(input: T): T {
  const locked = RISE_TO_IMMORTALITY_LOCKED_SETTINGS;
  return {
    ...input,
    game: locked.game,
    leagueType: locked.leagueType,
    templateId: locked.templateId,
    coinEconomyEnabled: locked.coinEconomyEnabled,
    customPlayersEnabled: locked.customPlayersEnabled,
    customPlayersSeasonCap: locked.customPlayersSeasonCap,
    legendsEnabled: locked.legendsEnabled,
    legendsSeasonCap: locked.legendsSeasonCap,
    devUpgradesEnabled: locked.devUpgradesEnabled,
    devUpgradesSeasonCap: locked.devUpgradesSeasonCap,
    devUpgradesPlayerCap: locked.devUpgradesPlayerCap,
    ageResetsEnabled: locked.ageResetsEnabled,
    ageResetsSeasonCap: locked.ageResetsSeasonCap,
    attributePurchasesEnabled: locked.attributePurchasesEnabled,
    coreAttributePurchasesSeasonCap: locked.coreAttributePurchasesSeasonCap,
    nonCoreAttributePurchasesSeasonCap: locked.nonCoreAttributePurchasesSeasonCap,
    playerTraitPurchasesEnabled: locked.playerTraitPurchasesEnabled,
    contractAdjustmentPurchasesEnabled: locked.contractAdjustmentPurchasesEnabled,
    contractPurchasesSeasonCap: locked.contractPurchasesSeasonCap,
    salaryCapEnabled: locked.salaryCapEnabled,
    tradeDeadlineEnabled: locked.tradeDeadlineEnabled,
    cpuTradingPolicy: locked.cpuTradingPolicy,
    cpuTradingAllowed: locked.cpuTradingAllowed,
    cpuTradesSeasonCap: locked.cpuTradesSeasonCap,
    tradeApprovalPolicy: locked.tradeApprovalPolicy,
    injuryPolicy: locked.injuryPolicy,
    wearAndTearEnabled: locked.wearAndTearEnabled,
    abilitiesEnabled: locked.abilitiesEnabled,
  };
}

export function isBlockedStandardCoinSource(source: string): boolean {
  return (RISE_TO_IMMORTALITY_BLOCKED_COIN_SOURCES as readonly string[]).includes(source);
}

export function isAllowedRiseToImmortalityCoinSource(source: string): boolean {
  return (RISE_TO_IMMORTALITY_ALLOWED_COIN_SOURCES as readonly string[]).includes(source);
}

/** Interviews and articles both credit through source `media`, distinguished by transactionType. */
export function riseToImmortalityAllowsCoinCredit(source: string, transactionType?: string): boolean {
  if (isAllowedRiseToImmortalityCoinSource(source)) return true;
  if (source === "media" && (transactionType === "interview_payout" || transactionType === "article_payout")) return true;
  return false;
}
