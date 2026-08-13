/** Canonical Madden development trait keys stored on rec_players.dev_trait. */
export const REC_MADDEN_DEV_TRAIT_KEYS = ["normal", "star", "superstar", "xfactor"] as const;
export type RecMaddenDevTraitKey = (typeof REC_MADDEN_DEV_TRAIT_KEYS)[number];

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
