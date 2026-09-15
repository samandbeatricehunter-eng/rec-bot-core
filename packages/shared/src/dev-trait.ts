/** Canonical Madden development trait keys stored on rec_players.dev_trait. */
export const REC_MADDEN_DEV_TRAIT_KEYS = ["normal", "star", "superstar", "xfactor"] as const;
export type RecMaddenDevTraitKey = (typeof REC_MADDEN_DEV_TRAIT_KEYS)[number];

/** docs/handoff-xp-progression/01_PLAYER/PLAYER_XP_ENGINE.md's "Dev multiplier" -- applies to
 *  base game performance, player challenge PPP, and configured streak PPP; explicitly NOT to
 *  MVP/OPOY/DPOY/Pro Bowl/season awards/records. A higher dev trait also means a higher OVR-band
 *  XP-per-SP threshold (see weekly-challenges/xp-to-sp.ts), so this is the intended counterweight
 *  -- an elite player earns raw XP faster to offset needing more of it per SP. */
export const DEV_TRAIT_XP_MULTIPLIER: Record<RecMaddenDevTraitKey, number> = {
  normal: 1.00,
  star: 1.05,
  superstar: 1.10,
  xfactor: 1.15,
};

/** Multiplier for a raw dev-trait value (any shape normalizeMaddenDevTrait accepts, or an
 *  already-normalized key) -- defaults to 1.00x (Normal) when unknown/missing. */
export function devTraitXpMultiplier(rawDevTrait: unknown): number {
  const key = normalizeMaddenDevTrait(rawDevTrait);
  return key ? DEV_TRAIT_XP_MULTIPLIER[key] : DEV_TRAIT_XP_MULTIPLIER.normal;
}

/**
 * Normalize companion / EA / scrape payloads into a stored Madden trait key.
 * Madden companion often sends numeric codes: 0 normal, 1 star, 2 superstar, 3 xfactor.
 */
export function normalizeMaddenDevTrait(raw: unknown): RecMaddenDevTraitKey | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    if (n === 0) return "normal";
    if (n === 1) return "star";
    if (n === 2) return "superstar";
    if (n === 3) return "xfactor";
    return null;
  }

  const text = String(raw).trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!text) return null;
  if (text === "0" || text === "normal" || text === "n") return "normal";
  if (text === "1" || text === "star" || text === "s") return "star";
  if (text === "2" || text === "superstar" || text === "ss") return "superstar";
  if (text === "3" || text === "xfactor" || text === "xf" || text === "x-factor") return "xfactor";
  if (text.includes("xfactor")) return "xfactor";
  if (text.includes("superstar")) return "superstar";
  if (text === "star" || text === "elite" || text === "impact") return "star";
  return null;
}
