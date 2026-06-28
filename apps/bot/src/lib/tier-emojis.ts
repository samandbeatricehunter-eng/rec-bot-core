export type RecDisplayTier = "normal" | "bronze" | "silver" | "gold" | "xf";

export const TIER_EMOJIS: Record<Exclude<RecDisplayTier, "normal">, string> = {
  bronze: "<:dev_Hidden:1519768397796212847>",
  silver: "<:dev_star:1494392249163972699>",
  gold: "<:dev_superstar:1494392251776897134>",
  xf: "<:dev_xfactor:1494392253177663688>",
};

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
