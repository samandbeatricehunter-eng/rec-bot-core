// Store purchase types, fixed REC standard prices, and the position lists used by the
// shared player-target sub-flow. Prices are whole coins ($ in the wallet). Pricing is fixed
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
export const REC_LEGEND_PRICE = 2000;

export type RecDevTier = "normal" | "star" | "superstar" | "xfactor";
export const REC_DEV_TIER_ORDER: RecDevTier[] = ["normal", "star", "superstar", "xfactor"];
export const REC_DEV_TIER_LABELS: Record<RecDevTier, string> = {
  normal: "Normal",
  star: "Star",
  superstar: "Superstar",
  xfactor: "X-Factor",
};
// Price to upgrade INTO a tier (one tier per purchase).
export const REC_DEV_UPGRADE_PRICE: Record<Exclude<RecDevTier, "normal">, number> = {
  star: 250,
  superstar: 750,
  xfactor: 1000,
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
export const REC_ATTRIBUTE_POINT_PRICE = { core: 100, non_core: 50 } as const;

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
  details: Record<string, unknown> = {}
): number {
  switch (purchaseType) {
    case "age_reset":
      return REC_AGE_RESET_PRICE;
    case "player_trait":
      return REC_PLAYER_TRAIT_PRICE;
    case "legend":
      return REC_LEGEND_PRICE;
    case "dev_upgrade": {
      const target = details.targetTier as RecDevTier | undefined;
      return target && target !== "normal" ? REC_DEV_UPGRADE_PRICE[target] ?? 0 : 0;
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
