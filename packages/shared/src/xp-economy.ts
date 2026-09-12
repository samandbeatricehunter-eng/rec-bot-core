// Canonical REC XP economy numbers, ported from docs/handoff-xp-progression/config/xp_economy.json
// (the source-of-truth reference doc) into real, importable runtime constants. Both use the same
// internal scale: 6,000 Progress Points = 1.00 displayed XP. Only the numbers this codebase
// actually wires up live here today -- see PLAYER_XP_ENGINE.md / FRANCHISE_XP_ENGINE.md for the
// full spec (base game caps, dev/rivalry multipliers, season caps, Player Performance Dividend,
// Media Day commitment FPP, team win/streak/playoff-win FPP, player recognition dividend --
// none of that is implemented yet).
export const XP_ECONOMY_POINTS_PER_XP = 6000;

export const PLAYER_XP_CHALLENGE_POINTS = {
  bronze: 600,
  silver: 1200,
  gold: 1800,
} as const;

export const FRANCHISE_XP_CHALLENGE_POINTS = {
  bronze: 900,
  silver: 1800,
  gold: 3000,
} as const;

// Franchise Progress Points for team results/milestones (FRANCHISE_XP_ENGINE.md "Team results /
// milestones"). Streak thresholds pay once each per season, at the tier reached.
export const FRANCHISE_XP_GAME_RESULT_POINTS = {
  regularSeasonWin: 300,
  legitimateUpsetBonus: 600,
  playoffWin: 1200,
  conferenceChampionshipWin: 2400,
  superBowlWin: 4800,
} as const;

export const FRANCHISE_XP_WIN_STREAK_POINTS: Record<number, number> = {
  3: 600,
  5: 1200,
  8: 1800,
};

export function displayedXpFromPoints(points: number): number {
  return Math.round((points / XP_ECONOMY_POINTS_PER_XP) * 100) / 100;
}
