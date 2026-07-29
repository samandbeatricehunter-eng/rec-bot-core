const LADDER_BADGES = new Set(["wins_milestone", "games_milestone", "air_milestone", "ground_milestone", "earner", "spender", "saver", "attribute_purchase", "dev_upgrade_purchase"]);
const NEGATIVE_BADGES = new Set(["turnover_trouble", "heartbreaker", "offensive_stall", "ground_game_missing", "chain_stalled", "third_down_drought_m", "red_zone_woes", "defensive_collapse", "yardage_flood", "blowout_victim_m", "pick_parade", "butterfingers", "completion_crisis", "failed_attempts", "third_down_drought", "fourth_down_futility", "ground_game_grounded", "passing_in_mud", "inefficient_attack", "flag_factory", "punt_party", "red_zone_waste", "touchdown_drought", "wasted_volume", "blowout_victim"]);
const SPECIAL_BADGES = new Set(["prolific_passer", "prolific_rusher", "balanced_season", "fourth_down_menace", "dawgin_em", "two_point_identity", "clock_bleeder", "perfect_regular_season", "winning_season", "return_threat", "veteran_coach", "fourth_down_legend", "red_zone_legend", "ground_and_pound_veteran", "air_raid_veteran", "playoff_winner", "dynasty_builder", "super_bowl_champion", "conf_champion", "div_champion", "national_champion", "bowl_winner"]);

export function badgeAsset(key: string, label: string, tier: string | null | undefined): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (SPECIAL_BADGES.has(key)) return `/assets/badges/baked/${slug(key)}.png`;
  if (LADDER_BADGES.has(key)) return `/assets/badges/baked/label-${slug(label)}-${tier === "gold" || tier === "silver" ? tier : "bronze"}.png`;
  if (NEGATIVE_BADGES.has(key)) return `/assets/badges/baked/label-${slug(label)}-negative.png`;
  return `/assets/badges/baked/label-${slug(label)}-positive.png`;
}

export type SiteBadge = {
  badge_key: string;
  badge_label?: string;
  badge_scope: string;
  polarity: string | null;
  tier: string | null;
  earned_count: number | null;
  description?: string;
  earnedByGame?: Record<string, number>;
  league_id?: string | null;
  season?: number | null;
  week?: number | null;
  updated_at?: string | null;
};

export function badgeTooltip(badge: SiteBadge): string {
  const byGame = Object.entries(badge.earnedByGame ?? {})
    .map(([game, count]) => game.replaceAll("_", " ") + ": x" + count)
    .join(" | ");
  const label = badge.badge_label ?? badge.badge_key.replaceAll("_", " ");
  return [
    label,
    badge.description,
    `Scope: ${badge.badge_scope}`,
    badge.tier ? `Tier: ${badge.tier}` : null,
    badge.earned_count ? `Earned ${badge.earned_count} time${badge.earned_count === 1 ? "" : "s"}` : null,
    byGame,
  ]
    .filter(Boolean)
    .join(" — ");
}
