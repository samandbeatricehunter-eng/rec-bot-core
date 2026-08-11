// Store purchase types, fixed REC standard prices, and the position lists used by the
// shared player-target sub-flow. Prices are whole coins in the league wallet. Pricing is fixed
// (not per-league configurable); per-league enabling and season caps live in
// rec_league_configuration and are enforced API-side.

export type RecPurchaseType =
  | "age_reset"
  | "dev_upgrade"
  | "contract"
  | "player_trait"
  | "attribute"
  | "legend"
  | "custom_player";

export const REC_PURCHASE_TYPE_LABELS: Record<RecPurchaseType, string> = {
  age_reset: "Age Reset",
  dev_upgrade: "Dev Upgrade",
  contract: "Contract",
  player_trait: "Player Trait Change",
  attribute: "Attribute Points",
  legend: "Legend",
  custom_player: "Custom Player",
};

// ─── Fixed prices ───────────────────────────────────────────────────────────────
export const REC_AGE_RESET_PRICE = 1000;
export const REC_PLAYER_TRAIT_PRICE = 500;
export const REC_LEGEND_PRICE = 3000;

// Madden's top tier is "X-Factor"; CFB's is "Elite" — otherwise same 4-rung ladder shape.
// CFB's stored dev_trait values order normal < impact < star < elite (matches
// REC_DEV_TRAITS.CFB in packages/shared/src/player-builder/catalog.ts, the custom-player
// builder's source of truth for these same tier keys).
export type RecDevTier = "normal" | "star" | "superstar" | "xfactor" | "impact" | "elite";
export const REC_DEV_TIER_ORDER_BY_GAME: Record<"CFB" | "MADDEN", RecDevTier[]> = {
  CFB: ["normal", "impact", "star", "elite"],
  MADDEN: ["normal", "star", "superstar", "xfactor"],
};
export const REC_DEV_TIER_LABELS: Record<RecDevTier, string> = {
  normal: "Normal",
  star: "Star",
  superstar: "Superstar",
  xfactor: "X-Factor",
  impact: "Impact",
  elite: "Elite",
};
export function devTierOrderForGame(game: string): RecDevTier[] {
  return REC_DEV_TIER_ORDER_BY_GAME[game === "cfb_27" ? "CFB" : "MADDEN"];
}
/** @deprecated Madden-only — use devTierOrderForGame(game) instead. */
export const REC_DEV_TIER_ORDER: RecDevTier[] = REC_DEV_TIER_ORDER_BY_GAME.MADDEN;

// A single-tier step costs 500 coins; the final step into the top tier (X-Factor/Elite)
// costs 1500. Multi-tier purchases (e.g. Normal straight to Elite) compound: sum every step
// crossed in one purchase.
const DEV_UPGRADE_STEP_PRICE = 500;
const DEV_UPGRADE_TOP_TIER_STEP_PRICE = 1500;

/** Coin cost to go from `fromTier` to `toTier` in one purchase, compounding every step
 * crossed. Returns 0 if the tiers are equal or `toTier` isn't higher than `fromTier`. */
export function priceForDevUpgradeSteps(game: string, fromTier: RecDevTier, toTier: RecDevTier): number {
  const order = devTierOrderForGame(game);
  const fromIndex = order.indexOf(fromTier);
  const toIndex = order.indexOf(toTier);
  if (fromIndex === -1 || toIndex === -1 || toIndex <= fromIndex) return 0;
  let total = 0;
  for (let i = fromIndex + 1; i <= toIndex; i++) {
    total += i === order.length - 1 ? DEV_UPGRADE_TOP_TIER_STEP_PRICE : DEV_UPGRADE_STEP_PRICE;
  }
  return total;
}
/** @deprecated Madden-only flat per-target-tier price — kept only for any stale callers still
 * reading it directly; use priceForDevUpgradeSteps(game, fromTier, toTier) instead. */
export const REC_DEV_UPGRADE_PRICE: Record<Exclude<RecDevTier, "normal" | "impact" | "elite">, number> = {
  star: 500,
  superstar: 500,
  xfactor: 1500,
};

export type RecContractVariant = "salary_bonus_reduction" | "extension";
export const REC_CONTRACT_VARIANT_LABELS: Record<RecContractVariant, string> = {
  salary_bonus_reduction: "Salary/Bonus Reduction (−50%)",
  extension: "1-Year Contract Extension",
};
export const REC_CONTRACT_PRICE: Record<RecContractVariant, number> = {
  salary_bonus_reduction: 500,
  extension: 500,
};

// Flat per-point attribute prices.
export const REC_ATTRIBUTE_POINT_PRICE = { core: 200, non_core: 100 } as const;

export type RecCustomPlayerPackage = "bronze" | "silver" | "gold";
export const REC_CUSTOM_PLAYER_PACKAGE_LABELS: Record<RecCustomPlayerPackage, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};
export const REC_CUSTOM_PLAYER_PACKAGE_PRICE: Record<RecCustomPlayerPackage, number> = {
  bronze: 250,
  silver: 750,
  gold: 1000,
};
export const REC_CUSTOM_PLAYER_PACKAGE_POINTS: Record<RecCustomPlayerPackage, number> = {
  bronze: 35,
  silver: 70,
  gold: 100,
};

// ─── Player-target positions (shared sub-flow) ──────────────────────────────────
// Per league owner: Kicker sits under Offense, Punter under Defense.
export const REC_OFFENSE_POSITIONS = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "K"] as const;
export const REC_DEFENSE_POSITIONS = ["LE", "DT", "RE", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "P"] as const;
export type RecPurchaseSide = "offense" | "defense";

// ─── Attribute allocation shape (Phase 2) ───────────────────────────────────────
export type RecAttributeAllocation = { code: string; points: number; core: boolean };

// Compute the coin price for a purchase from its details. Returns 0 for types whose price
// can't be derived (caller should treat that as a configuration error).
export function priceForPurchase(
  purchaseType: RecPurchaseType,
  details: Record<string, unknown> = {},
  game?: string,
): number {
  switch (purchaseType) {
    case "age_reset":
      return REC_AGE_RESET_PRICE;
    case "player_trait":
      return REC_PLAYER_TRAIT_PRICE;
    case "legend":
      return REC_LEGEND_PRICE;
    case "dev_upgrade": {
      const fromTier = details.fromTier as RecDevTier | undefined;
      const toTier = details.toTier as RecDevTier | undefined;
      if (fromTier && toTier && game) return priceForDevUpgradeSteps(game, fromTier, toTier);
      // Legacy shape fallback (flat price to a single target tier, Madden vocabulary only).
      const target = details.targetTier as RecDevTier | undefined;
      return target && target !== "normal" ? REC_DEV_UPGRADE_PRICE[target as Exclude<RecDevTier, "normal" | "impact" | "elite">] ?? 0 : 0;
    }
    case "contract": {
      const variant = details.variant as RecContractVariant | undefined;
      return variant ? REC_CONTRACT_PRICE[variant] ?? 0 : 0;
    }
    case "attribute": {
      const allocations = (details.allocations as RecAttributeAllocation[] | undefined) ?? [];
      return allocations.reduce(
        (sum, a) => sum + (a.core ? REC_ATTRIBUTE_POINT_PRICE.core : REC_ATTRIBUTE_POINT_PRICE.non_core) * Math.max(0, Number(a.points) || 0),
        0
      );
    }
    case "custom_player": {
      const pkg = details.package as RecCustomPlayerPackage | undefined;
      return pkg ? REC_CUSTOM_PLAYER_PACKAGE_PRICE[pkg] ?? 0 : 0;
    }
    default:
      return 0;
  }
}
