import { normalizeMaddenDevTrait } from "@rec/shared";

// "normal" is the baseline trait every player who isn't Star/Superstar/X-Factor has -- it gets
// no badge at all (matches the full flip-card player's traitBadgeSrc in PlayerCard.tsx), not a
// "hidden"/unscouted icon. Only star/superstar/xfactor render a badge.
export function DevTraitIcon({ devTrait, className }: { devTrait: string | null | undefined; className?: string }) {
  const tier = normalizeMaddenDevTrait(devTrait);
  if (tier == null || tier === "normal") return null;
  return <img className={className ?? "hub-trade-devtrait-icon"} src={`/assets/dev-traits/${tier}.png`} alt={tier} title={tier} loading="lazy" />;
}
