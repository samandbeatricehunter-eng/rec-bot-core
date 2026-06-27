export type RecDisplayTier = "normal" | "bronze" | "silver" | "gold" | "xf";

export const TIER_EMOJIS: Record<Exclude<RecDisplayTier, "normal">, string> = {
  bronze: "🥉",
  silver: "⭐",
  gold: "🌟",
  xf: "⚡",
};

// Keep for backwards compatibility (referenced in index-timeout.ts)
export const DEV_TIER_EMOJIS = TIER_EMOJIS;

export function normalizeDisplayTier(tier?: string | null): RecDisplayTier {
  const normalized = String(tier ?? "normal").toLowerCase();
  if (normalized === "bronze" || normalized === "hidden") return "bronze";
  if (normalized === "silver" || normalized === "star") return "silver";
  if (normalized === "gold" || normalized === "superstar") return "gold";
  if (normalized === "xf" || normalized === "xfactor") return "xf";
  return "normal";
}

export function formatTierEmojiPrefix(tier?: string | null) {
  const normalized = normalizeDisplayTier(tier);
  if (normalized === "normal") return "";
  return `${TIER_EMOJIS[normalized]} `;
}
