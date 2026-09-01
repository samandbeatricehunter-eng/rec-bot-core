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

export const WEEKLY_XP = { bronze: 1, silver: 2, gold: 3 } as const;
export const SEASON_XP = { tier1: 8, tier2: 15, tier3: 25 } as const;
export const CAREER_XP = { minor: 20, major: 35, historic: 50 } as const;

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

export const DEV_TRAIT_PROMOTION_XP_COST = 250;

export function purchaseDevTraitPromotion(input: {
  currentDevTrait: ImmortalityDevTrait;
  availableXp: number;
  devTraitPurchaseUnlocked: boolean;
}): { ok: true; nextDevTrait: ImmortalityDevTrait; cost: number } | { ok: false; error: string } {
  if (!input.devTraitPurchaseUnlocked) return { ok: false, error: "Purchase the Self-Made Progression Tree perk before buying a dev-trait promotion." };
  const nextDevTrait = promotionPath(input.currentDevTrait);
  if (!nextDevTrait) return { ok: false, error: "Already at X-Factor — nothing left to promote." };
  if (input.availableXp < DEV_TRAIT_PROMOTION_XP_COST) return { ok: false, error: `Need ${DEV_TRAIT_PROMOTION_XP_COST} Player XP.` };
  return { ok: true, nextDevTrait, cost: DEV_TRAIT_PROMOTION_XP_COST };
}

export const XP_FORMULA_VERSION = FORMULA_VERSIONS.xp;
