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

export const XP_FORMULA_VERSION = FORMULA_VERSIONS.xp;
