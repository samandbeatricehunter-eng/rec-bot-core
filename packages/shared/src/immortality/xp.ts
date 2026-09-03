import { FORMULA_VERSIONS, type ImmortalityDevTrait } from "./types.js";
import type { CharacteristicModifiers } from "./characteristics.js";

export const PLAYER_TO_TEAM_XP = { player: 4, team: 3 } as const;
export const TEAM_XP_TEAMMATE_OVR_CAP = 95;
export const TEAM_XP_SEASONAL_OVR_GAIN_CAP = 2;

export const DEV_OVR_CEILING: Record<ImmortalityDevTrait, number> = {
  normal: 90,
  star: 93,
  superstar: 96,
  xfactor: 99,
};

// Player XP is not a direct award -- every challenge/milestone/record grants raw "points" into
// a running per-side pool (offense and defense never share one), and XP_POINTS_PER_LEVEL points
// converts to 1 Player XP, flat -- no compounding, the pool just resets toward zero on grant
// (mod arithmetic, see pointsToXp/pointsTowardNextLevel). Calibrated so a genuinely
// high-achieving season (mostly gold weeks + a top season-tier milestone) lands at the low end
// of 20-25 XP, and an all-time season that also breaks a record lands just over it.
export const XP_POINTS_PER_LEVEL = 6000;

export const WEEKLY_CHALLENGE_POINTS = { bronze: 1000, silver: 2500, gold: 5000 } as const;
export const SEASON_MILESTONE_POINTS = { tier1: 10000, tier2: 25000, tier3: 50000 } as const;
export const CAREER_MILESTONE_POINTS = { minor: 200000, major: 400000, historic: 700000 } as const;
/** Awarded once EVERY time this player sets a league (real-NFL-sourced) record, not a one-time bonus. */
export const RECORD_SET_BONUS_POINTS = 25000;

export function pointsToXp(totalPoints: number): number {
  return Math.floor(Math.max(0, totalPoints) / XP_POINTS_PER_LEVEL);
}

export function pointsTowardNextLevel(totalPoints: number): number {
  return Math.max(0, totalPoints) % XP_POINTS_PER_LEVEL;
}

export function xpCostForPlusOne(currentValue: number): number {
  if (currentValue < 70) return 2;
  if (currentValue < 80) return 3;
  if (currentValue < 85) return 5;
  if (currentValue < 90) return 8;
  if (currentValue < 95) return 12;
  if (currentValue < 98) return 18;
  return 30;
}

export function discountedXpCost(currentValue: number, discount: number): number {
  const raw = xpCostForPlusOne(currentValue);
  return Math.max(1, Math.round(raw * (1 - Math.min(0.3, Math.max(0, discount)))));
}

export function ledgerXpBalance(rows: Array<{ player_xp_delta?: number | null; team_xp_delta?: number | null }>): { playerXp: number; teamXp: number } {
  return rows.reduce(
    (sum, row) => ({
      playerXp: sum.playerXp + Number(row.player_xp_delta ?? 0),
      teamXp: sum.teamXp + Number(row.team_xp_delta ?? 0),
    }),
    { playerXp: 0, teamXp: 0 },
  );
}

export function spendAttributePlusOne(input: {
  currentValue: number;
  discount: number;
  currentOvr: number;
  ceiling: number;
  availableXp: number;
}): { ok: true; cost: number; nextValue: number } | { ok: false; error: string } {
  if (input.currentOvr >= input.ceiling) return { ok: false, error: "This player is at his development ceiling." };
  if (input.currentValue >= 99) return { ok: false, error: "That rating is already maxed." };
  const cost = discountedXpCost(input.currentValue, input.discount);
  if (input.availableXp < cost) return { ok: false, error: `Need ${cost} Player XP.` };
  return { ok: true, cost, nextValue: input.currentValue + 1 };
}

export function applyXpEarnBonus(amount: number, modifiers: CharacteristicModifiers): number {
  return Math.round(amount * (1 + modifiers.xpEarnBonus));
}

export function canConvertToTeamXp(input: {
  currentOvr: number;
  devTrait: ImmortalityDevTrait;
  teamPlayer: boolean;
}): boolean {
  if (input.teamPlayer) return true;
  return input.currentOvr >= DEV_OVR_CEILING[input.devTrait];
}

export function convertPlayerXpToTeamXp(playerXp: number): { playerSpent: number; teamGained: number } | { error: string } {
  if (playerXp < PLAYER_TO_TEAM_XP.player) {
    return { error: "Need 4 Player XP to convert 3 Team XP." };
  }
  const bundles = Math.floor(playerXp / PLAYER_TO_TEAM_XP.player);
  return {
    playerSpent: bundles * PLAYER_TO_TEAM_XP.player,
    teamGained: bundles * PLAYER_TO_TEAM_XP.team,
  };
}

export function promotionPath(current: ImmortalityDevTrait): ImmortalityDevTrait | null {
  if (current === "normal") return "star";
  if (current === "star") return "superstar";
  if (current === "superstar") return "xfactor";
  return null;
}

// Cost of the NEXT promotion, keyed by the player's CURRENT dev trait -- calibrated against the
// real ~20-25 XP/season scale above (a great season), not the old flat 250 (over a decade to afford).
export const DEV_TRAIT_PROMOTION_XP_COST: Record<ImmortalityDevTrait, number> = {
  normal: 10,
  star: 30,
  superstar: 150,
  xfactor: 0,
};

export function purchaseDevTraitPromotion(input: {
  currentDevTrait: ImmortalityDevTrait;
  availableXp: number;
  devTraitPurchaseUnlocked: boolean;
}): { ok: true; nextDevTrait: ImmortalityDevTrait; cost: number } | { ok: false; error: string } {
  if (!input.devTraitPurchaseUnlocked) return { ok: false, error: "Purchase the Self-Made Progression Tree perk before buying a dev-trait promotion." };
  return resolveDevTraitPromotionCost(input);
}

export function purchaseTeammateDevTraitPromotion(input: {
  currentDevTrait: ImmortalityDevTrait;
  availableXp: number;
  teammateDevPurchaseUnlocked: boolean;
}): { ok: true; nextDevTrait: ImmortalityDevTrait; cost: number } | { ok: false; error: string } {
  if (!input.teammateDevPurchaseUnlocked) return { ok: false, error: "Purchase the Development Staff Progression Tree perk before buying a teammate promotion." };
  return resolveDevTraitPromotionCost(input);
}

function resolveDevTraitPromotionCost(input: {
  currentDevTrait: ImmortalityDevTrait;
  availableXp: number;
}): { ok: true; nextDevTrait: ImmortalityDevTrait; cost: number } | { ok: false; error: string } {
  const nextDevTrait = promotionPath(input.currentDevTrait);
  if (!nextDevTrait) return { ok: false, error: "Already at X-Factor — nothing left to promote." };
  const cost = DEV_TRAIT_PROMOTION_XP_COST[input.currentDevTrait];
  if (input.availableXp < cost) return { ok: false, error: `Need ${cost} Player XP.` };
  return { ok: true, nextDevTrait, cost };
}

const DEV_TRAIT_ORDER: ImmortalityDevTrait[] = ["normal", "star", "superstar", "xfactor"];

/** Starting Origins trait plus one-step promotions REC has already recorded (pending or applied).
 * EA roster sync overwrites rec_players.dev_trait, so this is the source of truth in-app. */
export function effectiveDevTrait(starting: ImmortalityDevTrait, promotionSteps: number): ImmortalityDevTrait {
  const index = DEV_TRAIT_ORDER.indexOf(starting);
  const next = Math.min(DEV_TRAIT_ORDER.length - 1, Math.max(0, index + Math.max(0, promotionSteps)));
  return DEV_TRAIT_ORDER[next] ?? starting;
}

export const XP_FORMULA_VERSION = FORMULA_VERSIONS.xp;
