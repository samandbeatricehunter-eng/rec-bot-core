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

/**
 * Standard coin payout sources that must not credit wallets in this mode. Contract salary
 * is the only coin grant — it uses source `immortality_contract`.
 */
export const RISE_TO_IMMORTALITY_BLOCKED_COIN_SOURCES = [
  "eos_payout",
  "eos_award",
  "highlight",
  "stream",
  "player_of_week",
  "interview",
  "article",
  "gotw",
  "scheduling_bonus",
  "box_score",
  "badge",
] as const;

export const RISE_TO_IMMORTALITY_ALLOWED_COIN_SOURCES = ["immortality_contract"] as const;

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
