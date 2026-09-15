import architectureJson from "./config/unified_challenge_architecture.json" with { type: "json" };

export type XpToSpConversion = {
  xpPerSp: number;
  spEarned: number;
  remainderXp: number;
  totalXpBefore: number;
};

type PlayerOvrBand = { min: number; max: number; xpPerSp: number };

const XP_TO_SP = architectureJson.xpToSp as {
  ownerXpPerSp: number;
  playerOvrBands: PlayerOvrBand[];
};

/** Fixed Owner XP -> SP threshold from the unified architecture package. */
export function ownerXpPerSp(): number {
  return XP_TO_SP.ownerXpPerSp;
}

/** OVR-aware Player XP -> SP threshold. Uses authoritative imported Madden OVR when known;
 * falls back to the lowest band when OVR is missing. */
export function playerXpPerSp(ovr: number | null | undefined): number {
  if (ovr == null || !Number.isFinite(ovr)) return XP_TO_SP.playerOvrBands[0]?.xpPerSp ?? 6000;
  const rating = Math.max(0, Math.min(99, Math.round(ovr)));
  const band = XP_TO_SP.playerOvrBands.find((row) => rating >= row.min && rating <= row.max);
  return band?.xpPerSp ?? XP_TO_SP.playerOvrBands[XP_TO_SP.playerOvrBands.length - 1]?.xpPerSp ?? 6000;
}

/** Convert an XP balance into whole SP + remainder. Remainder always carries forward. */
export function convertXpToSp(balanceXp: number, xpPerSp: number): XpToSpConversion {
  const threshold = Math.max(1, Math.round(xpPerSp));
  const totalXpBefore = Math.max(0, Math.floor(balanceXp));
  const spEarned = Math.floor(totalXpBefore / threshold);
  const remainderXp = totalXpBefore - spEarned * threshold;
  return { xpPerSp: threshold, spEarned, remainderXp, totalXpBefore };
}
